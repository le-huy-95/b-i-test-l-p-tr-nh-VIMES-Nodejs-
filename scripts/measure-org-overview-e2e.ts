import dotenv from 'dotenv';
import { prisma, closeDatabase } from '../src/infra/prisma';
import { connectRedis, closeRedis } from '../src/infra/redis';
import { listCache } from '../src/infra/redis-list-cache';
import { OrganizationOverviewService } from '../src/modules/report/organization-overview.service';
import type { TenantRole } from '../src/infra/prisma-types';

dotenv.config();

interface QueryStat {
  model: string;
  operation: string;
  ms: number;
}

async function timeOnce(
  label: string,
  tenantId: string,
  userId: string,
  role: TenantRole,
  warehouseIds: string[] | 'all',
) {
  const queries: QueryStat[] = [];
  const tracked = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const started = performance.now();
          const result = await query(args);
          queries.push({
            model: String(model),
            operation,
            ms: performance.now() - started,
          });
          return result;
        },
      },
    },
  });

  const service = new OrganizationOverviewService(tracked as never, listCache);
  const ctx = service.buildContext(tenantId, userId, role, warehouseIds);
  const started = performance.now();
  const data = await service.getOverview(ctx, {});
  const wallMs = performance.now() - started;

  const byKey = new Map<string, { n: number; ms: number }>();
  for (const q of queries) {
    const key = `${q.model}.${q.operation}`;
    const cur = byKey.get(key) ?? { n: 0, ms: 0 };
    cur.n += 1;
    cur.ms += q.ms;
    byKey.set(key, cur);
  }

  const top = [...byKey.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 12)
    .map(([key, v]) => ({
      key,
      n: v.n,
      totalMs: Number(v.ms.toFixed(2)),
      avgMs: Number((v.ms / v.n).toFixed(2)),
    }));

  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        wallMs: Number(wallMs.toFixed(2)),
        queryCount: queries.length,
        visibilityScope: (data as { visibilityScope: string }).visibilityScope,
        warehouseCount: (data as { organization: { warehouseCount: number } }).organization
          .warehouseCount,
        topQueries: top,
      },
      null,
      2,
    ),
  );
  return wallMs;
}

async function main() {
  await connectRedis().catch((err) => {
    console.warn('Redis unavailable, cache tests skipped:', err.message);
  });

  const tenant = await prisma.tenant.findFirst({
    where: { code: 'DEMO' },
    select: { id: true },
  });
  if (!tenant) {
    throw new Error('DEMO tenant not found');
  }

  const membership = await prisma.userTenant.findFirst({
    where: { tenantId: tenant.id },
    select: { userId: true, role: true, isActive: true },
  });
  const anyMembership = membership
    ?? (await prisma.userTenant.findFirst({
      select: { userId: true, role: true, tenantId: true },
    }));
  if (!anyMembership) {
    throw new Error('No user_tenant row found');
  }

  const tenantId = 'tenantId' in anyMembership && anyMembership.tenantId
    ? anyMembership.tenantId
    : tenant.id;
  const userId = anyMembership.userId;
  const role = anyMembership.role;

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId, isActive: true },
    select: { id: true },
  });

  console.log(
    `tenant=${tenantId} user=${userId} role=${role} warehouses=${warehouses.length}`,
  );

  await listCache.invalidatePattern(`report:organization-overview:${tenantId}:`);
  await timeOnce('admin cache-miss #1', tenantId, userId, 'admin', 'all');

  await listCache.invalidatePattern(`report:organization-overview:${tenantId}:`);
  await timeOnce('admin cache-miss #2 (warm DB)', tenantId, userId, 'admin', 'all');
  await timeOnce('admin cache-hit', tenantId, userId, 'admin', 'all');

  await listCache.invalidatePattern(`report:organization-overview:${tenantId}:`);
  await timeOnce(
    'warehouse_keeper cache-miss',
    tenantId,
    userId,
    'warehouse_keeper',
    warehouses.map((w) => w.id),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => {});
    await closeDatabase().catch(() => {});
  });
