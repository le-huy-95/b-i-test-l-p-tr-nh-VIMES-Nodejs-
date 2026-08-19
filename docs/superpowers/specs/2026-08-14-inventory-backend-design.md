# Design: Inventory Management Backend (SaaS)

> Nguồn nghiệp vụ: `nghiep-vu-quan-ly-ton-kho-spec-v6.md`  
> Quyết định chốt qua brainstorming (2026-08-14)  
> Repo: `test-y-Backend` (refactor modular monolith)

## Goal

Xây backend quản lý tồn kho đầy đủ theo spec v6, multi-tenant SaaS, trên Express + TypeScript + PostgreSQL, phục vụ Flutter; triển khai theo roadmap giai đoạn 1→4 trong cùng codebase.

## Architecture

**Modular monolith** — một Express app, chia module theo domain, một Postgres, Redis + MinIO + BullMQ + SSE.

```
Client (Flutter)
  → /api/v1
  → auth (JWT userId + tokenVersion)
  → tenant (X-Tenant-Id + UserTenant)
  → rbac (Redis permission cache)
  → Zod validate
  → controller → service → repository (Prisma)
  → Postgres | Redis | MinIO | BullMQ | SSE | SMTP(Nodemailer)
```

### Tech stack (đã chốt)

| Thành phần | Lựa chọn |
|---|---|
| Runtime | Node.js ≥ 18, Express, TypeScript |
| ORM | Prisma + PostgreSQL |
| Validation | Zod |
| Auth | JWT mỏng (`userId`, `tokenVersion`) + refresh rotate |
| Tenant | Shared DB + `tenantId`; header `X-Tenant-Id` |
| Cache/Queue (GĐ1) | Redis: permission cache + BullMQ |
| Cache đầy đủ (GĐ3) | Cache-aside + Pub/Sub + Outbox |
| Object storage | MinIO (presigned URL) |
| Realtime | SSE |
| Email | Nodemailer + SMTP — **cấu hình port từ `ktx-be-new`** |
| PDF | BullMQ worker + Puppeteer/pdf-lib |
| Geocode | Google Maps Geocoding API (async job) |
| Tiền/SL | `NUMERIC` + `decimal.js` |

### Cấu trúc thư mục mục tiêu

```
src/
  modules/          # auth, tenant, warehouse, product, customer, supplier,
                    # department, stock-receipt, stock-issue, stock-transfer,
                    # stock-count, stock-opening, stock-ledger, report, ...
  middlewares/      # auth, tenant, rbac, errorHandler, cacheMiddleware
  services/
    cache/          # GĐ1 permission; GĐ3 cache-aside + outbox
    email/          # port kiến trúc từ ktx-be-new (xem mục Email)
  jobs/             # BullMQ workers (pdf, geocode, alerts, reservation, email)
  infra/            # prisma, redis, minio, sse, smtp
  utils/            # numbering, decimal, numberToWords
```

### Triển khai theo giai đoạn

1. **Nền**: Tenant + Auth (register/verify/invite) + RBAC + Prisma + numbering + error contract + Docker (Postgres/Redis/MinIO) + Email SMTP  
2. **GĐ1**: Master data + Opening + Receipt + Issue + Balance/Ledger + Customer + PDF cơ bản + Warehouse coords/geocode  
3. **GĐ2**: Batch/expiry + alerts + StockCount + Reservation + timeout  
4. **GĐ3**: Transfer (+ cancel-in-transit) + Location + Redis cache-aside + Outbox  
5. **GĐ4**: SSE ổn định + báo cáo nâng cao  

**Không làm trong phạm vi này:** Flutter/offline, multi-level approval, LIFO, microservices.

---

## Multi-tenant & Auth

### Tenant isolation

- Bảng `Tenant`: `id`, `code`, `name`, `status` (`active` | `suspended`).
- Mọi bảng nghiệp vụ có `tenantId` + index; mọi query filter theo tenant context.
- `NumberingCounter` PK: `(tenantId, docType, year)`.
- MinIO key prefix: `tenants/{tenantId}/...`.

### User model

- `User` (global): email **hoặc** phone, password hash, `tokenVersion`, `isPlatformAdmin`, `isActive`, cờ verified email/phone.
- `UserTenant`: `(userId, tenantId)`, role trong tenant, UNIQUE `(userId, tenantId)`.
- `UserWarehouse`: kho phụ trách trong tenant.
- Request nghiệp vụ bắt buộc `X-Tenant-Id`; verify membership + tenant active.

### Đăng ký & mời (đã chốt)

