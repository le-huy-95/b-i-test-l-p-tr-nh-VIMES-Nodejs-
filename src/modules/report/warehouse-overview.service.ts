/**
 * DỊCH VỤ TỔNG QUAN KHO (WAREHOUSE OVERVIEW)
 * ------------------------------------------
 * Cung cấp API báo cáo tổng hợp theo từng kho:
 * - list(): danh sách tất cả kho + chỉ số tồn kho + thống kê phiếu xuất/nhập/tồn đầu kỳ
 * - detail(): chi tiết 1 kho gồm cảnh báo tồn thấp, hết hạn, phiếu chờ duyệt, biến động gần đây
 * Dữ liệu được cache Redis theo tenant + bộ lọc ngày/expiryDays.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { warehouseOverviewQuerySchema } from "../../dto/report.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { AppError } from "../../utils/app-error";
import {
  computeExpiryAlerts,
  computeLowStockItems,
} from "./stock-alert.helpers";
import { buildDateRangeFilter } from "./organization-overview.helpers";
import {
  computeWarehouseInventoryMetrics,
  computeWarehouseInventoryMetricsMap,
  emptyInventoryMetrics,
  groupDocCountsByWarehouse,
  rowsToStatusCounts,
  serializeWarehouse,
  totalFromStatusCounts,
  type DocStatusKey,
  type WarehouseInventoryMetrics,
} from "./warehouse-overview.helpers";

// Tiền tố khóa cache cho toàn bộ báo cáo warehouse overview
export const CACHE_PREFIX_WAREHOUSE_OVERVIEW = "report:warehouse-overview";

/** Gom số lượng phiếu theo trạng thái thành object tổng hợp (total, pendingApproval...) */
function buildDocSummary(
  counts: ReturnType<typeof rowsToStatusCounts>,
  includeDraft = false,
) {
  return {
    byStatus: counts,
    total: totalFromStatusCounts(counts),
    pendingApproval: counts.pending_approval,
    ...(includeDraft ? { draft: counts.draft } : {}),
  };
}

