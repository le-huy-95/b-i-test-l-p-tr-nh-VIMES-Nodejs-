import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  user: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  tenant: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  invitation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  userTenant: { upsert: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  userWarehouse: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

const mockSendInviteEmail = vi.fn();
const mockPublishTenantNotification = vi.fn().mockResolvedValue(undefined);
const mockInvalidate = vi.fn();
const mockInvalidatePattern = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    uploadObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    objectKeyFromUrl: vi.fn(),
  },
}));

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/email-invite-mailer', () => ({
  inviteMailer: { sendInvite: mockSendInviteEmail },
}));

vi.mock('../../src/infra/redis-permission-cache', () => ({
  permissionCache: { get: vi.fn(), set: vi.fn(), invalidate: mockInvalidate },
}));

vi.mock('../../src/infra/redis-list-cache', () => ({
  listCache: {
    get: mockCacheGet,
    set: mockCacheSet,
    invalidate: mockInvalidate,
    invalidatePattern: mockInvalidatePattern,
    refreshPattern: vi.fn(),
  },
}));

vi.mock('../../src/infra/minio-storage', () => ({
  objectStorage: mockStorage,
  logoExtensionForMime: (mime: string) =>
    ({ 'image/png': '.png', 'image/jpeg': '.jpg' })[mime] ?? null,
  tenantLogoObjectKey: (tenantId: string, ext: string) => `tenants/${tenantId}/logo${ext}`,
}));

vi.mock('../../src/shared/notifications/publish', () => ({
  publishTenantNotification: mockPublishTenantNotification,
  actorLabel: (user: { name?: string | null; email?: string | null }) =>
    user.name ?? user.email ?? 'User',
}));

vi.mock('../../src/utils/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  randomToken: vi.fn().mockReturnValue('invite-token'),
  sha256: vi.fn((value: string) => `hash:${value}`),
}));

