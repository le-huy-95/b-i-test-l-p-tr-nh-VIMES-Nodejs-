export interface ListCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /**
   * Cache-aside with in-process singleflight: concurrent misses for the same key
   * share one loader invocation.
   */
  getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T>;
  invalidatePattern(pattern: string): Promise<void>;
  invalidate(key: string): Promise<void>;
}

export const DEFAULT_LIST_CACHE_TTL = 60;

export function hasListQuery(query?: unknown): boolean {
  return !!query && Object.keys(query as object).length > 0;
}

export function buildListCacheKey(
  prefix: string,
  tenantId: string,
  query?: unknown,
): string {
  return `${prefix}:${tenantId}:${hasListQuery(query) ? JSON.stringify(query) : "all"}`;
}

export function parseListCacheQuery(suffix: string): unknown {
  return suffix === "all" ? undefined : (JSON.parse(suffix) as unknown);
}
