import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipientResolver } from '../../../services/notification-ws/src/modules/recipient.resolver';

const mockPrisma = {
  userTenant: { findMany: vi.fn() },
};

describe('recipient.resolver', () => {
  const resolver = new RecipientResolver(mockPrisma as never);

  beforeEach(() => {
    mockPrisma.userTenant.findMany.mockReset();
  });

  it('returns explicit user ids', async () => {
    const ids = await resolver.resolve('t1', { type: 'explicit_users', userIds: ['u1', 'u2', 'u1'] });
    expect(ids).toEqual(['u1', 'u2']);
  });

  it('returns source creator', async () => {
    const ids = await resolver.resolve('t1', { type: 'source_creator', createdByUserId: 'creator-1' });
    expect(ids).toEqual(['creator-1']);
  });

  it('queries tenant roles', async () => {
    mockPrisma.userTenant.findMany.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);
    const ids = await resolver.resolve('t1', { type: 'tenant_roles', roles: ['admin', 'accountant'] });
    expect(mockPrisma.userTenant.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't1',
        isActive: true,
        role: { in: ['admin', 'accountant'] },
      },
      select: { userId: true },
    });
    expect(ids).toEqual(['a', 'b']);
  });
});
