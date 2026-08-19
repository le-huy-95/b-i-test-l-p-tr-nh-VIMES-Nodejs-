import { Prisma } from '../../infra/prisma-types';
import type { StockLedgerEntry, StockLedgerWriter } from './stock-ledger.port';

export class StockLedgerService implements StockLedgerWriter {
  async record(entries: StockLedgerEntry[], trx: Prisma.TransactionClient) {
    if (!entries.length) return;
    await trx.stockLedger.createMany({
      data: entries.map((e) => ({
        tenantId: e.tenantId,
        productId: e.productId,
        warehouseId: e.warehouseId,
        batchId: e.batchId ?? null,
        locationId: e.locationId ?? null,
        transactionType: e.transactionType,
        refDocType: e.refDocType,
        refDocId: e.refDocId,
        qtyChange: e.qtyChange,
        qtyBalanceAfter: e.qtyBalanceAfter,
        unitCost: e.unitCost ?? '0',
        note: e.note,
        createdById: e.createdById,
      })),
    });
  }
}

export const stockLedgerService = new StockLedgerService();