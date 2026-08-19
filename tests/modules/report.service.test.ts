import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockPrisma = {
  product: { findMany: vi.fn() },
  stockBalance: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  stockReservation: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

describe('report service low stock', () => {
  beforeEach(() => {
    mockPrisma.product.findMany.mockReset();
    mockPrisma.stockBalance.findMany.mockReset();
    mockPrisma.stockBalance.groupBy.mockReset();
    mockPrisma.stockReservation.findMany.mockReset();
    mockPrisma.stockReservation.groupBy.mockReset();
  });

  it('compares min stock against available qty, not raw onhand', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        sku: 'SKU-1',
        name: 'Widget',
        baseUnitName: 'cái',
        minStockLevel: '10.0000',
      },
    ]);
    mockPrisma.stockBalance.groupBy.mockResolvedValue([
      { productId: 'product-1', _sum: { onhandQty: '12.0000' } },
    ]);
    mockPrisma.stockReservation.groupBy.mockResolvedValue([
      { productId: 'product-1', _sum: { qtyBaseUnit: '5.0000' } },
    ]);

    const { reportService } = await import('../../src/modules/report/report.service');
    const data = await reportService.lowStock('tenant-1', {});

    expect(data).toEqual([
      expect.objectContaining({
        productId: 'product-1',
        onhandQty: '12.0000',
        availableQty: '7.0000',
        shortageQty: '3.0000',
      }),
    ]);
  });
});
