# Warehouse Phone + Keeper CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional warehouse `phone` on CRUD APIs, and let `admin` plus `warehouse_keeper` create/update/soft-delete warehouses.

**Architecture:** Same master-data pattern as Customer.phone: nullable Prisma column, Zod `nullish` on `warehouseSchema`, pass through `WarehouseService.create` / spread on `update`. Route guards change from `requireRoles('admin')` to `requireRoles('admin', 'warehouse_keeper')` on POST/PUT/DELETE. Do not touch warehouse-overview serialization or list search.

**Tech Stack:** Prisma, Zod, Express, Vitest

**Design ref:** `docs/superpowers/specs/2026-08-18-warehouse-phone-design.md`

**Commits:** Do not `git commit` unless the user asks.

---

## File map

| Path | Action | Responsibility |
|------|--------|----------------|
| `tests/modules/warehouse.service.test.ts` | Create | Create/update `phone` behavior |
| `tests/modules/warehouse.routes.test.ts` | Create | Assert POST/PUT/DELETE allow admin + keeper |
| `prisma/schema.prisma` | Modify | `Warehouse.phone String?` |
| `prisma/migrations/20260818121500_warehouse_phone/migration.sql` | Create | `ADD COLUMN "phone"` |
| `src/dto/warehouse.dto.ts` | Modify | `phone: z.string().nullish()` |
| `src/modules/warehouse/warehouse.service.ts` | Modify | Pass `phone` on create |
| `src/modules/warehouse/warehouse.routes.ts` | Modify | Expand requireRoles |
| `docs/API.md` | Modify | Field + roles + DELETE |

Do not modify `src/modules/report/warehouse-overview.helpers.ts` or `serializeWarehouse`.

---

### Task 1: Failing warehouse service tests for `phone`

**Files:**
- Create: `tests/modules/warehouse.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/warehouse.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockInvalidateMasterData = vi.fn().mockResolvedValue(undefined);

const mockPrisma = {
  warehouse: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockCache = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  invalidatePattern: vi.fn(),
  invalidate: vi.fn(),
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/redis-list-cache', () => ({
  listCache: mockCache,
}));

vi.mock('../../src/infra/cache-invalidation', () => ({
  cacheInvalidationService: { invalidateMasterData: mockInvalidateMasterData },
}));

describe('warehouse service phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateMasterData.mockResolvedValue(undefined);
  });

  it('creates a warehouse with phone', async () => {
    mockPrisma.warehouse.create.mockResolvedValue({ id: 'wh-1', phone: '0901234567' });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.create('tenant-1', {
      code: 'WH01',
      name: 'Kho chính',
      phone: '0901234567',
    });

    expect(mockPrisma.warehouse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          code: 'WH01',
          name: 'Kho chính',
          phone: '0901234567',
        }),
      }),
    );
  });

  it('creates a warehouse without phone', async () => {
    mockPrisma.warehouse.create.mockResolvedValue({ id: 'wh-1', phone: null });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.create('tenant-1', { code: 'WH01', name: 'Kho chính' });

    const payload = mockPrisma.warehouse.create.mock.calls[0][0].data;
    expect(payload.phone).toBeUndefined();
  });

  it('clears phone when update sends null', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1', phone: null });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.update('tenant-1', 'wh-1', { phone: null });

    expect(mockPrisma.warehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: null }),
      }),
    );
  });

  it('omits phone from update when the field is not sent', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', tenantId: 'tenant-1' });
    mockPrisma.warehouse.update.mockResolvedValue({ id: 'wh-1' });

    const { WarehouseService } = await import('../../src/modules/warehouse/warehouse.service');
    const service = new WarehouseService(mockPrisma as never, mockCache);

    await service.update('tenant-1', 'wh-1', { name: 'Kho mới' });

    const payload = mockPrisma.warehouse.update.mock.calls[0][0].data;
    expect(payload.phone).toBeUndefined();
    expect(payload.name).toBe('Kho mới');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/warehouse.service.test.ts`

Expected: FAIL. `creates a warehouse with phone` fails because `create.data` has no `phone` (Zod currently strips unknown keys; service does not pass `phone`). `clears phone when update sends null` fails because `z.string().optional()` rejects `null`.

- [ ] **Step 3: Do not implement yet**

Leave production code unchanged until Task 3.

---

### Task 2: Failing route-role test

