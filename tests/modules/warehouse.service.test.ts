import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockInvalidateMasterData = vi.fn().mockResolvedValue(undefined);

const mockPrisma = {
  warehouse: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockCache = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  invalidatePattern: vi.fn(),
  invalidate: vi.fn(),
  getOrSet: vi.fn(async (key: string, loader: () => Promise<unknown>, ttl?: number) => {
    const cached = await mockCache.get(key);
    if (cached != null) return cached;
    const value = await loader();
    await mockCache.set(key, value, ttl);
    return value;
  }),
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/redis-list-cache', () => ({
  listCache: mockCache,
}));

vi.mock('../../src/infra/cache-invalidation', () => ({
  cacheInvalidationService: { invalidateMasterData: mockInvalidateMasterData },
}));

describe('warehouse service phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateMasterData.mockResolvedValue(undefined);
  });

  it('creates a warehouse with phone', async () => {
    mockPrisma.warehouse.create.mockResolvedValue({ id: 'wh-1', phone: '0901234567' });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.create('tenant-1', {
      code: 'WH01',
      name: 'Kho chính',
      phone: '0901234567',
    });

    expect(mockPrisma.warehouse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          code: 'WH01',
          name: 'Kho chính',
          phone: '0901234567',
        }),
      }),
    );
  });

  it('creates a warehouse without phone', async () => {
    mockPrisma.warehouse.create.mockResolvedValue({ id: 'wh-1', phone: null });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.create('tenant-1', { code: 'WH01', name: 'Kho chính' });

    const payload = mockPrisma.warehouse.create.mock.calls[0][0].data;
    expect(payload.phone).toBeUndefined();
  });

  it('clears phone when update sends null', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1', phone: null });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.update('tenant-1', 'wh-1', { phone: null });

    expect(mockPrisma.warehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: null }),
      }),
    );
  });

  it('omits phone from update when the field is not sent', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1' });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.update('tenant-1', 'wh-1', { name: 'Kho mới' });

    const payload = mockPrisma.warehouse.update.mock.calls[0][0].data;
    expect(payload.phone).toBeUndefined();
    expect(payload.name).toBe('Kho mới');
  });

  it('deactivates warehouse with soft-delete', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1', isActive: false });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.softDelete('tenant-1', 'wh-1');

    expect(mockPrisma.warehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wh-1' },
        data: { isActive: false },
      }),
    );
    expect(mockInvalidateMasterData).toHaveBeenCalledWith('tenant-1');
  });

  it('activates warehouse', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1', isActive: true });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.activate('tenant-1', 'wh-1');

    expect(mockPrisma.warehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wh-1' },
        data: { isActive: true },
      }),
    );
    expect(mockInvalidateMasterData).toHaveBeenCalledWith('tenant-1');
  });
});
