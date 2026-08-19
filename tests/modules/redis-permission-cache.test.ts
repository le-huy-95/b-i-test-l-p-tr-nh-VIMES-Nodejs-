import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

vi.mock('../../src/infra/redis', () => ({
  getRedis: vi.fn(() => ({ get: mockGet, set: mockSet, del: mockDel })),
}));

describe('RedisPermissionCache', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
  });

  it('get returns parsed payload and set uses TTL 300', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a');
    vi.stubEnv('JWT_REFRESH_SECRET', 'b');
    mockGet.mockResolvedValue(JSON.stringify({ role: 'admin', warehouseIds: 'all' }));
    const { RedisPermissionCache } = await import('../../src/infra/redis-permission-cache');
    const cache = new RedisPermissionCache();
    await expect(cache.get('u1', 't1')).resolves.toMatchObject({ role: 'admin' });
    expect(mockGet).toHaveBeenCalledWith('cache:user-permissions:u1:t1');
    await cache.set('u1', 't1', {
      role: 'admin',
      warehouseIds: 'all',
      emailVerified: true,
      phoneVerified: false,
      tenantStatus: 'active',
    });
    expect(mockSet).toHaveBeenCalledWith(
      'cache:user-permissions:u1:t1',
      expect.any(String),
      'EX',
      300,
    );
  });

  it('swallows redis errors and get returns null', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a');
    vi.stubEnv('JWT_REFRESH_SECRET', 'b');
    mockGet.mockRejectedValue(new Error('down'));
    const { RedisPermissionCache } = await import('../../src/infra/redis-permission-cache');
    const cache = new RedisPermissionCache();
    await expect(cache.get('u1', 't1')).resolves.toBeNull();
    await expect(cache.invalidate('u1', 't1')).resolves.toBeUndefined();
  });
});
