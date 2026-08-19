import type { Prisma } from '../../../infra/prisma-types';
import { AppError } from '../../../utils/app-error';
import { stockBalanceService } from '../stock-balance.service';
import { AvgCostingPolicy } from './avg-costing.policy';
import { LotCostingPolicy } from './lot-costing.policy';

export interface CostingChangeInput {
  tenantId: string;
  productId: string;
  warehouseId: string;
  qtyBaseUnit: string;
  unitCost: string;
  trx: Prisma.TransactionClient;
}

export interface CostingPolicy {
  onStockIncrease(input: CostingChangeInput): Promise<void>;
}

const avgCostingPolicy = new AvgCostingPolicy(stockBalanceService);
const lotCostingPolicy = new LotCostingPolicy();

function normalizeCostingMethod(method: string): string {
  return method.trim().toLowerCase();
}

export function resolveCostingPolicy(method: string): CostingPolicy {
  const normalized = normalizeCostingMethod(method);

  if (normalized === 'weighted_average' || normalized === 'avg') {
    return avgCostingPolicy;
  }

  if (normalized === 'fifo' || normalized === 'fefo' || normalized === 'specific_identification') {
    return lotCostingPolicy;
  }

  throw new AppError('VALIDATION_ERROR', 400, `Unsupported costing method: ${method}`);
}
