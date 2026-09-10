import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  otpCode: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  userTenant: {
    findMany: vi.fn(),
  },
  refreshToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  userDevice: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

const mockSendOtpEmail = vi.fn();
const mockVerifyGoogleIdToken = vi.fn();
const mockPublishTenantNotification = vi.fn().mockResolvedValue(undefined);
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/redis-list-cache', () => ({
  listCache: {
    get: mockCacheGet,
    set: mockCacheSet,
    invalidate: mockCacheInvalidate,
    invalidatePattern: vi.fn(),
    getOrSet: async (key: string, loader: () => Promise<unknown>) => {
      const cached = await mockCacheGet(key);
      if (cached != null) return cached;
      const value = await loader();
      await mockCacheSet(key, value);
      return value;
    },
  },
}));

vi.mock('../../src/services/email', () => ({
  sendOtpEmail: mockSendOtpEmail,
}));

vi.mock('../../src/infra/firebase-google-auth', () => ({
  googleAuth: {
    isConfigured: vi.fn(() => true),
    verifyIdToken: mockVerifyGoogleIdToken,
  },
}));

vi.mock('../../src/shared/notifications/publish', () => ({
  publishTenantNotification: mockPublishTenantNotification,
  actorLabel: (user: { name?: string | null; email?: string | null }) =>
    user.name ?? user.email ?? 'User',
}));

vi.mock('../../src/utils/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
  randomOtp: vi.fn().mockReturnValue('123456'),
  randomToken: vi.fn().mockReturnValue('token-1'),
  sha256: vi.fn((value: string) => `hash:${value}`),
  signAccessToken: vi.fn(() => 'access-token'),
  signRefreshToken: vi.fn(() => 'refresh-token'),
  verifyAccessToken: vi.fn(),
  verifyRefreshToken: vi.fn(() => ({ userId: 'user-1', jti: 'jti-1' })),
}));

