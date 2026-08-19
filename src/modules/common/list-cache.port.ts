export interface ListCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  refreshPattern(pattern: string, refresh: (key: string) => Promise<void>): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
  invalidate(key: string): Promise<void>;
}

export const DEFAULT_LIST_CACHE_TTL = 60;
