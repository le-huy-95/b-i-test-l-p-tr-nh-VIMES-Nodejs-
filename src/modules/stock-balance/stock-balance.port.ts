import type { Prisma } from '../../infra/prisma-types';
import type { Decimal } from '../../utils/decimal';

export interface BalanceKey {
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId?: string | null;
  locationId?: string | null;
}

export interface QtyChange extends BalanceKey {
  qtyBaseUnit: string;
  unitCost?: string;
}

export interface StockAvailableQty {
  onhandQty: Decimal;
  reservedQty: Decimal;
  availableQty: Decimal;
}

export type BalanceApplyResult = { key: BalanceKey; balanceAfter: string };

export interface StockBalanceReader {
  getAvailable(
    tenantId: string,
    productId: string,
    warehouseId: string,
    trx?: Prisma.TransactionClient,
    batchId?: string | null,
  ): Promise<StockAvailableQty>;
}

export interface StockBalanceWriter {
  applyIncrease(
    changes: QtyChange[],
    trx: Prisma.TransactionClient,
  ): Promise<BalanceApplyResult[]>;
  applyDecrease(
    changes: QtyChange[],
    trx: Prisma.TransactionClient,
  ): Promise<BalanceApplyResult[]>;
}