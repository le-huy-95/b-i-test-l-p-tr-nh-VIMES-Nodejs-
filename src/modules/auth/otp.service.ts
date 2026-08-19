import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import { randomOtp, sha256 } from '../../utils/crypto';
import { resendOtpSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema } from '../../dto/auth.dto';
import { authMailer } from '../../infra/email-auth-mailer';
import type { AuthMailer } from './auth-mailer.port';
import type { OtpIssuer } from './otp.port';
import { hashPassword } from '../../utils/crypto';

const PASSWORD_RESET_PURPOSE = 'reset_password';
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi đến hộp thư của bạn.';

export class OtpService implements OtpIssuer {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly mailer: AuthMailer = authMailer,
  ) {}

  async issueOtp(
    userId: string,
    channel: 'email' | 'phone',
    purpose: string,
    destination: string,
    userName?: string,
  ) {
    const code = randomOtp(6);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60_000);
    await this.db.otpCode.create({
      data: {
        userId,
        channel,
        purpose,
        codeHash: sha256(code),
        expiresAt,
      },
    });

    if (env.NODE_ENV === 'development') {
      console.log(`[OTP][${channel}] ${destination}: ${code}`);
    }

    if (channel === 'email') {
      await this.mailer.sendOtp({
        to: destination,
        userName,
        otpCode: code,
        expiryMinutes: env.OTP_EXPIRES_MINUTES,
        userId,
      });
    }

    return { expiresAt };
  }

  async verifyOtp(input: unknown) {
    const data = verifyOtpSchema.parse(input);

    const user = data.email
      ? await this.db.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' } },
        })
      : await this.db.user.findUnique({ where: { phone: data.phone } });
    if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');

    const purpose = data.email ? 'verify_email' : 'verify_phone';
    const otp = await this.db.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.codeHash !== sha256(data.code)) {
      throw new AppError('INVALID_OTP', 400, 'Invalid or expired OTP');
    }

    await this.db.$transaction([
      this.db.otpCode.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      }),
      this.db.user.update({
        where: { id: user.id },
        data: data.email
          ? { emailVerifiedAt: new Date() }
          : { phoneVerifiedAt: new Date() },
      }),
    ]);

    return { verified: true };
  }

  async resendOtp(input: unknown) {
    const data = resendOtpSchema.parse(input);
    const user = data.email
      ? await this.db.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' } },
        })
      : await this.db.user.findUnique({ where: { phone: data.phone } });
    if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');

    if (data.email) {
      return this.issueOtp(user.id, 'email', 'verify_email', data.email, user.name ?? undefined);
    }
    return this.issueOtp(user.id, 'phone', 'verify_phone', data.phone!, user.name ?? undefined);
  }

  async requestPasswordReset(input: unknown) {
    const { email } = forgotPasswordSchema.parse(input);
    const user = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (!user?.email || !user.isActive) {
      return { message: GENERIC_FORGOT_PASSWORD_MESSAGE };
    }

    const code = randomOtp(6);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60_000);
    await this.db.otpCode.create({
      data: {
        userId: user.id,
        channel: 'email',
        purpose: PASSWORD_RESET_PURPOSE,
        codeHash: sha256(code),
        expiresAt,
      },
    });

    if (env.NODE_ENV === 'development') {
      console.log(`[OTP][password-reset] ${email}: ${code}`);
    }

    await this.mailer.sendPasswordResetOtp({
      to: email,
      userName: user.name ?? undefined,
      otpCode: code,
      expiryMinutes: env.OTP_EXPIRES_MINUTES,
      userId: user.id,
    }).then((result) => {
      if (!result.success) {
        console.error(`[OTP][password-reset] Email send failed for ${email}: ${result.error ?? 'unknown error'}`);
      }
    });

    return { message: GENERIC_FORGOT_PASSWORD_MESSAGE, expiresAt };
  }

  async resetPasswordWithOtp(input: unknown) {
    const data = resetPasswordSchema.parse(input);
    const user = await this.db.user.findFirst({
      where: { email: { equals: data.email, mode: 'insensitive' } },
    });
    if (!user) throw new AppError('INVALID_OTP', 400, 'Invalid or expired OTP');
    if (!user.isActive) throw new AppError('USER_INACTIVE', 403, 'User inactive');

    const otp = await this.db.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose: PASSWORD_RESET_PURPOSE,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.codeHash !== sha256(data.code)) {
      throw new AppError('INVALID_OTP', 400, 'Invalid or expired OTP');
    }

    const passwordHash = await hashPassword(data.newPassword);
    await this.db.$transaction([
      this.db.otpCode.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      }),
      this.db.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      }),
      this.db.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true as const };
  }
}

export const otpService = new OtpService(prisma, authMailer);
