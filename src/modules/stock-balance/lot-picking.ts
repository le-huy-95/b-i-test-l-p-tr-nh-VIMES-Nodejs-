/**
 * CHỌN LÔ KHI XUẤT (FIFO/FEFO)
 * ----------------------------
 * Chọn batch để trừ tồn khi xuất — ưu tiên hết hạn sớm hoặc nhập trước.
 */
import { Prisma } from '../../infra/prisma-types';
import { d, toDecimalString } from '../../utils/decimal';
import type { LotCandidate } from './lot-allocation';

export async function lockStockBalances(
  trx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  productIds: string[],
) {
  if (productIds.length === 0) return;
  const sorted = [...new Set(productIds)].sort();
  await trx.$queryRaw`
    SELECT id FROM stock_balances
    WHERE tenant_id = ${tenantId}
      AND warehouse_id = ${warehouseId}
      AND product_id IN (${Prisma.join(sorted)})
    ORDER BY product_id, coalesce(batch_id, ''), coalesce(location_id, '')
    FOR UPDATE
  `;
}

export async function loadPickableLots(
  trx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    warehouseId: string;
    productIds: string[];
    excludeRef?: { docType: string; docId: string };
  },
): Promise<Map<string, LotCandidate[]>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const productIds = [...new Set(input.productIds)];
  if (productIds.length === 0) return new Map();

  await trx.stockReservation.updateMany({
    where: {
      tenantId: input.tenantId,
      warehouseId: input.warehouseId,
      productId: { in: productIds },
      status: 'active',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'expired' },
  });

  await lockStockBalances(trx, input.tenantId, input.warehouseId, productIds);

  const [balances, reservations] = await Promise.all([
    trx.stockBalance.findMany({
      where: {
        tenantId: input.tenantId,
        warehouseId: input.warehouseId,
        productId: { in: productIds },
      },
    }),
    trx.stockReservation.findMany({
      where: {
        tenantId: input.tenantId,
        warehouseId: input.warehouseId,
        productId: { in: productIds },
        status: 'active',
      },
    }),
  ]);

  const reservedByLot = new Map<string, ReturnType<typeof d>>();
  for (const row of reservations) {
    if (
      input.excludeRef &&
      row.refDocType === input.excludeRef.docType &&
      row.refDocId === input.excludeRef.docId
    ) {
      continue;
    }
    const key = `${row.productId}:${row.batchId ?? ''}`;
    reservedByLot.set(key, (reservedByLot.get(key) ?? d(0)).plus(row.qtyBaseUnit.toString()));
  }

  const batchIds = [...new Set(balances.map((b) => b.batchId).filter((id): id is string => Boolean(id)))];
  const batches = batchIds.length ? await trx.batch.findMany({ where: { id: { in: batchIds } } }) : [];
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  const lotsByProduct = new Map<string, LotCandidate[]>();
  for (const balance of balances) {
    const batch = balance.batchId ? batchMap.get(balance.batchId) : undefined;
    const expiryDate = batch?.expiryDate ?? null;
    const reserved = reservedByLot.get(`${balance.productId}:${balance.batchId ?? ''}`) ?? d(0);
    const available = d(balance.onhandQty.toString()).minus(reserved);
    const lots = lotsByProduct.get(balance.productId) ?? [];
    lots.push({
      batchId: balance.batchId,
      onhandQty: toDecimalString(available.gt(0) ? available : d(0), 4),
      expiryDate,
      createdAt: batch?.createdAt ?? balance.updatedAt,
      expired: expiryDate ? expiryDate < today : false,
      unitCost: batch?.unitCost != null ? batch.unitCost.toString() : undefined,
    });
    lotsByProduct.set(balance.productId, lots);
  }
  return lotsByProduct;
}
