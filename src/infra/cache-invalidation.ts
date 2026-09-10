/**
 * Dịch vụ invalidation cache đọc theo tenant (lazy delete).
 *
 * Khi master data / chứng từ / tồn kho thay đổi: chỉ xóa key Redis theo prefix.
 * Lần gọi list/report tiếp theo miss cache → query DB → ghi lại (getOrSet).
 * Không eager refresh, không publish Redis Stream (Redis dùng chung giữa các instance).
 */
import { listCache } from './redis-list-cache';
import type { ListCache } from '../modules/common/list-cache.port';

/** Prefix cache bị ảnh hưởng khi master data (sản phẩm, KH, NCC, ...) thay đổi */
const masterPrefixes = [
  'list:products',
  'list:customers',
  'list:suppliers',
  'list:warehouses',
  'list:contacts',
  'report:warehouse-overview',
  'report:organization-overview',
];
/** Prefix khi chứng từ nhập/xuất/tồn đầu kỳ thay đổi */
const stockDocPrefixes = [
  'list:stock-receipts',
  'detail:stock-receipts',
  'list:stock-issues',
  'list:stock-openings',
  'report:warehouse-overview',
  'report:organization-overview',
];
/** Prefix báo cáo / số dư tồn kho cần xóa sau mutation */
const stockReadPrefixes = [
  'list:stock-balances',
  'report:stock-balance',
  'report:stock-movement',
  'report:low-stock',
  'report:expiry-alert',
  'report:warehouse-overview',
  'report:organization-overview',
];

/**
 * Service invalidation cache theo nhóm nghiệp vụ và tenant.
 */
export class CacheInvalidationService {
  constructor(private readonly cache: ListCache = listCache) {}

  /** Quét và xóa mọi key khớp các prefix cho tenant */
  private async invalidatePrefixes(
    tenantId: string,
    prefixes: string[],
  ): Promise<void> {
    await Promise.all(
      prefixes.map((prefix) =>
        this.cache.invalidatePattern(`${prefix}:${tenantId}:`),
      ),
    );
  }

  /** Xóa cache master data */
  async invalidateMasterData(tenantId: string): Promise<void> {
    await this.invalidatePrefixes(tenantId, masterPrefixes);
  }

  /** Xóa cache danh sách chứng từ kho */
  async invalidateStockDocuments(tenantId: string): Promise<void> {
    await this.invalidatePrefixes(tenantId, stockDocPrefixes);
  }

  /** Xóa cache đọc tồn kho / báo cáo */
  async invalidateStockReads(tenantId: string): Promise<void> {
    await this.invalidatePrefixes(tenantId, stockReadPrefixes);
  }

  /** Kết hợp invalidation chứng từ và đọc kho sau mutation */
  async invalidateStockMutations(tenantId: string): Promise<void> {
    await Promise.all([
      this.invalidateStockDocuments(tenantId),
      this.invalidateStockReads(tenantId),
    ]);
  }

  /** Invalidation toàn bộ cache đọc của tenant (master + stock) */
  async invalidateAllTenantReadCaches(tenantId: string): Promise<void> {
    await Promise.all([
      this.invalidateMasterData(tenantId),
      this.invalidateStockDocuments(tenantId),
      this.invalidateStockReads(tenantId),
    ]);
  }
}

/** Instance singleton dùng listCache mặc định */
export const cacheInvalidationService = new CacheInvalidationService(listCache);
