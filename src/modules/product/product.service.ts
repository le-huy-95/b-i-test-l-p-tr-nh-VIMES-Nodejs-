import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { productSchema } from '../../dto/product.dto';
import { paginationSchema, paginate } from '../../dto/pagination.dto';
import { listCache } from '../../infra/redis-list-cache';
import type { ListCache } from '../common/list-cache.port';
import { cacheInvalidationService, registerCacheRefreshHandler } from '../../infra/cache-invalidation';
import { d, toDecimalString } from '../../utils/decimal';

const CACHE_PREFIX = 'list:products';

export class ProductService {
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
      const data = await this.db.product.findMany({
        where: { tenantId, isActive: true },
        include: { units: true },
        orderBy: { sku: 'asc' },
      });
      await this.cache.set(cacheKey, data);
      return data;
    }

    const { page, limit, search } = paginationSchema.parse(query);
    const where = {
      tenantId,
      isActive: true,
      ...(search
        ? { OR: [{ sku: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }, { barcode: { contains: search, mode: 'insensitive' as const } }] }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.db.product.findMany({
        where,
        include: { units: true },
        orderBy: { sku: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.product.count({ where }),
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
    const data = productSchema.parse(input);
    const fileId = data.imageFileId ?? data.fileIds?.[0];
    let imageUrl = data.imageUrl;

    if (fileId) {
      const file = await this.db.uploadedFile.findFirst({
        where: { id: fileId, tenantId },
        select: { url: true, mimeType: true },
      });
      if (!file) throw new AppError('NOT_FOUND', 404, 'Product image file not found');
      if (!file.mimeType.startsWith('image/')) {
        throw new AppError('INVALID_FILE_TYPE', 400, 'Product image must be an image file');
      }
      imageUrl = file.url;
    }

    try {
      const result = await this.db.product.create({
        data: {
          tenantId,
          sku: data.sku,
          barcode: data.barcode,
          name: data.name,
          imageUrl: imageUrl ?? undefined,
          baseUnitName: data.baseUnitName,
          minStockLevel: data.minStockLevel,
          maxStockLevel: data.maxStockLevel,
          reorderPoint: data.reorderPoint,
          averageCost: toDecimalString(d(data.averageCost), 4),
          units: data.units?.length
            ? {
                create: data.units.map((u) => ({
                  unitName: u.unitName,
                  conversionRate: u.conversionRate,
                })),
              }
            : {
                create: [{ unitName: data.baseUnitName, conversionRate: 1 }],
              },
        },
        include: { units: true },
      });
      await cacheInvalidationService.invalidateMasterData(tenantId);
      return result;
    } catch {
      throw new AppError('DUPLICATE_SKU', 409, 'SKU already exists');
    }
  }

  async get(tenantId: string, id: string) {
    const product = await this.db.product.findFirst({
      where: { id, tenantId },
      include: { units: true },
    });
    if (!product) throw new AppError('NOT_FOUND', 404, 'Product not found');
    return product;
  }

  async availability(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.db.stockReservation.updateMany({
      where: {
        tenantId,
        productId: id,
        status: 'active',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    });

    const [balances, reservedRows, batches] = await Promise.all([
      this.db.stockBalance.findMany({
        where: { tenantId, productId: id },
        include: { warehouse: { select: { id: true, code: true, name: true } } },
      }),
      this.db.stockReservation.groupBy({
        by: ['warehouseId', 'batchId'],
        where: { tenantId, productId: id, status: 'active' },
        _sum: { qtyBaseUnit: true },
      }),
      this.db.batch.findMany({ where: { tenantId, productId: id } }),
    ]);

    const reservedMap = new Map(
      reservedRows.map((row) => [
        `${row.warehouseId}:${row.batchId ?? ''}`,
        d(row._sum.qtyBaseUnit?.toString() ?? 0),
      ]),
    );
    const batchMap = new Map(batches.map((b) => [b.id, b]));

    const lots = balances.map((b) => {
      const reservedQty = reservedMap.get(`${b.warehouseId}:${b.batchId ?? ''}`) ?? d(0);
      const onhandQty = d(b.onhandQty.toString());
      const batch = b.batchId ? batchMap.get(b.batchId) : undefined;
      return {
        warehouseId: b.warehouseId,
        warehouse: b.warehouse,
        batchId: b.batchId,
        batchNo: batch?.batchNo ?? null,
        expiryDate: batch?.expiryDate ?? null,
        onhandQty: onhandQty.toFixed(4),
        reservedQty: reservedQty.toFixed(4),
        availableQty: onhandQty.minus(reservedQty).toFixed(4),
      };
    });

    const byWarehouse = new Map<
      string,
      { warehouseId: string; warehouse: (typeof balances)[0]['warehouse']; onhand: ReturnType<typeof d>; reserved: ReturnType<typeof d> }
    >();
    for (const lot of lots) {
      const prev = byWarehouse.get(lot.warehouseId) ?? {
        warehouseId: lot.warehouseId,
        warehouse: lot.warehouse,
        onhand: d(0),
        reserved: d(0),
      };
      prev.onhand = prev.onhand.plus(lot.onhandQty);
      prev.reserved = prev.reserved.plus(lot.reservedQty);
      byWarehouse.set(lot.warehouseId, prev);
    }

    return {
      productId: id,
      warehouses: [...byWarehouse.values()].map((w) => ({
        warehouseId: w.warehouseId,
        warehouse: w.warehouse,
        onhandQty: w.onhand.toFixed(4),
        reservedQty: w.reserved.toFixed(4),
        availableQty: w.onhand.minus(w.reserved).toFixed(4),
        lots: lots.filter((lot) => lot.warehouseId === w.warehouseId),
      })),
    };
  }

  async update(tenantId: string, id: string, input: unknown) {
    const existing = await this.get(tenantId, id);
    const data = productSchema.partial().parse(input);
    const fileId = data.imageFileId ?? data.fileIds?.[0];
    let imageUrl = data.imageUrl;

    if (fileId) {
      const file = await this.db.uploadedFile.findFirst({
        where: { id: fileId, tenantId },
        select: { url: true, mimeType: true },
      });
      if (!file) throw new AppError('NOT_FOUND', 404, 'Product image file not found');
      if (!file.mimeType.startsWith('image/')) {
        throw new AppError('INVALID_FILE_TYPE', 400, 'Product image must be an image file');
      }
      imageUrl = file.url;
    }

    const result = await this.db.product.update({
      where: { id },
      data: {
        sku: data.sku,
        barcode: data.barcode,
        name: data.name,
        imageUrl: imageUrl === undefined ? existing.imageUrl : imageUrl,
        baseUnitName: data.baseUnitName,
        minStockLevel: data.minStockLevel,
        maxStockLevel: data.maxStockLevel,
        reorderPoint: data.reorderPoint,
        averageCost: toDecimalString(d(data.averageCost ?? 0), 4),
      },
      include: { units: true },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.product.update({
      where: { id },
      data: { isActive: false },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }
}

export const productService = new ProductService(prisma, listCache);
registerCacheRefreshHandler(CACHE_PREFIX, async (key) => {
  const tenantId = key.split(':')[2];
  if (!tenantId) return;
  await productService.refreshListCache(tenantId, key);
});
