import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

type QueryLog = { model: string; method: string };

const queryLog: QueryLog[] = [];
let queryLatencyMs = 0;

function tracked<T extends (...args: any[]) => Promise<unknown>>(
  model: string,
  method: string,
  impl: T,
): T {
  return (async (...args: any[]) => {
    queryLog.push({ model, method });
    if (queryLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, queryLatencyMs));
    }
    return impl(...args);
  }) as T;
}

function makeWarehouses(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `wh-${i + 1}`,
    code: `WH${String(i + 1).padStart(2, '0')}`,
    name: `Kho ${i + 1}`,
  }));
}

const mockCache = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  invalidatePattern: vi.fn(),
  invalidate: vi.fn(),
};

const mockPrisma = {
  warehouse: {
    findMany: tracked('warehouse', 'findMany', async (args?: { where?: { id?: { in: string[] } } }) => {
      const all = makeWarehouses(20);
      const ids = args?.where?.id?.in;
      return ids ? all.filter((w) => ids.includes(w.id)) : all;
    }),
  },
  stockReceipt: {
    groupBy: tracked('stockReceipt', 'groupBy', async () => [
      { status: 'completed', _count: { _all: 80 } },
      { status: 'pending_approval', _count: { _all: 4 } },
    ]),
    findMany: tracked('stockReceipt', 'findMany', async () => []),
  },
  stockIssue: {
    groupBy: tracked('stockIssue', 'groupBy', async () => [
      { status: 'completed', _count: { _all: 60 } },
      { status: 'pending_approval', _count: { _all: 3 } },
    ]),
    findMany: tracked('stockIssue', 'findMany', async () => []),
  },
  stockOpeningBalance: {
    groupBy: tracked('stockOpeningBalance', 'groupBy', async () => []),
  },
  stockReceiptDetail: {
    aggregate: tracked('stockReceiptDetail', 'aggregate', async () => ({
      _sum: { qtyBaseUnit: '1000.0000' },
    })),
    groupBy: tracked('stockReceiptDetail', 'groupBy', async () => [
      { productId: 'p-1', _sum: { qtyBaseUnit: '400.0000' }, _count: { receiptId: 12 } },
    ]),
  },
  stockIssueDetail: {
    aggregate: tracked('stockIssueDetail', 'aggregate', async () => ({
      _sum: { qtyBaseUnit: '500.0000' },
    })),
    groupBy: tracked('stockIssueDetail', 'groupBy', async () => [
      { productId: 'p-2', _sum: { qtyBaseUnit: '220.0000' }, _count: { issueId: 8 } },
    ]),
  },
  product: {
    findMany: tracked('product', 'findMany', async () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: `p-${i + 1}`,
        sku: `SKU-${i + 1}`,
        name: `SP ${i + 1}`,
        baseUnitName: 'cái',
        minStockLevel: '10.0000',
        averageCost: '100.0000',
      })),
    ),
  },
  stockBalance: {
    findMany: tracked('stockBalance', 'findMany', async () =>
      Array.from({ length: 80 }, (_, i) => ({
        productId: `p-${(i % 50) + 1}`,
        warehouseId: `wh-${(i % 20) + 1}`,
        batchId: i % 3 === 0 ? `b-${i}` : null,
        onhandQty: '12.0000',
      })),
    ),
  },
  stockReservation: {
    findMany: tracked('stockReservation', 'findMany', async () => []),
    updateMany: tracked('stockReservation', 'updateMany', async () => ({ count: 0 })),
  },
  batch: {
    findMany: tracked('batch', 'findMany', async () => []),
  },
  $queryRaw: tracked('$queryRaw', 'queryRaw', async (query: { strings?: string[] }) => {
    const sql = query.strings?.join('') ?? '';
    if (sql.includes('inventory-metrics')) {
      return [
        {
          skuCount: 8,
          totalOnhandQty: '960',
          totalReservedQty: '0',
          totalAvailableQty: '960',
          estimatedStockValue: '96000',
          lowStockCount: 0,
          expiryAlertCount: 0,
          activeReservationCount: 0,
          qtyByUnit: [],
        },
      ];
    }
    if (sql.includes('overview-top-products')) {
      return [];
    }
    if (sql.includes('overview-completed-movement')) {
      return [
        {
          facet: 'unit',
          kind: 'receipt',
          warehouseId: 'wh-1',
          baseUnitName: 'cái',
          qty: '1000.0000',
          day: null,
        },
        {
          facet: 'unit',
          kind: 'issue',
          warehouseId: 'wh-1',
          baseUnitName: 'cái',
          qty: '500.0000',
          day: null,
        },
      ];
    }
    return [];
  }),
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/redis-list-cache', () => ({
  listCache: mockCache,
}));