export class WarehouseOverviewService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  /**
   * Danh sách tổng quan tất cả kho đang hoạt động của tenant.
   * Song song query groupBy phiếu + metrics tồn kho, ghép theo warehouseId.
   */
  async list(tenantId: string, query: unknown) {
    const parsed = warehouseOverviewQuerySchema.parse(query);
    const { expiryDays, from, to } = parsed;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const dateFilter = buildDateRangeFilter(fromDate, toDate);
    const cacheKey = `${CACHE_PREFIX_WAREHOUSE_OVERVIEW}:${tenantId}:list:${expiryDays}:${from ?? ""}:${to ?? ""}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const warehouses = await this.db.warehouse.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: "asc" },
    });

    const [issueGroups, receiptGroups, openingGroups, inventoryByWarehouse] =
      await Promise.all([
        this.db.stockIssue.groupBy({
          by: ["warehouseId", "status"],
          where: { tenantId, ...dateFilter },
          _count: { _all: true },
        }),
        this.db.stockReceipt.groupBy({
          by: ["warehouseId", "status"],
          where: { tenantId, ...dateFilter },
          _count: { _all: true },
        }),
        this.db.stockOpeningBalance.groupBy({
          by: ["warehouseId", "status"],
          where: { tenantId, ...dateFilter },
          _count: { _all: true },
        }),
        this.loadInventoryMetricsMap(
          tenantId,
          warehouses.map((warehouse) => warehouse.id),
          expiryDays,
        ),
      ]);

    const issueCountsByWarehouse = groupDocCountsByWarehouse(
      issueGroups as Array<{
        warehouseId: string;
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );
    const receiptCountsByWarehouse = groupDocCountsByWarehouse(
      receiptGroups as Array<{
        warehouseId: string;
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );
    const openingCountsByWarehouse = groupDocCountsByWarehouse(
      openingGroups as Array<{
        warehouseId: string;
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );

    const data = warehouses.map((warehouse) => {
      const inventory =
        inventoryByWarehouse.get(warehouse.id) ?? emptyInventoryMetrics();
      const issueCounts =
        issueCountsByWarehouse.get(warehouse.id) ?? rowsToStatusCounts([]);
      const receiptCounts =
        receiptCountsByWarehouse.get(warehouse.id) ?? rowsToStatusCounts([]);
      const openingCounts =
        openingCountsByWarehouse.get(warehouse.id) ?? rowsToStatusCounts([]);

      return {
        warehouse: serializeWarehouse(warehouse),
        inventory,
        stockIssues: buildDocSummary(issueCounts, true),
        stockReceipts: buildDocSummary(receiptCounts, true),
        stockOpenings: {
          byStatus: openingCounts,
          total: totalFromStatusCounts(openingCounts),
        },
      };
    });

    const result = {
      generatedAt: new Date().toISOString(),
      expiryDays,
      filters: {
        from: from ?? null,
        to: to ?? null,
        expiryDays,
      },
      warehouses: data,
    };
    await this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Chi tiết 1 kho: tồn kho, thống kê phiếu, danh sách chờ duyệt,
   * cảnh báo low-stock/expiry, và các dòng sổ cái kho gần nhất.
   */
  async detail(tenantId: string, warehouseId: string, query: unknown) {
    const parsed = warehouseOverviewQuerySchema.parse(query);
    const { expiryDays, recentLimit, from, to } = parsed;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const dateFilter = buildDateRangeFilter(fromDate, toDate);
    const cacheKey = `${CACHE_PREFIX_WAREHOUSE_OVERVIEW}:${tenantId}:${warehouseId}:${expiryDays}:${recentLimit}:${from ?? ""}:${to ?? ""}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const warehouse = await this.db.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
    });
    if (!warehouse) {
      throw new AppError("NOT_FOUND", 404, "Warehouse not found");
    }

    const [
      inventory,
      issueStatusRows,
      receiptStatusRows,
      openingStatusRows,
      pendingIssues,
      pendingReceipts,
      recentMovements,
      lowStockItems,
      expiryAlerts,
    ] = await Promise.all([
      this.loadInventoryMetrics(tenantId, warehouseId, expiryDays),
      this.db.stockIssue.groupBy({
        by: ["status"],
        where: { tenantId, warehouseId, ...dateFilter },
        _count: { _all: true },
      }),
      this.db.stockReceipt.groupBy({
        by: ["status"],
        where: { tenantId, warehouseId, ...dateFilter },
        _count: { _all: true },
      }),
      this.db.stockOpeningBalance.groupBy({
        by: ["status"],
        where: { tenantId, warehouseId, ...dateFilter },
        _count: { _all: true },
      }),
      this.db.stockIssue.findMany({
        where: {
          tenantId,
          warehouseId,
          status: "pending_approval",
          ...dateFilter,
        },
        select: {
          id: true,
          code: true,
          issueDate: true,
          issueType: true,
          createdAt: true,
          customer: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: recentLimit,
      }),
      this.db.stockReceipt.findMany({
        where: {
          tenantId,
          warehouseId,
          status: "pending_approval",
          ...dateFilter,
        },
        select: {
          id: true,
          code: true,
          receiptDate: true,
          receiptType: true,
          totalAmount: true,
          createdAt: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: recentLimit,
      }),
      this.db.stockLedger.findMany({
        where: { tenantId, warehouseId, ...dateFilter },
        select: {
          id: true,
          transactionType: true,
          refDocType: true,
          refDocId: true,
          qtyChange: true,
          qtyBalanceAfter: true,
          unitCost: true,
          createdAt: true,
          product: {
            select: { id: true, sku: true, name: true, baseUnitName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: recentLimit,
      }),
      computeLowStockItems(this.db, tenantId, {
        warehouseId,
        sortByShortage: true,
      }),
      computeExpiryAlerts(this.db, tenantId, expiryDays, {
        warehouseId,
        includeWarehouse: false,
      }),
    ]);

    const issueCounts = rowsToStatusCounts(
      issueStatusRows as Array<{
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );
    const receiptCounts = rowsToStatusCounts(
      receiptStatusRows as Array<{
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );
    const openingCounts = rowsToStatusCounts(
      openingStatusRows as Array<{
        status: DocStatusKey;
        _count: { _all: number };
      }>,
    );

    const result = {
      generatedAt: new Date().toISOString(),
      expiryDays,
      recentLimit,
      filters: {
        from: from ?? null,
        to: to ?? null,
        expiryDays,
        recentLimit,
      },
      warehouse: serializeWarehouse(warehouse),
      inventory,
      stockIssues: {
        ...buildDocSummary(issueCounts),
        pendingApproval: pendingIssues,
      },
      stockReceipts: {
        ...buildDocSummary(receiptCounts),
        pendingApproval: pendingReceipts.map((receipt) => ({
          ...receipt,
          totalAmount: receipt.totalAmount.toString(),
        })),
      },
      stockOpenings: {
        byStatus: openingCounts,
        total: totalFromStatusCounts(openingCounts),
      },
      alerts: {
        lowStock: lowStockItems,
        expiry: expiryAlerts,
      },
      recentMovements: recentMovements.map((movement) => ({
        ...movement,
        qtyChange: movement.qtyChange.toString(),
        qtyBalanceAfter: movement.qtyBalanceAfter.toString(),
        unitCost: movement.unitCost.toString(),
      })),
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  // Cache lớp con: chỉ số tồn kho của 1 kho (dùng trong detail)
  private async loadInventoryMetrics(
    tenantId: string,
    warehouseId: string,
    expiryDays: number,
  ): Promise<WarehouseInventoryMetrics> {
    const cacheKey = `${CACHE_PREFIX_WAREHOUSE_OVERVIEW}:${tenantId}:${warehouseId}:inventory:${expiryDays}`;
    const cached = await this.cache.get<WarehouseInventoryMetrics>(cacheKey);
    if (cached) return cached;
    const metrics = await computeWarehouseInventoryMetrics(
      this.db,
      tenantId,
      warehouseId,
      expiryDays,
    );
    await this.cache.set(cacheKey, metrics);
    return metrics;
  }

  // Cache lớp con: map warehouseId → metrics (dùng trong list nhiều kho)
  private async loadInventoryMetricsMap(
    tenantId: string,
    warehouseIds: string[],
    expiryDays: number,
  ): Promise<Map<string, WarehouseInventoryMetrics>> {
    const cacheKey = `${CACHE_PREFIX_WAREHOUSE_OVERVIEW}:${tenantId}:inventory-map:${expiryDays}`;
    const cached =
      await this.cache.get<Array<[string, WarehouseInventoryMetrics]>>(
        cacheKey,
      );
    if (cached) return new Map(cached);
    const metrics = await computeWarehouseInventoryMetricsMap(
      this.db,
      tenantId,
      warehouseIds,
      expiryDays,
    );
    await this.cache.set(cacheKey, [...metrics.entries()]);
    return metrics;
  }
}

export const warehouseOverviewService = new WarehouseOverviewService(
  prisma,
  listCache,
);
