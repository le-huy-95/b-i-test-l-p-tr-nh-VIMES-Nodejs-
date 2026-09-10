/**
 * Dịch vụ xác thực (Auth) — lớp nghiệp vụ trung tâm cho đăng ký, đăng nhập,
 * OTP, Google Sign-In, phiên làm việc và thông báo đăng nhập theo tenant.
 *
 * Phối hợp các port: OtpIssuer, TokenIssuer, DeviceRegistry, GoogleTokenVerifier.
 * Không xử lý HTTP trực tiếp; được gọi từ AuthController.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { hashPassword, randomToken, verifyPassword } from "../../utils/crypto";
import { normalizeEmail } from "../../utils/auth-normalize";
import {
  googleLoginSchema,
  loginSchema,
  registerSchema,
} from "../../dto/auth.dto";
import { otpService } from "./otp.service";
import { tokenService } from "./token.service";
import { deviceService } from "./device.service";
import type { OtpIssuer } from "./otp.port";
import type { TokenIssuer } from "./token.port";
import type { DeviceRegistry } from "./device.port";
import type { GoogleTokenVerifier } from "./google-auth.port";
import { googleAuth } from "../../infra/firebase-google-auth";
import { listCache as defaultListCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { userTenantsCacheKey } from "./user-tenants-cache";
import { NOTIFICATION_EVENT_TYPES } from "../../shared/notifications/event-types";
import {
  actorLabel,
  publishTenantNotification,
} from "../../shared/notifications/publish";

/** DTO tổ chức trong danh sách membership của user (login + /auth/me). */
type UserTenantListItem = {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
  role: string;
  status: string;
};