function summarize(log: QueryLog[]) {
  const byKey = new Map<string, number>();
  for (const entry of log) {
    const key = `${entry.model}.${entry.method}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  return {
    total: log.length,
    byKey: Object.fromEntries([...byKey.entries()].sort((a, b) => b[1] - a[1])),
  };
}

describe('organization overview query budget', () => {
  beforeEach(() => {
    queryLog.length = 0;
    queryLatencyMs = 0;
    vi.clearAllMocks();
    mockCache.get.mockResolvedValue(null);
  });

  it('counts queries for admin with 20 warehouses', async () => {
    const { organizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const ctx = organizationOverviewService.buildContext('tenant-1', 'admin-1', 'admin', 'all');
    await organizationOverviewService.getOverview(ctx, {});

    const stats = summarize(queryLog);
    expect(stats.total).toBe(9);
    expect(stats.byKey['stockReservation.updateMany'] ?? 0).toBe(0);
    expect(stats.byKey['product.findMany'] ?? 0).toBe(0);
    expect(stats.byKey['stockReceiptDetail.groupBy'] ?? 0).toBe(0);
    expect(stats.byKey['stockIssueDetail.groupBy'] ?? 0).toBe(0);
    expect(stats.byKey['stockReceipt.groupBy']).toBe(1);
    expect(stats.byKey['stockIssue.groupBy']).toBe(1);
    expect(stats.byKey['stockReservation.findMany'] ?? 0).toBe(0);
    console.log('\n[admin / 20 warehouses] query count =', stats.total);
    console.log(JSON.stringify(stats.byKey, null, 2));
  });

  it('counts queries for warehouse_keeper (own documents)', async () => {
    const { organizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const ctx = organizationOverviewService.buildContext(
      'tenant-1',
      'keeper-1',
      'warehouse_keeper',
      ['wh-1', 'wh-2'],
    );
    await organizationOverviewService.getOverview(ctx, {});

    const stats = summarize(queryLog);
    console.log('\n[warehouse_keeper / 2 warehouses] query count =', stats.total);
    console.log(JSON.stringify(stats.byKey, null, 2));
    expect(stats.total).toBe(8);
    expect(stats.byKey['stockReservation.updateMany'] ?? 0).toBe(0);
    expect(stats.byKey['stockReceiptDetail.groupBy'] ?? 0).toBe(0);
    expect(stats.byKey['stockIssueDetail.groupBy'] ?? 0).toBe(0);
  });

  it('date range does not add a second details scan for daily movement', async () => {
    const { organizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const ctx = organizationOverviewService.buildContext('tenant-1', 'admin-1', 'admin', 'all');
    await organizationOverviewService.getOverview(ctx, {
      from: '2026-06-30T17:00:00.000Z',
      to: '2026-07-31T16:59:59.999Z',
    });

    const stats = summarize(queryLog);
    expect(stats.byKey['stockReceiptDetail.groupBy'] ?? 0).toBe(0);
    expect(stats.byKey['stockIssueDetail.groupBy'] ?? 0).toBe(0);
    expect(stats.byKey['$queryRaw.queryRaw']).toBeLessThanOrEqual(3);
    expect(stats.total).toBe(9);
  });

  it('query count scales linearly with warehouse count (admin inventory+breakdown)', async () => {
    const { OrganizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const counts: Array<{ warehouses: number; queries: number; elapsedMs: number }> = [];

    for (const warehouseCount of [1, 5, 10, 20]) {
      queryLog.length = 0;
      mockPrisma.warehouse.findMany = tracked(
        'warehouse',
        'findMany',
        async () => makeWarehouses(warehouseCount),
      );
      const service = new OrganizationOverviewService(mockPrisma as never, mockCache);
      const ctx = service.buildContext('tenant-1', 'admin-1', 'admin', 'all');
      const started = performance.now();
      await service.getOverview(ctx, {});
      counts.push({
        warehouses: warehouseCount,
        queries: queryLog.length,
        elapsedMs: Math.round(performance.now() - started),
      });
    }

    console.log('\n[scale] ', counts);
    const delta = counts[3].queries - counts[0].queries;
    const perWarehouse = delta / 19;
    console.log(`[scale] extra queries per additional warehouse ≈ ${perWarehouse.toFixed(2)}`);
    expect(counts[3].queries).toBeLessThan(30);
    expect(perWarehouse).toBeLessThan(1);
  });

  it('estimates wall time with 5ms DB RTT per query', async () => {
    queryLatencyMs = 5;
    mockPrisma.warehouse.findMany = tracked(
      'warehouse',
      'findMany',
      async () => makeWarehouses(10),
    );
    const { OrganizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const service = new OrganizationOverviewService(mockPrisma as never, mockCache);
    const ctx = service.buildContext('tenant-1', 'admin-1', 'admin', 'all');
    const started = performance.now();
    await service.getOverview(ctx, {});
    const elapsedMs = Math.round(performance.now() - started);
    console.log(
      `\n[10 warehouses, 5ms RTT] queries=${queryLog.length} wall=${elapsedMs}ms`,
    );
    expect(queryLog.length).toBeLessThan(30);
  });

  it('cache hit avoids all DB queries', async () => {
    mockCache.get.mockResolvedValueOnce({ cached: true });
    const { organizationOverviewService } = await import(
      '../../src/modules/report/organization-overview.service'
    );
    const ctx = organizationOverviewService.buildContext('tenant-1', 'admin-1', 'admin', 'all');
    const started = performance.now();
    const data = await organizationOverviewService.getOverview(ctx, {});
    const elapsedMs = performance.now() - started;
    expect(data).toEqual({ cached: true });
    expect(queryLog.length).toBe(0);
    console.log(`\n[cache hit] queries=0 wall=${elapsedMs.toFixed(2)}ms`);
  });
});
