# Design: Warehouse Manager Role & Warehouse Data Scoping

> Brainstorm chốt: 2026-08-14  
> Repo: `test-y-Backend`  
> Liên quan: `docs/superpowers/specs/2026-08-14-inventory-backend-design.md`

## Goal

1. Bổ sung role **`warehouse_manager`** (quản lý kho) — lớp giữa admin và thủ kho.
2. **Enforce phạm vi dữ liệu theo kho được gán** (`UserWarehouse`) — hiện middleware đã load `warehouseIds` nhưng service chưa dùng.
3. Bổ sung API quản lý nhân sự theo kho (list user, gán kho, me/warehouses).

## Decisions (đã chốt)

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Enforce scope bằng **helper tập trung** (`warehouse-scope.ts`), không Prisma extension | Ít magic, khớp Express hiện tại, dễ test |
| 2 | Thêm enum `warehouse_manager` | Gần WMS thực tế (Manager vận hành, không quản user toàn tenant) |
| 3 | **`accountant` / `approver` thấy mọi kho** trong tenant (Option A) | Duyệt phiếu đa kho; khớp Oracle/NetSuite; ít đổi logic |
| 4 | Master data (product/supplier/customer) **tenant-wide** | Chỉ admin CRUD; role khác read-only |
| 5 | User non-admin **không gán kho** → write `403`, list read → `[]` | Tránh lộ cấu trúc + chặn thao tác sai |
| 6 | `warehouse_manager` **không duyệt phiếu** (MVP) | Segregation of duties: vận hành ≠ duyệt |
| 7 | Triển khai 3 phase: enforce → role → user APIs | Fix security trước, feature sau |

---

## Architecture

### Tenant context (đã có, mở rộng semantics)

```ts
interface TenantContext {
  id: string;
  role: TenantRole;
  warehouseIds: string[] | 'all';
}
```

**Quy tắc resolve scope:**

| Role | `warehouseIds` |
|---|---|
| `admin` | `'all'` |
| `accountant`, `approver` | `'all'` (read + approve cross-warehouse) |
| `warehouse_manager`, `warehouse_keeper`, `viewer` | `string[]` từ `UserWarehouse` |

> Thay đổi so với hiện tại: `accountant`/`approver` cũng nhận `'all'` thay vì chỉ dựa `UserWarehouse`.

### Module `src/utils/warehouse-scope.ts`

```ts
export type WarehouseScope =
  | { mode: 'all' }
  | { mode: 'restricted'; ids: string[] };

export function scopeFromTenant(tenant: TenantContext): WarehouseScope;

/** Prisma where fragment: { warehouseId: ... } hoặc { warehouseId: { in: [...] } } */
export function buildWarehouseWhere(
  scope: WarehouseScope,
  field?: string,
): Record<string, unknown>;

/** Throw AppError WAREHOUSE_ACCESS_DENIED nếu warehouseId không thuộc scope */
export function assertWarehouseAccess(scope: WarehouseScope, warehouseId: string): void;

/** Cho list/report: merge query ?warehouseId= với scope */
export function resolveWarehouseFilter(
  scope: WarehouseScope,
  queryWarehouseId?: string,
): { warehouseId?: string; warehouseIdIn?: string[] };

/** Non-admin, ids rỗng → throw WAREHOUSE_NOT_ASSIGNED trước write */
export function assertHasWarehouseAssignment(scope: WarehouseScope): void;
```

### Luồng request

```
Client → auth → tenantMiddleware (load role + warehouseIds)
       → route (requireRoles)
       → controller (pass req.tenant)
       → service (scopeFromTenant → assert/buildWhere)
       → Prisma
```

---

## Role matrix

