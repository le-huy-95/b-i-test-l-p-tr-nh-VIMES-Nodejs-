# Design: SOLID pragmatic refactor

> Brainstorming 2026-08-14. User chọn hướng **A — thực dụng**.  
> Không phải hexagonal/repository mọi CRUD, không NestJS/DI container.

## Goal

Chỉnh `src` theo SOLID vừa phải, từng bộ phận: Stock → Auth → Tenant/cache → leftover. Giữ hành vi API và nghiệp vụ kho hiện tại. Test `tests/modules/*` phải xanh sau mỗi bộ phận.

## Non-goals

- Repository / port-adapter cho Product, Customer, Supplier, Warehouse, Report.
- Thuật toán FIFO/FEFO thật (chọn lô, valuation). Chỉ chừa Strategy để sau này thêm class, không sửa posting.
- SMS OTP, đổi URL public, viết lại email module.
- Inversify/tsyringe/NestJS.
- Generic document workflow base class.

## Constraints

- Path và JSON trong `docs/API.md` không đổi: `/auth/tenants`, `/auth/invitations/accept`, `/auth/platform/tenants`, `/auth/platform/tenants/:id` vẫn tồn tại.
- AVG: moving average như `StockReceiptService.complete` hiện tại. Opening vẫn set `product.averageCost` từ unit cost dòng.
- FIFO/FEFO trên **receipt/issue**: không cập nhật `averageCost` (không throw `COSTING_NOT_IMPLEMENTED`). **Opening** luôn set `averageCost` = unit cost dòng, mọi costing method — đúng `stock-opening.service.ts` hiện tại.
- Constructor inject; composition cuối file `export const x = new X(...)`. Không composition-root bắt buộc trừ khi file module cần wiring rõ.

## Architecture

Giữ layered Express:

```
routes → middleware → controller → service → Prisma / Redis / SMTP
```

Thay đổi: class fat tách theo trách nhiệm; chỗ biến đổi (costing, permission cache) đi qua interface; service không import middleware.

Thứ tự ship: **1 Stock → 2 Auth → 3 Tenant/cache → 4 leftover**. Mỗi bước test xanh rồi mới bước sau.

---

## 1. Stock

### Files

```
src/modules/stock-balance/
  stock-balance.service.ts     # onhand, reservation aggregate, versioned increase/decrease
  stock-ledger.service.ts      # createMany ledger
  qty.ts                       # resolveQtyBaseUnit
  costing/
    costing-policy.ts          # CostingPolicy + resolveCostingPolicy(method)
    avg-costing.policy.ts
    lot-costing.policy.ts      # FIFO và FEFO cùng no-op averageCost
  stock-posting.service.ts     # balance + ledger + costing trong trx đang mở
```

`stock-balance.service.ts` hiện chứa 3 thứ; tách ra. Không barrel re-export lâu dài: receipt/issue/opening và test đổi import sang file mới (`qty.ts`, `stock-ledger.service.ts`, `stock-posting.service.ts`). `getAvailable` vẫn từ `stock-balance.service.ts` (issue submit).

### CostingPolicy

```ts
interface CostingPolicy {
  onStockIncrease(input: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    qtyBaseUnit: string;
    unitCost: string;
    trx: Prisma.TransactionClient;
  }): Promise<void>;
}
```

- `AvgCostingPolicy`: copy logic moving average từ `stock-receipt.service.ts` `complete` (onhand before = onhand after − qty vừa tăng; nếu before ≤ 0 thì avg = unitCost).
- `LotCostingPolicy`: `onStockIncrease` no-op. Dùng cho `FIFO` và `FEFO`.
- `resolveCostingPolicy('AVG' | 'FIFO' | 'FEFO')` trả đúng class. Method lạ: throw `AppError('VALIDATION_ERROR', 400, ...)`.
- Opening không dùng `LotCostingPolicy`. `StockPostingService.apply` với `direction: 'opening'` luôn `product.update({ averageCost: unitCost })` cho mọi costing method.

### StockPostingService

Một method public `apply(input, trx)`:

