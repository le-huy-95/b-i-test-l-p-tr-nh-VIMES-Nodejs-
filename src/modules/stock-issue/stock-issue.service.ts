/**
 * DỊCH VỤ PHIẾU XUẤT KHO
 * ----------------------
 * Xuất hàng cho khách, reserve tồn khi chờ duyệt, pick lot FIFO,
 * posting giảm tồn khi completed; tích hợp workflow + notify.
 */
import type { Prisma, PrismaClient } from "../../infra/prisma-types";
import { prisma, pool } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { generateNextCode } from "../../utils/numbering";
import { d, toDecimalString } from "../../utils/decimal";
import { toVnDate, withVnTimestamps } from "../../utils/vn-time";
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
  notifyIssueOutOfStock,
  notifyIssueRejected,
  notifyIssueStockAvailable,
  notifyIssueSubmitted,
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
import { assertStockDocEditableByCreator } from "../stock-balance/stock-doc-edit-lock";

const CACHE_PREFIX = "list:stock-issues";

export class StockIssueService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  /** Danh sách phiếu xuất — cache Redis, lọc theo role/user */
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
        "stock_issue",
        actor,
      );
      const where = { tenantId, ...visibility };
      if (!query || Object.keys(query as object).length === 0) {
        return this.db.stockIssue.findMany({
          where,
          include: { details: true },
          orderBy: { createdAt: "desc" },
        });
      }
      const { page, limit } = paginationSchema.parse(query);
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
    return withVnTimestamps(result);
  }

  /** Chi tiết phiếu xuất kèm dòng hàng */
  async get(tenantId: string, id: string, actor: StockDocVisibilityActor) {
    const visibility = await buildStockDocumentVisibilityWhere(
      this.db,
      tenantId,
      "stock_issue",
      actor,
    );
    const doc = await this.db.stockIssue.findFirst({
      where: { id, tenantId, ...visibility },
      include: {
        details: {
          include: {
            batch: {
              select: {
                id: true,
                productId: true,
                warehouseId: true,
                batchNo: true,
                manufactureDate: true,
                expiryDate: true,
                supplierId: true,
                unitCost: true,
                createdAt: true,
              },
            },
          },
        },
        customer: true,
        warehouse: true,
      },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Issue not found");
    return withVnTimestamps(doc);
  }

  /** Load phiếu theo id trong tenant — dùng nội bộ cho mutation (đã có role guard) */
  private async requireById(tenantId: string, id: string) {
    const doc = await this.db.stockIssue.findFirst({
      where: { id, tenantId },
      include: { details: true, customer: true, warehouse: true },
    });
    if (!doc) throw new AppError("NOT_FOUND", 404, "Issue not found");
    return doc;
  }

  /** Tạo phiếu xuất: draft + workflow in_review (reserve khi sang pending_approval) */
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
        issueDate: toVnDate(data.issueDate),
        deliveredByName: data.deliveredByName,
        note: data.note,
        createdById: userId,
        details: { create: details },
      },
      include: { details: true },
    });

    const actor = { userId, name: undefined };
    const adapter = getDocumentAdapter("stock_issue");
    await documentWorkflowService.initWorkflow(
      tenantId,
      "stock_issue",
      result.id,
      actor,
      adapter,
      data.workflowAssignedApproverIds,
    );
    await documentWorkflowService.startReviewOnCreate(
      tenantId,
      "stock_issue",
      result.id,
      actor,
      adapter,
    );

    await this.markOutOfStockIfInsufficient(tenantId, result.id, actor);

    const created = await this.requireById(tenantId, result.id);
    const workflow = await documentWorkflowService.getWorkflow(
      tenantId,
      "stock_issue",
      result.id,
    );
    await notifyIssueSubmitted(tenantId, created, actor);
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps({
      ...created,
      workflowStatus: workflow.status,
      currentStepCode: workflow.currentStepCode,
    });
  }

  /** Cập nhật phiếu xuất draft — chỉ người tạo khi chưa khóa */
  async update(tenantId: string, id: string, userId: string, input: unknown) {
    const doc = await this.requireById(tenantId, id);
    await assertStockDocEditableByCreator(
      this.db,
      tenantId,
      "stock_issue",
      id,
      doc,
      userId,
    );
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
            issueDate: toVnDate(data.issueDate),
            deliveredByName: data.deliveredByName,
            note: data.note,
            version: { increment: 1 },
            details: { create: details },
          },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return withVnTimestamps(result);
  }

  /** @deprecated Create đã start review — không gọi submit nữa */
  async submit(_tenantId: string, _id: string, _actor: StockDocActor) {
    throw new AppError(
      "SUBMIT_DEPRECATED",
      410,
      "Submit is deprecated; documents enter review on create",
    );
  }

  /** draft → pending_approval + reserve (sau duyệt bước đầu sau creator / legacy submit) */
  async markPendingApproval(
    tenantId: string,
    id: string,
    actor: StockDocActor,
    externalTrx?: Prisma.TransactionClient,
  ) {
    const existing = await this.requireById(tenantId, id);
    if (existing.status === "pending_approval") {
      return withVnTimestamps(existing);
    }
    if (existing.status === "out_of_stock") {
      throw new AppError(
        "STOCK_INSUFFICIENT",
        409,
        "Sản phẩm đã hết trong kho",
        { status: "out_of_stock", issueId: id },
      );
    }

    const run = async (trx: Prisma.TransactionClient) => {
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
      if (locked.status === "pending_approval") {
        const issue = await trx.stockIssue.findFirst({
          where: { id, tenantId },
          include: { details: true },
        });
        if (!issue) throw new AppError("NOT_FOUND", 404, "Issue not found");
        return issue;
      }
      if (locked.status === "out_of_stock") {
        throw new AppError(
          "STOCK_INSUFFICIENT",
          409,
          "Sản phẩm đã hết trong kho",
          { status: "out_of_stock", issueId: id },
        );
      }
      if (locked.status !== "draft") {
        throw new AppError(
          "INVALID_STATUS_TRANSITION",
          409,
          "Only draft can enter pending_approval",
        );
      }
      const warehouseId = locked.warehouseId ?? locked.warehouse_id;
      if (!warehouseId) throw new AppError("NOT_FOUND", 404, "Issue not found");

      const issue = await trx.stockIssue.findFirst({
        where: { id, tenantId },
        include: { details: true },
      });
      if (!issue) throw new AppError("NOT_FOUND", 404, "Issue not found");

      let allocations;
      try {
        allocations = await allocateIssueLines(
          trx,
          tenantId,
          warehouseId,
          issue.details,
          {
            excludeRef: { docType: "stock_issue", docId: id },
          },
        );
      } catch (err) {
        if (isStockInsufficientError(err)) {
          // Commit out_of_stock trên connection riêng khi đang trong workflow txn —
          // tránh bị rollback cùng bước duyệt (Prisma nested savepoint).
          const updated = externalTrx
            ? await commitIssueOutOfStockViaPool({
                id,
                tenantId,
                statusBeforeOutOfStock: "pending_approval",
                reason: formatOutOfStockReason(err),
              })
            : await trx.stockIssue.update({
                where: { id },
                data: {
                  status: "out_of_stock",
                  statusBeforeOutOfStock: "pending_approval",
                  outOfStockAt: new Date(),
                  outOfStockReason: formatOutOfStockReason(err),
                },
                include: { details: true },
              });
          try {
            await notifyIssueOutOfStock(
              tenantId,
              updated,
              actor,
              updated.outOfStockReason,
            );
          } catch (notifyErr) {
            console.error("notifyIssueOutOfStock failed", notifyErr);
          }
          await cacheInvalidationService.invalidateStockDocuments(tenantId);
          if (externalTrx) {
            throw new AppError(
              "STOCK_INSUFFICIENT",
              409,
              "Sản phẩm đã hết trong kho",
              {
                status: "out_of_stock",
                issueId: id,
                details:
                  typeof err === "object" && err !== null && "details" in err
                    ? (err as { details?: unknown }).details
                    : undefined,
              },
            );
          }
          return updated;
        }
        throw err;
      }

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
    };

    const result = externalTrx
      ? await run(externalTrx)
      : await this.db.$transaction(run);

    if (!externalTrx) {
      await cacheInvalidationService.invalidateStockDocuments(tenantId);
    }
    return withVnTimestamps(result);
  }

  /**
   * Sau create (chưa ai duyệt): nếu không đủ tồn theo dòng/lô → out_of_stock ngay.
   */
  async markOutOfStockIfInsufficient(
    tenantId: string,
    id: string,
    actor: StockDocActor,
  ) {
    const issue = await this.db.stockIssue.findFirst({
      where: { id, tenantId },
      include: { details: true },
    });
    if (!issue || issue.status !== "draft") return issue;

    try {
      await this.db.$transaction(async (trx) => {
        await allocateIssueLines(
          trx,
          tenantId,
          issue.warehouseId,
          issue.details,
          {
            excludeRef: { docType: "stock_issue", docId: id },
            dryRun: true,
          },
        );
      });
      return issue;
    } catch (err) {
      if (!isStockInsufficientError(err)) throw err;
      const updated = await this.db.stockIssue.update({
        where: { id },
        data: {
          status: "out_of_stock",
          statusBeforeOutOfStock: "pending_approval",
          outOfStockAt: new Date(),
          outOfStockReason: formatOutOfStockReason(err),
        },
        include: { details: true },
      });
      try {
        await notifyIssueOutOfStock(
          tenantId,
          updated,
          actor,
          updated.outOfStockReason,
        );
      } catch (notifyErr) {
        console.error("notifyIssueOutOfStock failed", notifyErr);
      }
      await cacheInvalidationService.invalidateStockDocuments(tenantId);
      return updated;
    }
  }

  /** Duyệt phiếu xuất qua workflow */
  async approve(tenantId: string, id: string, actor: StockDocActor) {
    const issue = await this.requireById(tenantId, id);
    if (issue.status === "out_of_stock") {
      throw new AppError(
        "STOCK_INSUFFICIENT",
        409,
        "Sản phẩm đã hết trong kho — không thể duyệt",
        { status: "out_of_stock", issueId: id },
      );
    }
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
    return withVnTimestamps(result);
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
        if (
          !issue ||
          (issue.status !== "pending_approval" &&
            issue.status !== "draft" &&
            issue.status !== "out_of_stock")
        ) {
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
          data: {
            status: "rejected",
            rejectReason: reason,
            statusBeforeOutOfStock: null,
            outOfStockAt: null,
            outOfStockReason: null,
          },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueRejected(tenantId, result, actor);
    return withVnTimestamps(result);
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
          !["draft", "pending_approval", "approved", "out_of_stock"].includes(
            issue.status,
          )
        ) {
          throw new AppError("INVALID_STATUS_TRANSITION", 409, "Cannot cancel");
        }
        await trx.stockReservation.updateMany({
          where: { refDocType: "stock_issue", refDocId: id, status: "active" },
          data: { status: "released" },
        });
        return trx.stockIssue.update({
          where: { id },
          data: {
            status: "cancelled",
            statusBeforeOutOfStock: null,
            outOfStockAt: null,
            outOfStockReason: null,
          },
          include: { details: true },
        });
      },
    );
    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    await notifyIssueCancelled(tenantId, result, actor);
    return withVnTimestamps(result);
  }

  /** Hoàn thành bất đồng bộ — trừ tồn qua stock-mutation-queue */
  async complete(tenantId: string, id: string, actor: StockDocActor) {
    const issue = await this.requireById(tenantId, id);
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
          if (issue.status === "out_of_stock") {
            throw new AppError(
              "INVALID_STATUS_TRANSITION",
              409,
              `Cannot complete from ${issue.status}`,
            );
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
          let allocations;
          try {
            allocations = await allocateIssueLines(
              trx,
              tenantId,
              issue.warehouseId,
              details,
              { excludeRef: { docType: "stock_issue", docId: id } },
            );
          } catch (err) {
            if (isStockInsufficientError(err)) {
              return trx.stockIssue.update({
                where: { id },
                data: {
                  status: "out_of_stock",
                  statusBeforeOutOfStock: "approved",
                  outOfStockAt: new Date(),
                  outOfStockReason: formatOutOfStockReason(err),
                },
                include: { details: true },
              });
            }
            throw err;
          }

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

          try {
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
          } catch (err) {
            if (isStockInsufficientError(err)) {
              return trx.stockIssue.update({
                where: { id },
                data: {
                  status: "out_of_stock",
                  statusBeforeOutOfStock: "approved",
                  outOfStockAt: new Date(),
                  outOfStockReason: formatOutOfStockReason(err),
                },
                include: { details: true },
              });
            }
            throw err;
          }

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
      if (result.status === "out_of_stock") {
        try {
          await notifyIssueOutOfStock(
            tenantId,
            result,
            actor,
            result.outOfStockReason,
          );
        } catch (err) {
          console.error("notifyIssueOutOfStock failed", err);
        }
        return withVnTimestamps(result);
      }
      await notifyIssueCompleted(tenantId, result, actor);
      return withVnTimestamps(result);
    } catch (err) {
      if (err instanceof AppError && err.code === "IDEMPOTENT_SKIP") {
        return withVnTimestamps(await this.requireById(tenantId, id));
      }
      throw err;
    }
  }

  /**
   * Sau nhập kho tăng tồn: mở khóa phiếu xuất đang out_of_stock nếu đủ hàng toàn bộ dòng.
   * Restore statusBeforeOutOfStock; nếu pending_approval thì tạo reservation.
   */
  async tryResolveOutOfStockIssues(
    tenantId: string,
    warehouseId: string,
    productIds: string[],
    actor: StockDocActor,
  ) {
    if (productIds.length === 0) return [];

    const resolved: Array<{ id: string; status: string }> = [];

    const candidates = await this.db.stockIssue.findMany({
      where: {
        tenantId,
        warehouseId,
        status: "out_of_stock",
        details: { some: { productId: { in: productIds } } },
      },
      include: { details: true },
    });

    for (const candidate of candidates) {
      const target =
        candidate.statusBeforeOutOfStock === "approved" ||
        candidate.statusBeforeOutOfStock === "pending_approval"
          ? candidate.statusBeforeOutOfStock
          : null;
      if (!target) continue;

      try {
        const updated = await this.db.$transaction(
          async (trx: Prisma.TransactionClient) => {
            const locked = await trx.stockIssue.findFirst({
              where: {
                id: candidate.id,
                tenantId,
                status: "out_of_stock",
              },
              include: { details: true },
            });
            if (!locked) return null;

            const allocations = await allocateIssueLines(
              trx,
              tenantId,
              warehouseId,
              locked.details,
              {
                excludeRef: { docType: "stock_issue", docId: locked.id },
              },
            );

            if (target === "pending_approval") {
              const expiresAt = new Date(Date.now() + 24 * 3600_000);
              const reservations = mergeReservations(
                tenantId,
                warehouseId,
                locked.id,
                expiresAt,
                allocations,
              );
              await trx.stockReservation.createMany({ data: reservations });
            }

            return trx.stockIssue.update({
              where: { id: locked.id },
              data: {
                status: target,
                statusBeforeOutOfStock: null,
                outOfStockAt: null,
                outOfStockReason: null,
              },
              include: { details: true },
            });
          },
        );

        if (!updated) continue;
        await notifyIssueStockAvailable(tenantId, updated, actor);
        resolved.push({ id: updated.id, status: updated.status });
      } catch (err) {
        if (isStockInsufficientError(err)) {
          continue;
        }
        throw err;
      }
    }

    if (resolved.length > 0) {
      await cacheInvalidationService.invalidateStockDocuments(tenantId);
    }
    return resolved;
  }
}