| Hành vi | admin | warehouse_manager | warehouse_keeper | accountant / approver | viewer |
|---|---|---|---|---|---|
| Tạo/sửa kho | ✅ all | ✅ assigned only | ❌ | ❌ | ❌ |
| Xem kho | ✅ all | ✅ assigned | ✅ assigned | ✅ all | ✅ assigned |
| CRUD product/supplier/customer | ✅ | ❌ read | ❌ read | ❌ read | ✅ read |
| Tạo/submit phiếu nhập/xuất | ✅ | ✅ assigned | ✅ assigned | ❌ | ❌ |
| Duyệt/từ chối/hoàn tất phiếu | ✅ | ❌ | ❌ | ✅ all | ❌ |
| Hủy phiếu (cancel) | ✅ | ✅ assigned | ✅ assigned | ❌ | ❌ |
| Tồn đầu kỳ — tạo | ✅ | ✅ assigned | ❌ | ❌ | ❌ |
| Tồn đầu kỳ — post | ✅ | ❌ | ❌ | ✅ | ❌ |
| Báo cáo tồn/biến động | ✅ all | ✅ assigned | ✅ assigned | ✅ all | ✅ assigned |
| Mời / tạo user tenant | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gán user ↔ kho | ✅ all kho | ✅ chỉ kho mình quản | ❌ | ❌ | ❌ |
| Sửa role tenant | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Data scoping by module

### Nhóm A — Bắt buộc filter theo kho

| Module | List | Get | Create/Update | Ghi chú |
|---|---|---|---|---|
| `warehouse` | `buildWarehouseWhere` | `assertWarehouseAccess` | POST/PUT: admin hoặc WM + assert | |
| `stock-opening` | filter | assert | create: admin/WM; post: admin/accountant/approver | |
| `stock-receipt` | filter | assert | body.warehouseId assert; workflow giữ nguyên | |
| `stock-issue` | filter | assert | tương tự receipt | |
| `report` | `resolveWarehouseFilter` | — | — | Không query → IN scope |
| `stock-balance` (writer) | — | assert trước mutate | — | Internal service |

### Nhóm B — Tenant-wide (không scope kho)

- `product`, `supplier`, `customer` — filter chỉ `tenantId`.
- Non-admin: GET allowed; POST/PUT/DELETE → `requireRoles('admin')` (giữ nguyên).

### Nhóm C — User / assignment (API mới)

Xem mục API below.

---

## Schema changes

### 1. Enum `TenantRole`

```prisma
enum TenantRole {
  admin
  warehouse_manager   // NEW
  warehouse_keeper
  accountant
  approver
  viewer
}
```

Migration: thêm giá trị enum (PostgreSQL `ALTER TYPE ... ADD VALUE`).

### 2. Invitation (Phase 3, optional)

```prisma
model Invitation {
  // existing fields...
  warehouseIds Json? @map("warehouse_ids")  // string[] | null
}
```

Khi accept: tạo `UserWarehouse` records nếu `warehouseIds` có giá trị.

### 3. Không đổi `UserWarehouse`

Giữ `@@unique([userId, warehouseId])`.

---

## Middleware changes

### `tenant.ts` — `loadPermissions`

```ts
warehouseIds:
  membership.role === 'admin'
  || membership.role === 'accountant'
  || membership.role === 'approver'
    ? 'all'
    : warehouses.map(w => w.warehouseId),
```

Invalidate cache khi:
- PATCH user warehouses
- Accept invite (có warehouseIds)
- createInternalUser
- Deactivate user tenant

---

## New & updated APIs

### Existing route updates

| Method | Path | Roles (cập nhật) |
|---|---|---|
| POST | `/warehouses` | admin, **warehouse_manager** |
| PUT | `/warehouses/:id` | admin, **warehouse_manager** |
| POST | `/stock-opening` | admin, **warehouse_manager** |
| POST | `/stock-receipts` | admin, warehouse_manager, warehouse_keeper |
| POST | `/stock-issues` | admin, warehouse_manager, warehouse_keeper |
| POST | `/*/cancel` | admin, warehouse_manager, warehouse_keeper |

### New endpoints

