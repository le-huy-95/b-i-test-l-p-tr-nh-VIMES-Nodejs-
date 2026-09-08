/**
 * DỊCH VỤ TỔNG QUAN TỔ CHỨC
 * --------------------------
 * Dashboard cấp tenant: tổng tồn, phiếu theo trạng thái, biểu đồ biến động,
 * top sản phẩm. Phân quyền: admin/accountant xem toàn bộ, role khác chỉ document của mình.
 */
import type { Prisma, PrismaClient } from "../../infra/prisma-types";
import { Prisma as PrismaNs } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { organizationOverviewQuerySchema } from "../../dto/report.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { d } from "../../utils/decimal";
import {
  aggregateQtyByUnit,
  computeOrganizationInventoryMetrics,
  groupDocCountsByWarehouse,
  rowsToStatusCounts,
  sumQtyByWarehouseId,
  sumStatusCountRows,
  type DocStatusKey,
  type QtyByUnit,
  type WarehouseInventoryMetrics,
} from "./warehouse-overview.helpers";
import {
  buildDailyMovementSeries,
  buildDateRangeFilter,
  buildDocumentScopeFilter,
  buildWarehouseScopeFilter,
  resolveVisibilityScope,
  toDocStatusBlock,
  type DailyMovementRow,
  type OrganizationOverviewContext,
  type TopProductRow,
} from "./organization-overview.helpers";

export const CACHE_PREFIX_ORGANIZATION_OVERVIEW =
  "report:organization-overview";

type ReceiptWhere = Prisma.StockReceiptWhereInput;
type IssueWhere = Prisma.StockIssueWhereInput;

