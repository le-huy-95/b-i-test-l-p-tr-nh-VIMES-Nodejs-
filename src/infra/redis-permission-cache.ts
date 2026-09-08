/**
 * Cache quyền người dùng theo tenant trên Redis.
 *
 * Triển khai interface PermissionCache: lưu/đọc CachedPermissions theo cặp
 * userId + tenantId với TTL mặc định 5 phút. Giúp giảm truy vấn DB khi
 * middleware auth kiểm tra quyền mỗi request. Lỗi Redis được bỏ qua im lặng.
 */
import { getRedis } from './redis';
import type { CachedPermissions, PermissionCache } from '../modules/tenant/permission-cache';

/** TTL mặc định cho cache quyền (giây) */
const DEFAULT_TTL_SECONDS = 300;

/**
 * Tạo key Redis chuẩn cho cache quyền user trong tenant.
 */
function cacheKey(userId: string, tenantId: string) {
  return `cache:user-permissions:${userId}:${tenantId}`;
}

export class RedisPermissionCache implements PermissionCache {
  /**
   * Đọc quyền đã cache; null nếu miss hoặc Redis không khả dụng.
   */
  async get(userId: string, tenantId: string): Promise<CachedPermissions | null> {
    try {
      const redis = getRedis();
      if (!redis) return null;
      const cached = await redis.get(cacheKey(userId, tenantId));
      if (!cached) return null;
      return JSON.parse(cached) as CachedPermissions;
    } catch {
      return null;
    }
  }

  /**
   * Ghi quyền vào cache với TTL tùy chọn.
   */
  async set(
    userId: string,
    tenantId: string,
    value: CachedPermissions,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      await redis.set(cacheKey(userId, tenantId), JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // ignore cache write
    }
  }

  /**
   * Xóa cache quyền khi role/permission của user thay đổi.
   */
  async invalidate(userId: string, tenantId: string): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      await redis.del(cacheKey(userId, tenantId));
    } catch {
      // ignore
    }
  }
}

/** Instance singleton cho permission cache */
export const permissionCache = new RedisPermissionCache();
