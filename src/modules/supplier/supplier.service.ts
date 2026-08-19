import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { supplierSchema } from '../../dto/supplier.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { cacheInvalidationService, registerCacheRefreshHandler } from '../../infra/cache-invalidation';

const CACHE_PREFIX = 'list:suppliers';

export class SupplierService {
  constructor(
    private readonly db: PrismaClient = prisma,
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
      const data = await this.db.supplier.findMany({
        where: { tenantId, isActive: true },
        orderBy: { code: 'asc' },
      });
      await this.cache.set(cacheKey, data);
      return data;
    }
    const { page, limit, search } = paginationSchema.parse(query);
    const where = {
      tenantId,
      isActive: true,
      ...(search
        ? { OR: [{ code: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }, { contact: { contains: search } }] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.db.supplier.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.db.supplier.count({ where }),
    ]);
    const result = paginate(data, page, limit, total);
    await this.cache.set(cacheKey, result);
    return result;
  }

  async refreshListCache(tenantId: string, cacheKey: string): Promise<void> {
    const suffix = cacheKey.slice(`${CACHE_PREFIX}:${tenantId}:`.length);
    const query = suffix === 'all' ? undefined : JSON.parse(suffix) as unknown;
    await this.cache.invalidate(cacheKey);
    await this.list(tenantId, query);
  }

  async create(tenantId: string, input: unknown) {
    const data = supplierSchema.parse(input);
    try {
      const result = await this.db.supplier.create({ data: { tenantId, ...data } });
      await cacheInvalidationService.invalidateMasterData(tenantId);
      return result;
    } catch {
      throw new AppError('DUPLICATE_CODE', 409, 'Supplier code exists');
    }
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.supplier.findFirst({ where: { id, tenantId } });
    if (!row) throw new AppError('NOT_FOUND', 404, 'Supplier not found');
    return row;
  }

  async update(tenantId: string, id: string, input: unknown) {
    await this.get(tenantId, id);
    const data = supplierSchema.partial().parse(input);
    const result = await this.db.supplier.update({ where: { id }, data });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.supplier.update({
      where: { id },
      data: { isActive: false },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }
}

export const supplierService = new SupplierService(prisma, listCache);
registerCacheRefreshHandler(CACHE_PREFIX, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await supplierService.refreshListCache(tenantId, key);
});
