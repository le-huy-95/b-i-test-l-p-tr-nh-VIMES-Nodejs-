import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import {
  stockBalanceQuerySchema,
  stockMovementQuerySchema,
  lowStockQuerySchema,
  expiryAlertQuerySchema,
} from '../../dto/report.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { computeExpiryAlerts, computeLowStockItems } from './stock-alert.helpers';
import { registerCacheRefreshHandler } from '../../infra/cache-invalidation';

const CACHE_PREFIX_BALANCE = 'report:stock-balance';
const CACHE_PREFIX_MOVEMENT = 'report:stock-movement';
const CACHE_PREFIX_LOW = 'report:low-stock';
const CACHE_PREFIX_EXPIRY = 'report:expiry-alert';

export class ReportService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  async stockBalance(tenantId: string, query: unknown) {
    const { warehouseId } = stockBalanceQuerySchema.parse(query);
    const { page, limit } = paginationSchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_BALANCE}:${tenantId}:${warehouseId ?? 'all'}:${page}:${limit}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.stockBalance.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, baseUnitName: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.stockBalance.count({ where }),
    ]);
    const result = paginate(data, page, limit, total);
    await this.cache.set(cacheKey, result);
    return result;
  }

  async stockMovement(tenantId: string, query: unknown) {
    const { warehouseId, from, to } = stockMovementQuerySchema.parse(query);
    const { page, limit } = paginationSchema.parse(query);
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const cacheKey = `${CACHE_PREFIX_MOVEMENT}:${tenantId}:${warehouseId ?? 'all'}:${from ?? ''}:${to ?? ''}:${page}:${limit}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const where = {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.db.stockLedger.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.stockLedger.count({ where }),
    ]);
    const result = paginate(data, page, limit, total);
    await this.cache.set(cacheKey, result);
    return result;
  }

  async lowStock(tenantId: string, query: unknown) {
    const { warehouseId } = lowStockQuerySchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_LOW}:${tenantId}:${warehouseId ?? 'all'}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const data = await computeLowStockItems(this.db, tenantId, { warehouseId });
    await this.cache.set(cacheKey, data);
    return data;
  }

  async expiryAlert(tenantId: string, query: unknown) {
    const { warehouseId, days } = expiryAlertQuerySchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_EXPIRY}:${tenantId}:${warehouseId ?? 'all'}:${days}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const data = await computeExpiryAlerts(this.db, tenantId, days, { warehouseId });
    await this.cache.set(cacheKey, data);
    return data;
  }

  async refreshStockBalanceCache(tenantId: string, cacheKey: string): Promise<void> {
    const suffix = cacheKey.slice(`${CACHE_PREFIX_BALANCE}:${tenantId}:`.length);
    const [warehouseIdPart] = suffix.split(':');
    const warehouseId = warehouseIdPart === 'all' ? undefined : warehouseIdPart;
    await this.cache.invalidate(cacheKey);
    await this.stockBalance(tenantId, { warehouseId });
  }

  async refreshStockMovementCache(tenantId: string, cacheKey: string): Promise<void> {
    const suffix = cacheKey.slice(`${CACHE_PREFIX_MOVEMENT}:${tenantId}:`.length);
    const [warehouseIdPart, from = '', to = '', page = '1', limit = '20'] = suffix.split(':');
    const query = {
      warehouseId: warehouseIdPart === 'all' ? undefined : warehouseIdPart,
      from: from || undefined,
      to: to || undefined,
      page: Number(page),
      limit: Number(limit),
    };
    await this.cache.invalidate(cacheKey);
    await this.stockMovement(tenantId, query);
  }

  async refreshLowStockCache(tenantId: string, cacheKey: string): Promise<void> {
    const suffix = cacheKey.slice(`${CACHE_PREFIX_LOW}:${tenantId}:`.length);
    const warehouseId = suffix === 'all' ? undefined : suffix;
    await this.cache.invalidate(cacheKey);
    await this.lowStock(tenantId, { warehouseId });
  }

  async refreshExpiryAlertCache(tenantId: string, cacheKey: string): Promise<void> {
    const suffix = cacheKey.slice(`${CACHE_PREFIX_EXPIRY}:${tenantId}:`.length);
    const [warehouseIdPart, daysPart] = suffix.split(':');
    await this.cache.invalidate(cacheKey);
    await this.expiryAlert(tenantId, {
      warehouseId: warehouseIdPart === 'all' ? undefined : warehouseIdPart,
      days: Number(daysPart),
    });
  }
}

export const reportService = new ReportService(prisma, listCache);
registerCacheRefreshHandler(CACHE_PREFIX_BALANCE, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await reportService.refreshStockBalanceCache(tenantId, key);
});
registerCacheRefreshHandler(CACHE_PREFIX_MOVEMENT, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await reportService.refreshStockMovementCache(tenantId, key);
});
registerCacheRefreshHandler(CACHE_PREFIX_LOW, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await reportService.refreshLowStockCache(tenantId, key);
});
registerCacheRefreshHandler(CACHE_PREFIX_EXPIRY, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await reportService.refreshExpiryAlertCache(tenantId, key);
});