| direction | balance | ledger type | costing |
|---|---|---|---|
| `in` (receipt) | `applyIncrease` | `in` | `resolveCostingPolicy(product.costingMethod).onStockIncrease` |
| `out` (issue) | `applyDecrease` | `out` | không đổi averageCost |
| `opening` | `applyIncrease` | `opening` | set `averageCost` = unitCost mọi product |

Caller đã ở trong `prisma.$transaction`. Posting không mở transaction mới. Ném `AppError` (`STOCK_INSUFFICIENT`, `VERSION_CONFLICT`) từ balance; posting không bọc `Object.assign(new Error())`.

### Document services sau refactor

`StockReceiptService.complete` / `StockIssueService.complete` / `StockOpeningService.post`:

1. `FOR UPDATE` + status + idempotent skip — giữ nguyên.
2. Build `QtyChange[]` (+ unitCost, createdBy, refDoc*).
3. `stockPostingService.apply({ direction, changes, ledger }, trx)`.
4. Issue: reservation `consumed`. Receipt/opening: không reservation.
5. Update document status.

Không còn `product.update({ averageCost })` trong receipt/opening service. Issue `complete` không còn try/catch map error ad-hoc nếu balance đã ném `AppError`.

Reservation create/release vẫn trong issue service (submit/reject/cancel) — chưa tách ReservationService.

### Errors

`StockBalanceService.applyDecrease` ném `AppError` với `code` `STOCK_INSUFFICIENT` | `VERSION_CONFLICT`, `details` chứa `productId` / `available` / `requested` khi insufficient. HTTP status 409. Message tiếng Việt giữ như caller hiện tại (`Không đủ tồn kho`, `Xung đột tồn kho, thử lại`).

### Tests

- Unit `avg-costing.policy`: onhand before > 0 và = 0.
- Unit `lot-costing.policy`: không gọi `product.update`.
- Sửa `stock-balance.service.test.ts`, `stock-receipt*.test.ts`, `stock-issue*.test.ts`, `stock-opening.service.test.ts` theo import/error type mới.
- Lifecycle tests phải xanh không đổi assertion nghiệp vụ.

---

## 2. Auth

### Files

```
src/modules/auth/
  auth.service.ts       # register, login, loginWithGoogle, me
  otp.service.ts        # issueOtp, verifyOtp, resendOtp
  token.service.ts      # issueTokens, refresh, logout
  device.service.ts     # registerDevice, upsertUserDevice, formatDeviceResponse
  auth.controller.ts    # chỉ auth/device
  auth.routes.ts        # path cũ; tenant handlers → tenantController
```

`login` / `loginWithGoogle` gọi `tokenService.issueTokens`. `register` (có email) gọi `otpService.issueOtp` + `sendWelcomeEmail`. Google: vẫn `isFirebaseConfigured` + `verifyGoogleIdToken` từ `config/firebase.ts`. Không thêm GoogleAuth port.

### Controller / routes

`AuthController` xóa: `createTenant`, `acceptInvite`, `platformCreateTenant`, `platformPatchTenant`.

`TenantController` thêm đúng 4 method đó (logic HTTP như auth controller hiện tại).

`src/middlewares/auth.ts`: thêm `requirePlatformAdmin` — nếu `!req.user?.isPlatformAdmin` thì `AppError('FORBIDDEN', 403, 'Platform admin only')`. Gắn trên 2 route platform.

`auth.routes.ts` vẫn:

- `POST /tenants` → `tenantController.createTenant`
- `POST /invitations/accept` → `tenantController.acceptInvite`
- `POST /platform/tenants` → `authMiddleware`, `requirePlatformAdmin`, `tenantController.platformCreateTenant`
- `PATCH /platform/tenants/:id` → tương tự patch

Prefix mount `/auth` không đổi.

### DIP

```ts
export const otpService = new OtpService();
export const tokenService = new TokenService();
export const deviceService = new DeviceService();
export const authService = new AuthService(otpService, tokenService, deviceService);
```

