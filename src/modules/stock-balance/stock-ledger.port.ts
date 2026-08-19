import type { LedgerTxnType, Prisma } from '../../infra/prisma-types';

export interface StockLedgerEntry {
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId?: string | null;
  locationId?: string | null;
  transactionType: LedgerTxnType;
  refDocType: string;
  refDocId: string;
  qtyChange: string;
  qtyBalanceAfter: string;
  unitCost?: string;
  note?: string;
  createdById: string;
}

export interface StockLedgerWriter {
  record(
    entries: StockLedgerEntry[],
    trx: Prisma.TransactionClient,
  ): Promise<void>;
}