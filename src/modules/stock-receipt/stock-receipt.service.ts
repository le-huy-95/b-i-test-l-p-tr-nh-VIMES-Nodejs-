/**
 * DỊCH VỤ PHIẾU NHẬP KHO
 * ----------------------
 * Tạo phiếu nhập từ NCC, workflow duyệt, posting tồn kho khi completed.
 * Hỗ trợ batch/lot, costing, thông báo realtime.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { generateNextCode } from "../../utils/numbering";
import { toDecimalString } from "../../utils/decimal";
import { toVnDate, withVnTimestamps } from "../../utils/vn-time";
import {
  buildStockReceiptChanges,
  buildStockReceiptDetails,
} from "../stock-balance/stock-document-line.helpers";
import type { StockPostingPort } from "../stock-balance/stock-posting.port";
import { stockPostingService } from "../stock-balance/stock-posting.service";
import {
  createStockReceiptSchema,
  updateStockReceiptSchema,
} from "../../dto/stock-receipt.dto";
import { paginationSchema, paginate } from "../../dto/pagination.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { cacheInvalidationService } from "../../infra/cache-invalidation";
import type { StockDocActor } from "../../shared/notifications/stock-doc-notify";
import {
  notifyReceiptApproved,
  notifyReceiptCancelled,
  notifyReceiptCompleted,
  notifyReceiptRejected,
  notifyReceiptSubmitted,
} from "../../shared/notifications/stock-doc-notify";
import { documentWorkflowService } from "../document-workflow/document-workflow.service";
import { getDocumentAdapter } from "../document-workflow/adapters/stock-document-adapter";
import { enqueueStockMutationCompletion } from "../../infra/stock-mutation-queue";
import {
  buildStockDocumentVisibilityWhere,
  resolveStockDocVisibilityScope,
  stockDocListCacheVisibilityKey,
  type StockDocVisibilityActor,
} from "../stock-balance/stock-doc-visibility";

const CACHE_PREFIX = "list:stock-receipts";

export class StockReceiptService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  /** Danh sách phiếu nhập — cache Redis, lọc theo role/user */
  async list(tenantId: string, actor: StockDocVisibilityActor, query?: unknown) {
    const scope = resolveStockDocVisibilityScope(actor.role);
    const visibilityKey = stockDocListCacheVisibilityKey(scope, actor.userId);
    const cacheSuffix =
      !query || Object.keys(query as object).length === 0
        ? "all"
        : JSON.stringify(paginationSchema.parse(query));
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${visibilityKey}:${cacheSuffix}`;
    const result = await this.cache.getOrSet(cacheKey, async () => {
      const visibility = await buildStockDocumentVisibilityWhere(
        this.db,
        tenantId,
        "stock_receipt",
        actor,
      );
      const where = { tenantId, ...visibility };
      if (!query || Object.keys(query as object).length === 0) {
        return this.db.stockReceipt.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
        });
      }
      const { page, limit } = paginationSchema.parse(query);
      const [data, total] = await Promise.all([
        this.db.stockReceipt.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.stockReceipt.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
    return withVnTimestamps(result);
  }

  /** Chi tiết 1 phiếu nhập kèm dòng hàng */
  async get(tenantId: string, id: string, actor: StockDocVisibilityActor) {
    const visibility = await buildStockDocumentVisibilityWhere(
      this.db,
      tenantId,
      "stock_receipt",
      actor,
    );
    const doc = await this.db.stockReceipt.findFirst({
      where: { id, tenantId, ...visibility },
      include: { details: true, supplier: true, warehouse: true },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Receipt not found");
    return withVnTimestamps(doc);
  }

  /** Load phiếu theo id trong tenant — dùng nội bộ cho mutation (đã có role guard) */
  private async requireById(tenantId: string, id: string) {
    const doc = await this.db.stockReceipt.findFirst({
      where: { id, tenantId },
      include: { details: true, supplier: true, warehouse: true },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Receipt not found");
    return doc;
  }

  /** Tạo phiếu nhập mới ở trạng thái draft, sinh mã tự động */
  async create(tenantId: string, userId: string, input: unknown) {
    const data = createStockReceiptSchema.parse(input);
    assertSupportedReceiptType(data.receiptType);
    await assertTrackedReceiptLines(this.db, tenantId, data.lines);
    const code = await generateNextCode(tenantId, "stock_receipt");

    const { details, total } = await buildStockReceiptDetails(
      this.db,
      data.lines,
    );
    const result = await this.db.stockReceipt.create({
      data: {
        tenantId,
        code,
        warehouseId: data.warehouseId,
        supplierId: data.supplierId,
        receiptType: data.receiptType,
        receiptDate: toVnDate(data.receiptDate),
        deliveredByName: data.deliveredByName,
        note: data.note,
        createdById: userId,
        totalAmount: toDecimalString(total, 2),
        details: { create: details },
      },
      include: { details: true },
    });

    const adapter = getDocumentAdapter("stock_receipt");
    await documentWorkflowService.initWorkflow(
      tenantId,
      "stock_receipt",
      result.id,
      { userId, name: undefined },
      adapter,
      data.workflowAssignedApproverIds,
    );

    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps(result);
  }

  /** Cập nhật phiếu draft — không cho sửa khi đã submit/duyệt */
  async update(tenantId: string, id: string, input: unknown) {
    const doc = await this.requireById(tenantId, id);
    if (doc.status !== "draft") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        "Only draft receipts can be updated",
      );
    }
    const data = updateStockReceiptSchema.parse(input);
    assertSupportedReceiptType(data.receiptType);
    await assertTrackedReceiptLines(this.db, tenantId, data.lines);
    const { details, total } = await buildStockReceiptDetails(
      this.db,
      data.lines,
    );

    const result = await this.db.$transaction(async (trx) => {
      await trx.stockReceiptDetail.deleteMany({ where: { receiptId: id } });
      return trx.stockReceipt.update({
        where: { id },
        data: {
          warehouseId: data.warehouseId,
          supplierId: data.supplierId,
          receiptType: data.receiptType,
          receiptDate: toVnDate(data.receiptDate),
          deliveredByName: data.deliveredByName,
          note: data.note,
          totalAmount: toDecimalString(total, 2),
          version: { increment: 1 },
          details: { create: details },
        },
        include: { details: true },
      });
    });
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps(result);
  }

  private async transition(
    tenantId: string,
    id: string,
    from: string[],
    to: string,
    extra: object = {},
  ) {
    const doc = await this.requireById(tenantId, id);
    if (!from.includes(doc.status)) {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        `Cannot transition from ${doc.status} to ${to}`,
      );
    }
    const result = await this.db.stockReceipt.update({
      where: { id },
      data: { status: to as never, ...extra },
      include: { details: true },
    });
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return result;
  }

  /** Gửi duyệt — khởi tạo workflow và chuyển sang pending_approval */
  async submit(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(
      tenantId,
      id,
      ["draft"],
      "pending_approval",
    );
    await notifyReceiptSubmitted(tenantId, result, actor);
    return withVnTimestamps(result);
  }

  /** Duyệt phiếu qua workflow engine */
  async approve(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(
      tenantId,
      id,
      ["pending_approval"],
      "approved",
      {
        approvedById: actor.userId,
        approvedAt: new Date(),
      },
    );
    await notifyReceiptApproved(tenantId, result, actor);
    return withVnTimestamps(result);
  }

  /** Từ chối phiếu — workflow reject, trả về trạng thái rejected */
  async reject(
    tenantId: string,
    id: string,
    reason: string,
    actor: StockDocActor,
  ) {
    const result = await this.transition(
      tenantId,
      id,
      ["pending_approval"],
      "rejected",
      {
        rejectReason: reason,
      },
    );
    await notifyReceiptRejected(tenantId, result, actor);
    return withVnTimestamps(result);
  }

  /** Hủy phiếu (draft hoặc pending) — không ảnh hưởng tồn kho */
  async cancel(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(
      tenantId,
      id,
      ["draft", "pending_approval", "approved"],
      "cancelled",
    );
    await notifyReceiptCancelled(tenantId, result, actor);
    return withVnTimestamps(result);
  }

  /** Hoàn thành phiếu — đưa vào hàng đợi posting tồn kho bất đồng bộ */
  async complete(tenantId: string, id: string, actor: StockDocActor) {
    const receipt = await this.requireById(tenantId, id);
    if (receipt.status === "completed") {
      return { queued: false, jobId: null, status: "completed" };
    }
    if (receipt.status !== "approved") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        `Cannot complete from ${receipt.status}`,
      );
    }

    const existingJob = await enqueueStockMutationCompletion({
      tenantId,
      documentType: "stock_receipt",
      documentId: id,
      actor,
    });

    return {
      queued: true,
      jobId: existingJob.jobId,
      status: "queued",
    };
  }

  /** Hoàn thành đồng bộ ngay — posting tồn kho trong cùng request */
  async completeNow(tenantId: string, id: string, actor: StockDocActor) {
    try {
      const result = await this.db.$transaction(async (trx) => {
        const rows = await trx.$queryRaw<
          Array<{
            id: string;
            status: string;
            warehouse_id: string;
            supplier_id: string | null;
          }>
        >`
          SELECT id, status, warehouse_id, supplier_id FROM stock_receipts
          WHERE id = ${id} AND tenant_id = ${tenantId}
          FOR UPDATE
        `;
        const receipt = rows[0];
        if (!receipt) throw new AppError("NOT_FOUND", 404, "Receipt not found");
        if (receipt.status === "completed") {
          throw new AppError(
            "IDEMPOTENT_SKIP",
            200,
            "Phiếu đã được hoàn tất trước đó",
          );
        }
        if (receipt.status !== "approved") {
          throw new AppError(
            "INVALID_STATUS_TRANSITION",
            409,
            `Cannot complete from ${receipt.status}`,
          );
        }

        const details = await trx.stockReceiptDetail.findMany({
          where: { receiptId: id },
        });
        const changes = await buildStockReceiptChanges(
          trx,
          tenantId,
          receipt,
          details,
        );

        await this.posting.apply(
          {
            direction: "in",
            changes,
            ledger: {
              refDocType: "stock_receipt",
              refDocId: id,
              createdById: actor.userId,
            },
          },
          trx,
        );

        const updated = await trx.stockReceipt.update({
          where: { id },
          data: { status: "completed", completedAt: new Date() },
          include: { details: true },
        });
        await cacheInvalidationService.invalidateStockMutations(tenantId);
        return updated;
      });
      await notifyReceiptCompleted(tenantId, result, actor);
      return withVnTimestamps(result);
    } catch (err) {
      if (err instanceof AppError && err.code === "IDEMPOTENT_SKIP") {
        return withVnTimestamps(await this.requireById(tenantId, id));
      }
      throw err;
    }
  }

  /** Sao chép phiếu bị reject thành phiếu draft mới để chỉnh sửa lại */
  async cloneFromRejected(tenantId: string, id: string, userId: string) {
    const src = await this.requireById(tenantId, id);
    if (src.status !== "rejected") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        "Only rejected receipts can be cloned",
      );
    }
    return this.create(tenantId, userId, {
      warehouseId: src.warehouseId,
      supplierId: src.supplierId ?? undefined,
      receiptType: src.receiptType,
      receiptDate: src.receiptDate.toISOString().slice(0, 10),
      deliveredByName: src.deliveredByName ?? undefined,
      note: src.note ?? undefined,
      lines: src.details.map((l) => ({
        productId: l.productId,
        unitName: l.unitName,
        expectedQty: Number(l.expectedQty),
        actualQty: Number(l.actualQty),
        unitPrice: Number(l.unitPrice),
        batchNo: l.batchNo ?? undefined,
        expiryDate: l.expiryDate?.toISOString(),
      })),
    });
  }
}

export const stockReceiptService = new StockReceiptService(
  prisma,
  stockPostingService,
  listCache,
);

const UNSUPPORTED_RECEIPT_TYPES = new Set(["transfer_in", "production_output"]);

function assertSupportedReceiptType(receiptType: string) {
  if (UNSUPPORTED_RECEIPT_TYPES.has(receiptType)) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      `${receiptType} is not supported until transfer/production modules exist`,
    );
  }
}

async function assertTrackedReceiptLines(
  _db: PrismaClient,
  _tenantId: string,
  lines: Array<{ productId: string; batchNo?: string }>,
) {
  for (const line of lines) {
    if (line.batchNo && !line.batchNo.trim()) {
      throw new AppError("VALIDATION_ERROR", 400, "batchNo cannot be empty", [
        { productId: line.productId },
      ]);
    }
  }
}
