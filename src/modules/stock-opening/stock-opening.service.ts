import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { generateNextCode } from '../../utils/numbering';
import { toDecimalString } from '../../utils/decimal';
import { buildStockOpeningChanges } from '../stock-balance/stock-document-line.helpers';
import type { StockPostingPort } from '../stock-balance/stock-posting.port';
import { stockPostingService } from '../stock-balance/stock-posting.service';
import { createStockOpeningSchema } from '../../dto/stock-opening.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { cacheInvalidationService } from '../../infra/cache-invalidation';
import { documentWorkflowService } from '../document-workflow/document-workflow.service';
import { getDocumentAdapter } from '../document-workflow/adapters/stock-document-adapter';

const CACHE_PREFIX = 'list:stock-openings';

export class StockOpeningService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
    private readonly cache: ListCache = listCache,
  ) {}

  async create(tenantId: string, userId: string, input: unknown) {
    const data = createStockOpeningSchema.parse(input);
    const posted = await this.db.stockOpeningBalance.findFirst({
      where: { tenantId, warehouseId: data.warehouseId, status: 'completed' },
    });
    if (posted) {
      throw new AppError('OPENING_EXISTS', 409, 'Warehouse already has posted opening balance');
    }

    await assertOpeningLines(this.db, tenantId, data.lines);

    const code = await generateNextCode(tenantId, 'stock_opening');
    const created = await this.db.stockOpeningBalance.create({
      data: {
        tenantId,
        code,
        warehouseId: data.warehouseId,
        effectiveDate: new Date(data.effectiveDate),
        note: data.note,
        createdById: userId,
        details: {
          create: data.lines.map((l) => ({
            productId: l.productId,
            qtyBaseUnit: toDecimalString(l.qty, 4),
            unitCost: toDecimalString(l.unitCost, 4),
            batchNo: l.batchNo,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : undefined,
          })),
        },
      },
      include: { details: true },
    });

    const adapter = getDocumentAdapter('stock_opening');
    await documentWorkflowService.initWorkflow(
      tenantId,
      'stock_opening',
      created.id,
      { userId, name: undefined },
      adapter,
      data.workflowAssignedApproverIds,
    );

    await cacheInvalidationService.invalidateStockDocuments(tenantId);
    return created;
  }

  async post(tenantId: string, id: string, userId: string) {
    const result = await this.db.$transaction(async (trx) => {
      const doc = await trx.stockOpeningBalance.findFirst({
        where: { id, tenantId },
        include: { details: true },
      });
      if (!doc) throw new AppError('NOT_FOUND', 404, 'Opening not found');
      if (doc.status === 'completed') {
        throw new AppError('IDEMPOTENT_SKIP', 200, 'Already posted');
      }

      const other = await trx.stockOpeningBalance.findFirst({
        where: {
          tenantId,
          warehouseId: doc.warehouseId,
          status: 'completed',
          id: { not: id },
        },
      });
      if (other) {
        throw new AppError('OPENING_EXISTS', 409, 'Warehouse already has posted opening');
      }

      const ledgerExists = await trx.stockLedger.findFirst({
        where: { tenantId, warehouseId: doc.warehouseId },
      });
      if (ledgerExists) {
        throw new AppError(
          'OPENING_TOO_LATE',
          409,
          'Cannot post opening after other stock transactions exist',
        );
      }

      const changes = await buildStockOpeningChanges(trx, tenantId, doc.warehouseId, doc.details);

      await this.posting.apply(
        {
          direction: 'opening',
          changes,
          ledger: {
            refDocType: 'stock_opening_balance',
            refDocId: id,
            createdById: userId,
          },
        },
        trx,
      );

      return trx.stockOpeningBalance.update({
        where: { id },
        data: {
          status: 'completed',
          postedAt: new Date(),
          approvedById: userId,
        },
        include: { details: true },
      });
    });
    await cacheInvalidationService.invalidateStockMutations(tenantId);
    return result;
  }

  async list(tenantId: string, query?: unknown) {
    const cacheSuffix = !query || Object.keys(query as object).length === 0
      ? 'all'
      : JSON.stringify(paginationSchema.parse(query));
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${cacheSuffix}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    if (!query || Object.keys(query as object).length === 0) {
      const data = await this.db.stockOpeningBalance.findMany({
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
      this.db.stockOpeningBalance.findMany({
        where,
        include: { details: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.stockOpeningBalance.count({ where }),
    ]);
    const result = paginate(data, page, limit, total);
    await this.cache.set(cacheKey, result);
    return result;
  }
}

export const stockOpeningService = new StockOpeningService(prisma, stockPostingService, listCache);

async function assertOpeningLines(
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
