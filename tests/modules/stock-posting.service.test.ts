import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApplyIncrease = vi.fn();
const mockApplyDecrease = vi.fn();
const mockRecord = vi.fn();

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'a');
vi.stubEnv('JWT_REFRESH_SECRET', 'b');

vi.mock('../../src/modules/stock-balance/stock-balance.service', () => ({
  stockBalanceService: {
    applyIncrease: mockApplyIncrease,
    applyDecrease: mockApplyDecrease,
  },
}));

vi.mock('../../src/modules/stock-balance/stock-ledger.service', () => ({
  stockLedgerService: { record: mockRecord },
}));

vi.mock('../../src/modules/stock-balance/costing/costing-policy', () => ({
  resolveCostingPolicy: vi.fn(() => ({ onStockIncrease: vi.fn() })),
}));

describe('stock posting service', () => {
  beforeEach(() => {
    mockApplyIncrease.mockReset().mockResolvedValue([
      { key: { tenantId: 't1', productId: 'p1', warehouseId: 'w1' }, balanceAfter: '10' },
    ]);
    mockApplyDecrease.mockReset().mockResolvedValue([
      { key: { tenantId: 't1', productId: 'p1', warehouseId: 'w1' }, balanceAfter: '4' },
    ]);
    mockRecord.mockReset();
  });

  const change = {
    tenantId: 't1',
    productId: 'p1',
    warehouseId: 'w1',
    qtyBaseUnit: '6',
    unitCost: '12',
  };

  it('direction in increases, records ledger in, applies costing', async () => {
    const trx = {
    } as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'in',
        changes: [change],
        ledger: { refDocType: 'stock_receipt', refDocId: 'r1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyIncrease).toHaveBeenCalledWith([change], trx);
    expect(mockRecord).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          transactionType: 'in',
          qtyChange: '6',
          qtyBalanceAfter: '10',
          unitCost: '12',
          refDocType: 'stock_receipt',
          refDocId: 'r1',
          createdById: 'u1',
        }),
      ],
      trx,
    );
  });

  it('direction out decreases and does not call costing', async () => {
    const trx = {} as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'out',
        changes: [change],
        ledger: { refDocType: 'stock_issue', refDocId: 'i1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyDecrease).toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      [expect.objectContaining({ transactionType: 'out', qtyChange: '-6' })],
      trx,
    );
  });

  it('direction opening increases, ledger opening, always sets averageCost', async () => {
    const trx = {
      product: { update: vi.fn().mockResolvedValue({}) },
    } as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'opening',
        changes: [change],
        ledger: { refDocType: 'stock_opening_balance', refDocId: 'o1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyIncrease).toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      [expect.objectContaining({ transactionType: 'opening' })],
      trx,
    );
    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '12' },
    });
  });

  it('zips ledger qtyChange/unitCost by sorted key order for multi-line posts', async () => {
    const p2 = {
      tenantId: 't1',
      productId: 'p2',
      warehouseId: 'w1',
      qtyBaseUnit: '3',
      unitCost: '30',
    };
    const p1 = {
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '10',
    };
    mockApplyIncrease.mockResolvedValue([
      { key: { tenantId: 't1', productId: 'p1', warehouseId: 'w1' }, balanceAfter: '5' },
      { key: { tenantId: 't1', productId: 'p2', warehouseId: 'w1' }, balanceAfter: '3' },
    ]);
    const trx = {
    } as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'in',
        changes: [p2, p1],
        ledger: { refDocType: 'stock_receipt', refDocId: 'r2', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyIncrease).toHaveBeenCalledWith([p1, p2], trx);
    expect(mockRecord).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          productId: 'p1',
          qtyChange: '5',
          unitCost: '10',
          qtyBalanceAfter: '5',
        }),
        expect.objectContaining({
          productId: 'p2',
          qtyChange: '3',
          unitCost: '30',
          qtyBalanceAfter: '3',
        }),
      ],
      trx,
    );
  });
});