function isStockInsufficientError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "STOCK_INSUFFICIENT"
  );
}

function formatOutOfStockReason(err: unknown): string {
  const details =
    typeof err === "object" && err !== null && "details" in err
      ? (err as { details?: unknown }).details
      : undefined;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : "STOCK_INSUFFICIENT";
  try {
    return JSON.stringify(details ?? message);
  } catch {
    return message;
  }
}

/** Ghi out_of_stock ngoài workflow transaction (connection pool riêng). */
async function commitIssueOutOfStockViaPool(input: {
  id: string;
  tenantId: string;
  statusBeforeOutOfStock: "pending_approval" | "approved";
  reason: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      UPDATE stock_issues
      SET status = 'out_of_stock',
          status_before_out_of_stock = $3::"DocStatus",
          out_of_stock_at = NOW(),
          out_of_stock_reason = $4,
          updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, code, created_by_id AS "createdById", status,
                status_before_out_of_stock AS "statusBeforeOutOfStock",
                out_of_stock_reason AS "outOfStockReason"
      `,
      [
        input.id,
        input.tenantId,
        input.statusBeforeOutOfStock,
        input.reason,
      ],
    );
    if (!result.rows[0]) {
      throw new AppError("NOT_FOUND", 404, "Issue not found");
    }
    await client.query("COMMIT");
    return result.rows[0] as {
      id: string;
      code: string;
      createdById: string;
      status: string;
      statusBeforeOutOfStock: string | null;
      outOfStockReason: string | null;
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
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
  options: {
    excludeRef?: { docType: string; docId: string };
    dryRun?: boolean;
  },
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

    if (!options.dryRun && allocated.length === 1 && line.id) {
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
