import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/app-error';
import { allocateLots, consumeLots, type LotCandidate } from '../../src/modules/stock-balance/lot-allocation';

const lots: LotCandidate[] = [
  { batchId: 'late', onhandQty: '4', expiryDate: new Date('2026-12-01'), createdAt: new Date('2026-01-20') },
  { batchId: 'early', onhandQty: '3', expiryDate: new Date('2026-06-01'), createdAt: new Date('2026-01-10') },
  { batchId: 'mid', onhandQty: '5', expiryDate: new Date('2026-09-01'), createdAt: new Date('2026-01-01') },
];

describe('allocateLots', () => {
  it('allocates FEFO by earliest expiry first', () => {
    const result = allocateLots('6', lots, 'fefo');
    expect(result).toEqual([
      { batchId: 'early', qtyBaseUnit: '3.0000' },
      { batchId: 'mid', qtyBaseUnit: '3.0000' },
    ]);
  });

  it('allocates FIFO by createdAt', () => {
    const result = allocateLots('6', lots, 'fifo');
    expect(result).toEqual([
      { batchId: 'mid', qtyBaseUnit: '5.0000' },
      { batchId: 'early', qtyBaseUnit: '1.0000' },
    ]);
  });

  it('skips expired lots when blocking expiry', () => {
    const mixed: LotCandidate[] = [
      { batchId: 'expired', onhandQty: '10', expiryDate: new Date('2020-01-01'), createdAt: new Date('2020-01-01'), expired: true },
      { batchId: 'ok', onhandQty: '4', expiryDate: new Date('2027-01-01'), createdAt: new Date('2026-01-01') },
    ];
    const result = allocateLots('3', mixed, 'fefo', { blockExpired: true });
    expect(result).toEqual([{ batchId: 'ok', qtyBaseUnit: '3.0000' }]);
  });

  it('throws STOCK_INSUFFICIENT when lots cannot cover qty', () => {
    expect(() => allocateLots('20', lots, 'fefo')).toThrow(AppError);
    try {
      allocateLots('20', lots, 'fefo');
    } catch (err) {
      expect(err).toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    }
  });
});

describe('consumeLots', () => {
  it('subtracts allocated qty so the next line takes remaining lots', () => {
    const mutable: LotCandidate[] = lots.map((lot) => ({ ...lot }));
    expect(consumeLots('3', mutable, 'fefo')).toEqual([
      { batchId: 'early', qtyBaseUnit: '3.0000' },
    ]);
    expect(consumeLots('3', mutable, 'fefo')).toEqual([
      { batchId: 'mid', qtyBaseUnit: '3.0000' },
    ]);
  });
});
