import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { generateNextCode } from '../../utils/numbering';
import { toDecimalString } from '../../utils/decimal';
import { buildStockReceiptChanges, buildStockReceiptDetails } from '../stock-balance/stock-document-line.helpers';
import type { StockPostingPort } from '../stock-balance/stock-posting.port';
import { stockPostingService } from '../stock-balance/stock-posting.service';
import { createStockReceiptSchema, updateStockReceiptSchema } from '../../dto/stock-receipt.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { cacheInvalidationService } from '../../infra/cache-invalidation';
import type { StockDocActor } from '../../shared/notifications/stock-doc-notify';
import {
  notifyReceiptApproved,
  notifyReceiptCancelled,
  notifyReceiptCompleted,
  notifyReceiptRejected,
  notifyReceiptSubmitted,
} from '../../shared/notifications/stock-doc-notify';
import { documentWorkflowService } from '../document-workflow/document-workflow.service';
import { getDocumentAdapter } from '../document-workflow/adapters/stock-document-adapter';
import { enqueueStockMutationCompletion } from '../../infra/stock-mutation-queue';

const CACHE_PREFIX = 'list:stock-receipts';

export class StockReceiptService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  async list(tenantId: string, query?: unknown) {
    const cacheSuffix = !query || Object.keys(query as object).length === 0
      ? 'all'
      : JSON.stringify(paginationSchema.parse(query));
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${cacheSuffix}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    if (!query || Object.keys(query as object).length === 0) {
      const data = await this.db.stockReceipt.findMany({
        where: { tenantId },
        include: { details: true },
        orderBy: { createdAt: 'desc' },
      });
      await this.cache.set(cacheKey, data);
      return data;
    }
    const { page, limit } = paginationSchema.parse(query);
    const where = { tenantId };
    const [data, total] = await Promise.all([
      this.db.stockReceipt.findMany({
        where,
        include: { details: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.stockReceipt.count({ where }),
    ]);
    const result = paginate(data, page, limit, total);
    await this.cache.set(cacheKey, result);
    return result;
  }

  async get(tenantId: string, id: string) {
    const doc = await this.db.stockReceipt.findFirst({
      where: { id, tenantId },
      include: { details: true, supplier: true, warehouse: true },
    });
    if (!doc) throw new AppError('NOT_FOUND', 404, 'Receipt not found');
    return doc;
  }

  async create(tenantId: string, userId: string, input: unknown) {
    const data = createStockReceiptSchema.parse(input);
    assertSupportedReceiptType(data.receiptType);
    await assertTrackedReceiptLines(this.db, tenantId, data.lines);
    const code = await generateNextCode(tenantId, 'stock_receipt');

    const { details, total } = await buildStockReceiptDetails(this.db, data.lines);
    const result = await this.db.stockReceipt.create({
      data: {
        tenantId,
        code,
        warehouseId: data.warehouseId,
        supplierId: data.supplierId,
        receiptType: data.receiptType,
        receiptDate: new Date(data.receiptDate),
        deliveredByName: data.deliveredByName,
        note: data.note,
        createdById: userId,
        totalAmount: toDecimalString(total, 2),
        details: { create: details },
      },
      include: { details: true },
    });

    const adapter = getDocumentAdapter('stock_receipt');
    await documentWorkflowService.initWorkflow(
      tenantId,
      'stock_receipt',
      result.id,
      { userId, name: undefined },
      adapter,
      data.workflowAssignedApproverIds,
    );

    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return result;
  }

  async update(tenantId: string, id: string, input: unknown) {
    const doc = await this.get(tenantId, id);
    if (doc.status !== 'draft') {
      throw new AppError('INVALID_STATUS_TRANSITION', 409, 'Only draft receipts can be updated');
    }
    const data = updateStockReceiptSchema.parse(input);
    assertSupportedReceiptType(data.receiptType);
    await assertTrackedReceiptLines(this.db, tenantId, data.lines);
    const { details, total } = await buildStockReceiptDetails(this.db, data.lines);


    const result = await this.db.$transaction(async (trx) => {
      await trx.stockReceiptDetail.deleteMany({ where: { receiptId: id } });
      return trx.stockReceipt.update({
        where: { id },
        data: {
          warehouseId: data.warehouseId,
          supplierId: data.supplierId,
          receiptType: data.receiptType,
          receiptDate: new Date(data.receiptDate),
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
    return result;
  }

  private async transition(tenantId: string, id: string, from: string[], to: string, extra: object = {}) {
    const doc = await this.get(tenantId, id);
    if (!from.includes(doc.status)) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
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

  async submit(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(tenantId, id, ['draft'], 'pending_approval');
    await notifyReceiptSubmitted(tenantId, result, actor);
    return result;
  }

  async approve(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(tenantId, id, ['pending_approval'], 'approved', {
      approvedById: actor.userId,
      approvedAt: new Date(),
    });
    await notifyReceiptApproved(tenantId, result, actor);
    return result;
  }

  async reject(tenantId: string, id: string, reason: string, actor: StockDocActor) {
    const result = await this.transition(tenantId, id, ['pending_approval'], 'rejected', {
      rejectReason: reason,
    });
    await notifyReceiptRejected(tenantId, result, actor);
    return result;
  }

  async cancel(tenantId: string, id: string, actor: StockDocActor) {
    const result = await this.transition(tenantId, id, ['draft', 'pending_approval', 'approved'], 'cancelled');
    await notifyReceiptCancelled(tenantId, result, actor);
    return result;
  }

  async complete(tenantId: string, id: string, actor: StockDocActor) {
    const receipt = await this.get(tenantId, id);
    if (receipt.status === 'completed') {
      return { queued: false, jobId: null, status: 'completed' };
    }
    if (receipt.status !== 'approved') {
      throw new AppError('INVALID_STATUS_TRANSITION', 409, `Cannot complete from ${receipt.status}`);
    }

    const existingJob = await enqueueStockMutationCompletion({
      tenantId,
      documentType: 'stock_receipt',
      documentId: id,
      actor,
    });

    return {
      queued: true,
      jobId: existingJob.jobId,
      status: 'queued',
    };
  }

  async completeNow(tenantId: string, id: string, actor: StockDocActor) {
    try {
      const result = await this.db.$transaction(async (trx) => {
        const rows = await trx.$queryRaw<
          Array<{ id: string; status: string; warehouse_id: string; supplier_id: string | null }>
        >`
          SELECT id, status, warehouse_id, supplier_id FROM stock_receipts
          WHERE id = ${id} AND tenant_id = ${tenantId}
          FOR UPDATE
        `;
        const receipt = rows[0];
        if (!receipt) throw new AppError('NOT_FOUND', 404, 'Receipt not found');
        if (receipt.status === 'completed') {
          throw new AppError('IDEMPOTENT_SKIP', 200, 'Phiếu đã được hoàn tất trước đó');
        }
        if (receipt.status !== 'approved') {
          throw new AppError(
            'INVALID_STATUS_TRANSITION',
            409,
            `Cannot complete from ${receipt.status}`,
          );
        }

        const details = await trx.stockReceiptDetail.findMany({ where: { receiptId: id } });
        const changes = await buildStockReceiptChanges(trx, tenantId, receipt, details);

        await this.posting.apply(
          {
            direction: 'in',
            changes,
            ledger: { refDocType: 'stock_receipt', refDocId: id, createdById: actor.userId },
          },
          trx,
        );

        const updated = await trx.stockReceipt.update({
          where: { id },
          data: { status: 'completed', completedAt: new Date() },
          include: { details: true },
        });
        await cacheInvalidationService.invalidateStockMutations(tenantId);
        return updated;
      });
      await notifyReceiptCompleted(tenantId, result, actor);
      return result;
    } catch (err) {
      if (err instanceof AppError && err.code === 'IDEMPOTENT_SKIP') {
        return this.get(tenantId, id);
      }
      throw err;
    }
  }

  async cloneFromRejected(tenantId: string, id: string, userId: string) {
    const src = await this.get(tenantId, id);
    if (src.status !== 'rejected') {
      throw new AppError('INVALID_STATUS_TRANSITION', 409, 'Only rejected receipts can be cloned');
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

export const stockReceiptService = new StockReceiptService(prisma, stockPostingService, listCache);

const UNSUPPORTED_RECEIPT_TYPES = new Set(['transfer_in', 'production_output']);

function assertSupportedReceiptType(receiptType: string) {
  if (UNSUPPORTED_RECEIPT_TYPES.has(receiptType)) {
    throw new AppError(
      'VALIDATION_ERROR',
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
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'batchNo cannot be empty',
        [{ productId: line.productId }],
      );
    }
  }
}
