/**
 * HÀM HỖ TRỢ TỔNG QUAN KHO
 * -------------------------
 * - Đếm phiếu theo trạng thái (draft, pending_approval, approved...)
 * - Tính chỉ số tồn kho qua raw SQL (onhand, reserved, giá trị, low-stock, hết hạn)
 * - Serialize warehouse và gom số lượng theo đơn vị tính
 */
import { Prisma, type PrismaClient } from '../../infra/prisma-types';
import { d } from '../../utils/decimal';

export const DOC_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'completed',
  'rejected',
  'cancelled',
  'out_of_stock',
] as const;

export type DocStatusKey = (typeof DOC_STATUSES)[number];
export type StatusCounts = Record<DocStatusKey, number>;

export function emptyStatusCounts(): StatusCounts {
  return {
    draft: 0,
    pending_approval: 0,
    approved: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    out_of_stock: 0,
  };
}

export function rowsToStatusCounts(
  rows: Array<{ status: DocStatusKey; _count: { _all: number } }>,
): StatusCounts {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    counts[row.status] = row._count._all;
  }
  return counts;
}

export function sumStatusCountRows(
  rows: Array<{ status: DocStatusKey; _count: { _all: number } }>,
): Array<{ status: DocStatusKey; _count: { _all: number } }> {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    counts[row.status] += row._count._all;
  }
  return DOC_STATUSES.map((status) => ({
    status,
    _count: { _all: counts[status] },
  }));
}

export function totalFromStatusCounts(counts: StatusCounts): number {
  return DOC_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

export function groupDocCountsByWarehouse(
  rows: Array<{ warehouseId: string; status: DocStatusKey; _count: { _all: number } }>,
): Map<string, StatusCounts> {
  const map = new Map<string, StatusCounts>();
  for (const row of rows) {
    const current = map.get(row.warehouseId) ?? emptyStatusCounts();
    current[row.status] = row._count._all;
    map.set(row.warehouseId, current);
  }
  return map;
}

export interface QtyByUnit {
  baseUnitName: string;
  qty: string;
}

export interface InventoryQtyByUnit {
  baseUnitName: string;
  onhandQty: string;
  reservedQty: string;
  availableQty: string;
}

export interface WarehouseInventoryMetrics {
  skuCount: number;
  totalOnhandQty: string;
  totalReservedQty: string;
  totalAvailableQty: string;
  estimatedStockValue: string;
  lowStockCount: number;
  expiryAlertCount: number;
  activeReservationCount: number;
  qtyByUnit: InventoryQtyByUnit[];
}

interface InventoryMetricsRow {
  skuCount: number | string | bigint;
  totalOnhandQty: string;
  totalReservedQty: string;
  totalAvailableQty: string;
  estimatedStockValue: string;
  lowStockCount: number | string | bigint;
  expiryAlertCount: number | string | bigint;
  activeReservationCount: number | string | bigint;
  qtyByUnit?: unknown;
}

export function emptyInventoryMetrics(): WarehouseInventoryMetrics {
  return {
    skuCount: 0,
    totalOnhandQty: '0.0000',
    totalReservedQty: '0.0000',
    totalAvailableQty: '0.0000',
    estimatedStockValue: '0.00',
    lowStockCount: 0,
    expiryAlertCount: 0,
    activeReservationCount: 0,
    qtyByUnit: [],
  };
}

function toCount(value: number | string | bigint | null | undefined): number {
  return Number(value ?? 0);
}

function formatInventoryQtyByUnit(raw: unknown): InventoryQtyByUnit[] {
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row: Record<string, unknown>) => ({
      baseUnitName: String(row.baseUnitName ?? ''),
      onhandQty: d(String(row.onhandQty ?? 0)).toFixed(4),
      reservedQty: d(String(row.reservedQty ?? 0)).toFixed(4),
      availableQty: d(String(row.availableQty ?? 0)).toFixed(4),
    }))
    .sort((a, b) => a.baseUnitName.localeCompare(b.baseUnitName, 'vi'));
}

function formatInventoryRow(row: InventoryMetricsRow): WarehouseInventoryMetrics {
  return {
    skuCount: toCount(row.skuCount),
    totalOnhandQty: d(row.totalOnhandQty).toFixed(4),
    totalReservedQty: d(row.totalReservedQty).toFixed(4),
    totalAvailableQty: d(row.totalAvailableQty).toFixed(4),
    estimatedStockValue: d(row.estimatedStockValue).toFixed(2),
    lowStockCount: toCount(row.lowStockCount),
    expiryAlertCount: toCount(row.expiryAlertCount),
    activeReservationCount: toCount(row.activeReservationCount),
    qtyByUnit: formatInventoryQtyByUnit(row.qtyByUnit),
  };
}

