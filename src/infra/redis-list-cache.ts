/**
 * Triển khai ListCache bằng Redis — cache kết quả danh sách / báo cáo theo key.
 *
 * Hỗ trợ get/set JSON, pattern invalidate qua SCAN (lazy delete),
 * và getOrSet với dedup request đồng thời (inflight map) để tránh thundering herd.
 * Cache là tùy chọn: mọi lỗi Redis đều fail im lặng, ứng dụng vẫn đọc từ DB.
 */
import { getRedis } from "./redis";
import type { ListCache } from "../modules/common/list-cache.port";
import { DEFAULT_LIST_CACHE_TTL } from "../modules/common/list-cache.port";

export class RedisListCache implements ListCache {
  // Map dedup: cùng key đang load thì các caller chờ chung một Promise
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Đọc giá trị cache theo key; trả null nếu miss hoặc Redis không khả dụng.
   */
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

  /**
   * Ghi giá trị vào cache với TTL (giây), mặc định DEFAULT_LIST_CACHE_TTL.
   */
  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = DEFAULT_LIST_CACHE_TTL,
  ): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // silent fail — cache is optional
    }
  }

  /**
   * Cache-aside: đọc cache trước, nếu miss thì gọi loader và ghi lại.
   * Các request đồng thời cùng key chỉ chạy loader một lần.
   */
  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number = DEFAULT_LIST_CACHE_TTL,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const flight = (async () => {
      const again = await this.get<T>(key);
      if (again !== null) return again;
      const value = await loader();
      await this.set(key, value, ttlSeconds);
      return value;
    })();

    this.inflight.set(key, flight);
    try {
      return await flight;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Xóa tất cả key khớp pattern bằng SCAN + DEL (lazy delete).
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const redis = getRedis();
      if (!redis) return;
      const normalizedPattern = pattern.endsWith("*") ? pattern : `${pattern}*`;
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          normalizedPattern,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== "0");
    } catch {
      // silent fail
    }
  }

  /**
   * Xóa một key cache cụ thể.
   */
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

/** Instance singleton dùng chung trong ứng dụng */
export const listCache = new RedisListCache();
