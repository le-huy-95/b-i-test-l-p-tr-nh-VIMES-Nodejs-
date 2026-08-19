import { getRedis } from './redis';
import type { ListCache } from '../modules/common/list-cache.port';
import { DEFAULT_LIST_CACHE_TTL } from '../modules/common/list-cache.port';

export class RedisListCache implements ListCache {
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = getRedis();
      if (!redis) return null;
      const cached = await redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = DEFAULT_LIST_CACHE_TTL): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // silent fail — cache is optional
    }
  }

  async refreshPattern(pattern: string, refresh: (key: string) => Promise<void>): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      const normalizedPattern = pattern.endsWith('*') ? pattern : `${pattern}*`;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', normalizedPattern, 'COUNT', 100);
        cursor = next;
        for (const key of keys) {
          await refresh(key);
        }
      } while (cursor !== '0');
    } catch {
      // silent fail
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      const normalizedPattern = pattern.endsWith('*') ? pattern : `${pattern}*`;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', normalizedPattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // silent fail
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      await redis.del(key);
    } catch {
      // silent fail
    }
  }
}

export const listCache = new RedisListCache();
