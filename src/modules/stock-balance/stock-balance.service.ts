import type { Prisma, PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { d } from '../../utils/decimal';
import { AppError } from '../../utils/app-error';
import type {
  BalanceKey,
  QtyChange,
  StockBalanceReader,
  StockBalanceWriter,
} from './stock-balance.port';

export type { BalanceKey, QtyChange } from './stock-balance.port';

function nullKey(v?: string | null) {
  return v ?? null;
}

function balanceKey(c: QtyChange): string {
  return `${c.tenantId}\u0000${c.productId}\u0000${c.warehouseId}\u0000${c.batchId ?? ''}\u0000${c.locationId ?? ''}`;
}

function compareQtyChangeKey(a: QtyChange, b: QtyChange) {
  return balanceKey(a).localeCompare(balanceKey(b));
}

export class StockBalanceService implements StockBalanceReader, StockBalanceWriter {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getAvailable(
    tenantId: string,
    productId: string,
    warehouseId: string,
    trx: Prisma.TransactionClient = this.db,
    batchId?: string | null,
  ) {
    await trx.stockReservation.updateMany({
      where: {
        tenantId,
        productId,
        warehouseId,
        status: 'active',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    });

    const balances = await trx.stockBalance.findMany({
      where: {
        tenantId,
        productId,
        warehouseId,
        ...(batchId === undefined ? {} : { batchId: batchId ?? null }),
      },
    });
    const onhand = balances.reduce((sum, b) => sum.plus(b.onhandQty.toString()), d(0));

    const reserved = await trx.stockReservation.aggregate({
      where: {
        tenantId,
        productId,
        warehouseId,
        status: 'active',
        ...(batchId === undefined ? {} : { batchId: batchId ?? null }),
      },
      _sum: { qtyBaseUnit: true },
    });

    const reservedQty = d(reserved._sum.qtyBaseUnit?.toString() ?? 0);
    return {
      onhandQty: onhand,
      reservedQty,
      availableQty: onhand.minus(reservedQty),
    };
  }

  async applyIncrease(changes: QtyChange[], trx: Prisma.TransactionClient) {
    const sorted = [...changes].sort(compareQtyChangeKey);

    const keys = sorted.map((c) => ({
      tenantId: c.tenantId,
      productId: c.productId,
      warehouseId: c.warehouseId,
      batchId: nullKey(c.batchId),
      locationId: nullKey(c.locationId),
    }));

    const existing = keys.length
      ? await trx.stockBalance.findMany({
          where: {
            OR: keys.map((k) => ({
              tenantId: k.tenantId,
              productId: k.productId,
              warehouseId: k.warehouseId,
              batchId: k.batchId,
              locationId: k.locationId,
            })),
          },
        })
      : [];

    const existingMap = new Map(
      existing.map((b) => [`${b.tenantId}\u0000${b.productId}\u0000${b.warehouseId}\u0000${b.batchId ?? ''}\u0000${b.locationId ?? ''}`, b]),
    );

    const results: Array<{ key: BalanceKey; balanceAfter: string }> = [];

    for (const c of sorted) {
      const batchId = nullKey(c.batchId);
      const locationId = nullKey(c.locationId);
      const key = `${c.tenantId}\u0000${c.productId}\u0000${c.warehouseId}\u0000${batchId ?? ''}\u0000${locationId ?? ''}`;
      const existingRow = existingMap.get(key);

      let balanceAfter: string;
      if (!existingRow) {
        const created = await trx.stockBalance.create({
          data: {
            tenantId: c.tenantId,
            productId: c.productId,
            warehouseId: c.warehouseId,
            batchId,
            locationId,
            onhandQty: c.qtyBaseUnit,
            version: 1,
          },
        });
        balanceAfter = created.onhandQty.toString();
      } else {
        const updated = await trx.stockBalance.update({
          where: { id: existingRow.id },
          data: {
            onhandQty: { increment: c.qtyBaseUnit },
            version: { increment: 1 },
          },
        });
        balanceAfter = updated.onhandQty.toString();
      }

      results.push({
        key: {
          tenantId: c.tenantId,
          productId: c.productId,
          warehouseId: c.warehouseId,
          batchId,
          locationId,
        },
        balanceAfter,
      });
    }

    return results;
  }

  async applyDecrease(changes: QtyChange[], trx: Prisma.TransactionClient) {
    const sorted = [...changes].sort(compareQtyChangeKey);

    const keys = sorted.map((c) => ({
      tenantId: c.tenantId,
      productId: c.productId,
      warehouseId: c.warehouseId,
      batchId: nullKey(c.batchId),
      locationId: nullKey(c.locationId),
    }));

    const existing = keys.length
      ? await trx.stockBalance.findMany({
          where: {
            OR: keys.map((k) => ({
              tenantId: k.tenantId,
              productId: k.productId,
              warehouseId: k.warehouseId,
              batchId: k.batchId,
              locationId: k.locationId,
            })),
          },
        })
      : [];

    const existingMap = new Map(
      existing.map((b) => [`${b.tenantId}\u0000${b.productId}\u0000${b.warehouseId}\u0000${b.batchId ?? ''}\u0000${b.locationId ?? ''}`, b]),
    );

    const results: Array<{ key: BalanceKey; balanceAfter: string }> = [];

    for (const c of sorted) {
      const batchId = nullKey(c.batchId);
      const locationId = nullKey(c.locationId);
      const key = `${c.tenantId}\u0000${c.productId}\u0000${c.warehouseId}\u0000${batchId ?? ''}\u0000${locationId ?? ''}`;
      const existingRow = existingMap.get(key);

      if (!existingRow) {
        throw new AppError('STOCK_INSUFFICIENT', 409, 'Không đủ tồn kho', [
          {
            productId: c.productId,
            available: '0',
            requested: c.qtyBaseUnit,
          },
        ]);
      }

      const current = d(existingRow.onhandQty.toString());
      const next = current.minus(c.qtyBaseUnit);
      if (next.isNegative()) {
        throw new AppError('STOCK_INSUFFICIENT', 409, 'Không đủ tồn kho', [
          {
            productId: c.productId,
            available: current.toString(),
            requested: c.qtyBaseUnit,
          },
        ]);
      }

      const updated = await trx.stockBalance.updateMany({
        where: {
          id: existingRow.id,
          version: existingRow.version,
          onhandQty: { gte: c.qtyBaseUnit },
        },
        data: {
          onhandQty: { decrement: c.qtyBaseUnit },
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new AppError('VERSION_CONFLICT', 409, 'Xung đột tồn kho, thử lại', [
          { productId: c.productId },
        ]);
      }

      const after = await trx.stockBalance.findUniqueOrThrow({ where: { id: existingRow.id } });
      results.push({
        key: {
          tenantId: c.tenantId,
          productId: c.productId,
          warehouseId: c.warehouseId,
          batchId,
          locationId,
        },
        balanceAfter: after.onhandQty.toString(),
      });
    }

    return results;
  }
}

export const stockBalanceService = new StockBalanceService(prisma);