export class OrganizationOverviewService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  buildContext(
    tenantId: string,
    userId: string,
    role: OrganizationOverviewContext["role"],
    warehouseIds: OrganizationOverviewContext["warehouseIds"],
  ): OrganizationOverviewContext {
    return {
      tenantId,
      userId,
      role,
      warehouseIds,
      visibilityScope: resolveVisibilityScope(role),
    };
  }

  /** Dashboard tổng quan toàn tổ chức — cache theo ctx + bộ lọc ngày */
  async getOverview(ctx: OrganizationOverviewContext, query: unknown) {
    const parsed = organizationOverviewQuerySchema.parse(query);
    const fromDate = parsed.from ? new Date(parsed.from) : undefined;
    const toDate = parsed.to ? new Date(parsed.to) : undefined;

    const cacheKey = [
      CACHE_PREFIX_ORGANIZATION_OVERVIEW,
      ctx.tenantId,
      ctx.visibilityScope,
      ctx.visibilityScope === "own_documents" ? ctx.userId : "all",
      ctx.role,
      Array.isArray(ctx.warehouseIds) ? ctx.warehouseIds.join(",") : "all",
      parsed.from ?? "",
      parsed.to ?? "",
      parsed.expiryDays,
      parsed.topLimit,
      parsed.recentLimit,
    ].join(":");

    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const receiptWhere = this.buildReceiptWhere(ctx, fromDate, toDate);
    const issueWhere = this.buildIssueWhere(ctx, fromDate, toDate);
    const openingWhere = this.buildOpeningWhere(ctx, fromDate, toDate);
    const isOrganization = ctx.visibilityScope === "organization";
    const warehousesPromise = this.loadWarehouses(ctx);
    const movementPromise = this.loadCompletedMovement(ctx, fromDate, toDate);

    const [
      warehouses,
      ownReceiptStatusRows,
      ownIssueStatusRows,
      openingStatusRows,
      pendingReceipts,
      pendingIssues,
      movement,
      topProducts,
      inventorySummary,
      orgBreakdown,
    ] = await Promise.all([
      warehousesPromise,
      isOrganization
        ? Promise.resolve(null)
        : this.db.stockReceipt.groupBy({
            by: ["status"],
            where: receiptWhere,
            _count: { _all: true },
          }),
      isOrganization
        ? Promise.resolve(null)
        : this.db.stockIssue.groupBy({
            by: ["status"],
            where: issueWhere,
            _count: { _all: true },
          }),
      this.db.stockOpeningBalance.groupBy({
        by: ["status"],
        where: openingWhere,
        _count: { _all: true },
      }),
      this.db.stockReceipt.findMany({
        where: { ...receiptWhere, status: "pending_approval" },
        select: {
          id: true,
          code: true,
          receiptDate: true,
          receiptType: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          warehouse: { select: { id: true, code: true, name: true } },
          supplier: { select: { id: true, code: true, name: true } },
          createdById: true,
        },
        orderBy: { createdAt: "asc" },
        take: parsed.recentLimit,
      }),
      this.db.stockIssue.findMany({
        where: { ...issueWhere, status: "pending_approval" },
        select: {
          id: true,
          code: true,
          issueDate: true,
          issueType: true,
          status: true,
          createdAt: true,
          warehouse: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, code: true, name: true } },
          createdById: true,
        },
        orderBy: { createdAt: "asc" },
        take: parsed.recentLimit,
      }),
      movementPromise,
      this.loadTopProducts(ctx, fromDate, toDate, parsed.topLimit),
      isOrganization
        ? this.loadInventorySummary(ctx, warehousesPromise, parsed.expiryDays)
        : Promise.resolve(null),
      isOrganization
        ? this.loadWarehousesBreakdown(
            ctx,
            warehousesPromise,
            fromDate,
            toDate,
            movementPromise,
          )
        : Promise.resolve({ items: [], receiptGroups: [], issueGroups: [] }),
    ]);
    const ownMovement = this.summarizeOwnQty(movement.qtyRows);
    const dailyMovement = fromDate && toDate ? movement.dailyMovement : [];

    const receiptStatusRows = isOrganization
      ? sumStatusCountRows(orgBreakdown.receiptGroups)
      : (ownReceiptStatusRows ?? []);
    const issueStatusRows = isOrganization
      ? sumStatusCountRows(orgBreakdown.issueGroups)
      : (ownIssueStatusRows ?? []);
    const { topImportedProducts, topExportedProducts } = topProducts;
    const warehousesBreakdown = orgBreakdown.items;

    const totalImportedQty =
      ctx.visibilityScope === "organization"
        ? warehousesBreakdown
            .reduce(
              (sum, row) => sum.plus(row.productMovement.totalImportedQty),
              d(0),
            )
            .toFixed(4)
        : ownMovement.totalImportedQty;
    const totalExportedQty =
      ctx.visibilityScope === "organization"
        ? warehousesBreakdown
            .reduce(
              (sum, row) => sum.plus(row.productMovement.totalExportedQty),
              d(0),
            )
            .toFixed(4)
        : ownMovement.totalExportedQty;
    const importedQtyByUnit =
      ctx.visibilityScope === "organization"
        ? aggregateQtyByUnit(
            warehousesBreakdown.flatMap(
              (row) => row.productMovement.importedQtyByUnit,
            ),
          )
        : ownMovement.importedQtyByUnit;
    const exportedQtyByUnit =
      ctx.visibilityScope === "organization"
        ? aggregateQtyByUnit(
            warehousesBreakdown.flatMap(
              (row) => row.productMovement.exportedQtyByUnit,
            ),
          )
        : ownMovement.exportedQtyByUnit;

    const result = {
      generatedAt: new Date().toISOString(),
      visibilityScope: ctx.visibilityScope,
      role: ctx.role,
      filters: {
        from: parsed.from ?? null,
        to: parsed.to ?? null,
        expiryDays: parsed.expiryDays,
        topLimit: parsed.topLimit,
        recentLimit: parsed.recentLimit,
      },
      organization: {
        warehouseCount: warehouses.length,
        warehouses: warehouses.map((warehouse) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
        })),
      },
      documents: {
        stockReceipts: {
          ...toDocStatusBlock(receiptStatusRows),
          pendingApprovalList: pendingReceipts.map((receipt) => ({
            id: receipt.id,
            code: receipt.code,
            receiptDate: receipt.receiptDate,
            receiptType: receipt.receiptType,
            totalAmount: receipt.totalAmount.toString(),
            status: receipt.status,
            createdAt: receipt.createdAt,
            warehouse: receipt.warehouse,
            supplier: receipt.supplier,
            createdById: receipt.createdById,
          })),
        },
        stockIssues: {
          ...toDocStatusBlock(issueStatusRows),
          pendingApprovalList: pendingIssues.map((issue) => ({
            id: issue.id,
            code: issue.code,
            issueDate: issue.issueDate,
            issueType: issue.issueType,
            status: issue.status,
            createdAt: issue.createdAt,
            warehouse: issue.warehouse,
            customer: issue.customer,
            createdById: issue.createdById,
          })),
        },
        stockOpenings: toDocStatusBlock(openingStatusRows),
      },
      productMovement: {
        totalImportedQty,
        totalExportedQty,
        importedQtyByUnit,
        exportedQtyByUnit,
        topImportedProducts,
        topExportedProducts,
        dailyMovement,
      },
      inventory: inventorySummary,
      warehousesBreakdown,
    };

    await this.cache.set(cacheKey, result);
    return result;
  }

  private buildReceiptWhere(
    ctx: OrganizationOverviewContext,
    from?: Date,
    to?: Date,
  ): ReceiptWhere {
    return {
      tenantId: ctx.tenantId,
      ...buildWarehouseScopeFilter(ctx.warehouseIds),
      ...buildDocumentScopeFilter(ctx.visibilityScope, ctx.userId),
      ...buildDateRangeFilter(from, to),
    };
  }

  private buildIssueWhere(
    ctx: OrganizationOverviewContext,
    from?: Date,
    to?: Date,
  ): IssueWhere {
    return {
      tenantId: ctx.tenantId,
      ...buildWarehouseScopeFilter(ctx.warehouseIds),
      ...buildDocumentScopeFilter(ctx.visibilityScope, ctx.userId),
      ...buildDateRangeFilter(from, to),
    };
  }

  private buildOpeningWhere(
    ctx: OrganizationOverviewContext,
    from?: Date,
    to?: Date,
  ): Prisma.StockOpeningBalanceWhereInput {
    return {
      tenantId: ctx.tenantId,
      ...buildWarehouseScopeFilter(ctx.warehouseIds),
      ...buildDocumentScopeFilter(ctx.visibilityScope, ctx.userId),
      ...buildDateRangeFilter(from, to),
    };
  }

  private async loadWarehouses(ctx: OrganizationOverviewContext) {
    const where = {
      tenantId: ctx.tenantId,
      isActive: true,
      ...(ctx.warehouseIds === "all" ? {} : { id: { in: ctx.warehouseIds } }),
    };
    return this.db.warehouse.findMany({
      where,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  }

  private completedHeaderWhereSql(
    ctx: OrganizationOverviewContext,
    from?: Date,
    to?: Date,
  ): PrismaNs.Sql {
    const conditions: PrismaNs.Sql[] = [
      PrismaNs.sql`r.tenant_id = ${ctx.tenantId}`,
      PrismaNs.sql`r.status = 'completed'`,
    ];
    if (ctx.warehouseIds !== "all") {
      conditions.push(
        PrismaNs.sql`r.warehouse_id IN (${PrismaNs.join(ctx.warehouseIds)})`,
      );
    }
    if (ctx.visibilityScope === "own_documents") {
      conditions.push(
        PrismaNs.sql`(r.created_by_id = ${ctx.userId} OR r.approved_by_id = ${ctx.userId})`,
      );
    }
    if (from) conditions.push(PrismaNs.sql`r.completed_at >= ${from}`);
    if (to) conditions.push(PrismaNs.sql`r.completed_at <= ${to}`);
    return PrismaNs.join(conditions, " AND ");
  }

  private summarizeOwnQty(
    rows: Array<{
      kind: "receipt" | "issue";
      warehouseId: string;
      baseUnitName: string;
      qty: string;
    }>,
  ): {
    totalImportedQty: string;
    totalExportedQty: string;
    importedQtyByUnit: QtyByUnit[];
    exportedQtyByUnit: QtyByUnit[];
  } {
    const importedQtyByUnit = aggregateQtyByUnit(
      rows.filter((row) => row.kind === "receipt"),
    );
    const exportedQtyByUnit = aggregateQtyByUnit(
      rows.filter((row) => row.kind === "issue"),
    );
    return {
      totalImportedQty: importedQtyByUnit
        .reduce((sum, row) => sum.plus(row.qty), d(0))
        .toFixed(4),
      totalExportedQty: exportedQtyByUnit
        .reduce((sum, row) => sum.plus(row.qty), d(0))
        .toFixed(4),
      importedQtyByUnit,
      exportedQtyByUnit,
    };
  }

  private emptyMovement(from?: Date, to?: Date) {
    return {
      qtyRows: [] as Array<{
        kind: "receipt" | "issue";
        warehouseId: string;
        baseUnitName: string;
        qty: string;
      }>,
      dailyMovement:
        from && to
          ? buildDailyMovementSeries(from, to, new Map(), new Map())
          : ([] as DailyMovementRow[]),
    };
  }

  private async loadCompletedMovement(
    ctx: OrganizationOverviewContext,
    from?: Date,
    to?: Date,
  ): Promise<{
    qtyRows: Array<{
      kind: "receipt" | "issue";
      warehouseId: string;
      baseUnitName: string;
      qty: string;
    }>;
    dailyMovement: DailyMovementRow[];
  }> {
    if (ctx.warehouseIds !== "all" && ctx.warehouseIds.length === 0) {
      return this.emptyMovement(from, to);
    }

    const whereSql = this.completedHeaderWhereSql(ctx, from, to);
    const includeDaily = Boolean(from && to);
    const rows = await this.db.$queryRaw<
      Array<{
        facet: "unit" | "day";
        kind: "receipt" | "issue";
        warehouseId: string | null;
        baseUnitName: string | null;
        day: Date | null;
        qty: string;
      }>
    >(
      includeDaily
        ? PrismaNs.sql`
            -- overview-completed-movement
            SELECT 'unit'::text AS facet, 'receipt'::text AS kind, r.warehouse_id AS "warehouseId",
                   COALESCE(p.base_unit_name, '') AS "baseUnitName", NULL::date AS day,
                   COALESCE(SUM(d.qty_base_unit), 0)::text AS qty
            FROM stock_receipt_details d
            INNER JOIN stock_receipts r ON r.id = d.receipt_id
            INNER JOIN products p ON p.id = d.product_id
            WHERE ${whereSql}
            GROUP BY r.warehouse_id, p.base_unit_name
            UNION ALL
            SELECT 'unit'::text, 'issue'::text, r.warehouse_id,
                   COALESCE(p.base_unit_name, ''), NULL::date,
                   COALESCE(SUM(d.qty_base_unit), 0)::text
            FROM stock_issue_details d
            INNER JOIN stock_issues r ON r.id = d.issue_id
            INNER JOIN products p ON p.id = d.product_id
            WHERE ${whereSql}
            GROUP BY r.warehouse_id, p.base_unit_name
            UNION ALL
            SELECT 'day'::text, 'receipt'::text, NULL::text, ''::text,
                   (r.completed_at AT TIME ZONE 'UTC')::date,
                   COALESCE(SUM(d.qty_base_unit), 0)::text
            FROM stock_receipt_details d
            INNER JOIN stock_receipts r ON r.id = d.receipt_id
            WHERE ${whereSql}
            GROUP BY 5
            UNION ALL
            SELECT 'day'::text, 'issue'::text, NULL::text, ''::text,
                   (r.completed_at AT TIME ZONE 'UTC')::date,
                   COALESCE(SUM(d.qty_base_unit), 0)::text
            FROM stock_issue_details d
            INNER JOIN stock_issues r ON r.id = d.issue_id
            WHERE ${whereSql}
            GROUP BY 5
          `
        : PrismaNs.sql`
            -- overview-completed-movement
            SELECT 'unit'::text AS facet, 'receipt'::text AS kind, r.warehouse_id AS "warehouseId",
                   COALESCE(p.base_unit_name, '') AS "baseUnitName", NULL::date AS day,
                   COALESCE(SUM(d.qty_base_unit), 0)::text AS qty
            FROM stock_receipt_details d
            INNER JOIN stock_receipts r ON r.id = d.receipt_id
            INNER JOIN products p ON p.id = d.product_id
            WHERE ${whereSql}
            GROUP BY r.warehouse_id, p.base_unit_name
            UNION ALL
            SELECT 'unit'::text, 'issue'::text, r.warehouse_id,
                   COALESCE(p.base_unit_name, ''), NULL::date,
                   COALESCE(SUM(d.qty_base_unit), 0)::text
            FROM stock_issue_details d
            INNER JOIN stock_issues r ON r.id = d.issue_id
            INNER JOIN products p ON p.id = d.product_id
            WHERE ${whereSql}
            GROUP BY r.warehouse_id, p.base_unit_name
          `,
    );

    const qtyRows = rows
      .filter((row) => row.facet === "unit" && row.warehouseId)
      .map((row) => ({
        kind: row.kind,
        warehouseId: row.warehouseId as string,
        baseUnitName: row.baseUnitName ?? "",
        qty: d(row.qty).toFixed(4),
      }));

    if (!from || !to) {
      return { qtyRows, dailyMovement: [] };
    }

    const importedByDay = new Map<string, string>();
    const exportedByDay = new Map<string, string>();
    for (const row of rows) {
      if (row.facet !== "day" || !row.day) continue;
      const key =
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10);
      const qty = d(row.qty).toFixed(4);
      if (row.kind === "receipt") importedByDay.set(key, qty);
      else exportedByDay.set(key, qty);
    }

    return {
      qtyRows,
      dailyMovement: buildDailyMovementSeries(
        from,
        to,
        importedByDay,
        exportedByDay,
      ),
    };
  }

  private async loadTopProducts(
    ctx: OrganizationOverviewContext,
    from: Date | undefined,
    to: Date | undefined,
    topLimit: number,
  ): Promise<{
    topImportedProducts: TopProductRow[];
    topExportedProducts: TopProductRow[];
  }> {
    if (ctx.warehouseIds !== "all" && ctx.warehouseIds.length === 0) {
      return { topImportedProducts: [], topExportedProducts: [] };
    }

    const whereSql = this.completedHeaderWhereSql(ctx, from, to);
    const rows = await this.db.$queryRaw<
      Array<{
        productId: string;
        sku: string;
        name: string;
        baseUnitName: string;
        totalQty: string;
        documentCount: number;
        kind: "imported" | "exported";
      }>
    >(PrismaNs.sql`
      -- overview-top-products
      (
        SELECT d.product_id AS "productId", p.sku, p.name, p.base_unit_name AS "baseUnitName",
               COALESCE(SUM(d.qty_base_unit), 0)::text AS "totalQty",
               COUNT(DISTINCT d.receipt_id)::int AS "documentCount",
               'imported'::text AS kind
        FROM stock_receipts r
        INNER JOIN stock_receipt_details d ON d.receipt_id = r.id
        INNER JOIN products p ON p.id = d.product_id
        WHERE ${whereSql}
        GROUP BY d.product_id, p.sku, p.name, p.base_unit_name
        ORDER BY SUM(d.qty_base_unit) DESC
        LIMIT ${topLimit}
      )
      UNION ALL
      (
        SELECT d.product_id, p.sku, p.name, p.base_unit_name,
               COALESCE(SUM(d.qty_base_unit), 0)::text,
               COUNT(DISTINCT d.issue_id)::int,
               'exported'::text
        FROM stock_issues r
        INNER JOIN stock_issue_details d ON d.issue_id = r.id
        INNER JOIN products p ON p.id = d.product_id
        WHERE ${whereSql}
        GROUP BY d.product_id, p.sku, p.name, p.base_unit_name
        ORDER BY SUM(d.qty_base_unit) DESC
        LIMIT ${topLimit}
      )
    `);

    const mapRow = (row: (typeof rows)[number]): TopProductRow => ({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      baseUnitName: row.baseUnitName,
      totalQty: d(row.totalQty).toFixed(4),
      documentCount: Number(row.documentCount),
    });

    return {
      topImportedProducts: rows
        .filter((row) => row.kind === "imported")
        .map(mapRow),
      topExportedProducts: rows
        .filter((row) => row.kind === "exported")
        .map(mapRow),
    };
  }

  private async loadInventorySummary(
    ctx: OrganizationOverviewContext,
    warehousesPromise: Promise<Array<{ id: string }>>,
    expiryDays: number,
  ) {
    const warehouses = await warehousesPromise;
    const warehouseIds = warehouses.map((warehouse) => warehouse.id);
    const cacheKey = `${CACHE_PREFIX_ORGANIZATION_OVERVIEW}:${ctx.tenantId}:inventory:${warehouseIds.join(",")}:${expiryDays}`;
    const cached = await this.cache.get<WarehouseInventoryMetrics>(cacheKey);
    if (cached) return cached;
    const metrics = await computeOrganizationInventoryMetrics(
      this.db,
      ctx.tenantId,
      warehouseIds,
      expiryDays,
    );
    await this.cache.set(cacheKey, metrics);
    return metrics;
  }

  private async loadWarehousesBreakdown(
    ctx: OrganizationOverviewContext,
    warehousesPromise: Promise<
      Array<{ id: string; code: string; name: string }>
    >,
    from: Date | undefined,
    to: Date | undefined,
    movementPromise: Promise<{
      qtyRows: Array<{
        kind: "receipt" | "issue";
        warehouseId: string;
        baseUnitName: string;
        qty: string;
      }>;
    }>,
  ) {
    const warehouses = await warehousesPromise;
    const [receiptGroups, issueGroups, movement] = await Promise.all([
      this.db.stockReceipt.groupBy({
        by: ["warehouseId", "status"],
        where: this.buildReceiptWhere(ctx, from, to),
        _count: { _all: true },
      }),
      this.db.stockIssue.groupBy({
        by: ["warehouseId", "status"],
        where: this.buildIssueWhere(ctx, from, to),
        _count: { _all: true },
      }),
      movementPromise,
    ]);
    const qtyRows = movement.qtyRows;

    const typedReceiptGroups = receiptGroups as Array<{
      warehouseId: string;
      status: DocStatusKey;
      _count: { _all: number };
    }>;
    const typedIssueGroups = issueGroups as Array<{
      warehouseId: string;
      status: DocStatusKey;
      _count: { _all: number };
    }>;
    const receiptCountsByWarehouse =
      groupDocCountsByWarehouse(typedReceiptGroups);
    const issueCountsByWarehouse = groupDocCountsByWarehouse(typedIssueGroups);
    const importedRows = qtyRows.filter((row) => row.kind === "receipt");
    const exportedRows = qtyRows.filter((row) => row.kind === "issue");
    const importedByWarehouse = sumQtyByWarehouseId(importedRows);
    const exportedByWarehouse = sumQtyByWarehouseId(exportedRows);

    return {
      receiptGroups: typedReceiptGroups,
      issueGroups: typedIssueGroups,
      items: warehouses.map((warehouse) => {
        const receiptCounts =
          receiptCountsByWarehouse.get(warehouse.id) ?? rowsToStatusCounts([]);
        const issueCounts =
          issueCountsByWarehouse.get(warehouse.id) ?? rowsToStatusCounts([]);
        return {
          warehouse,
          productMovement: {
            totalImportedQty: importedByWarehouse.get(warehouse.id) ?? "0.0000",
            totalExportedQty: exportedByWarehouse.get(warehouse.id) ?? "0.0000",
            importedQtyByUnit: aggregateQtyByUnit(
              importedRows.filter((row) => row.warehouseId === warehouse.id),
            ),
            exportedQtyByUnit: aggregateQtyByUnit(
              exportedRows.filter((row) => row.warehouseId === warehouse.id),
            ),
          },
          stockReceipts: toDocStatusBlock(
            Object.entries(receiptCounts).map(([status, count]) => ({
              status,
              _count: { _all: count },
            })),
          ),
          stockIssues: toDocStatusBlock(
            Object.entries(issueCounts).map(([status, count]) => ({
              status,
              _count: { _all: count },
            })),
          ),
        };
      }),
    };
  }
}

export const organizationOverviewService = new OrganizationOverviewService(
  prisma,
  listCache,
);
