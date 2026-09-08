/**
 * DỊCH VỤ TENANT (ĐA THUÊ BAO)
 * ----------------------------
 * Tạo/sửa tenant, quản lý thành viên, gửi lời mời, gán quyền và phạm vi kho.
 * Invalidate cache quyền khi membership thay đổi.
 */
import type { Prisma, PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import { hashPassword } from "../../utils/crypto";
import { permissionCache } from "../../infra/redis-permission-cache";
import { inviteMailer } from "../../infra/email-invite-mailer";
import { listCache as defaultListCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { paginate, paginationSchema } from "../../dto/pagination.dto";
import {
  logoExtensionForMime,
  objectStorage,
  tenantLogoObjectKey,
} from "../../infra/minio-storage";
import type { InviteMailer } from "./invite-mailer.port";
import type { PermissionCache } from "./permission-cache";
import type { ObjectStorage } from "./object-storage.port";
import {
  acceptInviteSchema,
  createInternalUserSchema,
  createTenantSchema,
  declineInviteSchema,
  inviteSchema,
  platformCreateTenantSchema,
  platformPatchTenantSchema,
} from "../../dto/tenant.dto";
import { NOTIFICATION_EVENT_TYPES } from "../../shared/notifications/event-types";
import {
  actorLabel,
  publishTenantNotification,
} from "../../shared/notifications/publish";
import { notifyInvitationCreated } from "../../shared/notifications/direct-notify";

function assertVerified(user: {
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
}) {
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
    throw new AppError(
      "EMAIL_NOT_VERIFIED",
      403,
      "Verify email or phone first",
    );
  }
}

const MEMBERS_CACHE_PREFIX = "list:members";
const INVITATIONS_CACHE_PREFIX = "list:invitations";

const memberUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
} as const;

type MemberRow = Prisma.UserTenantGetPayload<{
  include: { user: { select: typeof memberUserSelect } };
}>;

function toMember(row: MemberRow) {
  return {
    id: row.id,
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    phone: row.user.phone,
    role: row.role,
    isActive: row.isActive,
    joinedAt: row.createdAt,
  };
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  createdAt: true,
  tenant: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, name: true, email: true } },
} as const;

type InvitationRow = Prisma.InvitationGetPayload<{
  select: typeof invitationSelect;
}>;

function toInvitation(row: InvitationRow, currentTenantId: string) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.declinedAt
      ? "declined"
      : row.acceptedAt
        ? "accepted"
        : row.expiresAt.getTime() < Date.now()
          ? "expired"
          : "pending",
    direction: row.tenant.id === currentTenantId ? "outgoing" : "incoming",
    tenantId: row.tenant.id,
    tenantName: row.tenant.name,
    expiresAt: row.expiresAt,
    invitedAt: row.createdAt,
    invitedBy: row.invitedBy,
  };
}

