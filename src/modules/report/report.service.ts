/**
 * DỊCH VỤ BÁO CÁO CƠ BẢN
 * -----------------------
 * - stockBalance / stockMovement: danh sách có phân trang, cache Redis
 * - lowStock / expiryAlert: ủy quyền cho stock-alert.helpers
 * Cache-aside: miss → query DB → set; ghi dữ liệu chỉ invalidate (lazy delete).
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import {
  stockBalanceQuerySchema,
  stockMovementQuerySchema,
  lowStockQuerySchema,
  expiryAlertQuerySchema,
} from "../../dto/report.dto";
import { paginationSchema, paginate } from "../../dto/pagination.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import {
  computeExpiryAlerts,
  computeLowStockItems,
} from "./stock-alert.helpers";

const CACHE_PREFIX_BALANCE = "report:stock-balance";
const CACHE_PREFIX_MOVEMENT = "report:stock-movement";
const CACHE_PREFIX_LOW = "report:low-stock";
const CACHE_PREFIX_EXPIRY = "report:expiry-alert";

export class ReportService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  async stockBalance(tenantId: string, query: unknown) {
    const { warehouseId } = stockBalanceQuerySchema.parse(query);
    const { page, limit } = paginationSchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_BALANCE}:${tenantId}:${warehouseId ?? "all"}:${page}:${limit}`;
    return this.cache.getOrSet(cacheKey, async () => {
      const where = {
        tenantId,
        ...(warehouseId ? { warehouseId } : {}),
      };
      const [data, total] = await Promise.all([
        this.db.stockBalance.findMany({
          where,
          include: {
            product: {
              select: { id: true, sku: true, name: true, baseUnitName: true },
            },
            warehouse: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ warehouseId: "asc" }, { productId: "asc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.stockBalance.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
  }

  async stockMovement(tenantId: string, query: unknown) {
    const { warehouseId, from, to } = stockMovementQuerySchema.parse(query);
    const { page, limit } = paginationSchema.parse(query);
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const cacheKey = `${CACHE_PREFIX_MOVEMENT}:${tenantId}:${warehouseId ?? "all"}:${from ?? ""}:${to ?? ""}:${page}:${limit}`;
    return this.cache.getOrSet(cacheKey, async () => {
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
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.stockLedger.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
  }

  async lowStock(tenantId: string, query: unknown) {
    const { warehouseId } = lowStockQuerySchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_LOW}:${tenantId}:${warehouseId ?? "all"}`;
    return this.cache.getOrSet(cacheKey, () =>
      computeLowStockItems(this.db, tenantId, { warehouseId }),
    );
  }

  async expiryAlert(tenantId: string, query: unknown) {
    const { warehouseId, days } = expiryAlertQuerySchema.parse(query);
    const cacheKey = `${CACHE_PREFIX_EXPIRY}:${tenantId}:${warehouseId ?? "all"}:${days}`;
    return this.cache.getOrSet(cacheKey, () =>
      computeExpiryAlerts(this.db, tenantId, days, { warehouseId }),
    );
  }
}

export const reportService = new ReportService(prisma, listCache);
