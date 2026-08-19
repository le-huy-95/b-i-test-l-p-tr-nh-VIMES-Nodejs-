# Warehouse Manager & Warehouse Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce dữ liệu theo kho được gán, thêm role `warehouse_manager`, và API quản lý user ↔ kho.

**Architecture:** Helper tập trung `warehouse-scope.ts` nhận `TenantContext`; controllers truyền `req.tenant` xuống services; Prisma where fragments từ helper. Accountant/approver scope `'all'`. Triển khai 3 phase: security enforce → role enum → user APIs.

**Tech Stack:** Express, TypeScript, Prisma, PostgreSQL, Zod, Vitest, Redis (permission cache)

**Design ref:** `docs/superpowers/specs/2026-08-14-warehouse-manager-and-scope-design.md`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/utils/warehouse-scope.ts` | Create | Scope helpers |
| `tests/utils/warehouse-scope.test.ts` | Create | Unit tests scope |
| `src/middlewares/tenant.ts` | Modify | accountant/approver → `'all'`; type includes `warehouse_manager` |
| `src/types/express.d.ts` | Modify | (no change if TenantRole from prisma) |
| `src/modules/warehouse/*.ts` | Modify | Pass tenant, filter/assert |
| `src/modules/stock-receipt/*.ts` | Modify | Pass tenant, filter/assert |
| `src/modules/stock-issue/*.ts` | Modify | Pass tenant, filter/assert |
| `src/modules/stock-opening/*.ts` | Modify | Pass tenant, filter/assert |
| `src/modules/report/*.ts` | Modify | Pass tenant, resolveWarehouseFilter |
| `src/modules/stock-balance/stock-balance.service.ts` | Modify | assert in applyIncrease/Decrease callers or export assert helper usage |
| `prisma/schema.prisma` | Modify | Add `warehouse_manager` to enum |
| `src/dto/tenant.dto.ts` | Modify | invite + patch user schemas |
| `src/modules/tenant/*` | Modify | list/get/patch users, assign warehouses |
| `src/modules/auth/auth.service.ts` | Modify | `meWarehouses` |
| `src/modules/auth/auth.controller.ts` | Modify | handler |
| `src/modules/auth/auth.routes.ts` | Modify | `GET /me/warehouses` |
| `docs/API.md` | Modify | Document new role + endpoints |
| `tests/modules/warehouse-scope.integration.test.ts` | Create | Optional integration via mocked prisma |

---

## Phase 1 — Enforce warehouse scoping (security)

### Task 1: `warehouse-scope` utility + unit tests

**Files:**
- Create: `src/utils/warehouse-scope.ts`
- Create: `tests/utils/warehouse-scope.test.ts`
- Modify: `src/types/express.d.ts` (export `TenantContext` type for reuse)

- [ ] **Step 1: Write failing tests**

Create `tests/utils/warehouse-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/app-error';
import {
  assertHasWarehouseAssignment,
  assertWarehouseAccess,
  buildWarehouseWhere,
  resolveWarehouseFilter,
  scopeFromTenant,
} from '../../src/utils/warehouse-scope';
import type { TenantContext } from '../../src/types/express.d';

const restrictedTenant = (ids: string[]): TenantContext => ({
  id: 't1',
  role: 'warehouse_keeper',
  warehouseIds: ids,
});

const allTenant = (): TenantContext => ({
  id: 't1',
  role: 'accountant',
  warehouseIds: 'all',
});

describe('warehouse-scope', () => {
  it('scopeFromTenant maps admin to all', () => {
    expect(scopeFromTenant({ id: 't1', role: 'admin', warehouseIds: 'all' })).toEqual({
      mode: 'all',
    });
  });

  it('buildWarehouseWhere all returns empty fragment', () => {
    expect(buildWarehouseWhere({ mode: 'all' })).toEqual({});
  });

  it('buildWarehouseWhere restricted returns in filter', () => {
    expect(buildWarehouseWhere({ mode: 'restricted', ids: ['w1', 'w2'] })).toEqual({
      warehouseId: { in: ['w1', 'w2'] },
    });
  });

  it('buildWarehouseWhere restricted empty returns impossible filter', () => {
    expect(buildWarehouseWhere({ mode: 'restricted', ids: [] })).toEqual({
      warehouseId: { in: [] },
    });
  });

  it('assertWarehouseAccess denies out of scope', () => {
    expect(() =>
      assertWarehouseAccess({ mode: 'restricted', ids: ['w1'] }, 'w2'),
    ).toThrow(AppError);
    try {
      assertWarehouseAccess({ mode: 'restricted', ids: ['w1'] }, 'w2');
    } catch (e) {
      expect((e as AppError).code).toBe('WAREHOUSE_ACCESS_DENIED');
    }
  });

  it('resolveWarehouseFilter merges query with restricted scope', () => {
    expect(
      resolveWarehouseFilter({ mode: 'restricted', ids: ['w1', 'w2'] }, 'w1'),
    ).toEqual({ warehouseId: 'w1' });
  });

  it('resolveWarehouseFilter rejects query outside scope', () => {
    expect(() =>
      resolveWarehouseFilter({ mode: 'restricted', ids: ['w1'] }, 'w9'),
    ).toThrow(AppError);
  });

  it('assertHasWarehouseAssignment throws when empty restricted', () => {
    expect(() =>
      assertHasWarehouseAssignment(scopeFromTenant(restrictedTenant([]))),
    ).toThrow(AppError);
  });

  it('assertHasWarehouseAssignment passes for all mode', () => {
    expect(() => assertHasWarehouseAssignment(scopeFromTenant(allTenant()))).not.toThrow();
  });
});
```

Export type from `src/types/express.d.ts`:

```ts
export interface TenantContext {
  id: string;
  role: TenantRole;
  warehouseIds: string[] | 'all';
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/utils/warehouse-scope.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `warehouse-scope.ts`**

Create `src/utils/warehouse-scope.ts`:

```ts
import { AppError } from './app-error';
import type { TenantContext } from '../types/express.d';

export type WarehouseScope =
  | { mode: 'all' }
  | { mode: 'restricted'; ids: string[] };

const ALL_ROLES: TenantContext['role'][] = ['admin', 'accountant', 'approver'];

export function scopeFromTenant(tenant: TenantContext): WarehouseScope {
  if (tenant.warehouseIds === 'all' || ALL_ROLES.includes(tenant.role)) {
    return { mode: 'all' };
  }
  return { mode: 'restricted', ids: tenant.warehouseIds };
}

export function buildWarehouseWhere(
  scope: WarehouseScope,
  field = 'warehouseId',
): Record<string, unknown> {
  if (scope.mode === 'all') return {};
  if (scope.ids.length === 0) return { [field]: { in: [] } };
  return { [field]: { in: scope.ids } };
}

export function assertWarehouseAccess(scope: WarehouseScope, warehouseId: string): void {
  if (scope.mode === 'all') return;
  if (!scope.ids.includes(warehouseId)) {
    throw new AppError('WAREHOUSE_ACCESS_DENIED', 403, 'Warehouse not in assigned scope');
  }
}

export function assertHasWarehouseAssignment(scope: WarehouseScope): void {
  if (scope.mode === 'all') return;
  if (scope.ids.length === 0) {
    throw new AppError('WAREHOUSE_NOT_ASSIGNED', 403, 'No warehouse assigned to user');
  }
}

export function resolveWarehouseFilter(
  scope: WarehouseScope,
  queryWarehouseId?: string,
): { warehouseId?: string; warehouseIdIn?: string[] } {
  if (queryWarehouseId) {
    assertWarehouseAccess(scope, queryWarehouseId);
    return { warehouseId: queryWarehouseId };
  }
  if (scope.mode === 'all') return {};
  if (scope.ids.length === 0) return { warehouseIdIn: [] };
  return { warehouseIdIn: scope.ids };
}

/** Build Prisma `where.warehouseId` clause from resolveWarehouseFilter result */
export function toPrismaWarehouseClause(
  filter: ReturnType<typeof resolveWarehouseFilter>,
): Record<string, unknown> {
  if (filter.warehouseId) return { warehouseId: filter.warehouseId };
  if (filter.warehouseIdIn) return { warehouseId: { in: filter.warehouseIdIn } };
  return {};
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/utils/warehouse-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/warehouse-scope.ts src/types/express.d.ts tests/utils/warehouse-scope.test.ts
git commit -m "feat: add warehouse scope helpers for tenant data isolation"
```

---

### Task 2: Update `tenantMiddleware` — accountant/approver → `'all'`

**Files:**
- Modify: `src/middlewares/tenant.ts`

- [ ] **Step 1: Update `loadPermissions` warehouseIds logic**

Replace lines 52-57 with:

```ts
  const hasAllWarehouseAccess =
    membership.role === 'admin' ||
    membership.role === 'accountant' ||
    membership.role === 'approver';

  const payload: CachedPermissions = {
    role: membership.role,
    warehouseIds: hasAllWarehouseAccess
      ? 'all'
      : warehouses.map((w: { warehouseId: string }) => w.warehouseId),
    emailVerified,
    phoneVerified,
    tenantStatus: tenant.status,
  };
```

Update local type at top to include `warehouse_manager`:

```ts
type TenantRole = 'admin' | 'warehouse_manager' | 'warehouse_keeper' | 'accountant' | 'approver' | 'viewer';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (enum may warn until Task 6 migration — OK for now if using string union)

- [ ] **Step 3: Commit**

```bash
git add src/middlewares/tenant.ts
git commit -m "fix: grant all-warehouse scope to accountant and approver roles"
```

---

### Task 3: Warehouse module scoping

**Files:**
- Modify: `src/modules/warehouse/warehouse.service.ts`
- Modify: `src/modules/warehouse/warehouse.controller.ts`

- [ ] **Step 1: Update service signatures**

`warehouse.service.ts`:

```ts
import type { TenantContext } from '../../types/express.d';
import {
  assertHasWarehouseAssignment,
  assertWarehouseAccess,
  buildWarehouseWhere,
  scopeFromTenant,
} from '../../utils/warehouse-scope';

export class WarehouseService {
  async list(tenant: TenantContext) {
    const scope = scopeFromTenant(tenant);
    return prisma.warehouse.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
        ...buildWarehouseWhere(scope),
      },
      orderBy: { code: 'asc' },
    });
  }

  async create(tenant: TenantContext, input: unknown) {
    assertHasWarehouseAssignment(scopeFromTenant(tenant));
    const data = warehouseSchema.parse(input);
    // admin-only route for now; Phase 2 adds WM
    try {
      return await prisma.warehouse.create({
        data: {
          tenantId: tenant.id,
          code: data.code,
          name: data.name,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
          geoSource: data.latitude != null ? 'manual' : undefined,
          geocodeStatus: data.latitude != null ? 'success' : 'not_applicable',
        },
      });
    } catch {
      throw new AppError('DUPLICATE_CODE', 409, 'Warehouse code exists');
    }
  }

  async get(tenant: TenantContext, id: string) {
    const wh = await prisma.warehouse.findFirst({ where: { id, tenantId: tenant.id } });
    if (!wh) throw new AppError('NOT_FOUND', 404, 'Warehouse not found');
    assertWarehouseAccess(scopeFromTenant(tenant), wh.id);
    return wh;
  }

  async update(tenant: TenantContext, id: string, input: unknown) {
    await this.get(tenant, id);
    const data = warehouseSchema.partial().parse(input);
    return prisma.warehouse.update({
      where: { id },
      data: {
        ...data,
        geoSource: data.latitude != null ? 'manual' : undefined,
      },
    });
  }
}
```

- [ ] **Step 2: Update controller**

```ts
  list = async (req: Request, res: Response) => {
    const data = await warehouseService.list(req.tenant!);
    res.json({ success: true, data });
  };
  // create/get/update: pass req.tenant! instead of req.tenant!.id
```

- [ ] **Step 3: Run typecheck + existing tests**

Run: `npm run typecheck && npm test`
Expected: PASS (fix any broken tests)

- [ ] **Step 4: Commit**

```bash
git add src/modules/warehouse/
git commit -m "feat: filter warehouse APIs by assigned warehouse scope"
```

---

### Task 4: Stock receipt & issue scoping

**Files:**
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.controller.ts`
- Modify: `src/modules/stock-issue/stock-issue.service.ts`
- Modify: `src/modules/stock-issue/stock-issue.controller.ts`

- [ ] **Step 1: Add private helper in each service**

```ts
import type { TenantContext } from '../../types/express.d';
import {
  assertHasWarehouseAssignment,
  assertWarehouseAccess,
  buildWarehouseWhere,
  scopeFromTenant,
} from '../../utils/warehouse-scope';

// In StockReceiptService:
  private scopedGet(tenant: TenantContext, id: string) {
    return this.get(tenant, id); // get checks assert after fetch
  }

  async list(tenant: TenantContext) {
    const scope = scopeFromTenant(tenant);
    return prisma.stockReceipt.findMany({
      where: { tenantId: tenant.id, ...buildWarehouseWhere(scope) },
      include: { details: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenant: TenantContext, id: string) {
    const doc = await prisma.stockReceipt.findFirst({
      where: { id, tenantId: tenant.id },
      include: { details: true, supplier: true, warehouse: true },
    });
    if (!doc) throw new AppError('NOT_FOUND', 404, 'Receipt not found');
    assertWarehouseAccess(scopeFromTenant(tenant), doc.warehouseId);
    return doc;
  }

  async create(tenant: TenantContext, userId: string, input: unknown) {
    assertHasWarehouseAssignment(scopeFromTenant(tenant));
    const data = createStockReceiptSchema.parse(input);
    assertWarehouseAccess(scopeFromTenant(tenant), data.warehouseId);
    // ... rest unchanged, use tenant.id
  }
```

- [ ] **Step 2: Update all methods using `tenantId` string → `tenant: TenantContext`**

Methods: `submit`, `approve`, `reject`, `complete`, `cancel`, `cloneFromRejected`, private `transition` — change signature to `(tenant: TenantContext, ...)` and call `this.get(tenant, id)`.

- [ ] **Step 3: Mirror same pattern in `stock-issue.service.ts`**

- [ ] **Step 4: Update both controllers** — pass `req.tenant!`

- [ ] **Step 5: Fix unit/lifecycle tests** — replace `'tenant-1'` string args with mock tenant object:

```ts
const tenant = { id: 'tenant-1', role: 'admin' as const, warehouseIds: 'all' as const };
```

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/modules/stock-receipt tests/modules/stock-issue`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/stock-receipt/ src/modules/stock-issue/ tests/modules/
git commit -m "feat: enforce warehouse scope on stock receipt and issue APIs"
```

---

### Task 5: Stock opening + report scoping

**Files:**
- Modify: `src/modules/stock-opening/stock-opening.service.ts`
- Modify: `src/modules/stock-opening/stock-opening.controller.ts`
- Modify: `src/modules/report/report.service.ts`
- Modify: `src/modules/report/report.controller.ts`

- [ ] **Step 1: stock-opening** — same pattern: `list`, `create`, `post`, `get` use `TenantContext` + assert on `warehouseId`

- [ ] **Step 2: report.service.ts**

```ts
import type { TenantContext } from '../../types/express.d';
import {
  resolveWarehouseFilter,
  scopeFromTenant,
  toPrismaWarehouseClause,
} from '../../utils/warehouse-scope';

  async stockBalance(tenant: TenantContext, query: unknown) {
    const { warehouseId } = stockBalanceQuerySchema.parse(query);
    const filter = resolveWarehouseFilter(scopeFromTenant(tenant), warehouseId);
    return prisma.stockBalance.findMany({
      where: {
        tenantId: tenant.id,
        ...toPrismaWarehouseClause(filter),
      },
      // include unchanged
    });
  }
```

Apply same to `stockMovement`.

- [ ] **Step 3: Update controllers + fix tests**

- [ ] **Step 4: Commit**

```bash
git add src/modules/stock-opening/ src/modules/report/
git commit -m "feat: scope stock opening and reports by warehouse assignment"
```

---

### Task 6: Phase 1 verify

- [ ] Run: `npm run typecheck && npm test`
- [ ] Manual smoke: keeper with WH1 only → GET `/warehouses` returns WH1; GET receipt WH2 → 404/403
- [ ] Commit if any test fixes remain

---

## Phase 2 — `warehouse_manager` role

### Task 7: Prisma enum migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enum value**

```prisma
enum TenantRole {
  admin
  warehouse_manager
  warehouse_keeper
  accountant
  approver
  viewer
}
```

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name add_warehouse_manager_role`
Then: `npm run db:generate`

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add warehouse_manager tenant role"
```

---

### Task 8: Route permission updates

**Files:**
- Modify: `src/modules/warehouse/warehouse.routes.ts`
- Modify: `src/modules/stock-opening/stock-opening.routes.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.routes.ts`
- Modify: `src/modules/stock-issue/stock-issue.routes.ts`

- [ ] **Step 1: warehouse.routes.ts**

```ts
router.post('/', requireRoles('admin', 'warehouse_manager'), asyncHandler(warehouseController.create));
router.put('/:id', requireRoles('admin', 'warehouse_manager'), asyncHandler(warehouseController.update));
```

- [ ] **Step 2: stock-opening.routes.ts**

```ts
router.post('/', requireRoles('admin', 'warehouse_manager'), asyncHandler(stockOpeningController.create));
```

- [ ] **Step 3: stock-receipt/issue routes** — add `'warehouse_manager'` alongside `'warehouse_keeper'` on create/submit/cancel/clone

- [ ] **Step 4: warehouse.service create/update** — WM must assert access to target warehouse on update; on create WM gets new warehouse auto-assigned via Task 10 helper (or admin assigns manually in Phase 3). **MVP:** after WM creates warehouse, auto-create `UserWarehouse` row linking creator to new warehouse.

Add to `warehouse.service.ts` `create`:

```ts
    const wh = await prisma.warehouse.create({ ... });
    if (tenant.role === 'warehouse_manager') {
      await prisma.userWarehouse.create({
        data: {
          userId: /* pass userId from controller */,
          tenantId: tenant.id,
          warehouseId: wh.id,
        },
      });
      await invalidateUserPermissionCache(userId, tenant.id);
    }
    return wh;
```

Update `create(tenant, userId, input)` signature.

- [ ] **Step 5: Update docs/API.md** — TenantRole table + permission matrix rows

- [ ] **Step 6: Commit**

```bash
git add src/modules/ docs/API.md
git commit -m "feat: add warehouse_manager role permissions on warehouse and stock routes"
```

---

## Phase 3 — User & warehouse assignment APIs

### Task 9: DTOs for user management

**Files:**
- Modify: `src/dto/tenant.dto.ts`

- [ ] **Step 1: Add schemas**

```ts
export const listTenantUsersQuerySchema = z.object({
  warehouseId: z.string().optional(),
});

export const patchTenantUserSchema = z.object({
  warehouseIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  role: tenantRoleSchema.optional(),
});

export const replaceUserWarehousesSchema = z.object({
  warehouseIds: z.array(z.string()),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: tenantRoleSchema.default('viewer'),
  warehouseIds: z.array(z.string()).optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/dto/tenant.dto.ts
git commit -m "feat: add DTOs for tenant user warehouse assignment"
```

---

### Task 10: Tenant user management service

**Files:**
- Modify: `src/modules/tenant/tenant.service.ts`
- Create: `src/modules/tenant/tenant-user.service.ts` (optional split if tenant.service grows)

- [ ] **Step 1: Implement `listUsers(tenant, query)`**

```ts
async listUsers(tenant: TenantContext, query: unknown) {
  const { warehouseId } = listTenantUsersQuerySchema.parse(query);
  const scope = scopeFromTenant(tenant);

  if (tenant.role === 'warehouse_manager') {
    assertHasWarehouseAssignment(scope);
    if (warehouseId) assertWarehouseAccess(scope, warehouseId);
  }

  const warehouseFilter = warehouseId
    ? { warehouseId }
    : tenant.role === 'admin'
      ? undefined
      : { warehouseId: { in: scope.mode === 'all' ? undefined : scope.ids } };

  const memberships = await prisma.userTenant.findMany({
    where: { tenantId: tenant.id, isActive: true },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          warehouses: {
            where: { tenantId: tenant.id },
            select: { warehouseId: true, warehouse: { select: { id: true, code: true, name: true } } },
          },
        },
      },
    },
  });

  let rows = memberships.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    phone: m.user.phone,
    name: m.user.name,
    role: m.role,
    warehouses: m.user.warehouses.map((w) => w.warehouse),
  }));

  if (warehouseFilter?.warehouseId) {
    const wid = typeof warehouseFilter.warehouseId === 'string'
      ? warehouseFilter.warehouseId
      : undefined;
    if (wid) {
      rows = rows.filter((r) => r.warehouses.some((w) => w.id === wid));
    }
  } else if (tenant.role === 'warehouse_manager' && scope.mode === 'restricted') {
    const allowed = new Set(scope.ids);
    rows = rows.filter((r) => r.warehouses.some((w) => allowed.has(w.id)));
  }

  return rows;
}
```

- [ ] **Step 2: Implement `assignWarehouses(actor, targetUserId, warehouseIds)`**

Rules:
- Actor admin: any warehouse in tenant
- Actor WM: `warehouseIds` ⊆ actor scope; cannot modify self; cannot modify admin users
- Replace all `UserWarehouse` for `(targetUserId, tenantId)` with new set
- Call `invalidateUserPermissionCache(targetUserId, tenantId)`

- [ ] **Step 3: Implement `patchUser(actor, targetUserId, body)`**

- admin: may patch role, isActive, warehouseIds
- WM: only warehouseIds (via assignWarehouses logic)
- Prevent deactivating last admin → `LAST_ADMIN_REQUIRED`

- [ ] **Step 4: Update `acceptInvite`** — if `invitation.warehouseIds` JSON array, create UserWarehouse rows

- [ ] **Step 5: Add tests in `tests/modules/tenant.service.test.ts`**

- [ ] **Step 6: Commit**

```bash
git add src/modules/tenant/ tests/modules/tenant.service.test.ts
git commit -m "feat: tenant user list and warehouse assignment service"
```

---

### Task 11: Routes + controller + `me/warehouses`

**Files:**
- Modify: `src/modules/tenant/tenant.routes.ts`
- Modify: `src/modules/tenant/tenant.controller.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.routes.ts`

- [ ] **Step 1: tenant.routes.ts**

```ts
router.get('/users', requireRoles('admin', 'warehouse_manager'), asyncHandler(tenantController.listUsers));
router.get('/users/:userId', requireRoles('admin', 'warehouse_manager'), asyncHandler(tenantController.getUser));
router.patch('/users/:userId', requireRoles('admin', 'warehouse_manager'), asyncHandler(tenantController.patchUser));
router.put('/users/:userId/warehouses', requireRoles('admin', 'warehouse_manager'), asyncHandler(tenantController.replaceWarehouses));
```

- [ ] **Step 2: auth `meWarehouses`**

Requires `X-Tenant-Id`:

```ts
async meWarehouses(userId: string, tenant: TenantContext) {
  const scope = scopeFromTenant(tenant);
  const where = {
    tenantId: tenant.id,
    isActive: true,
    ...buildWarehouseWhere(scope),
  };
  return prisma.warehouse.findMany({
    where,
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}
```

Route: `GET /auth/me/warehouses` with `authMiddleware` + `tenantMiddleware`

- [ ] **Step 3: Update `docs/API.md`** — full endpoint docs + error codes `WAREHOUSE_ACCESS_DENIED`, `WAREHOUSE_NOT_ASSIGNED`, `LAST_ADMIN_REQUIRED`

- [ ] **Step 4: Final verify**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/modules/tenant/ src/modules/auth/ docs/API.md
git commit -m "feat: user warehouse assignment APIs and me/warehouses endpoint"
```

---

## Execution order

Phase 1: Task 1 → 2 → 3 → 4 → 5 → 6  
Phase 2: Task 7 → 8  
Phase 3: Task 9 → 10 → 11  

Mỗi phase ship được độc lập; Phase 1 nên merge trước vì fix security.

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| warehouse-scope helper | Task 1 |
| accountant/approver all scope | Task 2 |
| Enforce warehouse module | Task 3 |
| Enforce receipt/issue | Task 4 |
| Enforce opening/report | Task 5 |
| warehouse_manager enum | Task 7 |
| Route matrix WM | Task 8 |
| User list/patch/assign APIs | Task 10, 11 |
| me/warehouses | Task 11 |
| Invite warehouseIds | Task 10 (acceptInvite) |
| Error codes | Task 1 + Task 10 |
| API docs | Task 8, 11 |

---

## Out of scope (this plan)

- Custom roles UI
- WM approve documents
- Cross-warehouse transfer (GĐ3)
- Frontend
