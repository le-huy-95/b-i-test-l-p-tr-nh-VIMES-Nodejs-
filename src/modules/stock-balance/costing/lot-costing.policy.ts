/**
 * GIÁ VỐN THEO LÔ
 * ---------------
 * Mỗi batch giữ unit cost riêng; xuất theo cost của lô được pick.
 */
import type { CostingChangeInput, CostingPolicy } from './costing-policy';

export class LotCostingPolicy implements CostingPolicy {
  async onStockIncrease(_input: CostingChangeInput): Promise<void> {}
}
