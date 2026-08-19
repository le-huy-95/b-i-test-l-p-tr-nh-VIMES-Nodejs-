import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockPrisma = {
  product: { findMany: vi.fn() },
  stockBalance: { findMany: vi.fn() },
  stockReservation: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  batch: { findMany: vi.fn() },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

describe('stock alert helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes low stock from available qty', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        sku: 'SKU-1',
        name: 'Widget',
        baseUnitName: 'cái',
        minStockLevel: '10.0000',
      },
    ]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([
      { productId: 'product-1', onhandQty: '12.0000' },
    ]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([
      { productId: 'product-1', qtyBaseUnit: '5.0000' },
    ]);

    const { computeLowStockItems } = await import('../../src/modules/report/stock-alert.helpers');
    const data = await computeLowStockItems(mockPrisma as never, 'tenant-1', {});

    expect(data).toEqual([
      expect.objectContaining({
        productId: 'product-1',
        availableQty: '7.0000',
        shortageQty: '3.0000',
      }),
    ]);
  });

  it('sorts low stock by shortage when requested', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        sku: 'SKU-1',
        name: 'A',
        baseUnitName: 'cái',
        minStockLevel: '10.0000',
      },
      {
        id: 'product-2',
        sku: 'SKU-2',
        name: 'B',
        baseUnitName: 'cái',
        minStockLevel: '20.0000',
      },
    ]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([
      { productId: 'product-1', onhandQty: '5.0000' },
      { productId: 'product-2', onhandQty: '2.0000' },
    ]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([]);

    const { computeLowStockItems } = await import('../../src/modules/report/stock-alert.helpers');
    const data = await computeLowStockItems(mockPrisma as never, 'tenant-1', {
      warehouseId: 'wh-1',
      sortByShortage: true,
    });

    expect(data.map((row) => row.productId)).toEqual(['product-2', 'product-1']);
  });

  it('filters live reservations without writing expired status', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([]);

    const { computeLowStockItems, liveReservationWhere } = await import(
      '../../src/modules/report/stock-alert.helpers'
    );
    await computeLowStockItems(mockPrisma as never, 'tenant-1', { warehouseId: 'wh-1' });

    expect(mockPrisma.stockReservation.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.stockReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          status: 'active',
          warehouseId: 'wh-1',
          expiresAt: { gte: expect.any(Date) },
        }),
      }),
    );
    expect(liveReservationWhere('tenant-1', 'wh-1')).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'active',
        warehouseId: 'wh-1',
        expiresAt: { gte: expect.any(Date) },
      }),
    );
  });
});
