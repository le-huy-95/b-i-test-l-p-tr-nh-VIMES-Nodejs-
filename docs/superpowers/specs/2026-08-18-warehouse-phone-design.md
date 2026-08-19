# Design: Warehouse phone

> Brainstorming 2026-08-18. User chọn: **tùy chọn**, **chuỗi tự do** (giống Customer), **chỉ CRUD kho** (không overview, không search). Quyền tạo/sửa/xóa kho: **admin + warehouse_keeper**.

## Goal

Thêm số điện thoại liên hệ cho kho. `admin` và `warehouse_keeper` tạo/sửa/xóa kho được (SĐT tùy chọn); list/get trả về `phone`.

## Non-goals

- Hiện `phone` trong `GET /reports/warehouse-overview` (list hoặc detail)
- Tìm kiếm kho theo SĐT (`GET /warehouses?search=`)
- Validate format (min length, E.164, SĐT Việt Nam)
- Unique constraint, OTP, verify phone
- Gán SĐT từ user/thủ kho
- Git commit (chỉ code + test + docs, commit khi user yêu cầu)

## Data model

`Warehouse.phone String?` — nullable, không `@map` (cột `"phone"`, giống Customer).

- Kho hiện có: `NULL` sau migration, không backfill
- Không index, không unique

Migration: `ALTER TABLE "warehouses" ADD COLUMN "phone" TEXT;`

## API

Prefix không đổi: `/api/v1/warehouses`

| Method | `phone` |
|--------|---------|
| `POST /warehouses` | Optional. Omit hoặc `null` → lưu `null`. String → lưu nguyên. |
| `PUT /warehouses/:id` | Optional. Omit → không đổi. String → cập nhật. `null` → xóa (`NULL`). |
| `GET /warehouses` · `GET /warehouses/:id` | Trả `phone: string \| null` trên object Warehouse |

Không đổi path, envelope, cache invalidation (`invalidateMasterData` khi create/update). Controller không đổi — body/query đi thẳng vào service.

## Roles

| Method | Roles |
|--------|--------|
| `GET /warehouses` · `GET /warehouses/:id` | Mọi role trong tenant (không đổi) |
| `POST /warehouses` | `admin`, `warehouse_keeper` |
| `PUT /warehouses/:id` | `admin`, `warehouse_keeper` |
| `DELETE /warehouses/:id` | `admin`, `warehouse_keeper` |

`warehouse.routes.ts`:

```ts
router.post('/', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.create));
router.put('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.update));
router.delete('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.softDelete));
```

Giống pattern phiếu nhập/xuất: thủ kho ghi được bản ghi, admin vẫn làm được. `accountant` / `approver` / `viewer` mutate kho → `403 FORBIDDEN`.

## Validation

Trong `warehouseSchema`:

```ts
phone: z.string().nullish(),
```

- Không `min()`, không regex, không trim/normalize
- Chuỗi rỗng `""` được chấp nhận và lưu nguyên (giống Customer không coerce)
- `warehouseSchema.partial()` cho PUT giữ hành vi omit / string / null ở trên

## Service

`WarehouseService.create` thêm `phone: data.phone` vào `create.data` (cùng chỗ với `address`).

`WarehouseService.update` đã `...data` sau `warehouseSchema.partial().parse` — `phone` đi theo spread, không logic riêng.

`list` / `get` / `softDelete` không đổi. Prisma trả `phone` vì field nằm trên model.

## Tests

File mới: `tests/modules/warehouse.service.test.ts` — mock Prisma + cache, giống `stock-opening.service.test.ts`.

Cases:

1. `create` với `phone` → `warehouse.create` nhận `phone` đó
2. `create` không gửi `phone` → `phone` là `undefined`/`null` trên payload create
3. `update` gửi `phone: null` → `warehouse.update` nhận `phone: null`
4. `update` không gửi `phone` → payload update không chứa `phone` (omit)

Không thêm test overview helpers/`serializeWarehouse`.

## Docs

`docs/API.md` mục Warehouse:

- Example JSON `GET /warehouses` thêm `"phone": "0901234567"`
- Bảng body `POST /warehouses` thêm hàng `phone` | string | ❌
- `POST` / `PUT` / `DELETE /warehouses` **Role:** `admin`, `warehouse_keeper` (thêm mục `DELETE` nếu docs chưa có — soft-delete `isActive: false`)

## Files

| File | Việc |
|------|------|
| `prisma/schema.prisma` | Thêm `phone String?` trên `Warehouse` |
| `prisma/migrations/20260818121500_warehouse_phone/migration.sql` | `ADD COLUMN "phone"` |
| `src/dto/warehouse.dto.ts` | `phone: z.string().nullish()` |
| `src/modules/warehouse/warehouse.routes.ts` | `POST` / `PUT` / `DELETE` → `requireRoles('admin', 'warehouse_keeper')` |
| `src/modules/warehouse/warehouse.service.ts` | Truyền `phone` khi `create` |
| `tests/modules/warehouse.service.test.ts` | Test create/update phone |
| `docs/API.md` | Document field `phone` + role create/update/delete |

Không sửa `warehouse-overview.helpers.ts` / `serializeWarehouse`.