1. **Self-register** (`POST /api/v1/auth/register`) bằng email hoặc SĐT + mật khẩu.  
2. **Xác minh bắt buộc từ GĐ1** (OTP/link email hoặc OTP SMS — email theo pipeline SMTP dưới đây). Chưa verify → không tạo tenant / không accept invite / không gọi API nghiệp vụ.  
3. **Tạo tenant** sau khi verified → user thành Admin tenant.  
4. **Admin tenant mời** qua email (`Invitation`) hoặc **tạo user nội bộ** (mật khẩu tạm / bắt đổi lần đầu).  
5. **PlatformAdmin**: tạo/khóa tenant; không làm kho trừ khi có `UserTenant`.

### JWT & RBAC

- Access ~15 phút: chỉ `userId` + `tokenVersion`.  
- Refresh rotate (lưu server-side).  
- Permissions cache key: `cache:user-permissions:{userId}:{tenantId}`.  
- Redis down: fail-closed API ghi; GET fallback DB có rate limit.  
- Roles trong tenant: Admin, WarehouseKeeper, Accountant/Approver, Viewer — **1 cấp duyệt**.

### Auth API (v1)

```
POST /api/v1/auth/register
POST /api/v1/auth/verify-email | verify-phone
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/me
GET  /api/v1/me/tenants
POST /api/v1/tenants
POST /api/v1/tenants/current/invitations
POST /api/v1/tenants/current/invitations/:token/accept
POST /api/v1/tenants/current/users          # tạo user nội bộ
POST /api/v1/platform/tenants
PATCH /api/v1/platform/tenants/:id
```

---

## Email (port từ `ktx-be-new`)

### Nguyên tắc

Bê **nguyên cấu hình SMTP + kiến trúc EmailService** từ `ktx-be-new`, thích ứng sang Express/Prisma (không dùng PayloadCMS).

**Không** copy mật khẩu/SMTP thật từ `.env` của ktx vào git. Chỉ port tên biến, validation, và flow gửi.

### Biến môi trường (giống ktx-be-new)

```env
DEFAULT_FROM_ADDRESS=info@yourdomain.com
DEFAULT_FROM_NAME=InventoryApp

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

# URL FE / deep link invite & verify
APP_PUBLIC_URL=http://localhost:3000
```

Zod env (cùng semantics với `ktx-be-new/src/lib/env.ts`):

- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`: optional  
- `SMTP_PORT`: default `587`  
- `SMTP_SECURE`: `'true' | 'false'`, default `'false'`  
- `DEFAULT_FROM_ADDRESS`: email, default `info@yourdomain.com`  
- `DEFAULT_FROM_NAME`: default tên app  
- Helper `isSmtpConfigured()` = có đủ HOST + USER + PASS  

Transport Nodemailer:

```ts
{
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE === 'true',
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
}
```

Dev: nếu chưa cấu hình SMTP → log rõ / ethereal hoặc skip có cảnh báo (không silent fail production).

### Module `src/services/email/` (cấu trúc như ktx)

```
src/services/email/
  EmailService.class.ts   # generateTemplate + enqueue/send
  instance.ts
  helpers.ts              # getDefaultFromAddress, siteName, normalizeEmailArray...
  template-loader.ts      # Handlebars (.hbs)
  types.ts
  templates/              # otp, email-verify, invite, password-reset, welcome...
  handlers/
    auth/                 # verify, invite, welcome, reset password
    index.ts
  index.ts