describe('auth service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
    vi.stubEnv('OTP_EXPIRES_MINUTES', '15');
    vi.stubEnv('INVITE_EXPIRES_HOURS', '72');
    vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
    vi.stubEnv('DEFAULT_FROM_ADDRESS', 'info@example.com');
    vi.stubEnv('DEFAULT_FROM_NAME', 'Vimes');
    mockSendOtpEmail.mockReset();
    mockVerifyGoogleIdToken.mockReset();
    mockPublishTenantNotification.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
    mockCacheInvalidate.mockReset();
    mockCacheGet.mockResolvedValue(null);
    for (const model of Object.values(mockPrisma)) {
      for (const fn of Object.values(model as Record<string, unknown>)) {
        if (vi.isMockFunction(fn)) fn.mockReset();
      }
    }
  });

  it('registers a user, stores OTP and sends verification email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
    });
    mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });
    mockSendOtpEmail.mockResolvedValue({ success: true });

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.register({
      email: 'user@example.com',
      password: 'secret123',
      name: 'User One',
    });

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      requiresVerification: true,
    });
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.otpCode.create).toHaveBeenCalledTimes(1);
    expect(mockSendOtpEmail).toHaveBeenCalledTimes(1);
    expect(mockSendOtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', userId: 'user-1' }),
    );
  });

  it('logs in and publishes tenant login notifications', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
      name: 'User One',
      passwordHash: 'hashed-password',
      isActive: true,
      tokenVersion: 2,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.userTenant.findMany.mockResolvedValue([
      {
        tenantId: 'tenant-1',
        role: 'admin',
        tenant: { id: 'tenant-1', code: 'T1', name: 'Tenant 1', status: 'active' },
      },
    ]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.login({ email: 'User@Example.com', password: 'secret123' });

    expect(result.accessToken).toBe('access-token');
    expect(mockPublishTenantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_LOGIN',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        recipientPolicy: { type: 'tenant_roles', roles: ['admin'] },
      }),
    );
  });

  it('logs in and issues tokens with tenant list', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
      name: 'User One',
      passwordHash: 'hashed-password',
      isActive: true,
      tokenVersion: 2,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.userTenant.findMany.mockResolvedValue([
      {
        role: 'admin',
        tenant: {
          id: 'tenant-1',
          code: 'T1',
          name: 'Tenant 1',
          logoUrl: null,
          status: 'active',
        },
      },
    ]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.login({ email: 'User@Example.com', password: 'secret123' });

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'user@example.com', mode: 'insensitive' } },
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.tenants).toEqual([
      expect.objectContaining({ id: 'tenant-1', role: 'admin', status: 'active' }),
    ]);
    expect(mockCacheSet).toHaveBeenCalledWith(
      'list:user-tenants:user-1',
      expect.any(Array),
    );
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('returns profile with tenants from DB on /me cache miss', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
      name: 'User One',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.userTenant.findMany.mockResolvedValue([
      {
        role: 'viewer',
        tenant: {
          id: 'tenant-2',
          code: 'T2',
          name: 'Tenant 2',
          logoUrl: 'http://logo',
          status: 'active',
        },
      },
    ]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.me('user-1');

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      tenants: [
        {
          id: 'tenant-2',
          code: 'T2',
          name: 'Tenant 2',
          logoUrl: 'http://logo',
          role: 'viewer',
          status: 'active',
        },
      ],
    });
    expect(mockPrisma.userTenant.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isActive: true },
      include: { tenant: true },
    });
    expect(mockCacheSet).toHaveBeenCalledWith(
      'list:user-tenants:user-1',
      expect.any(Array),
    );
  });

  it('serves /me tenants from cache on hit without querying memberships', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
      name: 'User One',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockCacheGet.mockResolvedValue([
      {
        id: 'tenant-cached',
        code: 'C1',
        name: 'Cached Org',
        logoUrl: null,
        role: 'admin',
        status: 'active',
      },
    ]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.me('user-1');

    expect(result.tenants).toEqual([
      expect.objectContaining({ id: 'tenant-cached', name: 'Cached Org' }),
    ]);
    expect(mockPrisma.userTenant.findMany).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('logs in with Google for existing user by googleId', async () => {
    mockVerifyGoogleIdToken.mockResolvedValue({
      uid: 'google-123',
      email: 'user@example.com',
      name: 'Google User',
      email_verified: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: null,
      name: 'Google User',
      googleId: 'google-123',
      isActive: true,
      tokenVersion: 1,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.userTenant.findMany.mockResolvedValue([]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.loginWithGoogle({ idToken: 'valid-token' });

    expect(mockVerifyGoogleIdToken).toHaveBeenCalledWith('valid-token');
    expect(result.accessToken).toBe('access-token');
    expect(result.user.email).toBe('user@example.com');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a new user on Google login when not found', async () => {
    mockVerifyGoogleIdToken.mockResolvedValue({
      uid: 'google-new',
      email: 'new@example.com',
      name: 'New User',
      email_verified: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'new@example.com',
      phone: null,
      name: 'New User',
      googleId: 'google-new',
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.userTenant.findMany.mockResolvedValue([]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.loginWithGoogle({ idToken: 'valid-token' });

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          googleId: 'google-new',
          email: 'new@example.com',
          name: 'New User',
        }),
      }),
    );
    expect(result.user.id).toBe('user-new');
  });

  it('links Google account to existing email user', async () => {
    mockVerifyGoogleIdToken.mockResolvedValue({
      uid: 'google-link',
      email: 'existing@example.com',
      name: 'Linked User',
      email_verified: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-existing',
      email: 'existing@example.com',
      phone: null,
      name: null,
      googleId: null,
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: new Date('2026-01-01'),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'user-existing',
      email: 'existing@example.com',
      phone: null,
      name: 'Linked User',
      googleId: 'google-link',
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: new Date('2026-01-01'),
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.userTenant.findMany.mockResolvedValue([]);

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.loginWithGoogle({ idToken: 'valid-token' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-existing' },
        data: expect.objectContaining({ googleId: 'google-link' }),
      }),
    );
    expect((result.user as Record<string, unknown>).googleId).toBeUndefined();
    expect(result.user.email).toBe('existing@example.com');
  });

  it('rejects Google login when Google email is not verified', async () => {
    mockVerifyGoogleIdToken.mockResolvedValue({
      uid: 'google-unverified',
      email: 'unverified@example.com',
      name: 'Unverified',
      email_verified: false,
    });

    const { authService } = await import('../../src/modules/auth/auth.service');
    await expect(
      authService.loginWithGoogle({ idToken: 'valid-token' }),
    ).rejects.toMatchObject({
      code: 'GOOGLE_EMAIL_NOT_VERIFIED',
      statusCode: 403,
    });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects linking Google to an unverified local email account', async () => {
    mockVerifyGoogleIdToken.mockResolvedValue({
      uid: 'google-link-unverified-local',
      email: 'pending@example.com',
      name: 'Pending User',
      email_verified: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-pending',
      email: 'pending@example.com',
      phone: null,
      name: null,
      googleId: null,
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      isPlatformAdmin: false,
    });

    const { authService } = await import('../../src/modules/auth/auth.service');
    await expect(
      authService.loginWithGoogle({ idToken: 'valid-token' }),
    ).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      statusCode: 403,
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('registers a device for authenticated user', async () => {
    const now = new Date();
    mockPrisma.userDevice.findUnique.mockResolvedValue(null);
    mockPrisma.userDevice.create.mockResolvedValue({
      id: 'device-1',
      deviceId: 'device-abc',
      deviceType: 'web',
      deviceModel: 'Chrome',
      osVersion: 'macOS',
      appVersion: '1.0.0',
      status: 'active',
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.registerDevice('user-1', {
      deviceId: 'device-abc',
      deviceType: 'web',
      deviceModel: 'Chrome',
    });

    expect(result.isUpdate).toBe(false);
    expect(result.device).toMatchObject({
      id: 'device-1',
      deviceId: 'device-abc',
      deviceType: 'web',
      status: 'active',
    });
    expect(mockPrisma.userDevice.create).toHaveBeenCalledTimes(1);
  });

  it('updates an existing device on register-device', async () => {
    const now = new Date();
    mockPrisma.userDevice.findUnique.mockResolvedValue({
      id: 'device-1',
      deviceId: 'device-abc',
      userId: 'user-1',
    });
    mockPrisma.userDevice.update.mockResolvedValue({
      id: 'device-1',
      deviceId: 'device-abc',
      deviceType: 'ios',
      deviceModel: 'iPhone 15',
      osVersion: '17.0',
      appVersion: '2.0.0',
      status: 'active',
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const { authService } = await import('../../src/modules/auth/auth.service');
    const result = await authService.registerDevice('user-1', {
      deviceId: 'device-abc',
      deviceType: 'ios',
      deviceModel: 'iPhone 15',
    });

    expect(result.isUpdate).toBe(true);
    expect(mockPrisma.userDevice.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userDevice.create).not.toHaveBeenCalled();
  });
});
