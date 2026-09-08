/**
 * GIÁ VỐN BÌNH QUÂN (MOVING AVERAGE)
 * ----------------------------------
 * Cập nhật average_cost khi nhập; xuất dùng giá vốn hiện tại.
 */
import { d, toDecimalString } from '../../../utils/decimal';
import type { StockBalanceReader } from '../stock-balance.port';
import type { CostingChangeInput, CostingPolicy } from './costing-policy';

export class AvgCostingPolicy implements CostingPolicy {
  constructor(private readonly balance: StockBalanceReader) {}

  async onStockIncrease(input: CostingChangeInput): Promise<void> {
    const { tenantId, productId, warehouseId, qtyBaseUnit, unitCost, trx } = input;
    const product = await trx.product.findUniqueOrThrow({ where: { id: productId } });
    const available = await this.balance.getAvailable(tenantId, productId, warehouseId, trx);
    const onhandBefore = available.onhandQty.minus(qtyBaseUnit);
    const qty = d(qtyBaseUnit);
    const newAvg = onhandBefore.lte(0)
      ? d(unitCost ?? 0)
      : onhandBefore
          .mul(product.averageCost.toString())
          .plus(qty.mul(unitCost ?? 0))
          .div(onhandBefore.plus(qty));

    await trx.product.update({
      where: { id: productId },
      data: { averageCost: toDecimalString(newAvg, 4) },
    });
  }
}
