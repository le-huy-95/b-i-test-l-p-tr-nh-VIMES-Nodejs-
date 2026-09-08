/**
 * PORT POSTING TỒN KHO
 * --------------------
 * Interface posting — cho phép mock hoặc queue async.
 */
import type { Prisma } from '../../infra/prisma-types';
import type { QtyChange } from './stock-balance.port';

export type StockPostingDirection = 'in' | 'out' | 'opening';

export interface StockPostingLedgerMeta {
  refDocType: string;
  refDocId: string;
  createdById: string;
}

export interface StockPostingInput {
  direction: StockPostingDirection;
  changes: QtyChange[];
  ledger: StockPostingLedgerMeta;
}

export interface StockPostingPort {
  apply(input: StockPostingInput, trx: Prisma.TransactionClient): Promise<void>;
}