```
GET  /api/v1/auth/me/warehouses
     Auth: Bearer (+ optional X-Tenant-Id)
     Response: warehouses trong scope (admin/accountant/approver → all active)

GET  /api/v1/tenants/current/users
     Auth: Bearer + X-Tenant-Id
     Role: admin | warehouse_manager
     Query: ?warehouseId= (optional)
     - admin: all users in tenant
     - WM: users có ≥1 UserWarehouse overlap với scope WM

GET  /api/v1/tenants/current/users/:userId
     Role: admin | warehouse_manager (WM chỉ user overlap)

PATCH /api/v1/tenants/current/users/:userId
     Role: admin | warehouse_manager
     Body: { warehouseIds?: string[], isActive?: boolean }
     - admin: full patch (+ role nếu cần mở rộng sau)
     - WM: chỉ warehouseIds, và chỉ được gán kho ∈ scope WM
     - WM không đổi role, không deactivate admin

PUT  /api/v1/tenants/current/users/:userId/warehouses
     Body: { warehouseIds: string[] }  // replace set
     Same rules as PATCH warehouseIds
```

### Invite update (Phase 3)

```
POST /tenants/current/invitations
Body thêm: warehouseIds?: string[]  // admin only
```

---

## Error codes

| Code | HTTP | Khi nào |
|---|---|---|
| `WAREHOUSE_ACCESS_DENIED` | 403 | Truy cập/ghi kho ngoài scope |
| `WAREHOUSE_NOT_ASSIGNED` | 403 | Non-admin/keeper/viewer/WM không có kho nào, thao tác write |
| `LAST_ADMIN_REQUIRED` | 409 | Demote/deactivate admin cuối |
| `FORBIDDEN` | 403 | Role không đủ (giữ nguyên) |

---

## Edge cases

| Case | Behavior |
|---|---|
| Keeper tạo phiếu `warehouseId` ngoài scope | 403 `WAREHOUSE_ACCESS_DENIED` |
| WM gán user vào kho C (WM không quản C) | 403 |
| WM sửa `warehouseIds` của chính mình | 403 — chỉ admin |
| Admin gỡ hết kho của WM | Lần request sau: scope `[]`, write blocked |
| Accountant duyệt phiếu kho B dù không gán kho B | ✅ Allowed (Option A) |
| Report không truyền `warehouseId` | restricted → `{ in: assignedIds }`; all → no filter |
| Report truyền `warehouseId` ngoài scope | 403 |
| Transfer liên kho (GĐ3 tương lai) | Cần quyền cả kho nguồn và đích |

---

## Implementation phases

### Phase 1 — Enforce warehouse scoping (security)

**Files:**
- `src/utils/warehouse-scope.ts` (+ tests)
- Update `src/middlewares/tenant.ts` (accountant/approver → `'all'`)
- Update services: warehouse, stock-receipt, stock-issue, stock-opening, report, stock-balance
- Pass `TenantContext` từ controllers → services

**Acceptance:**
- User keeper kho A không list/get phiếu kho B
- Report auto-filter theo scope
- accountant thấy all kho
- User 0 kho: list `[]`, write 403

### Phase 2 — `warehouse_manager` role

- Prisma migration enum
- Update `requireRoles` on routes per matrix
- Update `docs/API.md`
- Integration tests role matrix

### Phase 3 — User & warehouse assignment APIs

- `tenant` module: list/get/patch users, assign warehouses
- `GET /auth/me/warehouses`
- Invitation `warehouseIds` (optional)
- Cache invalidation on all assignment changes

---

## Testing

### Unit (`warehouse-scope.test.ts`)

- `scopeFromTenant` per role
- `buildWarehouseWhere` all vs restricted vs empty
- `resolveWarehouseFilter` with/without query param
- `assertWarehouseAccess` throw/ok

### Integration

- Seed: tenant, 2 warehouses, userA (WH1), userB (WH2), accountant
- userA GET receipts → chỉ WH1
- userA POST receipt WH2 → 403
- accountant GET receipts → both
- accountant approve WH2 receipt → 200
- WM create warehouse → 403 (chưa role) / 200 after Phase 2 with assignment

---

## Out of scope

- Custom roles / granular permissions UI
- `warehouse_manager` duyệt phiếu
- Cross-warehouse transfer rules (GĐ3)
- Frontend implementation

---

## Next

Sau khi user duyệt spec → `writing-plans` → `docs/superpowers/plans/2026-08-14-warehouse-manager-and-scope.md`
