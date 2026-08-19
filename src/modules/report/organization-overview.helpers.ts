import type { TenantRole } from '../../infra/prisma-types';

export const FULL_ACCESS_ROLES: TenantRole[] = ['admin', 'accountant'];

export type VisibilityScope = 'organization' | 'own_documents';

export function resolveVisibilityScope(role: TenantRole): VisibilityScope {
  return FULL_ACCESS_ROLES.includes(role) ? 'organization' : 'own_documents';
}

export interface OrganizationOverviewContext {
  tenantId: string;
  userId: string;
  role: TenantRole;
  warehouseIds: string[] | 'all';
  visibilityScope: VisibilityScope;
}

export function buildWarehouseScopeFilter(warehouseIds: string[] | 'all') {
  if (warehouseIds === 'all') return {};
  return { warehouseId: { in: warehouseIds } };
}

export function buildDocumentScopeFilter(
  visibilityScope: VisibilityScope,
  userId: string,
) {
  if (visibilityScope === 'organization') return {};
  return {
    OR: [{ createdById: userId }, { approvedById: userId }],
  };
}

export function buildDateRangeFilter(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

export function buildCompletedDateRangeFilter(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return {
    completedAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

export interface TopProductRow {
  productId: string;
  sku: string;
  name: string;
  baseUnitName: string;
  totalQty: string;
  documentCount: number;
}

export interface DocStatusBlock {
  byStatus: Record<string, number>;
  total: number;
  pendingApproval: number;
  draft: number;
  completed: number;
}

export function toDocStatusBlock(
  rows: Array<{ status: string; _count: { _all: number } }>,
): DocStatusBlock {
  const byStatus: Record<string, number> = {
    draft: 0,
    pending_approval: 0,
    approved: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    byStatus[row.status] = row._count._all;
  }
  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  return {
    byStatus,
    total,
    pendingApproval: byStatus.pending_approval ?? 0,
    draft: byStatus.draft ?? 0,
    completed: byStatus.completed ?? 0,
  };
}

export interface DailyMovementRow {
  date: string;
  importedQty: string;
  exportedQty: string;
}

export function buildDailyMovementSeries(
  from: Date,
  to: Date,
  importedByDay: Map<string, string>,
  exportedByDay: Map<string, string>,
): DailyMovementRow[] {
  const rows: DailyMovementRow[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    rows.push({
      date: key,
      importedQty: importedByDay.get(key) ?? '0.0000',
      exportedQty: exportedByDay.get(key) ?? '0.0000',
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows;
}
