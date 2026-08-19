import { describe, expect, it, vi } from 'vitest';
import { d } from '../../src/utils/decimal';
import { AppError } from '../../src/utils/app-error';
import { AvgCostingPolicy } from '../../src/modules/stock-balance/costing/avg-costing.policy';
import { LotCostingPolicy } from '../../src/modules/stock-balance/costing/lot-costing.policy';
import { resolveCostingPolicy } from '../../src/modules/stock-balance/costing/costing-policy';

function stubEnv() {
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
  vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
  vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
}

describe('costing policies', () => {
  it('AVG uses unitCost when onhand before is zero', async () => {
    stubEnv();
    const trx = {
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', averageCost: '10', costingMethod: 'AVG' }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;

    const balance = {
      getAvailable: vi.fn().mockResolvedValue({ onhandQty: d(5) }),
    };

    await new AvgCostingPolicy(balance as never).onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });

    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '20.0000' },
    });
  });

  it('AVG blends previous average when onhand before > 0', async () => {
    stubEnv();
    const trx = {
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', averageCost: '10', costingMethod: 'AVG' }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;

    const balance = {
      getAvailable: vi.fn().mockResolvedValue({ onhandQty: d(15) }),
    };

    await new AvgCostingPolicy(balance as never).onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });

    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '13.3333' },
    });
  });

  it('lot policy does not update product', async () => {
    const trx = { product: { update: vi.fn() } } as never;
    await new LotCostingPolicy().onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });
    expect(trx.product.update).not.toHaveBeenCalled();
  });

  it('resolveCostingPolicy maps weighted_average / fifo / fefo / specific_identification and rejects unknown', () => {
    expect(resolveCostingPolicy('weighted_average')).toBeInstanceOf(AvgCostingPolicy);
    expect(resolveCostingPolicy('AVG')).toBeInstanceOf(AvgCostingPolicy);
    expect(resolveCostingPolicy('FIFO')).toBeInstanceOf(LotCostingPolicy);
    expect(resolveCostingPolicy('FEFO')).toBeInstanceOf(LotCostingPolicy);
    expect(resolveCostingPolicy('specific_identification')).toBeInstanceOf(LotCostingPolicy);
    expect(() => resolveCostingPolicy('LIFO' as never)).toThrow(AppError);
  });
});
