/**
 * DỊCH VỤ TỒN ĐẦU KỲ
 * ------------------
 * Tạo/sửa/duyệt phiếu tồn đầu kỳ; tích hợp workflow phê duyệt.
 * Khi hoàn thành → post vào stock ledger và cập nhật stock balance.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { generateNextCode } from "../../utils/numbering";
import { toDecimalString } from "../../utils/decimal";
import { toVnDate, withVnTimestamps } from "../../utils/vn-time";
import { buildStockOpeningChanges } from "../stock-balance/stock-document-line.helpers";
import type { StockPostingPort } from "../stock-balance/stock-posting.port";
import { stockPostingService } from "../stock-balance/stock-posting.service";
import { createStockOpeningSchema } from "../../dto/stock-opening.dto";
import { paginationSchema, paginate } from "../../dto/pagination.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { cacheInvalidationService } from "../../infra/cache-invalidation";
import { documentWorkflowService } from "../document-workflow/document-workflow.service";
import { getDocumentAdapter } from "../document-workflow/adapters/stock-document-adapter";
import {
  buildStockDocumentVisibilityWhere,
  resolveStockDocVisibilityScope,
  stockDocListCacheVisibilityKey,
  type StockDocVisibilityActor,
} from "../stock-balance/stock-doc-visibility";

const CACHE_PREFIX = "list:stock-openings";

export class StockOpeningService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  async create(tenantId: string, userId: string, input: unknown) {
    const data = createStockOpeningSchema.parse(input);
    const posted = await this.db.stockOpeningBalance.findFirst({
      where: { tenantId, warehouseId: data.warehouseId, status: "completed" },
    });
    if (posted) {
      throw new AppError(
        "OPENING_EXISTS",
        409,
        "Warehouse already has posted opening balance",
      );
    }

    await assertOpeningLines(this.db, tenantId, data.lines);

    const code = await generateNextCode(tenantId, "stock_opening");
    const created = await this.db.stockOpeningBalance.create({
      data: {
        tenantId,
        code,
        warehouseId: data.warehouseId,
        effectiveDate: toVnDate(data.effectiveDate),
        note: data.note,
        createdById: userId,
        details: {
          create: data.lines.map((l) => ({
            productId: l.productId,
            qtyBaseUnit: toDecimalString(l.qty, 4),
            unitCost: toDecimalString(l.unitCost, 4),
            batchNo: l.batchNo,
            expiryDate: l.expiryDate ? toVnDate(l.expiryDate) : undefined,
          })),
        },
      },
      include: { details: true },
    });

    const adapter = getDocumentAdapter("stock_opening");
    const actor = { userId, name: undefined };
    await documentWorkflowService.initWorkflow(
      tenantId,
      "stock_opening",
      created.id,
      actor,
      adapter,
      data.workflowAssignedApproverIds,
    );
    await documentWorkflowService.startReviewOnCreate(
      tenantId,
      "stock_opening",
      created.id,
      actor,
      adapter,
    );

    const workflow = await documentWorkflowService.getWorkflow(
      tenantId,
      "stock_opening",
      created.id,
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps({
      ...created,
      workflowStatus: workflow.status,
      currentStepCode: workflow.currentStepCode,
    });
  }

  /** draft → pending_approval sau duyệt bước đầu sau creator */
  async markPendingApproval(
    tenantId: string,
    id: string,
    _actor: { userId: string },
  ) {
    const doc = await this.db.stockOpeningBalance.findFirst({
      where: { id, tenantId },
      include: { details: true },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Opening not found");
    if (doc.status === "pending_approval") {
      return withVnTimestamps(doc);
    }
    if (doc.status !== "draft") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        "Only draft openings can enter pending_approval",
      );
    }
    const result = await this.db.stockOpeningBalance.update({
      where: { id },
      data: { status: "pending_approval" },
      include: { details: true },
    });
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps(result);
  }

  async post(tenantId: string, id: string, userId: string) {
    const result = await this.db.$transaction(async (trx) => {
      const doc = await trx.stockOpeningBalance.findFirst({
        where: { id, tenantId },
        include: { details: true },
      });
      if (!doc) throw new AppError("NOT_FOUND", 404, "Opening not found");
      if (doc.status === "completed") {
        throw new AppError("IDEMPOTENT_SKIP", 200, "Already posted");
      }

      const other = await trx.stockOpeningBalance.findFirst({
        where: {
          tenantId,
          warehouseId: doc.warehouseId,
          status: "completed",
          id: { not: id },
        },
      });
      if (other) {
        throw new AppError(
          "OPENING_EXISTS",
          409,
          "Warehouse already has posted opening",
        );
      }

      const ledgerExists = await trx.stockLedger.findFirst({
        where: { tenantId, warehouseId: doc.warehouseId },
      });
      if (ledgerExists) {
        throw new AppError(
          "OPENING_TOO_LATE",
          409,
          "Cannot post opening after other stock transactions exist",
        );
      }

      const changes = await buildStockOpeningChanges(
        trx,
        tenantId,
        doc.warehouseId,
        doc.details,
      );

      await this.posting.apply(
        {
          direction: "opening",
          changes,
          ledger: {
            refDocType: "stock_opening_balance",
            refDocId: id,
            createdById: userId,
          },
        },
        trx,
      );

      return trx.stockOpeningBalance.update({
        where: { id },
        data: {
          status: "completed",
          postedAt: new Date(),
          approvedById: userId,
        },
        include: { details: true },
      });
    });
    await cacheInvalidationService.invalidateStockMutations(tenantId);
    return withVnTimestamps(result);
  }

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
        "stock_opening",
        actor,
      );
      const where = { tenantId, ...visibility };
      if (!query || Object.keys(query as object).length === 0) {
        return this.db.stockOpeningBalance.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
        });
      }
      const { page, limit } = paginationSchema.parse(query);
      const [data, total] = await Promise.all([
        this.db.stockOpeningBalance.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.stockOpeningBalance.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
    return withVnTimestamps(result);
  }
}

export const stockOpeningService = new StockOpeningService(
  prisma,
  stockPostingService,
  listCache,
);

async function assertOpeningLines(
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
