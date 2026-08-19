# Inventory Backend — API Reference

> Base URL: `/api/v1`  
> Content-Type mặc định: `application/json`  
> Cập nhật: 2026-08-14

---

## Mục lục

1. [Quy ước chung](#quy-ước-chung)
2. [Enums](#enums)
3. [Health](#health)
4. [Auth — Xác thực & tài khoản](#auth--xác-thực--tài-khoản)
5. [Tenant — Quản lý tổ chức](#tenant--quản-lý-tổ-chức)
6. [Files — Upload file dùng chung](#files--upload-file-dùng-chung)
7. [Warehouse — Kho](#warehouse--kho)
8. [Product — Sản phẩm](#product--sản-phẩm)
9. [Supplier — Nhà cung cấp](#supplier--nhà-cung-cấp)
10. [Customer — Khách hàng](#customer--khách-hàng)
11. [Stock Opening — Tồn đầu kỳ](#stock-opening--tồn-đầu-kỳ)
12. [Stock Receipt — Phiếu nhập kho](#stock-receipt--phiếu-nhập-kho)
13. [Stock Issue — Phiếu xuất kho](#stock-issue--phiếu-xuất-kho)
14. [Reports — Báo cáo](#reports--báo-cáo)

> **Hướng dẫn chi tiết API tổng quan kho:** xem [WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md)  
> **Hướng dẫn API tổng quan toàn tổ chức:** xem [ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md)  
> **Hướng dẫn Flutter — số điện thoại kho:** xem [WAREHOUSE_PHONE_FLUTTER.md](./WAREHOUSE_PHONE_FLUTTER.md)  
> **Notification realtime (WebSocket + inbox):** xem [NOTIFICATION_WS.md](./NOTIFICATION_WS.md) — service riêng port 3001

---

## Quy ước chung

### Response thành công

```json
{
  "success": true,
  "data": { ... }
}
```

Một số endpoint trả thêm `message` (ví dụ `register-device`):

```json
{
  "success": true,
  "data": { ... },
  "message": "Device registered"
}
```

### Response lỗi

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mô tả lỗi",
    "details": { ... }
  }
}
```

| HTTP | Code thường gặp | Ý nghĩa |
|------|-----------------|---------|
| 400 | `VALIDATION_ERROR`, `INVALID_LOGO_TYPE`, `LOGO_TOO_LARGE`, `LOGO_REQUIRED` | Dữ liệu request không hợp lệ (Zod) / logo sai định dạng hoặc quá lớn |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | Chưa đăng nhập / sai token / sai mật khẩu |
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `PERMISSION_DENIED_TENANT` | Không đủ quyền / chưa verify / không thuộc tenant |
| 404 | `NOT_FOUND`, `LOGO_NOT_FOUND` | Không tìm thấy tài nguyên / tổ chức chưa có logo |
| 409 | `DUPLICATE_CODE`, `INVALID_STATUS_TRANSITION`, `STOCK_INSUFFICIENT` | Xung đột dữ liệu / trạng thái |
| 500 | `INTERNAL_ERROR` | Lỗi server |

### Xác thực

| Loại API | Headers bắt buộc |
|----------|-------------------|
| Public (register, login, …) | Không cần |
| Cần đăng nhập | `Authorization: Bearer <accessToken>` |
| Nghiệp vụ theo tenant | `Authorization` + `X-Tenant-Id: <tenantId>` |

**Lưu ý:** User phải verify **email hoặc phone** trước khi truy cập API có `X-Tenant-Id`.

### Cơ chế retry idempotent (Idempotency-Key)

Các request **ghi** (`POST`, `PUT`, `PATCH`, `DELETE`) thuộc endpoint có auth (`Bearer` + `X-Tenant-Id`)
có thể bật cơ chế retry không trùng lặp bằng header:

```
Idempotency-Key: <uuid/chuỗi duy nhất do client sinh>
```

**Cách hoạt động:**

1. Client sinh 1 key duy nhất cho **một lần nghiệp vụ** (VD: tạo phiếu nhập kho), gửi kèm header
   `Idempotency-Key` mọi lần thử gọi API đó.
2. Lần đầu: server xử lý bình thường và lưu lại kết quả (HTTP status + response body) theo key,
   mặc định trong **24 giờ** (cấu hình `IDEMPOTENCY_TTL_HOURS`).
3. Lần retry (request timeout, mạng rớt, server trả 5xx…): client gọi lại **cùng key, cùng body**.
4. Server nhận ra key đã tồn tại → **trả lại kết quả cũ**, header `Idempotency-Replayed: true`,
   **không chạy lại** logic nghiệp vụ (không tạo trùng phiếu kho, không trừ tồn 2 lần…).

**Các mã lỗi đặc biệt:**

| HTTP | Code | Ý nghĩa |
|------|------|---------|
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Request cùng key đang được xử lý — chờ và retry sau |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key đã được dùng cho payload khác — sinh key mới |

**Khuyến nghị client:** kết hợp `Idempotency-Key` với retry có backoff (VD dùng
`fetchWithRetry` trong `src/utils/retry.ts`) — retry lên các lỗi network / `408` / `429` / `5xx`,
không retry các lỗi `4xx` khác.

### Vai trò tenant (`TenantRole`)

| Role | Mô tả ngắn |
|------|------------|
| `admin` | Toàn quyền trong tenant, truy cập mọi kho |
| `warehouse_keeper` | Thủ kho — sửa/submit phiếu nhập/xuất |
| `accountant` | Kế toán — duyệt/từ chối/hoàn tất phiếu |
| `approver` | Người duyệt — tương tự accountant |
| `viewer` | Chỉ xem |

> **Tạo phiếu** (xuất/nhập/đầu kỳ): mọi thành viên tenant (`admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer`) đều có thể tạo.

### Trạng thái chứng từ (`DocStatus`)

```
draft → pending_approval → approved → completed
                         ↘ rejected
              ↘ cancelled (từ draft / pending / approved)
```

---

## Enums

| Enum | Giá trị |
|------|---------|
| `TenantStatus` | `active`, `suspended` |
| `TenantRole` | `admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer` |
| `CostingMethod` | `fifo`, `weighted_average`, `specific_identification` |
| `PickingPriority` | `fefo`, `fifo`, `none` |
| `ReceiptType` | `purchase`, `customer_return`, `transfer_in`, `production_output`, `other` |
| `DeviceType` | `ios`, `android`, `web`, `other` |
| `DeviceStatus` | `active`, `inactive`, `deleted` |
| `IssueType` | `sale`, `internal_use`, `return_to_supplier`, `disposal` |
| `LedgerTxnType` | `opening`, `in`, `out`, `transfer_in`, `transfer_out`, `adjust`, `transfer_cancel_return` |

---

## Health

### `GET /health`

Kiểm tra API và kết nối database.

**Auth:** Không cần

**Response 200**

```json
{
  "success": true,
  "data": {
    "message": "API is running",
    "database": {
      "current_time": "2026-08-14T10:00:00.000Z",
      "pg_version": "PostgreSQL 16.x ..."
    }
  }
}
```

**Response 503** — Database không kết nối được.

---

## Auth — Xác thực & tài khoản

Prefix: `/api/v1/auth`

### Luồng đăng nhập & thiết bị (pattern ktx)

```
1. POST /login  → accessToken + refreshToken
2. POST /register-device             → lưu thiết bị (Bearer token)
3. Gọi API nghiệp vụ                 → Bearer + X-Tenant-Id
4. POST /logout                      → revoke token + inactive device
```

---

### `POST /auth/register`

Đăng ký tài khoản mới.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `email` | string | Một trong email/phone | Email hợp lệ |
| `phone` | string | Một trong email/phone | Min 8 ký tự |
| `password` | string | ✅ | Min 6 ký tự |
| `name` | string | ❌ | |

**Response 201**

```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "email": "user@example.com",
    "phone": null,
    "requiresVerification": true
  }
}
```

**Lỗi:** `EMAIL_EXISTS` (409), `PHONE_EXISTS` (409)

> Sau register, hệ thống gửi OTP qua email (nếu có email) và email chào mừng.

---

### `POST /auth/verify-otp`

Xác minh email hoặc số điện thoại bằng OTP 6 số.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `email` | string | Một trong email/phone |
| `phone` | string | Một trong email/phone |
| `code` | string | ✅ — đúng 6 ký tự |

**Response 200**

```json
{
  "success": true,
  "data": { "verified": true }
}
```

**Lỗi:** `NOT_FOUND` (404), `INVALID_OTP` (400)

---

### `POST /auth/resend-otp`

Gửi lại OTP.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `email` | string | Một trong email/phone |
| `phone` | string | Một trong email/phone |

**Response 200**

```json
{
  "success": true,
  "data": {
    "expiresAt": "2026-08-14T10:15:00.000Z"
  }
}
```

---

### `POST /auth/forgot-password`

Yêu cầu đặt lại mật khẩu — gửi OTP 6 số tới email (nếu tài khoản tồn tại và đang active).

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `email` | string | ✅ — email hợp lệ |

**Response 200**

```json
{
  "success": true,
  "data": {
    "message": "Nếu email tồn tại trong hệ thống, mã OTP đã được gửi đến hộp thư của bạn.",
    "expiresAt": "2026-08-17T06:40:00.000Z"
  }
}
```

> `expiresAt` chỉ có khi email tồn tại; response luôn giống nhau để tránh lộ email có/không có trong hệ thống.

**Rate limit:** 5 request / 5 phút

---

### `POST /auth/reset-password`

Xác nhận OTP và đặt mật khẩu mới.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `email` | string | ✅ | Email đã yêu cầu forgot-password |
| `code` | string | ✅ | OTP 6 số |
| `newPassword` | string | ✅ | Min 6 ký tự |

**Response 200**

```json
{
  "success": true,
  "data": { "success": true }
}
```

**Lỗi:** `INVALID_OTP` (400), `USER_INACTIVE` (403)

> Sau reset: `tokenVersion` tăng, refresh token bị revoke — cần đăng nhập lại.

---

### `POST /auth/login`

Đăng nhập email/phone + mật khẩu.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `email` | string | Một trong email/phone |
| `phone` | string | Một trong email/phone |
| `password` | string | ✅ |

**Response 200**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "cuid",
      "email": "user@example.com",
      "phone": null,
      "name": "Nguyen Van A",
      "emailVerified": true,
      "phoneVerified": false,
      "isPlatformAdmin": false
    },
    "tenants": [
      {
        "id": "tenant-id",
        "code": "ACME",
        "name": "Acme Corp",
        "logoUrl": "http://localhost:9000/inventory/tenants/tenant-id/logo.png",
        "role": "admin",
        "status": "active"
      }
    ],
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

**Lỗi:** `INVALID_CREDENTIALS` (401), `USER_INACTIVE` (403)

---

### `POST /auth/register-device`

Đăng ký hoặc cập nhật thiết bị **sau khi login** (pattern ktx).

**Auth:** `Authorization: Bearer <accessToken>`

**Body**

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `deviceId` | string | ✅ | ID duy nhất do client sinh (UUID) |
| `deviceType` | string | ✅ | `ios` \| `android` \| `web` \| `other` |
| `fcmToken` | string | ❌ | Token push notification |
| `deviceModel` | string | ❌ | VD: `iPhone 15`, `Chrome` |
| `osVersion` | string | ❌ | VD: `iOS 17.0` |
| `appVersion` | string | ❌ | VD: `1.0.0` |
| `deviceInfo` | object | ❌ | JSON metadata bổ sung |

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "deviceId": "uuid-device",
    "deviceType": "ios",
    "deviceModel": "iPhone 15",
    "osVersion": "17.0",
    "appVersion": "1.0.0",
    "status": "active",
    "lastLoginAt": "2026-08-14T10:00:00.000Z",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-14T10:00:00.000Z"
  },
  "message": "Device registered"
}
```

> Gọi lại với cùng `deviceId` → cập nhật bản ghi, `message`: `"Device updated"`.

---

### `POST /auth/refresh`

Làm mới access token (rotate refresh token).

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `refreshToken` | string | ✅ |

**Response 200**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

**Lỗi:** `UNAUTHORIZED` (401) — token hết hạn / đã revoke

---

### `POST /auth/logout`

Đăng xuất — revoke refresh token.

**Auth:** Không cần

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `refreshToken` | string | ✅ |
| `deviceId` | string | ❌ — nếu có, đặt thiết bị `inactive` |

**Response 200**

```json
{
  "success": true,
  "data": { "success": true }
}
```

---

### `GET /auth/me`

Lấy thông tin user hiện tại.

**Auth:** Bearer token

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "email": "user@example.com",
    "phone": null,
    "name": "Nguyen Van A",
    "emailVerified": true,
    "phoneVerified": false,
    "isPlatformAdmin": false,
    "tenants": [
      {
        "id": "tenant-id",
        "code": "ACME",
        "name": "Acme Corp",
        "logoUrl": "http://localhost:9000/inventory/tenants/tenant-id/logo.png",
        "role": "admin"
      }
    ]
  }
}
```

---

### `POST /auth/tenants`

User tự tạo tenant mới (trở thành `admin`).

**Auth:** Bearer token  
**Yêu cầu:** Email hoặc phone đã verify

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `code` | string | ✅ — 2–32 ký tự, tự uppercase |
| `name` | string | ✅ — min 2 ký tự |

**Response 201** — Object `Tenant`:

```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "code": "ACME",
    "name": "Acme Corp",
    "logoUrl": null,
    "status": "active",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Lỗi:** `EMAIL_NOT_VERIFIED` (403), `TENANT_CODE_EXISTS` (409)

---

### `POST /auth/invitations/accept`

Chấp nhận lời mời tham gia tenant.

**Auth:** Bearer token  
**Yêu cầu:** Email đã verify, email khớp lời mời

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `token` | string | ✅ — token từ link mời (min 10 ký tự) |

**Response 200**

```json
{
  "success": true,
  "data": {
    "tenantId": "cuid",
    "role": "viewer"
  }
}
```

**Lỗi:** `INVALID_INVITE` (400), `INVITE_EMAIL_MISMATCH` (403)

---

### `POST /auth/platform/tenants`

Platform admin tạo tenant (không gắn user).

**Auth:** Bearer token  
**Yêu cầu:** `isPlatformAdmin = true`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `code` | string | ✅ |
| `name` | string | ✅ |

**Response 201** — Object `Tenant`

**Lỗi:** `FORBIDDEN` (403)

---

### `PATCH /auth/platform/tenants/:id`

Platform admin cập nhật tenant.

**Auth:** Bearer token + `isPlatformAdmin`

**Path:** `id` — tenant ID

**Body** (tất cả optional)

| Field | Type | Giá trị |
|-------|------|---------|
| `status` | string | `active` \| `suspended` |
| `name` | string | |

**Response 200** — Object `Tenant` đã cập nhật

---

## Tenant — Quản lý tổ chức

Prefix: `/api/v1/tenants/current`  
**Auth:** Bearer + `X-Tenant-Id`

> Logo tổ chức lưu trên **MinIO** (S3-compatible). Dev: `npm run docker:redis-minio`.  
> `logoUrl` là URL công khai; `null` nếu chưa upload.

---

### `GET /tenants/current`

Lấy thông tin tổ chức đang chọn (theo header `X-Tenant-Id`).

**Role:** Bất kỳ thành viên active

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "tenant-id",
    "code": "ACME",
    "name": "Acme Corp",
    "logoUrl": "http://localhost:9000/inventory/tenants/tenant-id/logo.png",
    "status": "active",
    "createdAt": "2026-08-14T10:00:00.000Z",
    "updatedAt": "2026-08-17T08:00:00.000Z"
  }
}
```

---

### `POST /tenants/current/logo`

Upload hoặc thay logo tổ chức.

**Role:** `admin`

**Content-Type:** `multipart/form-data`

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `logo` | file | ✅ | JPEG, PNG, WebP, GIF — tối đa 2MB |

**Response 200** — Object `Tenant` đã cập nhật (có `logoUrl` mới)

**Lỗi:** `LOGO_REQUIRED` (400), `INVALID_LOGO_TYPE` (400), `LOGO_TOO_LARGE` (400), `FORBIDDEN` (403)

**cURL:**

```bash
curl -X POST http://localhost:3000/api/v1/tenants/current/logo \
  -H "Authorization: Bearer eyJ..." \
  -H "X-Tenant-Id: tenant-id" \
  -F "logo=@/path/to/logo.png"
```

> Upload logo mới sẽ tự xóa file logo cũ trên MinIO (nếu có).

---

### `DELETE /tenants/current/logo`

Xóa logo tổ chức.

**Role:** `admin`

**Response 200** — Object `Tenant` với `logoUrl: null`

**Lỗi:** `LOGO_NOT_FOUND` (404), `FORBIDDEN` (403)

---

### `POST /tenants/current/invitations`

Mời user vào tenant qua email.

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc | Default |
|-------|------|----------|---------|
| `email` | string | ✅ | |
| `role` | TenantRole | ❌ | `viewer` |

**Response 201**

```json
{
  "success": true,
  "data": {
    "id": "invitation-id",
    "email": "invitee@example.com",
    "role": "warehouse_keeper",
    "inviteLink": "https://app.example.com/invite/accept?token=..."
  }
}
```

---

### `POST /tenants/current/users`

Admin tạo user nội bộ trong tenant.

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc | Default |
|-------|------|----------|---------|
| `email` | string | Một trong email/phone | |
| `phone` | string | Một trong email/phone | |
| `password` | string | ✅ — min 6 | |
| `name` | string | ❌ | |
| `role` | TenantRole | ❌ | `warehouse_keeper` |
| `warehouseIds` | string[] | ❌ | Gán quyền kho cụ thể |

**Response 201**

```json
{
  "success": true,
  "data": {
    "id": "user-id",
    "email": "staff@example.com",
    "phone": null,
    "role": "warehouse_keeper"
  }
}
```

> User nội bộ được auto-verify email/phone tương ứng field được cung cấp.

---

## Files — Upload file dùng chung

Prefix: `/api/v1/files`  
**Auth:** Bearer + `X-Tenant-Id` — mọi role trong tenant đều dùng được.

> File lưu trên **MinIO** (S3-compatible). Metadata (người upload, loại, kích thước…) lưu ở bảng `uploaded_files`.
> Mỗi tenant có namespace riêng dưới key `media/{tenantId}/{kind}/…`.

### Các loại file được phép

| Nhóm | MIME types |
|------|-----------|
| Hình ảnh | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`, `image/avif`, `image/bmp`, `image/tiff`, `image/heic` |
| PDF | `application/pdf` |
| Media (video/audio) | `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`, `video/mpeg`, `video/ogg`, `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/flac`, `audio/mp4`, `audio/x-m4a`, `audio/aac` |

> Giới hạn dung lượng: **25MB/file**. Field multipart bắt buộc là `file` (1 file).

---

### `POST /files`

Upload file mới.

**Content-Type:** `multipart/form-data`

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `file` | file | ✅ | Ảnh / PDF / media — tối đa 25MB |
| `kind` | string | ❌ | Nhãn nhóm file, mặc định `general`. Chỉ gồm chữ/số/dấu `-` `_` (tối đa 64 ký tự). Ví dụ: `avatar`, `product`, `document` |

**Response 201**

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "tenantId": "tenant-id",
    "uploadedById": "user-id",
    "url": "http://localhost:9000/inventory/media/tenant-id/document/xxxx.pdf",
    "originalName": "hoa-don.pdf",
    "mimeType": "application/pdf",
    "size": 102400,
    "kind": "document",
    "createdAt": "2026-08-19T09:00:00.000Z"
  }
}
```

**Lỗi:** `FILE_REQUIRED` (400), `INVALID_FILE_TYPE` (400), `EMPTY_FILE` (400), `FILE_TOO_LARGE` (400), `VALIDATION_ERROR` (400)

**cURL:**

```bash
curl -X POST http://localhost:3000/api/v1/files \
  -H "Authorization: Bearer eyJ..." \
  -H "X-Tenant-Id: tenant-id" \
  -F "file=@/path/to/hoa-don.pdf" \
  -F "kind=document"
```

---

### `PUT /files/:id`

Thay nội dung file đã upload (update). Upload file mới lên cùng bản ghi; file cũ trên MinIO tự bị xóa.

**Role:** người upload hoặc `admin`.

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `file` | file | ✅ | Ảnh / PDF / media — tối đa 25MB |
| `kind` | string | ❌ | Nếu không gửi, giữ nguyên `kind` hiện tại |

**Response 200** — Object file đã cập nhật (cùng cấu trúc như `POST`)

**Lỗi:** `FILE_REQUIRED` (400), `NOT_FOUND` (404), `FORBIDDEN` (403), `INVALID_FILE_TYPE` (400), `FILE_TOO_LARGE` (400)

---

### `GET /files`

Danh sách file của tenant, mới nhất trước. Có thể lọc theo `kind` và phân trang (`page`, `limit`, `search`).

**Query params:** `page` (mặc định 1), `limit` (mặc định 20, tối đa 200), `kind`

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "cm...",
      "tenantId": "tenant-id",
      "uploadedById": "user-id",
      "url": "http://localhost:9000/inventory/media/tenant-id/document/xxxx.pdf",
      "originalName": "hoa-don.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "kind": "document",
      "createdAt": "2026-08-19T09:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

### `GET /files/:id`

Chi tiết một file (trong tenant hiện tại).

**Response 200** — Object file

**Lỗi:** `NOT_FOUND` (404)

---

### `DELETE /files/:id`

Xóa file (xóa cả object trên MinIO và bản ghi metadata).

**Role:** người upload hoặc `admin`.

**Response 200** — `{ "success": true, "data": { "id": "cm..." } }`

**Lỗi:** `NOT_FOUND` (404), `FORBIDDEN` (403)

---

## Warehouse — Kho

Prefix: `/api/v1/warehouses`  
**Auth:** Bearer + `X-Tenant-Id`

---

### `GET /warehouses`

Danh sách kho đang active.

**Response 200** — Mảng `Warehouse`:

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "code": "WH01",
      "name": "Kho chính",
      "address": "123 ABC",
      "phone": "0901234567",
      "isActive": true,
      "latitude": "10.8231000",
      "longitude": "106.6297000",
      "geoSource": "manual",
      "geocodeStatus": "success",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### `POST /warehouses`

**Role:** `admin`, `warehouse_keeper`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `code` | string | ✅ |
| `name` | string | ✅ |
| `address` | string | ❌ |
| `phone` | string | ❌ |
| `latitude` | number | ❌ — -90 đến 90 |
| `longitude` | number | ❌ — -180 đến 180 |

**Response 201** — Object `Warehouse`

**Lỗi:** `DUPLICATE_CODE` (409)

---

### `GET /warehouses/:id`

**Response 200** — Object `Warehouse`

**Lỗi:** `NOT_FOUND` (404)

---

### `PUT /warehouses/:id`

**Role:** `admin`, `warehouse_keeper`  
**Body:** Các field của `POST` (partial — gửi field cần sửa)

**Response 200** — Object `Warehouse` đã cập nhật

---

### `DELETE /warehouses/:id`

**Role:** `admin`, `warehouse_keeper`

Soft-delete: `isActive = false`.

**Response 200** — Object `Warehouse` đã xóa mềm

**Lỗi:** `NOT_FOUND` (404)

---

### `PATCH /warehouses/:id/deactivate`

**Role:** `admin`, `warehouse_keeper`

Ngừng hoạt động kho: `isActive = false`. Tương đương `DELETE` nhưng rõ ràng hơn về ngữ nghĩa.

**Body:** Không cần

**Response 200** — Object `Warehouse` với `isActive: false`

**Lỗi:** `NOT_FOUND` (404)

---

### `PATCH /warehouses/:id/activate`

**Role:** `admin`, `warehouse_keeper`

Khôi phục kho đang inactive về active: `isActive = true`.

**Body:** Không cần

**Response 200** — Object `Warehouse` đã kích hoạt lại

**Lỗi:** `NOT_FOUND` (404)

---

## Product — Sản phẩm

Prefix: `/api/v1/products`  
**Auth:** Bearer + `X-Tenant-Id`

---

### `GET /products`

**Response 200** — Mảng `Product` kèm `units[]`:

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "sku": "SP001",
      "barcode": "893...",
      "name": "Sản phẩm A",
      "baseUnitName": "cái",
      "minStockLevel": "0.0000",
      "maxStockLevel": null,
      "reorderPoint": null,
      "averageCost": "0.0000",
      "isActive": true,
      "units": [
        {
          "id": "...",
          "productId": "...",
          "unitName": "cái",
          "conversionRate": "1.000000"
        }
      ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### `POST /products`

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc | Default |
|-------|------|----------|---------|
| `sku` | string | ✅ | |
| `barcode` | string | ❌ | |
| `name` | string | ✅ | |
| `baseUnitName` | string | ❌ | `"cái"` |
| `minStockLevel` | number | ❌ | `0` |
| `maxStockLevel` | number | ❌ | `null` |
| `reorderPoint` | number | ❌ | `null` |
| `averageCost` | number | ❌ | `0` |
| `units` | array | ❌ | Tự tạo unit base nếu không gửi |
| `units[].unitName` | string | ✅ (nếu có units) | |
| `units[].conversionRate` | number | ✅ (nếu có units) | > 0 |

**Response 201** — Object `Product` + `units`

**Lỗi:** `DUPLICATE_SKU` (409), `VALIDATION_ERROR` (400)

---

### `GET /products/:id/availability`

Tồn onhand / reserved / available theo kho và lô. Frontend chỉ cần hiển thị `batchNo`/`expiryDate` nếu có.

---

### `GET /products/:id`

**Response 200** — Object `Product` + `units`

---

### `PUT /products/:id`

**Role:** `admin`  
**Body:** Partial các field của `POST /products` (không cập nhật `units` qua endpoint này)

**Response 200** — Object `Product` + `units`

---

### `DELETE /products/:id`

Soft delete — đặt `isActive = false`.

**Role:** `admin`

**Response 200** — Object `Product` với `isActive: false`

---


## Supplier — Nhà cung cấp

Prefix: `/api/v1/suppliers`  
**Auth:** Bearer + `X-Tenant-Id`

---

### `GET /suppliers`

**Response 200** — Mảng `Supplier`

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "code": "NCC01",
      "name": "Công ty ABC",
      "taxCode": "0123456789",
      "contact": "0901234567",
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### `POST /suppliers`

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `code` | string | ✅ |
| `name` | string | ✅ |
| `taxCode` | string | ❌ |
| `contact` | string | ❌ |

**Response 201** — Object `Supplier`

---

### `GET /suppliers/:id` · `PUT /suppliers/:id`

Giống pattern Warehouse. PUT yêu cầu role `admin`.

---

## Customer — Khách hàng

Prefix: `/api/v1/customers`  
**Auth:** Bearer + `X-Tenant-Id`

---

### `GET /customers`

**Response 200** — Mảng `Customer`

---

### `POST /customers`

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `code` | string | ✅ |
| `name` | string | ✅ |
| `phone` | string | ❌ |
| `email` | string | ❌ — email hợp lệ |

**Response 201** — Object `Customer`

---

### `GET /customers/:id` · `PUT /customers/:id`

Giống pattern Supplier.

---

## Stock Opening — Tồn đầu kỳ

Prefix: `/api/v1/stock-opening-balances`  
**Auth:** Bearer + `X-Tenant-Id`

Mỗi kho chỉ được **post** tồn đầu kỳ **một lần**, và chỉ post được **trước** mọi giao dịch kho khác.

---

### `GET /stock-opening-balances`

**Response 200** — Mảng `StockOpeningBalance` + `details[]`

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "code": "OB-2026-0001",
      "effectiveDate": "2026-01-01T00:00:00.000Z",
      "warehouseId": "...",
      "status": "draft",
      "note": "Tồn đầu kỳ",
      "createdById": "...",
      "approvedById": null,
      "postedAt": null,
      "details": [
        {
          "id": "...",
          "openingBalanceId": "...",
          "productId": "...",
          "qtyBaseUnit": "100.0000",
          "unitCost": "50000.0000"
        }
      ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### `POST /stock-opening-balances`

**Role:** `admin`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `warehouseId` | string | ✅ |
| `effectiveDate` | string | ✅ — ISO date |
| `note` | string | ❌ |
| `lines` | array | ✅ — min 1 dòng |
| `lines[].productId` | string | ✅ |
| `lines[].qty` | number | ✅ — > 0 |
| `lines[].unitCost` | number | ✅ — >= 0 |
| `lines[].batchNo` | string | ❌ | Tùy chọn, dùng khi muốn gắn lô vào dòng tồn đầu kỳ |
| `lines[].expiryDate` | string | ❌ — ISO date |

**Response 201** — Object `StockOpeningBalance` + `details`

**Lỗi:** `OPENING_EXISTS` (409) — kho đã có tồn đầu đã post

---

### `POST /stock-opening-balances/:id/post`

Ghi sổ tồn đầu kỳ (cập nhật tồn kho + ledger).

**Role:** `admin`, `accountant`, `approver`

**Body:** Không cần

**Response 200** — Object `StockOpeningBalance` với `status: "completed"`, `postedAt` có giá trị

**Lỗi:** `OPENING_EXISTS` (409), `OPENING_TOO_LATE` (409), `IDEMPOTENT_SKIP` (200) — đã post rồi

---

## Stock Receipt — Phiếu nhập kho

Prefix: `/api/v1/stock-receipts`  
**Auth:** Bearer + `X-Tenant-Id`

### Workflow

```
draft → submit → pending_approval → approve → approved → complete → completed
                                  ↘ reject → rejected → clone-from-rejected → draft mới
              ↘ cancel (draft/pending/approved)
```

| Action | Endpoint | Role |
|--------|----------|------|
| Tạo | `POST /` | mọi thành viên tổ chức |
| Sửa nháp | `PUT /:id` | admin, warehouse_keeper |
| Submit | `POST /:id/submit` | admin, warehouse_keeper |
| Duyệt | `POST /:id/approve` | admin, accountant, approver |
| Từ chối | `POST /:id/reject` | admin, accountant, approver |
| Hoàn tất | `POST /:id/complete` | admin, accountant, approver |
| Hủy | `POST /:id/cancel` | admin, warehouse_keeper |
| Clone | `POST /:id/clone-from-rejected` | admin, warehouse_keeper |

---

### `GET /stock-receipts`

**Response 200** — Mảng `StockReceipt` + `details[]`

---

### `POST /stock-receipts`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `warehouseId` | string | ✅ |
| `supplierId` | string | ❌ |
| `receiptType` | ReceiptType | ❌ — mặc định `purchase`. Hiện hỗ trợ `purchase`, `customer_return`, `other`. `transfer_in` / `production_output` bị từ chối cho đến khi có module tương ứng. |
| `receiptDate` | string | ✅ — ISO date |
| `deliveredByName` | string | ❌ |
| `note` | string | ❌ |
| `lines` | array | ✅ — min 1 |
| `lines[].productId` | string | ✅ |
| `lines[].unitName` | string | ✅ |
| `lines[].expectedQty` | number | ✅ — >= 0 |
| `lines[].actualQty` | number | ✅ — > 0 |
| `lines[].unitPrice` | number | ✅ — >= 0 |
| `lines[].batchNo` | string | ❌ | Tùy chọn, dùng khi muốn gắn lô vào dòng nhập |
| `lines[].expiryDate` | string | ❌ — ISO datetime |

**Response 201** — Object `StockReceipt` + `details` (status `draft`, có `code`, `totalAmount`)

---

### `GET /stock-receipts/:id`

**Response 200** — Object `StockReceipt` + `details` + `supplier` + `warehouse`

---

### `PUT /stock-receipts/:id`

Sửa phiếu `draft`. Body giống `POST /stock-receipts` (thay toàn bộ header + dòng hàng).

**Lỗi:** `INVALID_STATUS_TRANSITION` (409) nếu không còn `draft`

---

### `POST /stock-receipts/:id/submit`

Chuyển `draft` → `pending_approval`. **Body:** không cần

---

### `POST /stock-receipts/:id/approve`

Chuyển `pending_approval` → `approved`. **Body:** không cần

---

### `POST /stock-receipts/:id/reject`

Chuyển `pending_approval` → `rejected`.

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `reason` | string | ❌ — default `"Rejected"` |

---

### `POST /stock-receipts/:id/complete`

Chuyển `approved` → `completed`, cập nhật tồn kho. Nếu dòng có `batchNo` thì hệ thống tạo/tái sử dụng `Batch` (kèm `unitCost`) và ghi `StockBalance` theo `batchId`. Nhiều dòng cùng sản phẩm + lô được gộp theo **giá vốn bình quân gia quyền**.

**Lỗi:** `IDEMPOTENT_SKIP` (200) nếu đã complete, `INVALID_STATUS_TRANSITION` (409), `VALIDATION_ERROR` (400) thiếu số lô

---

### `POST /stock-receipts/:id/cancel`

Hủy từ `draft` / `pending_approval` / `approved`.

---

### `POST /stock-receipts/:id/clone-from-rejected`

Tạo phiếu nhập mới từ phiếu `rejected`. Chỉ áp dụng khi status = `rejected`.

**Response 201** — Phiếu mới (status `draft`)

---

## Stock Issue — Phiếu xuất kho

Prefix: `/api/v1/stock-issues`  
**Auth:** Bearer + `X-Tenant-Id`

### Workflow

```
draft → submit → pending_approval (+ giữ chỗ tồn 24h) → approve → approved → complete → completed
                                                    ↘ reject → rejected (release reservation)
              ↘ cancel (draft/pending/approved)
```

| Action | Endpoint | Role |
|--------|----------|------|
| Tạo | `POST /` | admin, warehouse_keeper |
| Sửa nháp | `PUT /:id` | admin, warehouse_keeper |
| Submit | `POST /:id/submit` | admin, warehouse_keeper |
| Duyệt | `POST /:id/approve` | admin, accountant, approver |
| Từ chối | `POST /:id/reject` | admin, accountant, approver |
| Hoàn tất | `POST /:id/complete` | admin, accountant, approver |
| Hủy | `POST /:id/cancel` | admin, warehouse_keeper |

---

### `GET /stock-issues`

**Response 200** — Mảng `StockIssue` + `details[]`

---

### `POST /stock-issues`

**Body**

| Field | Type | Bắt buộc |
|-------|------|----------|
| `warehouseId` | string | ✅ |
| `issueType` | IssueType | ✅ |
| `customerId` | string | ✅ khi `issueType = sale` |
| `issueDate` | string | ✅ — ISO date |
| `note` | string | ❌ |
| `lines` | array | ✅ — min 1 |
| `lines[].productId` | string | ✅ |
| `lines[].unitName` | string | ✅ |
| `lines[].requestedQty` | number | ✅ — > 0 |
| `lines[].actualQty` | number | ✅ — > 0 |
| `lines[].unitPrice` | number | ❌ — >= 0 |
| `lines[].batchId` | string | ❌ — chỉ định lô; nếu bỏ trống hệ thống sẽ phân bổ theo lô còn khả dụng hiện có |

**Response 201** — Object `StockIssue` + `details` (status `draft`)

**Lỗi:** `VALIDATION_ERROR` (400) — thiếu `customerId` khi xuất bán

---

### `GET /stock-issues/:id`

**Response 200** — Object `StockIssue` + `details` + `customer` + `warehouse`

---

### `PUT /stock-issues/:id`

Sửa phiếu `draft`. Body giống `POST /stock-issues`.

---

### `POST /stock-issues/:id/submit`

Kiểm tra tồn khả dụng **theo lô** (khóa `StockBalance` `FOR UPDATE`), phân bổ FEFO/FIFO, tạo `StockReservation` kèm `batchId` (24h), chuyển → `pending_approval`.

**Lỗi:** `STOCK_INSUFFICIENT` (409)

---

### `POST /stock-issues/:id/approve` · `reject` · `complete` · `cancel`

Tương tự Stock Receipt. Reject/complete release hoặc consume reservation. Complete phân bổ lô theo thứ tự tồn khả dụng hiện có, ghi `batchId` vào dòng xuất. Giá vốn xuất lấy theo `product.averageCost` trong giao diện mới này.

**Lỗi complete:** `STOCK_INSUFFICIENT` (409), `EXPIRED_BATCH` (409), `VERSION_CONFLICT` (409)

---

## Reports — Báo cáo

Prefix: `/api/v1/reports`  
**Auth:** Bearer + `X-Tenant-Id`

---

### `GET /reports/stock-balance`

Báo cáo tồn kho hiện tại.

**Query params**

| Param | Type | Bắt buộc |
|-------|------|----------|
| `warehouseId` | string | ❌ — lọc theo kho |

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "productId": "...",
      "warehouseId": "...",
      "onhandQty": "150.0000",
      "version": 3,
      "updatedAt": "...",
      "product": {
        "id": "...",
        "sku": "SP001",
        "name": "Sản phẩm A",
        "baseUnitName": "cái"
      },
      "warehouse": {
        "id": "...",
        "code": "WH01",
        "name": "Kho chính"
      }
    }
  ]
}
```

---

### `GET /reports/stock-movement`

Nhật ký xuất nhập tồn (tối đa 500 bản ghi).

**Query params**

| Param | Type | Bắt buộc |
|-------|------|----------|
| `warehouseId` | string | ❌ |
| `from` | string | ❌ — ISO datetime, lọc `createdAt >= from` |
| `to` | string | ❌ — ISO datetime, lọc `createdAt <= to` |

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "tenantId": "...",
      "productId": "...",
      "warehouseId": "...",
      "transactionType": "in",
      "refDocType": "stock_receipt",
      "refDocId": "...",
      "qtyChange": "50.0000",
      "qtyBalanceAfter": "150.0000",
      "unitCost": "50000.0000",
      "createdById": "...",
      "createdAt": "...",
      "product": { "id": "...", "sku": "SP001", "name": "..." },
      "warehouse": { "id": "...", "code": "WH01", "name": "..." }
    }
  ]
}
```

---

### `GET /reports/low-stock`

Sản phẩm có tồn **khả dụng** (`onhand − reserved`) < `minStockLevel`. Response có `onhandQty`, `reservedQty`, `availableQty`, `shortageQty`.

**Query params:** `warehouseId` (không bắt buộc)

---

### `GET /reports/expiry-alert`

Lô còn tồn, hạn dùng trong `days` ngày (mặc định 30).

**Query params:** `warehouseId` (không bắt buộc), `days` (số nguyên dương, mặc định 30)

---

### `GET /reports/organization-overview`

Dashboard **toàn tổ chức**: tổng số kho, thống kê phiếu nhập/xuất/tồn đầu, tổng SL sản phẩm nhập/xuất, top SP nhập/xuất nhiều nhất, tồn kho tổng hợp. **Phân quyền tự động:**

- `admin`, `accountant`, `approver` → thấy toàn bộ (`visibilityScope: organization`)
- `warehouse_keeper`, `viewer` → chỉ phiếu mình tạo/duyệt (`visibilityScope: own_documents`)

> Hướng dẫn chi tiết: **[ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md)**

**Query params:** `from`, `to` (ISO datetime), `expiryDays` (30), `topLimit` (5), `recentLimit` (5)

**Response 200** — xem [ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md) cho bảng trường đầy đủ.

---

### `GET /reports/warehouse-overview`

Tổng quan **tất cả kho** của tổ chức đang chọn. Dữ liệu được cache Redis (TTL 60s) và tự xóa qua Redis Stream `cache:invalidate` khi có thay đổi master data, phiếu nhập/xuất, hoặc tồn kho.

> Hướng dẫn chi tiết từng trường response, enum, luồng Flutter: **[WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md)**

**Query params**

| Param | Type | Bắt buộc |
|-------|------|----------|
| `from` | ISO datetime | ❌ — lọc phiếu: `createdAt >= from` |
| `to` | ISO datetime | ❌ — lọc phiếu: `createdAt <= to` |
| `expiryDays` | number | ❌ — mặc định 30 |

> `inventory` luôn là snapshot tồn kho hiện tại, không lọc theo `from`/`to`.

**Response 200**

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T13:00:00.000Z",
    "expiryDays": 30,
    "filters": {
      "from": null,
      "to": null,
      "expiryDays": 30
    },
    "warehouses": [
      {
        "warehouse": {
          "id": "cuid",
          "code": "WH01",
          "name": "Kho chính",
          "address": "123 ABC",
          "isActive": true,
          "latitude": null,
          "longitude": null
        },
        "inventory": {
          "skuCount": 42,
          "totalOnhandQty": "1580.0000",
          "totalReservedQty": "120.0000",
          "totalAvailableQty": "1460.0000",
          "estimatedStockValue": "2450000.00",
          "lowStockCount": 3,
          "expiryAlertCount": 2,
          "activeReservationCount": 5,
          "qtyByUnit": [
            { "baseUnitName": "cái", "onhandQty": "1200.0000", "reservedQty": "80.0000", "availableQty": "1120.0000" },
            { "baseUnitName": "kg", "onhandQty": "380.0000", "reservedQty": "40.0000", "availableQty": "340.0000" }
          ]
        },
        "stockIssues": {
          "byStatus": {
            "draft": 1,
            "pending_approval": 2,
            "approved": 0,
            "completed": 85,
            "rejected": 1,
            "cancelled": 0
          },
          "total": 89,
          "pendingApproval": 2,
          "draft": 1
        },
        "stockReceipts": {
          "byStatus": {
            "draft": 0,
            "pending_approval": 1,
            "approved": 0,
            "completed": 120,
            "rejected": 0,
            "cancelled": 0
          },
          "total": 121,
          "pendingApproval": 1,
          "draft": 0
        },
        "stockOpenings": {
          "byStatus": {
            "draft": 0,
            "pending_approval": 0,
            "approved": 0,
            "completed": 1,
            "rejected": 0,
            "cancelled": 0
          },
          "total": 1
        }
      }
    ]
  }
}
```

---

### `GET /reports/warehouse-overview/:warehouseId`

Tổng quan **chi tiết một kho**: tồn kho, thống kê phiếu xuất/nhập/tồn đầu, cảnh báo, phiếu chờ duyệt, biến động gần nhất. Cache + invalidation giống endpoint trên.

> Hướng dẫn chi tiết từng trường response: **[WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md)**

**Query params**

| Param | Type | Bắt buộc |
|-------|------|----------|
| `from` | ISO datetime | ❌ — lọc phiếu và biến động: `createdAt >= from` |
| `to` | ISO datetime | ❌ — lọc phiếu và biến động: `createdAt <= to` |
| `expiryDays` | number | ❌ — mặc định 30 |
| `recentLimit` | number | ❌ — 1–20, mặc định 5 |

> `inventory` và `alerts` luôn là snapshot hiện tại, không lọc theo `from`/`to`.

**Response 200**

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T13:00:00.000Z",
    "expiryDays": 30,
    "recentLimit": 5,
    "filters": {
      "from": null,
      "to": null,
      "expiryDays": 30,
      "recentLimit": 5
    },
    "warehouse": {
      "id": "cuid",
      "code": "WH01",
      "name": "Kho chính",
      "address": "123 ABC",
      "isActive": true,
      "latitude": null,
      "longitude": null
    },
    "inventory": {
      "skuCount": 42,
      "totalOnhandQty": "1580.0000",
      "totalReservedQty": "120.0000",
      "totalAvailableQty": "1460.0000",
      "estimatedStockValue": "2450000.00",
      "lowStockCount": 3,
      "expiryAlertCount": 2,
      "activeReservationCount": 5,
      "qtyByUnit": [
        { "baseUnitName": "cái", "onhandQty": "1200.0000", "reservedQty": "80.0000", "availableQty": "1120.0000" },
        { "baseUnitName": "kg", "onhandQty": "380.0000", "reservedQty": "40.0000", "availableQty": "340.0000" }
      ]
    },
    "stockIssues": {
      "byStatus": {
        "draft": 1,
        "pending_approval": 2,
        "approved": 0,
        "completed": 85,
        "rejected": 1,
        "cancelled": 0
      },
      "total": 89,
      "pendingApproval": [
        {
          "id": "cuid",
          "code": "PX001",
          "issueDate": "2026-08-15",
          "issueType": "sale",
          "createdAt": "2026-08-15T08:00:00.000Z",
          "customer": { "id": "...", "code": "KH01", "name": "Khách A" }
        }
      ]
    },
    "stockReceipts": {
      "byStatus": {
        "draft": 0,
        "pending_approval": 1,
        "approved": 0,
        "completed": 120,
        "rejected": 0,
        "cancelled": 0
      },
      "total": 121,
      "pendingApproval": [
        {
          "id": "cuid",
          "code": "PN001",
          "receiptDate": "2026-08-16",
          "receiptType": "purchase",
          "totalAmount": "500000.00",
          "createdAt": "2026-08-16T09:00:00.000Z",
          "supplier": { "id": "...", "code": "NCC01", "name": "NCC A" }
        }
      ]
    },
    "stockOpenings": {
      "byStatus": {
        "draft": 0,
        "pending_approval": 0,
        "approved": 0,
        "completed": 1,
        "rejected": 0,
        "cancelled": 0
      },
      "total": 1
    },
    "alerts": {
      "lowStock": [
        {
          "productId": "...",
          "sku": "SP001",
          "name": "Sản phẩm A",
          "baseUnitName": "cái",
          "minStockLevel": "10.0000",
          "onhandQty": "8.0000",
          "reservedQty": "2.0000",
          "availableQty": "6.0000",
          "shortageQty": "4.0000"
        }
      ],
      "expiry": [
        {
          "batchId": "...",
          "batchNo": "LOT-001",
          "expiryDate": "2026-09-01",
          "daysToExpiry": 15,
          "onhandQty": "50.0000",
          "product": { "id": "...", "sku": "SP001", "name": "Sản phẩm A", "baseUnitName": "cái" }
        }
      ]
    },
    "recentMovements": [
      {
        "id": "cuid",
        "transactionType": "out",
        "refDocType": "stock_issue",
        "refDocId": "...",
        "qtyChange": "-10.0000",
        "qtyBalanceAfter": "140.0000",
        "unitCost": "50000.0000",
        "createdAt": "2026-08-17T10:00:00.000Z",
        "product": { "id": "...", "sku": "SP001", "name": "Sản phẩm A", "baseUnitName": "cái" }
      }
    ]
  }
}
```

**Lỗi:** `NOT_FOUND` (404) — kho không thuộc tổ chức

**Cache invalidation (Redis Stream)**

| Sự kiện | Stream group | Cache bị xóa |
|---------|--------------|--------------|
| Sửa kho, sản phẩm, NCC, KH | `master` | `report:warehouse-overview:{tenantId}:*` |
| Tạo/sửa/submit/duyệt phiếu | `stock-documents` / `stock-mutations` | `report:warehouse-overview:{tenantId}:*` |
| Hoàn tất phiếu, thay đổi tồn | `stock-reads` / `stock-mutations` | `report:warehouse-overview:{tenantId}:*` |

---

## Bảng tóm tắt endpoint

| Method | Path | Auth | X-Tenant-Id | Role |
|--------|------|------|-------------|------|
| GET | `/health` | — | — | — |
| POST | `/auth/register` | — | — | — |
| POST | `/auth/verify-otp` | — | — | — |
| POST | `/auth/resend-otp` | — | — | — |
| POST | `/auth/forgot-password` | — | — | — |
| POST | `/auth/reset-password` | — | — | — |
| POST | `/auth/login` | — | — | — |
| POST | `/auth/register-device` | Bearer | — | — |
| POST | `/auth/refresh` | — | — | — |
| POST | `/auth/logout` | — | — | — |
| GET | `/auth/me` | Bearer | — | — |
| POST | `/auth/tenants` | Bearer | — | — |
| POST | `/auth/invitations/accept` | Bearer | — | — |
| POST | `/auth/platform/tenants` | Bearer (platform admin) | — | — |
| PATCH | `/auth/platform/tenants/:id` | Bearer (platform admin) | — | — |
| GET | `/tenants/current` | Bearer | ✅ | any |
| POST | `/tenants/current/logo` | Bearer | ✅ | admin |
| DELETE | `/tenants/current/logo` | Bearer | ✅ | admin |
| POST | `/tenants/current/invitations` | Bearer | ✅ | admin |
| POST | `/tenants/current/users` | Bearer | ✅ | admin |
| POST | `/files` | Bearer | ✅ | any |
| PUT | `/files/:id` | Bearer | ✅ | uploader hoặc admin |
| GET | `/files` | Bearer | ✅ | any |
| GET | `/files/:id` | Bearer | ✅ | any |
| DELETE | `/files/:id` | Bearer | ✅ | uploader hoặc admin |
| GET | `/warehouses` | Bearer | ✅ | any |
| POST | `/warehouses` | Bearer | ✅ | admin, warehouse_keeper |
| GET | `/warehouses/:id` | Bearer | ✅ | any |
| PUT | `/warehouses/:id` | Bearer | ✅ | admin, warehouse_keeper |
| DELETE | `/warehouses/:id` | Bearer | ✅ | admin, warehouse_keeper |
| GET | `/products` | Bearer | ✅ | any |
| POST | `/products` | Bearer | ✅ | admin |
| GET | `/products/:id/availability` | Bearer | ✅ | any |
| GET | `/products/:id` | Bearer | ✅ | any |
| PUT | `/products/:id` | Bearer | ✅ | admin |
| DELETE | `/products/:id` | Bearer | ✅ | admin |
| GET | `/suppliers` | Bearer | ✅ | any |
| POST | `/suppliers` | Bearer | ✅ | admin |
| GET | `/suppliers/:id` | Bearer | ✅ | any |
| PUT | `/suppliers/:id` | Bearer | ✅ | admin |
| GET | `/customers` | Bearer | ✅ | any |
| POST | `/customers` | Bearer | ✅ | admin |
| GET | `/customers/:id` | Bearer | ✅ | any |
| PUT | `/customers/:id` | Bearer | ✅ | admin |
| GET | `/stock-opening-balances` | Bearer | ✅ | any |
| POST | `/stock-opening-balances` | Bearer | ✅ | any |
| POST | `/stock-opening-balances/:id/post` | Bearer | ✅ | admin, accountant, approver |
| GET | `/stock-receipts` | Bearer | ✅ | any |
| POST | `/stock-receipts` | Bearer | ✅ | any |
| GET | `/stock-receipts/:id` | Bearer | ✅ | any |
| PUT | `/stock-receipts/:id` | Bearer | ✅ | admin, warehouse_keeper |
| POST | `/stock-receipts/:id/submit` | Bearer | ✅ | admin, warehouse_keeper |
| POST | `/stock-receipts/:id/approve` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-receipts/:id/reject` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-receipts/:id/complete` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-receipts/:id/cancel` | Bearer | ✅ | admin, warehouse_keeper |
| POST | `/stock-receipts/:id/clone-from-rejected` | Bearer | ✅ | admin, warehouse_keeper |
| GET | `/stock-issues` | Bearer | ✅ | any |
| POST | `/stock-issues` | Bearer | ✅ | any |
| GET | `/stock-issues/:id` | Bearer | ✅ | any |
| PUT | `/stock-issues/:id` | Bearer | ✅ | admin, warehouse_keeper |
| POST | `/stock-issues/:id/submit` | Bearer | ✅ | admin, warehouse_keeper |
| POST | `/stock-issues/:id/approve` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-issues/:id/reject` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-issues/:id/complete` | Bearer | ✅ | admin, accountant, approver |
| POST | `/stock-issues/:id/cancel` | Bearer | ✅ | admin, warehouse_keeper |
| GET | `/reports/stock-balance` | Bearer | ✅ | any |
| GET | `/reports/stock-movement` | Bearer | ✅ | any |
| GET | `/reports/low-stock` | Bearer | ✅ | any |
| GET | `/reports/expiry-alert` | Bearer | ✅ | any |
| GET | `/reports/organization-overview` | Bearer | ✅ | any |
| GET | `/reports/warehouse-overview` | Bearer | ✅ | any |
| GET | `/reports/warehouse-overview/:warehouseId` | Bearer | ✅ | any |

---

## Postman

Collection và environment mẫu:

- `postman/Inventory-API.postman_collection.json`
- `postman/Inventory-API-Local.postman_environment.json`

Biến collection: `baseUrl`, `accessToken`, `refreshToken`, `tenantId`.
