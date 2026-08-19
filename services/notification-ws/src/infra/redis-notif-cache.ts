import type Redis from 'ioredis';

const LIST_TTL_SECONDS = 60;
const UNREAD_TTL_SECONDS = 300;

function unreadKey(userId: string): string {
  return `notif:unread:${userId}`;
}

function listKey(userId: string, limit: number): string {
  return `notif:list:${userId}:latest:${limit}`;
}

export class RedisNotifCache {
  constructor(private readonly redis: Redis | null) {}

  async getUnreadCount(userId: string): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const value = await this.redis.get(unreadKey(userId));
      return value != null ? Number(value) : null;
    } catch {
      return null;
    }
  }

  async setUnreadCount(userId: string, count: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(unreadKey(userId), String(count), 'EX', UNREAD_TTL_SECONDS);
    } catch {
      // cache is optional
    }
  }

  async incrementUnread(userId: string, delta: number): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const result = await this.redis.incrby(unreadKey(userId), delta);
      await this.redis.expire(unreadKey(userId), UNREAD_TTL_SECONDS);
      return result;
    } catch {
      return null;
    }
  }

  async getLatestList<T>(userId: string, limit: number): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(listKey(userId, limit));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setLatestList(userId: string, limit: number, data: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(listKey(userId, limit), LIST_TTL_SECONDS, JSON.stringify(data));
    } catch {
      // cache is optional
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(unreadKey(userId));
      const pattern = `notif:list:${userId}:latest:*`;
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // cache is optional
    }
  }
}