Prisma vẫn import module-level trong từng service (giống pattern hiện tại + constructor cho collaboration). Không bắt buộc inject `prisma` vào mọi constructor ở bước 2 nếu Stock đã làm mẫu cho posting; Auth inject **các service con**, Prisma giữ import `from '../../infra/prisma'` để khỏi viết lại toàn bộ test mock cùng lúc. Test `auth.service.test.ts` mock Prisma + email + firebase như cũ; bổ sung mock service con hoặc test từng file mới.

### Tests

`tests/modules/auth.service.test.ts` và `tenant.service.test.ts` xanh. Route path không cần e2e mới nếu chưa có; không đổi `docs/API.md`.

---

## 3. Tenant / permission cache

### Port

```
src/modules/tenant/permission-cache.ts
src/infra/redis-permission-cache.ts
```

```ts
export interface CachedPermissions {
  role: TenantRole;
  warehouseIds: string[] | 'all';
  emailVerified: boolean;
  phoneVerified: boolean;
  tenantStatus: string;
}

export interface PermissionCache {
  get(userId: string, tenantId: string): Promise<CachedPermissions | null>;
  set(userId: string, tenantId: string, value: CachedPermissions, ttlSeconds?: number): Promise<void>;
  invalidate(userId: string, tenantId: string): Promise<void>;
}
```

Key: `cache:user-permissions:{userId}:{tenantId}`. TTL default 300. Redis null/throw → get trả `null`, set/invalidate nuốt lỗi (như middleware hiện tại).

`RedisPermissionCache` dùng `getRedis()`. Singleton `export const permissionCache = new RedisPermissionCache()`.

### Consumers

- `middlewares/tenant.ts` `loadPermissions`: `permissionCache.get` → miss thì Prisma (membership, user, tenant, warehouses) → verify + `permissionCache.set`. Logic 403 không đổi: `PERMISSION_DENIED_TENANT`, `TENANT_SUSPENDED`, `EMAIL_NOT_VERIFIED`.
- `TenantService.acceptInvite`: `this.cache.invalidate(userId, tenantId)` — **cấm** `import` từ `middlewares/tenant`.
- Xóa `export async function invalidateUserPermissionCache` khỏi middleware; test tenant mock `PermissionCache` (hoặc mock `../../infra/redis-permission-cache`).

`requireRoles` giữ trong middleware. Không tách InviteService.

---

## 4. Leftover

- Xóa `requireVerified` trong `auth.ts` (dead code, không verify).
- Xóa `src/routes/users.routes.ts` (không mount trong `routes/index.ts`).
- `health.routes.ts`: `prisma.$queryRaw` `SELECT NOW(), version()` thay `src/database` pool. Response JSON shape giữ `success` + `data.message` + `data.database` (map cột cho gần output cũ: `current_time`, `pg_version`).
- Xóa `src/database/index.ts` sau khi không còn import.
- Không sửa Product/Customer/Supplier/Warehouse/email.
- Test/src đổi import theo file mới; không re-export giả từ `stock-balance.service.ts`.

---

## Error handling

Một hierarchy: `AppError` + `ZodError` trong `errorHandler`. Stock không ném `Error` gắn `code` bằng `Object.assign`.

## Testing

Sau mỗi bộ phận: `npx vitest run tests/modules` (hoặc script test repo). Thêm unit costing. Không hạ assertion nghiệp vụ.

## Decision log

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Hướng A pragmatic | User chọn; CRUD mỏng không cần repository |
| 2 | FIFO/FEFO no-op, không throw | Giữ hành vi complete hiện tại |
| 3 | Opening luôn set averageCost | Copy đúng `stock-opening.service.ts` |
| 4 | URL auth/tenant không đổi | API.md + client Flutter |
| 5 | Platform admin = middleware | SRP controller |
| 6 | PermissionCache port, Redis impl | DIP; service không import middleware |
| 7 | Auth inject service con, Prisma import thẳng | Tránh rewrite mock quá lớn một lần |
| 8 | Xóa pool `src/database` | Một adapter DB: Prisma |
| 9 | Không DI container | Composition cuối file |

## Out of scope follow-ups

FIFO/FEFO chọn lô, ReservationService, inject Prisma mọi service.
