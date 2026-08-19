import { getRedis } from './redis';
import type { CachedPermissions, PermissionCache } from '../modules/tenant/permission-cache';

const DEFAULT_TTL_SECONDS = 300;

function cacheKey(userId: string, tenantId: string) {
  return `cache:user-permissions:${userId}:${tenantId}`;
}

export class RedisPermissionCache implements PermissionCache {
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

export const permissionCache = new RedisPermissionCache();
