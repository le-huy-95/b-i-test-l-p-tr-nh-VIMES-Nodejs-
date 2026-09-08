/**
 * Cache Redis cho unread count và list inbox trang đầu.
 *
 * Thiết kế "cache optional": redis=null hoặc lệnh Redis lỗi → trả null / no-op,
 * caller luôn fallback DB. Service không chết vì Redis.
 *
 * Key:
 * - notif:unread:{userId}           TTL 300s
 * - notif:list:{userId}:latest:{n}  TTL 60s
 */
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

  /**
   * Đọc unread đã cache. Miss / lỗi / không Redis → null (caller COUNT DB).
   */
  async getUnreadCount(userId: string): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const value = await this.redis.get(unreadKey(userId));
      return value != null ? Number(value) : null;
    } catch {
      return null;
    }
  }

  /** Ghi unread + TTL. Dùng sau COUNT DB hoặc mark-read. */
  async setUnreadCount(userId: string, count: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(unreadKey(userId), String(count), 'EX', UNREAD_TTL_SECONDS);
    } catch {
      // cache is optional
    }
  }

  /**
   * INCR unread khi tạo notification mới (tránh COUNT lại).
   * Đồng thời refresh TTL. Lỗi → null, caller fallback getUnreadCount.
   *
   * Cảnh báo: nếu key chưa tồn tại, INCR tạo key=1 — có thể sai nếu user
   * vốn đã có N chưa đọc. TTL ngắn + invalidateUser giảm rủi ro.
   */
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

  /** Đọc JSON list trang đầu. Parse lỗi → null. */
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

  /** Ghi list trang đầu, TTL ngắn vì inbox thay đổi thường xuyên. */
  async setLatestList(userId: string, limit: number, data: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(listKey(userId, limit), LIST_TTL_SECONDS, JSON.stringify(data));
    } catch {
      // cache is optional
    }
  }

  /**
   * Xóa unread + mọi list cache của user (SCAN pattern, không KEYS blocking).
   * Gọi sau mark-read / tạo mới để inbox không stale.
   */
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
