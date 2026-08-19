import type { Prisma } from '../../infra/prisma-types';
import type { QtyChange, StockBalanceWriter } from './stock-balance.port';
import { stockBalanceService } from './stock-balance.service';
import type { StockLedgerWriter } from './stock-ledger.port';
import { stockLedgerService } from './stock-ledger.service';
import { resolveCostingPolicy } from './costing/costing-policy';
import type {
  StockPostingInput,
  StockPostingPort,
} from './stock-posting.port';

export type {
  StockPostingDirection,
  StockPostingInput,
  StockPostingLedgerMeta,
} from './stock-posting.port';

const LEDGER_TYPE = { in: 'in', out: 'out', opening: 'opening' } as const;

function compareQtyChangeKey(a: QtyChange, b: QtyChange) {
  return `${a.productId}:${a.warehouseId}:${a.batchId}:${a.locationId}`.localeCompare(
    `${b.productId}:${b.warehouseId}:${b.batchId}:${b.locationId}`,
  );
}

export class StockPostingService implements StockPostingPort {
  constructor(
    private readonly balance: StockBalanceWriter = stockBalanceService,
    private readonly ledger: StockLedgerWriter = stockLedgerService,
  ) {}

  async apply(input: StockPostingInput, trx: Prisma.TransactionClient) {
    const { direction, ledger } = input;
    const changes = [...input.changes].sort(compareQtyChangeKey);
    const applied =
      direction === 'out'
        ? await this.balance.applyDecrease(changes, trx)
        : await this.balance.applyIncrease(changes, trx);

    await this.ledger.record(
      applied.map((a, i) => ({
        tenantId: a.key.tenantId,
        productId: a.key.productId,
        warehouseId: a.key.warehouseId,
        batchId: a.key.batchId,
        locationId: a.key.locationId,
        transactionType: LEDGER_TYPE[direction],
        refDocType: ledger.refDocType,
        refDocId: ledger.refDocId,
        qtyChange: direction === 'out' ? `-${changes[i].qtyBaseUnit}` : changes[i].qtyBaseUnit,
        qtyBalanceAfter: a.balanceAfter,
        unitCost: changes[i].unitCost,
        createdById: ledger.createdById,
      })),
      trx,
    );

    if (direction === 'opening') {
      for (const c of changes) {
        await trx.product.update({
          where: { id: c.productId },
          data: { averageCost: c.unitCost ?? '0' },
        });
      }
      return;
    }

    if (direction === 'in') {
      for (const c of changes) {
        await resolveCostingPolicy('weighted_average').onStockIncrease({
          tenantId: c.tenantId,
          productId: c.productId,
          warehouseId: c.warehouseId,
          qtyBaseUnit: c.qtyBaseUnit,
          unitCost: c.unitCost ?? '0',
          trx,
        });
      }
    }
  }
}

export const stockPostingService = new StockPostingService(
  stockBalanceService,
  stockLedgerService,
);