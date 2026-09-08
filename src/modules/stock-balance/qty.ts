/**
 * TIỆN ÍCH SỐ LƯỢNG TỒN KHO
 * -------------------------
 * Chuyển đổi/chuẩn hóa qty Decimal, tính available = onhand - reserved.
 */
import { Prisma } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { d, toDecimalString } from '../../utils/decimal';

export class QtyResolver {
  constructor(private readonly db: Prisma.TransactionClient = prisma) {}

  async resolveQtyBaseUnit(
    productId: string,
    unitName: string,
    qty: number,
    trx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = trx ?? this.db;
    const product = await client.product.findUniqueOrThrow({
      where: { id: productId },
      include: { units: true },
    });
    const unit =
      product.units.find((u) => u.unitName === unitName) ??
      product.units.find((u) => u.unitName === product.baseUnitName);
    const rate = d(unit?.conversionRate?.toString() ?? 1);
    return toDecimalString(d(qty).mul(rate), 4);
  }
}

export const qtyResolver = new QtyResolver(prisma);

export async function resolveQtyBaseUnit(
  productId: string,
  unitName: string,
  qty: number,
  trx: Prisma.TransactionClient = prisma,
): Promise<string> {
  return qtyResolver.resolveQtyBaseUnit(productId, unitName, qty, trx);
}