**Files:**
- Create: `tests/modules/warehouse.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/warehouse.routes.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROUTES = new URL('../../src/modules/warehouse/warehouse.routes.ts', import.meta.url);

describe('warehouse routes roles', () => {
  it('allows admin and warehouse_keeper to create, update, and delete warehouses', () => {
    const src = readFileSync(ROUTES, 'utf8');
    const allowed = "requireRoles('admin', 'warehouse_keeper')";
    expect(src).toContain(`router.post('/', ${allowed}`);
    expect(src).toContain(`router.put('/:id', ${allowed}`);
    expect(src).toContain(`router.delete('/:id', ${allowed}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/modules/warehouse.routes.test.ts`

Expected: FAIL — current file uses `requireRoles('admin')` on POST/PUT/DELETE.

---

### Task 3: Schema + DTO + service (make phone tests pass)

**Files:**
- Modify: `prisma/schema.prisma` (Warehouse model, after `address`)
- Create: `prisma/migrations/20260818121500_warehouse_phone/migration.sql`
- Modify: `src/dto/warehouse.dto.ts`
- Modify: `src/modules/warehouse/warehouse.service.ts`

- [ ] **Step 1: Add Prisma field**

In `prisma/schema.prisma` on `model Warehouse`, after `address`:

```prisma
  address             String?
  phone               String?
  isActive            Boolean       @default(true) @map("is_active")
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260818121500_warehouse_phone/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN "phone" TEXT;
```

- [ ] **Step 3: Generate Prisma client**

Run: `bun run db:generate`

Expected: succeeds; generated Warehouse type includes `phone: string | null`.

- [ ] **Step 4: DTO + create payload**

`src/dto/warehouse.dto.ts`:

```ts
import { z } from 'zod';

export const warehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().nullish(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export type WarehouseDto = z.infer<typeof warehouseSchema>;
export type UpdateWarehouseDto = z.infer<ReturnType<typeof warehouseSchema.partial>>;
```

In `WarehouseService.create`, add `phone: data.phone` next to `address`:

```ts
        data: {
          tenantId,
          code: data.code,
          name: data.name,
          address: data.address,
          phone: data.phone,
          latitude: data.latitude,
          longitude: data.longitude,
          geoSource: data.latitude != null ? 'manual' : undefined,
          geocodeStatus: data.latitude != null ? 'success' : 'not_applicable',
        },
```

Do not change `update` — `...data` already forwards `phone` after `warehouseSchema.partial().parse`.

- [ ] **Step 5: Run phone tests**

Run: `bun run test tests/modules/warehouse.service.test.ts`

Expected: PASS (4 tests). Route test still fails until Task 4.

---

### Task 4: Allow warehouse_keeper on POST/PUT/DELETE

**Files:**
- Modify: `src/modules/warehouse/warehouse.routes.ts`

- [ ] **Step 1: Expand requireRoles**

Replace the three mutating routes:

```ts
router.get('/', asyncHandler(warehouseController.list));
router.post('/', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.create));
router.get('/:id', asyncHandler(warehouseController.get));
router.put('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.update));
router.delete('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.softDelete));
```

Leave GET unchanged (no `requireRoles`).

- [ ] **Step 2: Run route + service tests**

Run: `bun run test tests/modules/warehouse.routes.test.ts tests/modules/warehouse.service.test.ts`

Expected: PASS.

---

### Task 5: API docs

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Warehouse section examples and tables**

In `GET /warehouses` example JSON, add `"phone": "0901234567"` after `"address"`:

```json
      "address": "123 ABC",
      "phone": "0901234567",
      "isActive": true,
```

`POST /warehouses` role line:

```
**Role:** `admin`, `warehouse_keeper`
```

Add `phone` to the POST body table after `address`:

```
| `phone` | string | ❌ |
```

`PUT /warehouses/:id` role line:

```
**Role:** `admin`, `warehouse_keeper`
```

After the PUT section, add:

```
### `DELETE /warehouses/:id`

**Role:** `admin`, `warehouse_keeper`

Soft-delete: `isActive = false`.

**Response 200** — Object `Warehouse` đã xóa mềm

**Lỗi:** `NOT_FOUND` (404)
```

- [ ] **Step 2: Endpoint summary table**

Replace the warehouse rows (~1728–1731) with:

```
| GET | `/warehouses` | Bearer | ✅ | any |
| POST | `/warehouses` | Bearer | ✅ | admin, warehouse_keeper |
| GET | `/warehouses/:id` | Bearer | ✅ | any |
| PUT | `/warehouses/:id` | Bearer | ✅ | admin, warehouse_keeper |
| DELETE | `/warehouses/:id` | Bearer | ✅ | admin, warehouse_keeper |
```

- [ ] **Step 3: Run the new tests once more**

Run: `bun run test tests/modules/warehouse.service.test.ts tests/modules/warehouse.routes.test.ts`

Expected: PASS.

---

## Self-review

- Spec coverage: optional free-string `phone` on CRUD only; create omit → undefined; update `null` clears; overview/search untouched; admin + warehouse_keeper on POST/PUT/DELETE.
- No TBD/placeholder steps.
- Types: field name is `phone` everywhere (schema, DTO, service, API, tests).
