/**
 * Middleware phân giải ngữ cảnh tenant (đa tenant) từ header X-Tenant-Id.
 *
 * Sau khi user đã auth, middleware này:
 * - Xác nhận user thuộc tenant và tenant đang active
 * - Kiểm tra email/phone đã verify
 * - Load role và danh sách warehouse được phép (có cache Redis)
 * - Gán req.tenant cho handler và middleware requireRoles phía sau.
 */
import { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';
import { AppError } from '../utils/app-error';
import { permissionCache } from '../infra/redis-permission-cache';
import type { CachedPermissions, PermissionCache } from '../modules/tenant/permission-cache';
import type { TenantRole } from '../infra/prisma-types';

export class TenantMiddleware {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: PermissionCache = permissionCache,
  ) {}

  /**
   * Load quyền user trong tenant: ưu tiên cache Redis, nếu miss thì query DB
   * (membership, user, tenant, warehouse assignments) rồi set cache.
   * Ném AppError nếu không đủ điều kiện truy cập tenant.
   */
  private async loadPermissions(userId: string, tenantId: string): Promise<CachedPermissions> {
    const cached = await this.cache.get(userId, tenantId);
    if (cached) return cached;

    const [membership, user, tenant, warehouses] = await Promise.all([
      this.db.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
      }),
      this.db.user.findUnique({ where: { id: userId } }),
      this.db.tenant.findUnique({ where: { id: tenantId } }),
      this.db.userWarehouse.findMany({
        where: { userId, tenantId },
        select: { warehouseId: true },
      }),
    ]);

    if (!user || !membership || !membership.isActive) {
      throw new AppError('PERMISSION_DENIED_TENANT', 403, 'User not in tenant');
    }
    if (!tenant || tenant.status !== 'active') {
      throw new AppError('TENANT_SUSPENDED', 403, 'Tenant is not active');
    }

    const emailVerified = !!user.emailVerifiedAt;
    const phoneVerified = !!user.phoneVerifiedAt;
    if (!emailVerified && !phoneVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Account not verified');
    }

    const payload: CachedPermissions = {
      role: membership.role,
      warehouseIds:
        membership.role === 'admin'
          ? 'all'
          : warehouses.map((w: { warehouseId: string }) => w.warehouseId),
      emailVerified,
      phoneVerified,
      tenantStatus: tenant.status,
    };

    await this.cache.set(userId, tenantId, payload);
    return payload;
  }

  /**
   * Handler Express: đọc X-Tenant-Id, load permissions, gán req.tenant.
   * Yêu cầu req.user từ auth middleware trước đó.
   */
  resolve = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('UNAUTHORIZED', 401, 'Unauthorized');
      }
      const tenantId = req.header('X-Tenant-Id');
      if (!tenantId) {
        throw new AppError('TENANT_REQUIRED', 400, 'Missing X-Tenant-Id header');
      }

      const perms = await this.loadPermissions(req.user.id, tenantId);
      req.tenant = {
        id: tenantId,
        role: perms.role,
        warehouseIds: perms.warehouseIds,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const tenantMiddlewareInstance = new TenantMiddleware(prisma, permissionCache);
export const tenantMiddleware = tenantMiddlewareInstance.resolve;

/**
 * Factory middleware: chỉ cho phép các role tenant được liệt kê.
 * Ví dụ: requireRoles('admin', 'manager') trên route quản lý kho.
 */
export function requireRoles(...roles: TenantRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenant) {
      return next(new AppError('TENANT_REQUIRED', 400, 'Tenant context required'));
    }
    if (!roles.includes(req.tenant.role)) {
      return next(new AppError('FORBIDDEN', 403, 'Insufficient role'));
    }
    next();
  };
}