export class TenantService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: PermissionCache = permissionCache,
    private readonly mailer: InviteMailer = inviteMailer,
    private readonly storage: ObjectStorage = objectStorage,
    private readonly listCache: ListCache = defaultListCache,
  ) {}

  private async invalidatePeopleCaches(tenantId: string): Promise<void> {
    await Promise.all([
      this.listCache.invalidatePattern(`${MEMBERS_CACHE_PREFIX}:${tenantId}:`),
      this.listCache.invalidatePattern(
        `${INVITATIONS_CACHE_PREFIX}:${tenantId}:`,
      ),
    ]);
  }

  private async refreshInvitationListCache(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.listCache.invalidatePattern(
      `${INVITATIONS_CACHE_PREFIX}:${tenantId}:${userId}:`,
    );
    await this.listInvitations(tenantId, userId);
  }

  /** User tạo tenant mới và trở thành admin — yêu cầu email đã verify */
  async createTenant(userId: string, input: unknown) {
    const data = createTenantSchema.parse(input);

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("NOT_FOUND", 404, "User not found");
    assertVerified(user);

    const exists = await this.db.tenant.findUnique({
      where: { code: data.code },
    });
    if (exists)
      throw new AppError("TENANT_CODE_EXISTS", 409, "Tenant code exists");

    const tenant = await this.db.tenant.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        userTenants: {
          create: {
            userId,
            role: "admin",
          },
        },
      },
    });

    return tenant;
  }

  /** Admin mời thành viên qua email — gửi link/token invite */
  async invite(tenantId: string, inviterId: string, input: unknown) {
    const data = inviteSchema.parse(input);

    const [tenant, inviter] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: tenantId } }),
      this.db.user.findUnique({ where: { id: inviterId } }),
    ]);
    if (!tenant) throw new AppError("NOT_FOUND", 404, "Tenant not found");
    if (!inviter) throw new AppError("NOT_FOUND", 404, "User not found");

    const invitation = await this.db.invitation.create({
      data: {
        tenantId,
        email: data.email,
        role: data.role,
        invitedById: inviterId,
        expiresAt: new Date(Date.now() + env.INVITE_EXPIRES_HOURS * 3600_000),
      },
    });

    const acceptUrl = `${env.APP_PUBLIC_URL}/invite/accept/${invitation.id}`;
    await this.mailer.sendInvite({
      to: data.email,
      tenantName: tenant.name,
      role: data.role,
      inviterName: actorLabel(inviter),
      acceptUrl,
      expiryHours: env.INVITE_EXPIRES_HOURS,
      userId: inviterId,
    });

    const invitee = await this.db.user.findFirst({
      where: { email: { equals: data.email, mode: "insensitive" } },
      select: { id: true },
    });

    if (invitee) {
      const inviterName = actorLabel(inviter);
      await notifyInvitationCreated({
        userId: invitee.id,
        invitationId: invitation.id,
        tenantId,
        tenantName: tenant.name,
        inviterId,
        inviterName,
      });
    }

    await this.invalidatePeopleCaches(tenantId);

    return { id: invitation.id, email: data.email, role: data.role, acceptUrl };
  }

  /** User chấp nhận lời mời — tạo membership và gán role/kho */
  async acceptInvite(userId: string, input: unknown) {
    const { invitationId } = acceptInviteSchema.parse(input);

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("NOT_FOUND", 404, "User not found");
    assertVerified(user);

    const invitation = await this.db.invitation.findUnique({
      where: { id: invitationId },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.declinedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new AppError(
        "INVALID_INVITE",
        400,
        "Invalid or expired invitation",
      );
    }
    if (
      user.email &&
      invitation.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      throw new AppError(
        "INVITE_EMAIL_MISMATCH",
        403,
        "Invitation email mismatch",
      );
    }

    await this.db.$transaction([
      this.db.userTenant.upsert({
        where: {
          userId_tenantId: { userId, tenantId: invitation.tenantId },
        },
        create: {
          userId,
          tenantId: invitation.tenantId,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
          isActive: true,
        },
      }),
      this.db.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.cache.invalidate(userId, invitation.tenantId);
    await this.invalidatePeopleCaches(invitation.tenantId);
    await this.refreshInvitationListCache(invitation.tenantId, userId);

    const tenant = await this.db.tenant.findUnique({
      where: { id: invitation.tenantId },
    });
    const accepterName = actorLabel(user);
    await publishTenantNotification({
      eventType: NOTIFICATION_EVENT_TYPES.INVITATION_ACCEPTED,
      tenantId: invitation.tenantId,
      actorUserId: userId,
      actorName: accepterName,
      source: { type: "invitation", id: invitation.id },
      recipientPolicy: { type: "tenant_roles", roles: ["admin"] },
      notification: {
        title: "Thành viên mới",
        body: `${accepterName} đã tham gia ${tenant?.name ?? "tổ chức"}`,
        targetType: "tenant_list",
        routeName: "tenant_members",
        routeParams: { tenantId: invitation.tenantId },
        deeplink: `myapp://tenants/${invitation.tenantId}/members`,
      },
    });

    return { tenantId: invitation.tenantId, role: invitation.role };
  }

  /** User từ chối lời mời tenant */
  async declineInvite(userId: string, input: unknown) {
    const { invitationId } = declineInviteSchema.parse(input);

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("NOT_FOUND", 404, "User not found");
    assertVerified(user);

    const invitation = await this.db.invitation.findUnique({
      where: { id: invitationId },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.declinedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new AppError(
        "INVALID_INVITE",
        400,
        "Invalid or expired invitation",
      );
    }
    if (
      user.email &&
      invitation.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      throw new AppError(
        "INVITE_EMAIL_MISMATCH",
        403,
        "Invitation email mismatch",
      );
    }

    await this.db.invitation.update({
      where: { id: invitation.id },
      data: { declinedAt: new Date() },
    });

    await this.invalidatePeopleCaches(invitation.tenantId);
    await this.refreshInvitationListCache(invitation.tenantId, userId);

    const tenant = await this.db.tenant.findUnique({
      where: { id: invitation.tenantId },
    });
    const declinerName = actorLabel(user);
    const inviter = await this.db.user.findUnique({
      where: { id: invitation.invitedById },
      select: { id: true },
    });
    if (inviter) {
      await publishTenantNotification({
        eventType: NOTIFICATION_EVENT_TYPES.INVITATION_DECLINED,
        tenantId: invitation.tenantId,
        actorUserId: userId,
        actorName: declinerName,
        source: { type: "invitation", id: invitation.id },
        recipientPolicy: { type: "explicit_users", userIds: [inviter.id] },
        notification: {
          title: "Lời mời bị từ chối",
          body: `${declinerName} đã từ chối lời mời vào ${tenant?.name ?? "tổ chức"}`,
          targetType: "tenant_invitation",
          targetId: invitation.id,
          routeName: "tenant_invitation_detail",
          routeParams: {
            invitationId: invitation.id,
            tenantId: invitation.tenantId,
          },
          deeplink: `myapp://tenant-invitations/${invitation.id}`,
        },
      });
    }

    return { tenantId: invitation.tenantId, invitationId: invitation.id };
  }

  async listMembers(tenantId: string, query?: unknown) {
    const normalizedQuery =
      query && Object.keys(query as object).length > 0
        ? paginationSchema.parse(query)
        : null;
    const cacheKey = `${MEMBERS_CACHE_PREFIX}:${tenantId}:${normalizedQuery ? JSON.stringify(normalizedQuery) : "all"}`;
    return this.listCache.getOrSet(cacheKey, async () => {
      const search = normalizedQuery?.search?.trim();
      const where: Prisma.UserTenantWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { user: { name: { contains: search, mode: "insensitive" } } },
                { user: { email: { contains: search, mode: "insensitive" } } },
                { user: { phone: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      };

      if (!normalizedQuery) {
        const data = await this.db.userTenant.findMany({
          where,
          include: { user: { select: memberUserSelect } },
          orderBy: { createdAt: "desc" },
        });
        return data.map(toMember);
      }

      const { page, limit } = normalizedQuery;
      const [data, total] = await Promise.all([
        this.db.userTenant.findMany({
          where,
          include: { user: { select: memberUserSelect } },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.userTenant.count({ where }),
      ]);

      return paginate(data.map(toMember), page, limit, total);
    });
  }

  async listInvitations(tenantId: string, userId: string, query?: unknown) {
    const normalizedQuery =
      query && Object.keys(query as object).length > 0
        ? paginationSchema.parse(query)
        : null;
    const cacheKey = `${INVITATIONS_CACHE_PREFIX}:${tenantId}:${userId}:${normalizedQuery ? JSON.stringify(normalizedQuery) : "all"}`;
    return this.listCache.getOrSet(cacheKey, async () => {
      const user = await this.db.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true },
      });
      if (!user) throw new AppError("NOT_FOUND", 404, "User not found");

      const identifiers = [user.email, user.phone].filter(
        (value): value is string => !!value,
      );
      const search = normalizedQuery?.search?.trim();
      const or: Prisma.InvitationWhereInput[] = [{ tenantId }];
      if (identifiers.length > 0) {
        or.push({ email: { in: identifiers, mode: "insensitive" } });
      }
      if (search) {
        or.push(
          { email: { contains: search, mode: "insensitive" } },
          {
            invitedBy: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
          { tenant: { name: { contains: search, mode: "insensitive" } } },
        );
      }
      const where: Prisma.InvitationWhereInput = {
        acceptedAt: null,
        declinedAt: null,
        OR: or,
      };

      if (!normalizedQuery) {
        const data = await this.db.invitation.findMany({
          where,
          select: invitationSelect,
          orderBy: { createdAt: "desc" },
        });
        return data.map((row) => toInvitation(row, tenantId));
      }

      const { page, limit } = normalizedQuery;
      const [data, total] = await Promise.all([
        this.db.invitation.findMany({
          where,
          select: invitationSelect,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.invitation.count({ where }),
      ]);

      return paginate(
        data.map((row) => toInvitation(row, tenantId)),
        page,
        limit,
        total,
      );
    });
  }

  async createInternalUser(
    tenantId: string,
    actorUserId: string,
    input: unknown,
  ) {
    const data = createInternalUserSchema.parse(input);
    if (!data.email && !data.phone) {
      throw new AppError("VALIDATION_ERROR", 400, "Email or phone required");
    }

    const passwordHash = await hashPassword(data.password);
    const user = await this.db.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        name: data.name,
        passwordHash,
        emailVerifiedAt: data.email ? new Date() : null,
        phoneVerifiedAt: data.phone ? new Date() : null,
        tenants: {
          create: { tenantId, role: data.role },
        },
        warehouses: data.warehouseIds?.length
          ? {
              create: data.warehouseIds.map((warehouseId) => ({
                tenantId,
                warehouseId,
              })),
            }
          : undefined,
      },
    });

    await this.invalidatePeopleCaches(tenantId);

    const [actor, tenant] = await Promise.all([
      this.db.user.findUnique({ where: { id: actorUserId } }),
      this.db.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    const actorName = actorLabel(actor ?? {});
    const createdUserName = actorLabel(user);
    await publishTenantNotification({
      eventType: NOTIFICATION_EVENT_TYPES.USER_CREATED,
      tenantId,
      actorUserId,
      actorName,
      source: { type: "user", id: user.id },
      recipientPolicy: { type: "tenant_roles", roles: ["admin"] },
      notification: {
        title: "Tài khoản mới được tạo",
        body: `${actorName} đã tạo tài khoản ${createdUserName} trong ${tenant?.name ?? "tổ chức"}`,
        targetType: "tenant_list",
        targetId: tenantId,
        routeName: "tenant_members",
        routeParams: { tenantId },
        deeplink: `myapp://tenants/${tenantId}/members`,
      },
    });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: data.role,
    };
  }

  async platformCreateTenant(input: unknown) {
    const data = platformCreateTenantSchema.parse(input);
    return this.db.tenant.create({
      data: { code: data.code.toUpperCase(), name: data.name },
    });
  }

  async platformPatchTenant(id: string, input: unknown) {
    const data = platformPatchTenantSchema.parse(input);
    return this.db.tenant.update({ where: { id }, data });
  }

  async getCurrentTenant(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError("NOT_FOUND", 404, "Tenant not found");
    return tenant;
  }

  async uploadLogo(
    tenantId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const extension = logoExtensionForMime(file.mimetype);
    if (!extension) {
      throw new AppError(
        "INVALID_LOGO_TYPE",
        400,
        "Logo must be JPEG, PNG, WebP, or GIF",
      );
    }

    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError("NOT_FOUND", 404, "Tenant not found");

    const objectKey = tenantLogoObjectKey(tenantId, extension);
    const logoUrl = await this.storage.uploadObject(
      objectKey,
      file.buffer,
      file.mimetype,
    );

    const updated = await this.db.tenant.update({
      where: { id: tenantId },
      data: { logoUrl },
    });

    if (tenant.logoUrl) {
      const oldKey = this.storage.objectKeyFromUrl(tenant.logoUrl);
      if (oldKey && oldKey !== objectKey) {
        await this.storage.deleteObject(oldKey).catch(() => undefined);
      }
    }

    return updated;
  }

  async deleteLogo(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError("NOT_FOUND", 404, "Tenant not found");
    if (!tenant.logoUrl) {
      throw new AppError("LOGO_NOT_FOUND", 404, "Tenant has no logo");
    }

    const objectKey = this.storage.objectKeyFromUrl(tenant.logoUrl);
    if (objectKey) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
    }

    return this.db.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: null },
    });
  }
}

export const tenantService = new TenantService(
  prisma,
  permissionCache,
  inviteMailer,
  objectStorage,
);