export function aggregateQtyByUnit(
  rows: Array<{ baseUnitName?: string | null; qty: string }>,
): QtyByUnit[] {
  const map = new Map<string, ReturnType<typeof d>>();
  for (const row of rows) {
    const unit = row.baseUnitName ?? '';
    map.set(unit, (map.get(unit) ?? d(0)).plus(row.qty));
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
    .map(([baseUnitName, qty]) => ({ baseUnitName, qty: qty.toFixed(4) }));
}

export function sumQtyByWarehouseId(
  rows: Array<{ warehouseId: string; qty: string }>,
): Map<string, string> {
  const map = new Map<string, ReturnType<typeof d>>();
  for (const row of rows) {
    map.set(row.warehouseId, (map.get(row.warehouseId) ?? d(0)).plus(row.qty));
  }
  return new Map([...map.entries()].map(([id, qty]) => [id, qty.toFixed(4)]));
}

function warehouseIdList(warehouseIds: string[]) {
  return Prisma.join(warehouseIds);
}

async function queryInventoryMetrics(
  db: PrismaClient,
  tenantId: string,
  warehouseIds: string[],
  expiryDays: number,
): Promise<WarehouseInventoryMetrics> {
  if (warehouseIds.length === 0) return emptyInventoryMetrics();

  const until = new Date();
  until.setDate(until.getDate() + expiryDays);
  const ids = warehouseIdList(warehouseIds);

  const rows = await db.$queryRaw<InventoryMetricsRow[]>(Prisma.sql`
    -- inventory-metrics
    WITH
    onhand_agg AS (
      SELECT warehouse_id, product_id, SUM(onhand_qty) AS qty
      FROM stock_balances
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND onhand_qty > 0
      GROUP BY warehouse_id, product_id
    ),
    reserved_agg AS (
      SELECT warehouse_id, product_id, SUM(qty_base_unit) AS qty
      FROM stock_reservations
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND status = 'active'
        AND expires_at >= NOW()
      GROUP BY warehouse_id, product_id
    ),
    totals AS (
      SELECT
        COUNT(DISTINCT b.product_id)::int AS sku_count,
        COALESCE(SUM(b.onhand_qty), 0) AS total_onhand,
        COALESCE(SUM(b.onhand_qty * COALESCE(p.average_cost, 0)), 0) AS stock_value
      FROM stock_balances b
      LEFT JOIN products p ON p.id = b.product_id
      WHERE b.tenant_id = ${tenantId}
        AND b.warehouse_id IN (${ids})
        AND b.onhand_qty > 0
    ),
    reserved_tot AS (
      SELECT
        COALESCE(SUM(qty_base_unit), 0) AS total_reserved,
        COUNT(*)::int AS reservation_count
      FROM stock_reservations
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND status = 'active'
        AND expires_at >= NOW()
    ),
    expiry AS (
      SELECT COUNT(*)::int AS expiry_count
      FROM stock_balances b
      INNER JOIN batches bt ON bt.id = b.batch_id
      WHERE b.tenant_id = ${tenantId}
        AND b.warehouse_id IN (${ids})
        AND b.onhand_qty > 0
        AND bt.expiry_date IS NOT NULL
        AND bt.expiry_date <= ${until}
    ),
    wh AS (
      SELECT UNNEST(ARRAY[${ids}]::text[]) AS id
    ),
    low_stock AS (
      SELECT COUNT(*)::int AS low_stock_count
      FROM wh
      CROSS JOIN products p
      LEFT JOIN onhand_agg o ON o.warehouse_id = wh.id AND o.product_id = p.id
      LEFT JOIN reserved_agg r ON r.warehouse_id = wh.id AND r.product_id = p.id
      WHERE p.tenant_id = ${tenantId}
        AND p.is_active = true
        AND COALESCE(o.qty, 0) - COALESCE(r.qty, 0) < p.min_stock_level
    ),
    unit_qty AS (
      SELECT
        COALESCE(o.unit, r.unit) AS unit,
        COALESCE(o.qty, 0) AS onhand,
        COALESCE(r.qty, 0) AS reserved
      FROM (
        SELECT COALESCE(p.base_unit_name, '') AS unit, SUM(b.onhand_qty) AS qty
        FROM stock_balances b
        INNER JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId}
          AND b.warehouse_id IN (${ids})
          AND b.onhand_qty > 0
        GROUP BY 1
      ) o
      FULL OUTER JOIN (
        SELECT COALESCE(p.base_unit_name, '') AS unit, SUM(rv.qty_base_unit) AS qty
        FROM stock_reservations rv
        INNER JOIN products p ON p.id = rv.product_id
        WHERE rv.tenant_id = ${tenantId}
          AND rv.warehouse_id IN (${ids})
          AND rv.status = 'active'
          AND rv.expires_at >= NOW()
        GROUP BY 1
      ) r ON r.unit = o.unit
    )
    SELECT
      COALESCE(totals.sku_count, 0) AS "skuCount",
      COALESCE(totals.total_onhand, 0)::text AS "totalOnhandQty",
      COALESCE(reserved_tot.total_reserved, 0)::text AS "totalReservedQty",
      (COALESCE(totals.total_onhand, 0) - COALESCE(reserved_tot.total_reserved, 0))::text AS "totalAvailableQty",
      COALESCE(totals.stock_value, 0)::text AS "estimatedStockValue",
      COALESCE(low_stock.low_stock_count, 0) AS "lowStockCount",
      COALESCE(expiry.expiry_count, 0) AS "expiryAlertCount",
      COALESCE(reserved_tot.reservation_count, 0) AS "activeReservationCount",
      COALESCE((
        SELECT json_agg(json_build_object(
          'baseUnitName', unit,
          'onhandQty', onhand::text,
          'reservedQty', reserved::text,
          'availableQty', (onhand - reserved)::text
        ) ORDER BY unit)
        FROM unit_qty
      ), '[]'::json) AS "qtyByUnit"
    FROM totals, reserved_tot, expiry, low_stock
  `);

  const row = rows[0];
  return row ? formatInventoryRow(row) : emptyInventoryMetrics();
}

export async function computeWarehouseInventoryMetrics(
  db: PrismaClient,
  tenantId: string,
  warehouseId: string,
  expiryDays: number,
): Promise<WarehouseInventoryMetrics> {
  return queryInventoryMetrics(db, tenantId, [warehouseId], expiryDays);
}

export async function computeOrganizationInventoryMetrics(
  db: PrismaClient,
  tenantId: string,
  warehouseIds: string[],
  expiryDays: number,
): Promise<WarehouseInventoryMetrics> {
  return queryInventoryMetrics(db, tenantId, warehouseIds, expiryDays);
}

export async function computeWarehouseInventoryMetricsMap(
  db: PrismaClient,
  tenantId: string,
  warehouseIds: string[],
  expiryDays: number,
): Promise<Map<string, WarehouseInventoryMetrics>> {
  const result = new Map<string, WarehouseInventoryMetrics>();
  if (warehouseIds.length === 0) return result;

  const until = new Date();
  until.setDate(until.getDate() + expiryDays);
  const ids = warehouseIdList(warehouseIds);

  const rows = await db.$queryRaw<Array<InventoryMetricsRow & { warehouseId: string }>>(Prisma.sql`
    -- inventory-metrics-by-warehouse
    WITH
    wh AS (
      SELECT UNNEST(ARRAY[${ids}]::text[]) AS id
    ),
    onhand_agg AS (
      SELECT warehouse_id, product_id, SUM(onhand_qty) AS qty
      FROM stock_balances
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND onhand_qty > 0
      GROUP BY warehouse_id, product_id
    ),
    reserved_agg AS (
      SELECT warehouse_id, product_id, SUM(qty_base_unit) AS qty
      FROM stock_reservations
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND status = 'active'
        AND expires_at >= NOW()
      GROUP BY warehouse_id, product_id
    ),
    totals AS (
      SELECT
        b.warehouse_id,
        COUNT(DISTINCT b.product_id)::int AS sku_count,
        COALESCE(SUM(b.onhand_qty), 0) AS total_onhand,
        COALESCE(SUM(b.onhand_qty * COALESCE(p.average_cost, 0)), 0) AS stock_value
      FROM stock_balances b
      LEFT JOIN products p ON p.id = b.product_id
      WHERE b.tenant_id = ${tenantId}
        AND b.warehouse_id IN (${ids})
        AND b.onhand_qty > 0
      GROUP BY b.warehouse_id
    ),
    reserved_tot AS (
      SELECT
        warehouse_id,
        COALESCE(SUM(qty_base_unit), 0) AS total_reserved,
        COUNT(*)::int AS reservation_count
      FROM stock_reservations
      WHERE tenant_id = ${tenantId}
        AND warehouse_id IN (${ids})
        AND status = 'active'
        AND expires_at >= NOW()
      GROUP BY warehouse_id
    ),
    expiry AS (
      SELECT
        b.warehouse_id,
        COUNT(*)::int AS expiry_count
      FROM stock_balances b
      INNER JOIN batches bt ON bt.id = b.batch_id
      WHERE b.tenant_id = ${tenantId}
        AND b.warehouse_id IN (${ids})
        AND b.onhand_qty > 0
        AND bt.expiry_date IS NOT NULL
        AND bt.expiry_date <= ${until}
      GROUP BY b.warehouse_id
    ),
    low_stock AS (
      SELECT
        wh.id AS warehouse_id,
        COUNT(*)::int AS low_stock_count
      FROM wh
      CROSS JOIN products p
      LEFT JOIN onhand_agg o ON o.warehouse_id = wh.id AND o.product_id = p.id
      LEFT JOIN reserved_agg r ON r.warehouse_id = wh.id AND r.product_id = p.id
      WHERE p.tenant_id = ${tenantId}
        AND p.is_active = true
        AND COALESCE(o.qty, 0) - COALESCE(r.qty, 0) < p.min_stock_level
      GROUP BY wh.id
    ),
    unit_qty AS (
      SELECT
        COALESCE(o.warehouse_id, r.warehouse_id) AS warehouse_id,
        COALESCE(o.unit, r.unit) AS unit,
        COALESCE(o.qty, 0) AS onhand,
        COALESCE(r.qty, 0) AS reserved
      FROM (
        SELECT b.warehouse_id, COALESCE(p.base_unit_name, '') AS unit, SUM(b.onhand_qty) AS qty
        FROM stock_balances b
        INNER JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId}
          AND b.warehouse_id IN (${ids})
          AND b.onhand_qty > 0
        GROUP BY 1, 2
      ) o
      FULL OUTER JOIN (
        SELECT rv.warehouse_id, COALESCE(p.base_unit_name, '') AS unit, SUM(rv.qty_base_unit) AS qty
        FROM stock_reservations rv
        INNER JOIN products p ON p.id = rv.product_id
        WHERE rv.tenant_id = ${tenantId}
          AND rv.warehouse_id IN (${ids})
          AND rv.status = 'active'
          AND rv.expires_at >= NOW()
        GROUP BY 1, 2
      ) r ON r.warehouse_id = o.warehouse_id AND r.unit = o.unit
    ),
    unit_json AS (
      SELECT
        warehouse_id,
        json_agg(json_build_object(
          'baseUnitName', unit,
          'onhandQty', onhand::text,
          'reservedQty', reserved::text,
          'availableQty', (onhand - reserved)::text
        ) ORDER BY unit) AS qty_by_unit
      FROM unit_qty
      GROUP BY warehouse_id
    )
    SELECT
      wh.id AS "warehouseId",
      COALESCE(totals.sku_count, 0) AS "skuCount",
      COALESCE(totals.total_onhand, 0)::text AS "totalOnhandQty",
      COALESCE(reserved_tot.total_reserved, 0)::text AS "totalReservedQty",
      (COALESCE(totals.total_onhand, 0) - COALESCE(reserved_tot.total_reserved, 0))::text AS "totalAvailableQty",
      COALESCE(totals.stock_value, 0)::text AS "estimatedStockValue",
      COALESCE(low_stock.low_stock_count, 0) AS "lowStockCount",
      COALESCE(expiry.expiry_count, 0) AS "expiryAlertCount",
      COALESCE(reserved_tot.reservation_count, 0) AS "activeReservationCount",
      COALESCE(unit_json.qty_by_unit, '[]'::json) AS "qtyByUnit"
    FROM wh
    LEFT JOIN totals ON totals.warehouse_id = wh.id
    LEFT JOIN reserved_tot ON reserved_tot.warehouse_id = wh.id
    LEFT JOIN expiry ON expiry.warehouse_id = wh.id
    LEFT JOIN low_stock ON low_stock.warehouse_id = wh.id
    LEFT JOIN unit_json ON unit_json.warehouse_id = wh.id
  `);

  for (const row of rows) {
    result.set(row.warehouseId, formatInventoryRow(row));
  }
  return result;
}

export function serializeWarehouse(warehouse: {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  latitude: { toString(): string } | null;
  longitude: { toString(): string } | null;
}) {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    isActive: warehouse.isActive,
    latitude: warehouse.latitude?.toString() ?? null,
    longitude: warehouse.longitude?.toString() ?? null,
  };
}
