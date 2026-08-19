import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import { hashPassword, randomToken, verifyPassword } from '../../utils/crypto';
import { normalizeEmail } from '../../utils/auth-normalize';
import { googleLoginSchema, loginSchema, registerSchema } from '../../dto/auth.dto';
import { otpService } from './otp.service';
import { tokenService } from './token.service';
import { deviceService } from './device.service';
import type { OtpIssuer } from './otp.port';
import type { TokenIssuer } from './token.port';
import type { DeviceRegistry } from './device.port';
import type { GoogleTokenVerifier } from './google-auth.port';
import { googleAuth } from '../../infra/firebase-google-auth';
import { NOTIFICATION_EVENT_TYPES } from '../../shared/notifications/event-types';
import { actorLabel, publishTenantNotification } from '../../shared/notifications/publish';

export class AuthService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly otp: OtpIssuer = otpService,
    private readonly tokens: TokenIssuer = tokenService,
    private readonly devices: DeviceRegistry = deviceService,
    private readonly google: GoogleTokenVerifier = googleAuth,
  ) {}

  async register(input: unknown) {
    const data = registerSchema.parse(input);
    if (data.email) {
      const exists = await this.db.user.findFirst({
        where: { email: { equals: data.email, mode: 'insensitive' } },
      });
      if (exists) throw new AppError('EMAIL_EXISTS', 409, 'Email already registered');
    }
    if (data.phone) {
      const exists = await this.db.user.findUnique({ where: { phone: data.phone } });
      if (exists) throw new AppError('PHONE_EXISTS', 409, 'Phone already registered');
    }

    const passwordHash = await hashPassword(data.password);
    const user = await this.db.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        name: data.name,
        passwordHash,
      },
    });

    if (data.email) {
      await this.otp.issueOtp(user.id, 'email', 'verify_email', data.email, data.name ?? undefined);
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      requiresVerification: true,
    };
  }

  async verifyOtp(input: unknown) {
    return this.otp.verifyOtp(input);
  }

  async resendOtp(input: unknown) {
    return this.otp.resendOtp(input);
  }

  async forgotPassword(input: unknown) {
    return this.otp.requestPasswordReset(input);
  }

  async resetPassword(input: unknown) {
    return this.otp.resetPasswordWithOtp(input);
  }

  async login(input: unknown) {
    const data = loginSchema.parse(input);
    const user = data.email
      ? await this.db.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' } },
        })
      : await this.db.user.findUnique({ where: { phone: data.phone } });

    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Email/số điện thoại hoặc mật khẩu không đúng');
    }
    if (!user.isActive) throw new AppError('USER_INACTIVE', 403, 'User inactive');

    return this.buildSessionResponse(user);
  }

  async loginWithGoogle(input: unknown) {
    if (!this.google.isConfigured()) {
      throw new AppError('GOOGLE_AUTH_DISABLED', 503, 'Google Sign-In is not configured');
    }

    const { idToken } = googleLoginSchema.parse(input);

    let decoded;
    try {
      decoded = await this.google.verifyIdToken(idToken);
    } catch (err) {
      console.error('[auth/google] verify Google ID token failed:', err instanceof Error ? err.message : err);
      throw new AppError('INVALID_GOOGLE_TOKEN', 401, 'Invalid or expired Google ID token');
    }

    if (!decoded.email) {
      throw new AppError('INVALID_GOOGLE_TOKEN', 401, 'Google account email is required');
    }

    const email = normalizeEmail(decoded.email);
    const googleId = decoded.uid;

    let user = await this.db.user.findUnique({ where: { googleId } });

    if (!user) {
      const byEmail = await this.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });

      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== googleId) {
          throw new AppError(
            'GOOGLE_ACCOUNT_CONFLICT',
            409,
            'Email already linked to another Google account',
          );
        }
        user = await this.db.user.update({
          where: { id: byEmail.id },
          data: {
            googleId,
            ...(decoded.email_verified && !byEmail.emailVerifiedAt
              ? { emailVerifiedAt: new Date() }
              : {}),
            ...(decoded.name && !byEmail.name ? { name: decoded.name } : {}),
          },
        });
      } else {
        user = await this.db.user.create({
          data: {
            googleId,
            email,
            name: decoded.name ?? null,
            passwordHash: await hashPassword(randomToken()),
            emailVerifiedAt: decoded.email_verified ? new Date() : null,
          },
        });
      }
    }

    if (!user.isActive) throw new AppError('USER_INACTIVE', 403, 'User inactive');

    return this.buildSessionResponse(user);
  }

  async registerDevice(userId: string, input: unknown) {
    return this.devices.registerDevice(userId, input);
  }

  async refresh(input: unknown) {
    return this.tokens.refresh(input);
  }

  async logout(input: unknown) {
    return this.tokens.logout(input);
  }

  async me(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');
    return this.buildProfileResponse(user);
  }

  private async buildTenantMemberships(userId: string) {
    return this.db.userTenant.findMany({
      where: { userId, isActive: true },
      include: { tenant: true },
    });
  }

  private async buildSessionResponse(user: {
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    isPlatformAdmin: boolean;
    tokenVersion: number;
  }) {
    const [tokens, tenants] = await Promise.all([
      this.tokens.issueTokens(user.id, user.tokenVersion),
      this.buildTenantMemberships(user.id),
    ]);

    const loginUserName = actorLabel(user);
    await Promise.all(
      tenants.map((membership) =>
        publishTenantNotification({
          eventType: NOTIFICATION_EVENT_TYPES.USER_LOGIN,
          tenantId: membership.tenantId,
          actorUserId: user.id,
          actorName: loginUserName,
          source: { type: 'user', id: user.id },
          recipientPolicy: { type: 'tenant_roles', roles: ['admin'] },
          notification: {
            title: 'Thành viên đăng nhập',
            body: `${loginUserName} vừa đăng nhập vào hệ thống`,
            targetType: 'tenant_list',
            targetId: membership.tenantId,
            routeName: 'tenant_members',
            routeParams: { tenantId: membership.tenantId },
            deeplink: `myapp://tenants/${membership.tenantId}/members`,
          },
        }),
      ),
    );

    return {
      user: this.buildProfileResponse(user),
      tenants: tenants.map((t) => ({
        id: t.tenant.id,
        code: t.tenant.code,
        name: t.tenant.name,
        logoUrl: t.tenant.logoUrl,
        role: t.role,
        status: t.tenant.status,
      })),
      ...tokens,
    };
  }

  private buildProfileResponse(user: {
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    isPlatformAdmin: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }
}

export const authService = new AuthService(prisma, otpService, tokenService, deviceService, googleAuth);
