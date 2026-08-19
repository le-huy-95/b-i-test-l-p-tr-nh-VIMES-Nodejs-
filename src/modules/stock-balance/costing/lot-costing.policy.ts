import type { CostingChangeInput, CostingPolicy } from './costing-policy';

export class LotCostingPolicy implements CostingPolicy {
  async onStockIncrease(_input: CostingChangeInput): Promise<void> {}
}