```

### Flow gửi (thay Payload hook bằng Prisma + worker)

1. Handler business gọi `emailService.sendEmail(...)`.  
2. Insert `SendEmailLog` status=`pending` (Prisma).  
3. Worker BullMQ (hoặc inline sau create ở GĐ1) gửi qua **Nodemailer** với SMTP ở trên.  
4. Cập nhật log `success` + `sentAt` hoặc `failed` + `error`.  

Bảng `SendEmailLog` (tương đương collection `send-email-logs` của ktx):  
`id`, `userId?`, `from`, `fromName?`, `to` (json), `cc?`, `bcc?`, `replyTo?`, `subject`, `emailType`, `templateName?`, `htmlContent`, `status` (pending|success|failed), `error?`, `metadata?`, `sentAt?`, `createdAt`.

Handlers GĐ1 tối thiểu: verify email OTP/link, tenant invitation, welcome, password reset (nếu có).

---

## Data model (kho)

### Master (`tenantId` trên mọi bảng nghiệp vụ)

- Warehouse (+ lat/lng, `geoSource`, `geocodeStatus`, `useLocationTracking` default false)  
- Location (schema sẵn; enforce GĐ3)  
- Product (`trackBatch`, `trackExpiry`, `costingMethod`: FIFO|FEFO|AVG default AVG; **không** allow negative)  
- ProductUnit (`qtyBaseUnit` = actualQty × conversionRate lúc lưu dòng; không sửa rate nếu đã dùng trên phiếu completed)  
- Supplier, Customer, Department, UserDepartment, Batch  

### Documents

- StockOpeningBalance (+ Detail) — post **1 lần / kho / tenant**  
- StockReceipt / StockIssue / StockTransfer / StockCount (+ Detail với `qtyBaseUnit`)  
- Status 1 cấp: `draft → pending_approval → approved → completed`; `rejected`/`cancelled` terminal  
- Transfer: + `in_transit`, `cancelled_in_transit`  
- Reject → clone-from-rejected  
- DocumentAttachment, DocumentFile (polymorphic)

### Stock

- StockBalance: UNIQUE `(tenantId, productId, warehouseId, batchId, locationId)`; `onhandQty`, `version`  
- StockReservation: theo product+warehouse (**không** batchId); active|released|consumed; `expiresAt`  
- available = SUM(onhand) − SUM(active reservations)  
- StockLedger: append-only; types gồm opening, in, out, transfer_*, adjust, transfer_cancel_return  

### Business rules đã chốt

- Không tồn âm bao giờ.  
- Lô hết hạn: **chặn cứng** khi complete xuất (`BATCH_EXPIRED`).  
- Costing: Strategy FIFO / FEFO / AVG (không LIFO).  
- Concurrency complete: READ COMMITTED + row lock / bulk upsert; sort key trước lock; idempotent FOR UPDATE.  
- Location: GĐ1–2 `locationId=NULL`; GĐ3 bật tracking.  

---

## Core flows

### Reservation (issue)

submit → insert reservation → reject/cancel release → complete chọn lô + trừ onhand + consumed → job timeout release + về draft.

### complete orchestration (SRP)

`*Service.complete` điều phối: BatchService, StockBalanceWriter, StockLedgerService, alerts after COMMIT, enqueue PDF, (GĐ3) Outbox invalidate.

### PDF

Async BullMQ → MinIO → DocumentFile versioning + fileHash idempotent; `/print` trả ready URL hoặc generating.

### Transfer cancel-in-transit

Compensating ledger `transfer_cancel_return` về kho nguồn; không xoá dòng ship.

### Error contract

```json
{
  "success": false,
  "error": {
    "code": "STOCK_INSUFFICIENT",
    "message": "...",
    "details": []
  }
}
```

Codes: `STOCK_INSUFFICIENT`, `BATCH_EXPIRED`, `INVALID_STATUS_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENT_SKIP`, `TRANSFER_NOT_IN_TRANSIT`, `PERMISSION_DENIED_WAREHOUSE`, `PERMISSION_DENIED_TENANT`, `EMAIL_NOT_VERIFIED`, `INVALID_COORDINATES`, ...

---

## API surface (tóm tắt theo giai đoạn)

Xem chi tiết endpoint trong spec v6 mục 3.3 + bổ sung:

- Auth/Tenant/Invite/Platform (mục Auth trên)  
- `/api/v1/warehouses`, `nearby`, products, suppliers, customers, departments  
- stock-receipts / issues / transfers / counts / opening-balances (+ workflow + print/attachments/documents)  
- reports: stock-balance, stock-movement, expiry, low-stock, valuation, stock-card, in-transit  
- SSE: `/api/v1/events` (alerts, pdf ready)

---

## Infra local

Docker Compose: Postgres, Redis, MinIO, API; Mail qua SMTP thật (Gmail app password) như ktx — không bắt buộc Mailhog nếu đã có SMTP_*.

---

## Testing

- Unit: costing strategies, variance, qtyBaseUnit, tenant filter helpers.  
- Integration: race 2 complete issue → không âm; cancel/reject giải phóng reservation; opening 1 lần/kho; **tenant A không đọc data B**; double complete → IDEMPOTENT_SKIP; email log pending→success với SMTP mock.  

---

## Design decisions log

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Phạm vi full C, ship theo roadmap | User chọn plan đầy đủ |
| 2 | Refactor repo hiện tại | Giữ Express scaffold |
| 3 | Prisma + Zod | Type-safe TS |
| 4 | 1 cấp duyệt | Đủ MVP; multi-level ngoài scope |
| 5 | MinIO + SSE | Đã chốt |
| 6 | FIFO+FEFO+AVG, default AVG | Không LIFO (chuẩn VN/IFRS) |
| 7 | Chặn hết hạn; không âm kho | An toàn nghiệp vụ |
| 8 | Redis từ GĐ1 (permission+queue) | JWT mỏng cần cache; PDF/email jobs |
| 9 | Multi-tenant shared DB + X-Tenant-Id | SaaS; user nhiều tenant |
| 10 | Register + invite + verify OTP GĐ1 | Yêu cầu user |
| 11 | Email = port SMTP/Nodemailer từ ktx-be-new | Cùng ops/credentials pattern |

---

## Next

Sau khi user duyệt file này → viết implementation plan tại `docs/superpowers/plans/2026-08-14-inventory-backend.md` (skill writing-plans).
