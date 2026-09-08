/**
 * PHÂN BỔ LÔ KHI NHẬP
 * -------------------
 * Gán số lượng nhập vào batch mới hoặc batch hiện có theo chính sách costing.
 */
import { AppError } from '../../utils/app-error';
import { d, toDecimalString } from '../../utils/decimal';

export type PickingPriorityValue = 'fefo' | 'fifo' | 'none';

export interface LotCandidate {
  batchId: string | null;
  onhandQty: string;
  expiryDate: Date | null;
  createdAt: Date;
  expired?: boolean;
  unitCost?: string;
}

export interface LotAllocation {
  batchId: string | null;
  qtyBaseUnit: string;
  unitCost?: string;
}

export function sortLots(lots: LotCandidate[], _priority: PickingPriorityValue): LotCandidate[] {
  return [...lots].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function allocateLots(
  requestedQty: string,
  lots: LotCandidate[],
  priority: PickingPriorityValue,
  options: { blockExpired?: boolean } = {},
): LotAllocation[] {
  const eligible = options.blockExpired ? lots.filter((lot) => !lot.expired) : lots;
  const sorted = sortLots(eligible, priority);
  let remaining = d(requestedQty);
  const out: LotAllocation[] = [];

  for (const lot of sorted) {
    if (remaining.lte(0)) break;
    const onhand = d(lot.onhandQty);
    if (onhand.lte(0)) continue;
    const take = remaining.lt(onhand) ? remaining : onhand;
    out.push({
      batchId: lot.batchId,
      qtyBaseUnit: toDecimalString(take, 4),
      ...(lot.unitCost != null ? { unitCost: lot.unitCost } : {}),
    });
    remaining = remaining.minus(take);
  }

  if (remaining.gt(0)) {
    throw new AppError('STOCK_INSUFFICIENT', 409, 'Không đủ tồn kho theo lô', [
      { requested: toDecimalString(requestedQty, 4), remaining: toDecimalString(remaining, 4) },
    ]);
  }
  return out;
}

export function consumeLots(
  requestedQty: string,
  lots: LotCandidate[],
  priority: PickingPriorityValue,
  options: { blockExpired?: boolean } = {},
): LotAllocation[] {
  const allocated = allocateLots(requestedQty, lots, priority, options);
  for (const part of allocated) {
    const lot = lots.find((item) => item.batchId === part.batchId);
    if (!lot) continue;
    lot.onhandQty = toDecimalString(d(lot.onhandQty).minus(part.qtyBaseUnit), 4);
  }
  return allocated;
}