/** Lớp dịch vụ xác thực — điều phối luồng người dùng từ đăng ký đến phiên. */
export class AuthService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly otp: OtpIssuer = otpService,
    private readonly tokens: TokenIssuer = tokenService,
    private readonly devices: DeviceRegistry = deviceService,
    private readonly google: GoogleTokenVerifier = googleAuth,
    private readonly listCache: ListCache = defaultListCache,
  ) {}

  /** Đăng ký tài khoản mới; gửi OTP xác minh email nếu có email. */
  async register(input: unknown) {
    const data = registerSchema.parse(input);
    if (data.email) {
      const exists = await this.db.user.findFirst({
        where: { email: { equals: data.email, mode: "insensitive" } },
      });
      if (exists)
        throw new AppError("EMAIL_EXISTS", 409, "Email already registered");
    }
    if (data.phone) {
      const exists = await this.db.user.findUnique({
        where: { phone: data.phone },
      });
      if (exists)
        throw new AppError("PHONE_EXISTS", 409, "Phone already registered");
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
      await this.otp.issueOtp(
        user.id,
        "email",
        "verify_email",
        data.email,
        data.name ?? undefined,
      );
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      requiresVerification: true,
    };
  }

  /** Xác minh mã OTP (email hoặc số điện thoại). */
  async verifyOtp(input: unknown) {
    return this.otp.verifyOtp(input);
  }

  /** Gửi lại mã OTP xác minh. */
  async resendOtp(input: unknown) {
    return this.otp.resendOtp(input);
  }

  /** Yêu cầu đặt lại mật khẩu qua OTP email. */
  async forgotPassword(input: unknown) {
    return this.otp.requestPasswordReset(input);
  }

  /** Đặt lại mật khẩu bằng mã OTP hợp lệ. */
  async resetPassword(input: unknown) {
    return this.otp.resetPasswordWithOtp(input);
  }

  /** Đăng nhập bằng email/số điện thoại và mật khẩu. */
  async login(input: unknown) {
    const data = loginSchema.parse(input);
    const user = data.email
      ? await this.db.user.findFirst({
          where: { email: { equals: data.email, mode: "insensitive" } },
        })
      : await this.db.user.findUnique({ where: { phone: data.phone } });

    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        401,
        "Email/số điện thoại hoặc mật khẩu không đúng",
      );
    }
    if (!user.isActive)
      throw new AppError("USER_INACTIVE", 403, "User inactive");

    return this.buildSessionResponse(user);
  }

  /** Đăng nhập hoặc liên kết tài khoản qua Google ID token (Firebase). */
  async loginWithGoogle(input: unknown) {
    if (!this.google.isConfigured()) {
      throw new AppError(
        "GOOGLE_AUTH_DISABLED",
        503,
        "Google Sign-In is not configured",
      );
    }

    const { idToken } = googleLoginSchema.parse(input);

    let decoded;
    try {
      decoded = await this.google.verifyIdToken(idToken);
    } catch (err) {
      console.error(
        "[auth/google] verify Google ID token failed:",
        err instanceof Error ? err.message : err,
      );
      throw new AppError(
        "INVALID_GOOGLE_TOKEN",
        401,
        "Invalid or expired Google ID token",
      );
    }

    if (!decoded.email) {
      throw new AppError(
        "INVALID_GOOGLE_TOKEN",
        401,
        "Google account email is required",
      );
    }

    if (!decoded.email_verified) {
      throw new AppError(
        "GOOGLE_EMAIL_NOT_VERIFIED",
        403,
        "Google account email must be verified",
      );
    }

    const email = normalizeEmail(decoded.email);
    const googleId = decoded.uid;

    let user = await this.db.user.findUnique({ where: { googleId } });

    if (!user) {
      const byEmail = await this.db.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });

      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== googleId) {
          throw new AppError(
            "GOOGLE_ACCOUNT_CONFLICT",
            409,
            "Email already linked to another Google account",
          );
        }
        if (!byEmail.emailVerifiedAt) {
          throw new AppError(
            "EMAIL_NOT_VERIFIED",
            403,
            "Verify email before linking Google Sign-In",
          );
        }
        user = await this.db.user.update({
          where: { id: byEmail.id },
          data: {
            googleId,
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
            emailVerifiedAt: new Date(),
          },
        });
      }
    }

    if (!user.isActive)
      throw new AppError("USER_INACTIVE", 403, "User inactive");

    return this.buildSessionResponse(user);
  }

  /** Đăng ký hoặc cập nhật thiết bị (FCM) của người dùng. */
  async registerDevice(userId: string, input: unknown) {
    return this.devices.registerDevice(userId, input);
  }

  /** Làm mới access token bằng refresh token (xoay token). */
  async refresh(input: unknown) {
    return this.tokens.refresh(input);
  }

  /** Đăng xuất — thu hồi refresh token và vô hiệu thiết bị nếu có. */
  async logout(input: unknown) {
    return this.tokens.logout(input);
  }

  /** Lấy hồ sơ người dùng hiện tại theo userId từ JWT. */
  async me(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("NOT_FOUND", 404, "User not found");
    const tenants = await this.listUserTenants(userId);
    return {
      ...this.buildProfileResponse(user),
      tenants,
    };
  }

  /**
   * Danh sách tổ chức active của user — cache-aside Redis.
   * Miss: query DB rồi set; hit: trả cache; Redis lỗi: fallback DB.
   */
  private async listUserTenants(userId: string): Promise<UserTenantListItem[]> {
    return this.listCache.getOrSet(userTenantsCacheKey(userId), async () => {
      const rows = await this.db.userTenant.findMany({
        where: { userId, isActive: true },
        include: { tenant: true },
      });
      return rows.map((t) => ({
        id: t.tenant.id,
        code: t.tenant.code,
        name: t.tenant.name,
        logoUrl: t.tenant.logoUrl,
        role: t.role,
        status: t.tenant.status,
      }));
    });
  }

  /**
   * Tạo phản hồi phiên đăng nhập: token, profile, danh sách tenant
   * và gửi thông báo USER_LOGIN tới admin các tenant liên quan.
   */
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
      this.listUserTenants(user.id),
    ]);

    const loginUserName = actorLabel(user);
    await Promise.all(
      tenants.map((tenant) =>
        publishTenantNotification({
          eventType: NOTIFICATION_EVENT_TYPES.USER_LOGIN,
          tenantId: tenant.id,
          actorUserId: user.id,
          actorName: loginUserName,
          source: { type: "user", id: user.id },
          recipientPolicy: { type: "tenant_roles", roles: ["admin"] },
          notification: {
            title: "Thành viên đăng nhập",
            body: `${loginUserName} vừa đăng nhập vào hệ thống`,
            targetType: "tenant_list",
            targetId: tenant.id,
            routeName: "tenant_members",
            routeParams: { tenantId: tenant.id },
            deeplink: `myapp://tenants/${tenant.id}/members`,
          },
        }),
      ),
    );

    return {
      user: this.buildProfileResponse(user),
      tenants,
      ...tokens,
    };
  }

  /** Chuẩn hóa dữ liệu hồ sơ người dùng trả về API. */
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

/** Instance mặc định của AuthService dùng trong toàn ứng dụng. */
export const authService = new AuthService(
  prisma,
  otpService,
  tokenService,
  deviceService,
  googleAuth,
  defaultListCache,
);
