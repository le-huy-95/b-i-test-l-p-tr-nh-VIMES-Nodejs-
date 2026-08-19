import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  otpCode: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
};

const mockSendPasswordResetOtp = vi.fn();

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/email-auth-mailer', () => ({
  authMailer: {
    sendPasswordResetOtp: mockSendPasswordResetOtp,
  },
}));

vi.mock('../../src/utils/crypto', () => ({
  randomOtp: vi.fn().mockReturnValue('654321'),
  sha256: vi.fn((value: string) => `hash:${value}`),
  hashPassword: vi.fn().mockResolvedValue('new-hashed-password'),
}));

describe('password reset', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
    vi.stubEnv('OTP_EXPIRES_MINUTES', '15');
    mockSendPasswordResetOtp.mockReset().mockResolvedValue({ success: true });
    for (const fn of Object.values(mockPrisma.user)) {
      if (vi.isMockFunction(fn)) fn.mockReset();
    }
    for (const fn of Object.values(mockPrisma.otpCode)) {
      if (vi.isMockFunction(fn)) fn.mockReset();
    }
    mockPrisma.refreshToken.updateMany.mockReset();
    mockPrisma.$transaction.mockClear();
  });

  it('sends OTP for an active user without revealing account existence details', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      isActive: true,
    });
    mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });

    const { otpService } = await import('../../src/modules/auth/otp.service');
    const result = await otpService.requestPasswordReset({ email: 'user@example.com' });

    expect(result.message).toContain('OTP');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockPrisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          purpose: 'reset_password',
          codeHash: 'hash:654321',
        }),
      }),
    );
    expect(mockSendPasswordResetOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        otpCode: '654321',
      }),
    );
  });

  it('returns generic message when email is not registered', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const { otpService } = await import('../../src/modules/auth/otp.service');
    const result = await otpService.requestPasswordReset({ email: 'missing@example.com' });

    expect(result.message).toContain('OTP');
    expect(result.expiresAt).toBeUndefined();
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    expect(mockSendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it('resets password when OTP is valid', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: true,
    });
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: 'hash:654321',
    });
    mockPrisma.otpCode.update.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const { otpService } = await import('../../src/modules/auth/otp.service');
    const result = await otpService.resetPasswordWithOtp({
      email: 'user@example.com',
      code: '654321',
      newPassword: 'newpass123',
    });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          passwordHash: 'new-hashed-password',
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('rejects invalid OTP on reset', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      isActive: true,
    });
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: 'hash:654321',
    });

    const { otpService } = await import('../../src/modules/auth/otp.service');

    await expect(
      otpService.resetPasswordWithOtp({
        email: 'user@example.com',
        code: '000000',
        newPassword: 'newpass123',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OTP',
      statusCode: 400,
    });
  });
});
