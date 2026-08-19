import { listCache } from './redis-list-cache';
import type { ListCache } from '../modules/common/list-cache.port';
import { publishCacheInvalidation } from './redis-streams';

const masterPrefixes = ['list:products', 'list:customers', 'list:suppliers', 'list:warehouses', 'report:warehouse-overview', 'report:organization-overview'];
const stockDocPrefixes = ['list:stock-receipts', 'list:stock-issues', 'list:stock-openings', 'report:warehouse-overview', 'report:organization-overview'];
const stockReadPrefixes = [
  'list:stock-balances',
  'report:stock-balance',
  'report:stock-movement',
  'report:low-stock',
  'report:expiry-alert',
  'report:warehouse-overview',
  'report:organization-overview',
];

type CacheRefreshHandler = (key: string) => Promise<void>;

const refreshHandlers = new Map<string, CacheRefreshHandler>();

export function registerCacheRefreshHandler(prefix: string, handler: CacheRefreshHandler): void {
  refreshHandlers.set(prefix, handler);
}

async function refreshCachedKey(key: string): Promise<void> {
  const handlerEntry = [...refreshHandlers.entries()]
    .sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => key === prefix || key.startsWith(`${prefix}:`));
  if (!handlerEntry) {
    await listCache.invalidate(key);
    return;
  }
  await handlerEntry[1](key);
}

export class CacheInvalidationService {
  constructor(private readonly cache: ListCache = listCache) {}

  private async refreshPrefixes(tenantId: string, prefixes: string[]): Promise<void> {
    await Promise.all(
      prefixes.map((prefix) =>
        this.cache.refreshPattern(`${prefix}:${tenantId}:`, refreshCachedKey),
      ),
    );
  }

  async invalidateMasterData(tenantId: string): Promise<void> {
    await this.refreshPrefixes(tenantId, masterPrefixes);
    await publishCacheInvalidation(tenantId, 'master');
  }

  async invalidateStockDocuments(tenantId: string): Promise<void> {
    await this.refreshPrefixes(tenantId, stockDocPrefixes);
    await publishCacheInvalidation(tenantId, 'stock-documents');
  }

  async invalidateStockReads(tenantId: string): Promise<void> {
    await this.refreshPrefixes(tenantId, stockReadPrefixes);
    await publishCacheInvalidation(tenantId, 'stock-reads');
  }

  async invalidateStockMutations(tenantId: string): Promise<void> {
    await Promise.all([
      this.invalidateStockDocuments(tenantId),
      this.invalidateStockReads(tenantId),
    ]);
    await publishCacheInvalidation(tenantId, 'stock-mutations');
  }

  async invalidateAllTenantReadCaches(tenantId: string): Promise<void> {
    await Promise.all([
      this.invalidateMasterData(tenantId),
      this.invalidateStockDocuments(tenantId),
      this.invalidateStockReads(tenantId),
    ]);
    await publishCacheInvalidation(tenantId, 'all');
  }
}

export const cacheInvalidationService = new CacheInvalidationService(listCache);
