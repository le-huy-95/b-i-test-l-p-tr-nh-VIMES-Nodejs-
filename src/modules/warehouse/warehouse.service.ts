import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { warehouseSchema } from '../../dto/warehouse.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { cacheInvalidationService, registerCacheRefreshHandler } from '../../infra/cache-invalidation';

const CACHE_PREFIX = 'list:warehouses';

export class WarehouseService {
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
      const data = await this.db.warehouse.findMany({
        where: { tenantId },
        orderBy: { code: 'asc' },
      });
      await this.cache.set(cacheKey, data);
      return data;
    }
    const { page, limit, search } = paginationSchema.parse(query);
    const where = {
      tenantId,
      ...(search
        ? { OR: [{ code: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.db.warehouse.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.db.warehouse.count({ where }),
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
    const data = warehouseSchema.parse(input);
    try {
      const result = await this.db.warehouse.create({
        data: {
          tenantId,
          code: data.code,
          name: data.name,
          address: data.address,
          phone: data.phone,
          latitude: data.latitude,
          longitude: data.longitude,
          geoSource: data.latitude != null ? 'manual' : undefined,
          geocodeStatus: data.latitude != null ? 'success' : 'not_applicable',
        },
      });
      await cacheInvalidationService.invalidateMasterData(tenantId);
      return result;
    } catch {
      throw new AppError('DUPLICATE_CODE', 409, 'Warehouse code exists');
    }
  }

  async get(tenantId: string, id: string) {
    const wh = await this.db.warehouse.findFirst({ where: { id, tenantId } });
    if (!wh) throw new AppError('NOT_FOUND', 404, 'Warehouse not found');
    return wh;
  }

  async update(tenantId: string, id: string, input: unknown) {
    await this.get(tenantId, id);
    const data = warehouseSchema.partial().parse(input);
    const result = await this.db.warehouse.update({
      where: { id },
      data: {
        ...data,
        geoSource: data.latitude != null ? 'manual' : undefined,
      },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.warehouse.update({
      where: { id },
      data: { isActive: false },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async activate(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.warehouse.update({
      where: { id },
      data: { isActive: true },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }
}

export const warehouseService = new WarehouseService(prisma, listCache);
registerCacheRefreshHandler(CACHE_PREFIX, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await warehouseService.refreshListCache(tenantId, key);
});