describe('tenant service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
    vi.stubEnv('INVITE_EXPIRES_HOURS', '72');
    vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
    mockSendInviteEmail.mockReset();
    mockPublishTenantNotification.mockReset();
    mockInvalidate.mockReset();
    mockInvalidatePattern.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
    mockStorage.uploadObject.mockReset();
    mockStorage.deleteObject.mockReset();
    mockStorage.objectKeyFromUrl.mockReset();
    mockStorage.deleteObject.mockResolvedValue(undefined);
    for (const model of Object.values(mockPrisma)) {
      for (const fn of Object.values(model as Record<string, unknown>)) {
        if (vi.isMockFunction(fn)) fn.mockReset();
      }
    }
    mockPrisma.invitation.findMany.mockResolvedValue([]);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.userTenant.findMany.mockResolvedValue([]);
    mockPrisma.userTenant.count.mockResolvedValue(0);
  });

  it('creates a tenant for a verified user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
    });
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-1', code: 'T1', name: 'Tenant 1' });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.createTenant('user-1', {
      code: 't1',
      name: 'Tenant 1',
    });

    expect(result).toMatchObject({ id: 'tenant-1', code: 'T1', name: 'Tenant 1' });
  });

  it('invites a user and sends invite email', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Tenant 1' });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Inviter',
      email: 'inviter@example.com',
    });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.invitation.create.mockResolvedValue({ id: 'invite-1' });
    mockSendInviteEmail.mockResolvedValue({ success: true });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.invite('tenant-1', 'user-1', {
      email: 'invitee@example.com',
      role: 'staff',
    });

    expect(result).toMatchObject({ id: 'invite-1', email: 'invitee@example.com' });
    expect(mockSendInviteEmail).toHaveBeenCalledTimes(1);
    expect(mockInvalidatePattern).toHaveBeenCalled();
  });

  it('declines an invitation and notifies the inviter', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        name: 'Invitee',
        email: 'invitee@example.com',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'user-2',
      })
      .mockResolvedValueOnce({
        id: 'user-3',
        name: 'Tenant Owner',
        email: 'owner@example.com',
      });
    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      tenantId: 'tenant-1',
      email: 'invitee@example.com',
      role: 'staff',
      invitedById: 'user-2',
      expiresAt: new Date('2026-08-20T10:00:00.000Z'),
      acceptedAt: null,
      declinedAt: null,
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Tenant 1' });
    mockPrisma.invitation.update.mockResolvedValue({ id: 'invite-1' });
    mockSendInviteEmail.mockResolvedValue({ success: true });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.declineInvite('user-1', {
      invitationId: 'invite-1',
    });

    expect(result).toEqual({ tenantId: 'tenant-1', invitationId: 'invite-1' });
    expect(mockPrisma.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invite-1' },
        data: expect.objectContaining({ declinedAt: expect.any(Date) }),
      }),
    );
    expect(mockPublishTenantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'INVITATION_DECLINED',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        recipientPolicy: { type: 'explicit_users', userIds: ['user-3'] },
        notification: expect.objectContaining({
          title: 'Lời mời bị từ chối',
        }),
      }),
    );
  });

  it('creates an internal user and publishes a USER_CREATED notification', async () => {
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'staff@example.com',
      phone: null,
      name: 'Staff User',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Admin A',
      email: 'admin@example.com',
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Tenant 1',
    });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.createInternalUser('tenant-1', 'user-1', {
      email: 'staff@example.com',
      password: 'password123',
      name: 'Staff User',
      role: 'warehouse_keeper',
    });

    expect(result).toMatchObject({
      id: 'user-2',
      email: 'staff@example.com',
      role: 'warehouse_keeper',
    });
    expect(mockPublishTenantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_CREATED',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        recipientPolicy: { type: 'tenant_roles', roles: ['admin'] },
        notification: expect.objectContaining({
          title: 'Tài khoản mới được tạo',
        }),
      }),
    );
    expect(mockInvalidatePattern).toHaveBeenCalled();
  });

  it('lists tenant members without pagination', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.userTenant.findMany.mockResolvedValue([
      {
        id: 'membership-1',
        role: 'admin',
        isActive: true,
        createdAt: new Date('2026-08-19T10:00:00.000Z'),
        user: {
          id: 'user-1',
          name: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901',
        },
      },
    ]);

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.listMembers('tenant-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'membership-1',
      userId: 'user-1',
      role: 'admin',
      isActive: true,
    });
    expect(mockCacheSet).toHaveBeenCalled();
  });

  it('lists tenant members with search and pagination', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.userTenant.findMany.mockResolvedValue([
      {
        id: 'membership-1',
        role: 'staff',
        isActive: true,
        createdAt: new Date('2026-08-19T10:00:00.000Z'),
        user: {
          id: 'user-1',
          name: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901',
        },
      },
    ]);
    mockPrisma.userTenant.count.mockResolvedValue(1);

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.listMembers('tenant-1', {
      page: '1',
      limit: '20',
      search: 'nguyen',
    });

    expect(result).toMatchObject({
      data: [
        expect.objectContaining({
          userId: 'user-1',
        }),
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('lists pending invitations with search', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'me@example.com',
      phone: '0901234567',
    });
    mockPrisma.invitation.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        email: 'invitee@example.com',
        role: 'staff',
        expiresAt: new Date('2026-08-20T10:00:00.000Z'),
        createdAt: new Date('2026-08-19T10:00:00.000Z'),
        tenant: { id: 'tenant-1', name: 'Tenant 1' },
        invitedBy: { id: 'user-1', name: 'Admin A', email: 'admin@example.com' },
      },
      {
        id: 'inv-2',
        email: 'me@example.com',
        role: 'staff',
        expiresAt: new Date('2026-08-21T10:00:00.000Z'),
        createdAt: new Date('2026-08-18T10:00:00.000Z'),
        tenant: { id: 'tenant-2', name: 'Tenant 2' },
        invitedBy: { id: 'user-2', name: 'Other Admin', email: 'other@example.com' },
      },
    ]);
    mockPrisma.invitation.count.mockResolvedValue(2);

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.listInvitations('tenant-1', 'user-1', {
      page: '1',
      limit: '20',
      search: 'invitee',
    });

    expect(result).toMatchObject({
      data: [
        {
          id: 'inv-1',
          email: 'invitee@example.com',
          status: 'pending',
          direction: 'outgoing',
          tenantId: 'tenant-1',
          tenantName: 'Tenant 1',
        },
        {
          id: 'inv-2',
          email: 'me@example.com',
          status: 'pending',
          direction: 'incoming',
          tenantId: 'tenant-2',
          tenantName: 'Tenant 2',
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      },
    });
  });

  it('uploads a tenant logo and replaces the previous file', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      logoUrl: 'http://localhost:9000/inventory/tenants/tenant-1/logo.jpg',
    });
    mockStorage.uploadObject.mockResolvedValue(
      'http://localhost:9000/inventory/tenants/tenant-1/logo.png',
    );
    mockStorage.objectKeyFromUrl.mockReturnValue('tenants/tenant-1/logo.jpg');
    mockPrisma.tenant.update.mockResolvedValue({
      id: 'tenant-1',
      logoUrl: 'http://localhost:9000/inventory/tenants/tenant-1/logo.png',
    });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.uploadLogo('tenant-1', {
      buffer: Buffer.from('png'),
      mimetype: 'image/png',
      size: 3,
    });

    expect(mockStorage.uploadObject).toHaveBeenCalledWith(
      'tenants/tenant-1/logo.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(mockStorage.deleteObject).toHaveBeenCalledWith('tenants/tenant-1/logo.jpg');
    expect(result.logoUrl).toContain('/tenants/tenant-1/logo.png');
  });

  it('deletes a tenant logo', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      logoUrl: 'http://localhost:9000/inventory/tenants/tenant-1/logo.png',
    });
    mockStorage.objectKeyFromUrl.mockReturnValue('tenants/tenant-1/logo.png');
    mockPrisma.tenant.update.mockResolvedValue({ id: 'tenant-1', logoUrl: null });

    const { tenantService } = await import('../../src/modules/tenant/tenant.service');
    const result = await tenantService.deleteLogo('tenant-1');

    expect(mockStorage.deleteObject).toHaveBeenCalledWith('tenants/tenant-1/logo.png');
    expect(result.logoUrl).toBeNull();
  });
});