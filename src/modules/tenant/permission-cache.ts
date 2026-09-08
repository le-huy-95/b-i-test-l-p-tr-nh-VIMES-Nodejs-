/**
 * CACHE QUYỀN THEO TENANT
 * -----------------------
 * Lưu role + warehouseIds của user trong Redis để tránh query DB mỗi request.
 * Fallback DB khi Redis không khả dụng.
 */
import type { TenantRole } from '../../infra/prisma-types';

export interface CachedPermissions {
  role: TenantRole;
  warehouseIds: string[] | 'all';
  emailVerified: boolean;
  phoneVerified: boolean;
  tenantStatus: string;
}

export interface PermissionCache {
  get(userId: string, tenantId: string): Promise<CachedPermissions | null>;
  set(
    userId: string,
    tenantId: string,
    value: CachedPermissions,
    ttlSeconds?: number,
  ): Promise<void>;
  invalidate(userId: string, tenantId: string): Promise<void>;
}
