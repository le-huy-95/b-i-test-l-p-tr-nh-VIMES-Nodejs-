import type { PrismaClient } from '../../infra/prisma-types';
import { d } from '../../utils/decimal';

export function liveReservationWhere(
  tenantId: string,
  warehouseId?: string | string[],
) {
  const warehouseFilter =
    warehouseId == null
      ? {}
      : Array.isArray(warehouseId)
        ? { warehouseId: { in: warehouseId } }
        : { warehouseId };

  return {
    tenantId,
    status: 'active' as const,
    expiresAt: { gte: new Date() },
    ...warehouseFilter,
  };
}

export interface LowStockItem {
  productId: string;
  sku: string;
  name: string;
  baseUnitName: string;
  minStockLevel: string;
  onhandQty: string;
  reservedQty: string;
  availableQty: string;
  shortageQty: string;
}

export async function computeLowStockItems(
  db: PrismaClient,
  tenantId: string,
  options?: { warehouseId?: string; sortByShortage?: boolean },
): Promise<LowStockItem[]> {
  const warehouseId = options?.warehouseId;

  const [products, balances, reservations] = await Promise.all([
    db.product.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        baseUnitName: true,
        minStockLevel: true,
      },
    }),
    db.stockBalance.groupBy({
      by: ['productId'],
      where: { tenantId, ...(warehouseId ? { warehouseId } : {}) },
      _sum: { onhandQty: true },
    }),
    db.stockReservation.groupBy({
      by: ['productId'],
      where: liveReservationWhere(tenantId, warehouseId),
      _sum: { qtyBaseUnit: true },
    }),
  ]);

  const onhandByProduct = new Map(
    balances.map((row) => [row.productId, d(row._sum.onhandQty?.toString() ?? 0)]),
  );
  const reservedByProduct = new Map(
    reservations.map((row) => [row.productId, d(row._sum.qtyBaseUnit?.toString() ?? 0)]),
  );

  const items = products
    .map((product) => {
      const onhandQty = onhandByProduct.get(product.id) ?? d(0);
      const reservedQty = reservedByProduct.get(product.id) ?? d(0);
      const availableQty = onhandQty.minus(reservedQty);
      const minStockLevel = d(product.minStockLevel.toString());
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        baseUnitName: product.baseUnitName,
        minStockLevel: minStockLevel.toFixed(4),
        onhandQty: onhandQty.toFixed(4),
        reservedQty: reservedQty.toFixed(4),
        availableQty: availableQty.toFixed(4),
        shortageQty: minStockLevel.minus(availableQty).toFixed(4),
      };
    })
    .filter((row) => d(row.availableQty).lt(row.minStockLevel));

  if (options?.sortByShortage) {
    return items.sort((a, b) => d(b.shortageQty).minus(a.shortageQty).toNumber());
  }
  return items;
}

export interface ExpiryAlertItem {
  batchId: string;
  batchNo: string;
  expiryDate: Date | null;
  daysToExpiry: number | null;
  onhandQty: string;
  product: {
    id: string;
    sku: string;
    name: string;
    baseUnitName: string;
  };
  warehouse?: {
    id: string;
    code: string;
    name: string;
  };
}

export async function computeExpiryAlerts(
  db: PrismaClient,
  tenantId: string,
  days: number,
  options?: { warehouseId?: string; includeWarehouse?: boolean },
): Promise<ExpiryAlertItem[]> {
  const warehouseId = options?.warehouseId;
  const includeWarehouse = options?.includeWarehouse ?? warehouseId == null;

  const until = new Date();
  until.setDate(until.getDate() + days);

  const batches = await db.batch.findMany({
    where: {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      expiryDate: { not: null, lte: until },
    },
    include: {
      product: { select: { id: true, sku: true, name: true, baseUnitName: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });

  const balances = await db.stockBalance.findMany({
    where: {
      tenantId,
      batchId: { in: batches.map((batch) => batch.id) },
      ...(warehouseId ? { warehouseId } : {}),
    },
    ...(includeWarehouse
      ? { include: { warehouse: { select: { id: true, code: true, name: true } } } }
      : {}),
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (includeWarehouse) {
    const onhandByBatch = new Map<string, typeof balances>();
    for (const row of balances) {
      if (!row.batchId) continue;
      const list = onhandByBatch.get(row.batchId) ?? [];
      list.push(row);
      onhandByBatch.set(row.batchId, list);
    }

    return batches.flatMap((batch) => {
      const rows = onhandByBatch.get(batch.id) ?? [];
      return rows
        .filter((row) => d(row.onhandQty.toString()).gt(0))
        .map((row) => ({
          batchId: batch.id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          daysToExpiry: batch.expiryDate
            ? Math.ceil((batch.expiryDate.getTime() - today.getTime()) / 86_400_000)
            : null,
          onhandQty: row.onhandQty.toString(),
          warehouse: (row as typeof row & { warehouse: NonNullable<ExpiryAlertItem['warehouse']> }).warehouse,
          product: batch.product,
        }));
    });
  }

  const balanceByBatch = new Map(balances.map((row) => [row.batchId!, row]));
  return batches
    .map((batch) => {
      const balance = balanceByBatch.get(batch.id);
      if (!balance || d(balance.onhandQty.toString()).lte(0)) return null;
      return {
        batchId: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        daysToExpiry: batch.expiryDate
          ? Math.ceil((batch.expiryDate.getTime() - today.getTime()) / 86_400_000)
          : null,
        onhandQty: balance.onhandQty.toString(),
        product: batch.product,
      };
    })
    .filter((row): row is ExpiryAlertItem => row != null);
}
