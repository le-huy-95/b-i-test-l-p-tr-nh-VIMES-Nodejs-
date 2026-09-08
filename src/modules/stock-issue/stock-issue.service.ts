/**
 * DỊCH VỤ PHIẾU XUẤT KHO
 * ----------------------
 * Xuất hàng cho khách, reserve tồn khi chờ duyệt, pick lot FIFO,
 * posting giảm tồn khi completed; tích hợp workflow + notify.
 */
import type { Prisma, PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { generateNextCode } from "../../utils/numbering";
import { d, toDecimalString } from "../../utils/decimal";
import { buildStockIssueDetails } from "../stock-balance/stock-document-line.helpers";
import type { StockPostingPort } from "../stock-balance/stock-posting.port";
import { stockPostingService } from "../stock-balance/stock-posting.service";
import {
  createStockIssueSchema,
  updateStockIssueSchema,
} from "../../dto/stock-issue.dto";
import { paginationSchema, paginate } from "../../dto/pagination.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { cacheInvalidationService } from "../../infra/cache-invalidation";
import { consumeLots } from "../stock-balance/lot-allocation";
import { loadPickableLots } from "../stock-balance/lot-picking";
import type { QtyChange } from "../stock-balance/stock-balance.port";
import type { StockDocActor } from "../../shared/notifications/stock-doc-notify";
import {
  notifyIssueApproved,
  notifyIssueCancelled,
  notifyIssueCompleted,
  notifyIssueRejected,
  notifyIssueSubmitted,
} from "../../shared/notifications/stock-doc-notify";
import { documentWorkflowService } from "../document-workflow/document-workflow.service";
import { getDocumentAdapter } from "../document-workflow/adapters/stock-document-adapter";
import { enqueueStockMutationCompletion } from "../../infra/stock-mutation-queue";

const CACHE_PREFIX = "list:stock-issues";

export class StockIssueService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  /** Danh sách phiếu xuất — cache Redis */
  async list(tenantId: string, query?: unknown) {
    const cacheSuffix =
      !query || Object.keys(query as object).length === 0
        ? "all"
        : JSON.stringify(paginationSchema.parse(query));
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${cacheSuffix}`;
    return this.cache.getOrSet(cacheKey, async () => {
      if (!query || Object.keys(query as object).length === 0) {
        return this.db.stockIssue.findMany({
          where: { tenantId },
          include: { details: true },
          orderBy: { createdAt: "desc" },
        });
      }
      const { page, limit } = paginationSchema.parse(query);
      const where = { tenantId };
      const [data, total] = await Promise.all([
        this.db.stockIssue.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.stockIssue.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
  }

  /** Chi tiết phiếu xuất kèm dòng hàng */
  async get(tenantId: string, id: string) {
    const doc = await this.db.stockIssue.findFirst({
      where: { id, tenantId },
      include: { details: true, customer: true, warehouse: true },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Issue not found");
    return doc;
  }

  /** Tạo phiếu xuất draft — chưa trừ tồn */
  async create(tenantId: string, userId: string, input: unknown) {
    const data = createStockIssueSchema.parse(input);
    if (data.issueType === "sale" && !data.customerId) {
      throw new AppError(
        "VALIDATION_ERROR",
        400,
        "customerId required for sale",
      );
    }
    const code = await generateNextCode(tenantId, "stock_issue");

    const details = await buildStockIssueDetails(this.db, data.lines);

    const result = await this.db.stockIssue.create({
      data: {
        tenantId,
        code,
        warehouseId: data.warehouseId,
        issueType: data.issueType,
        customerId: data.customerId,
        issueDate: new Date(data.issueDate),
        note: data.note,
        createdById: userId,
        details: { create: details },
      },
      include: { details: true },
    });

    const adapter = getDocumentAdapter("stock_issue");
    await documentWorkflowService.initWorkflow(
      tenantId,
      "stock_issue",
      result.id,
      { userId, name: undefined },
      adapter,
      data.workflowAssignedApproverIds,
    );

    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return result;
  }

  /** Cập nhật phiếu xuất draft */
  async update(tenantId: string, id: string, input: unknown) {
    const doc = await this.get(tenantId, id);
    if (doc.status !== "draft") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        "Only draft issues can be updated",
      );
    }
    const data = updateStockIssueSchema.parse(input);
    if (data.issueType === "sale" && !data.customerId) {
      throw new AppError(
        "VALIDATION_ERROR",
        400,
        "customerId required for sale",
      );
    }
    const details = await buildStockIssueDetails(this.db, data.lines);
    const result = await this.db.$transaction(
      async (trx: Prisma.TransactionClient) => {
        await trx.stockIssueDetail.deleteMany({ where: { issueId: id } });
        return trx.stockIssue.update({
          where: { id },
          data: {
            warehouseId: data.warehouseId,
            issueType: data.issueType,
            customerId: data.customerId,
            issueDate: new Date(data.issueDate),
            note: data.note,
            version: { increment: 1 },
            details: { create: details },
          },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return result;
  }

  /** Gửi duyệt — reserve tồn kho và khởi tạo workflow */
  async submit(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.db.$transaction(
      async (trx: Prisma.TransactionClient) => {
        const rows = await trx.$queryRaw<
          Array<{
            id: string;
            status: string;
            warehouseId?: string;
            warehouse_id?: string;
          }>
        >`
        SELECT id, status, warehouse_id AS "warehouseId" FROM stock_issues
        WHERE id = ${id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `;
        const locked = rows[0];
        if (!locked) throw new AppError("NOT_FOUND", 404, "Issue not found");
        if (locked.status !== "draft") {
          throw new AppError(
            "INVALID_STATUS_TRANSITION",
            409,
            "Only draft can submit",
          );
        }
        const warehouseId = locked.warehouseId ?? locked.warehouse_id;
        if (!warehouseId)
          throw new AppError("NOT_FOUND", 404, "Issue not found");

        const issue = await trx.stockIssue.findFirst({
          where: { id, tenantId },
          include: { details: true },
        });
        if (!issue) throw new AppError("NOT_FOUND", 404, "Issue not found");

        const allocations = await allocateIssueLines(
          trx,
          tenantId,
          warehouseId,
          issue.details,
          {
            excludeRef: { docType: "stock_issue", docId: id },
          },
        );

        const expiresAt = new Date(Date.now() + 24 * 3600_000);
        const reservations = mergeReservations(
          tenantId,
          warehouseId,
          id,
          expiresAt,
          allocations,
        );
        await trx.stockReservation.createMany({ data: reservations });

        return trx.stockIssue.update({
          where: { id },
          data: { status: "pending_approval" },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueSubmitted(tenantId, result, actor);
    return result;
  }

  /** Duyệt phiếu xuất qua workflow */
  async approve(tenantId: string, id: string, actor: StockDocActor) {
    const issue = await this.get(tenantId, id);
    if (issue.status !== "pending_approval") {
      throw new AppError("INVALID_STATUS_TRANSITION", 409, "Invalid status");
    }
    const result = await this.db.stockIssue.update({
      where: { id },
      data: {
        status: "approved",
        approvedById: actor.userId,
        approvedAt: new Date(),
      },
      include: { details: true },
    });
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueApproved(tenantId, result, actor);
    return result;
  }

  /** Từ chối — giải phóng reservation đã giữ */
  async reject(
    tenantId: string,
    id: string,
    reason: string,
    actor: StockDocActor,
  ) {
    const result = await this.db.$transaction(
      async (trx: Prisma.TransactionClient) => {
        const issue = await trx.stockIssue.findFirst({
          where: { id, tenantId },
        });
        if (!issue || issue.status !== "pending_approval") {
          throw new AppError(
            "INVALID_STATUS_TRANSITION",
            409,
            "Invalid status",
          );
        }
        await trx.stockReservation.updateMany({
          where: { refDocType: "stock_issue", refDocId: id, status: "active" },
          data: { status: "released" },
        });
        return trx.stockIssue.update({
          where: { id },
          data: { status: "rejected", rejectReason: reason },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueRejected(tenantId, result, actor);
    return result;
  }

  /** Hủy phiếu xuất và giải phóng tồn đã reserve */
  async cancel(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.db.$transaction(
      async (trx: Prisma.TransactionClient) => {
        const issue = await trx.stockIssue.findFirst({
          where: { id, tenantId },
        });
        if (
          !issue ||
          !["draft", "pending_approval", "approved"].includes(issue.status)
        ) {
          throw new AppError("INVALID_STATUS_TRANSITION", 409, "Cannot cancel");
        }
        await trx.stockReservation.updateMany({
          where: { refDocType: "stock_issue", refDocId: id, status: "active" },
          data: { status: "released" },
        });
        return trx.stockIssue.update({
          where: { id },
          data: { status: "cancelled" },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueCancelled(tenantId, result, actor);
    return result;
  }

  /** Hoàn thành bất đồng bộ — trừ tồn qua stock-mutation-queue */
  async complete(tenantId: string, id: string, actor: StockDocActor) {
    const issue = await this.get(tenantId, id);
    if (issue.status === "completed") {
      return { queued: false, jobId: null, status: "completed" };
    }
    if (issue.status !== "approved") {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        409,
        `Cannot complete from ${issue.status}`,
      );
    }

    const existingJob = await enqueueStockMutationCompletion({
      tenantId,
      documentType: "stock_issue",
      documentId: id,
      actor,
    });

    return {
      queued: true,
      jobId: existingJob.jobId,
      status: "queued",
    };
  }

  /** Hoàn thành đồng bộ — pick lot và posting ngay */
  async completeNow(tenantId: string, id: string, actor: StockDocActor) {
    try {
      const result = await this.db.$transaction(
        async (trx: Prisma.TransactionClient) => {
          const rows = await trx.$queryRaw<
            Array<{ id: string; status: string; warehouseId: string }>
          >`
          SELECT id, status, warehouse_id AS "warehouseId" FROM stock_issues
          WHERE id = ${id} AND tenant_id = ${tenantId}
          FOR UPDATE
        `;
          const issue = rows[0]
            ? {
                ...rows[0],
                warehouseId:
                  rows[0].warehouseId ??
                  (rows[0] as { warehouse_id?: string }).warehouse_id,
              }
            : undefined;
          if (!issue) throw new AppError("NOT_FOUND", 404, "Issue not found");
          if (issue.status === "completed") {
            throw new AppError("IDEMPOTENT_SKIP", 200, "Phiếu đã hoàn tất");
          }
          if (issue.status !== "approved") {
            throw new AppError(
              "INVALID_STATUS_TRANSITION",
              409,
              `Cannot complete from ${issue.status}`,
            );
          }

          const details = await trx.stockIssueDetail.findMany({
            where: { issueId: id },
          });
          const allocations = await allocateIssueLines(
            trx,
            tenantId,
            issue.warehouseId,
            details,
            { excludeRef: { docType: "stock_issue", docId: id } },
          );

          const changes: QtyChange[] = allocations.map((item) => ({
            tenantId,
            productId: item.productId,
            warehouseId: issue.warehouseId,
            batchId: item.batchId,
            qtyBaseUnit: item.qtyBaseUnit,
            unitCost: item.unitCost,
          }));

          const merged = mergeQtyChanges(changes);
          merged.sort((a, b) =>
            `${a.productId}:${a.warehouseId}:${a.batchId ?? ""}`.localeCompare(
              `${b.productId}:${b.warehouseId}:${b.batchId ?? ""}`,
            ),
          );

          await this.posting.apply(
            {
              direction: "out",
              changes: merged,
              ledger: {
                refDocType: "stock_issue",
                refDocId: id,
                createdById: actor.userId,
              },
            },
            trx,
          );

          await trx.stockReservation.updateMany({
            where: {
              refDocType: "stock_issue",
              refDocId: id,
              status: "active",
            },
            data: { status: "consumed" },
          });

          return trx.stockIssue.update({
            where: { id },
            data: { status: "completed", completedAt: new Date() },
            include: { details: true },
          });
        },
      );
      await cacheInvalidationService.invalidateStockMutations(tenantId);
      await notifyIssueCompleted(tenantId, result, actor);
      return result;
    } catch (err) {
      if (err instanceof AppError && err.code === "IDEMPOTENT_SKIP") {
        return this.get(tenantId, id);
      }
      throw err;
    }
  }
}

async function allocateIssueLines(
  trx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  details: Array<{
    id?: string;
    productId: string;
    qtyBaseUnit: { toString(): string };
    batchId?: string | null;
  }>,
  options: { excludeRef?: { docType: string; docId: string } },
) {
  const productIds = [...new Set(details.map((line) => line.productId))];
  const lotsByProduct = await loadPickableLots(trx, {
    tenantId,
    warehouseId,
    productIds,
    excludeRef: options.excludeRef,
  });

  const out: Array<{
    productId: string;
    batchId: string | null;
    qtyBaseUnit: string;
    unitCost: string;
  }> = [];

  for (const line of details) {
    const lots = lotsByProduct.get(line.productId) ?? [];
    let allocated;
    if (line.batchId) {
      const lot = lots.find((item) => item.batchId === line.batchId);
      if (!lot) {
        throw new AppError(
          "STOCK_INSUFFICIENT",
          409,
          "Không đủ tồn kho theo lô",
          [{ productId: line.productId, batchId: line.batchId }],
        );
      }
      allocated = consumeLots(line.qtyBaseUnit.toString(), [lot], "none");
    } else {
      allocated = consumeLots(line.qtyBaseUnit.toString(), lots, "none");
    }

    if (allocated.length === 1 && line.id) {
      await trx.stockIssueDetail.update({
        where: { id: line.id },
        data: { batchId: allocated[0].batchId },
      });
    }

    for (const part of allocated) {
      out.push({
        productId: line.productId,
        batchId: part.batchId,
        qtyBaseUnit: part.qtyBaseUnit,
        unitCost: resolveIssueUnitCost(part.unitCost),
      });
    }
  }
  return out;
}

function resolveIssueUnitCost(lotUnitCost?: string) {
  return lotUnitCost ?? "0";
}

function mergeReservations(
  tenantId: string,
  warehouseId: string,
  issueId: string,
  expiresAt: Date,
  allocations: Array<{
    productId: string;
    batchId: string | null;
    qtyBaseUnit: string;
  }>,
) {
  const grouped = new Map<
    string,
    { productId: string; batchId: string | null; qtyBaseUnit: string }
  >();
  for (const part of allocations) {
    const key = `${part.productId}:${part.batchId ?? ""}`;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, { ...part });
      continue;
    }
    grouped.set(key, {
      ...prev,
      qtyBaseUnit: toDecimalString(
        d(prev.qtyBaseUnit).plus(part.qtyBaseUnit),
        4,
      ),
    });
  }
  return [...grouped.values()].map((row) => ({
    tenantId,
    productId: row.productId,
    warehouseId,
    batchId: row.batchId,
    refDocType: "stock_issue",
    refDocId: issueId,
    qtyBaseUnit: row.qtyBaseUnit,
    expiresAt,
  }));
}

function mergeQtyChanges(changes: QtyChange[]): QtyChange[] {
  const grouped = new Map<string, QtyChange>();
  for (const change of changes) {
    const key = `${change.productId}:${change.warehouseId}:${change.batchId ?? ""}:${change.locationId ?? ""}`;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, { ...change });
      continue;
    }
    grouped.set(key, {
      ...prev,
      qtyBaseUnit: toDecimalString(
        d(prev.qtyBaseUnit).plus(change.qtyBaseUnit),
        4,
      ),
    });
  }
  return [...grouped.values()];
}

export const stockIssueService = new StockIssueService(
  prisma,
  stockPostingService,
  listCache,
);
