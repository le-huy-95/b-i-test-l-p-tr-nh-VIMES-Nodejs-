# Hướng dẫn lấy danh sách tổ chức của user

Tài liệu này mô tả cách **lấy danh sách tổ chức (tenant)** mà user đang đăng nhập thuộc về, và cách **chọn tổ chức** để gọi các API nghiệp vụ.

## Tổng quan

Hệ thống dùng mô hình **multi-tenant**: một user có thể thuộc nhiều tổ chức, mỗi tổ chức gán một **role** (`admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer`).

**Hiện chưa có** endpoint riêng kiểu `GET /tenants` (danh sách). Danh sách tổ chức được trả về trong:

| Mục đích | Endpoint | Khi nào dùng |
|----------|----------|--------------|
| Lấy lại danh sách khi đã đăng nhập | `GET /auth/me` | Màn chọn tổ chức, refresh profile, sau khi chấp nhận lời mời |
| Lấy danh sách lúc đăng nhập | `POST /auth/login` | Luồng login — trả thêm `accessToken`, `refreshToken` |
| Lấy chi tiết tổ chức đang chọn | `GET /tenants/current` | Màn cài đặt tổ chức, hiển thị logo — cần `X-Tenant-Id` |

Base URL (dev):

- Local: `http://localhost:3004/api/v1`
- Production qua Cloudflare: `https://api.kimbap.io.vn/api/v1`

---

## Cách 1 — Lấy danh sách tổ chức (đã đăng nhập)

**Endpoint:** `GET /auth/me`

**Auth:** `Authorization: Bearer <accessToken>`

**Response mẫu:**

```json
{
  "success": true,
  "data": {
    "id": "cuid-user",
    "email": "user@example.com",
    "phone": null,
    "name": "Nguyen Van A",
    "emailVerified": true,
    "phoneVerified": false,
    "isPlatformAdmin": false,
    "tenants": [
      {
        "id": "tenant-id-1",
        "code": "ACME",
        "name": "Acme Corp",
        "logoUrl": "http://localhost:9000/inventory/tenants/tenant-id-1/logo.png",
        "role": "admin",
        "status": "active"
      },
      {
        "id": "tenant-id-2",
        "code": "SHOP01",
        "name": "Cửa hàng ABC",
        "logoUrl": null,
        "role": "viewer",
        "status": "active"
      }
    ]
  }
}
```

**cURL:**

```bash
curl -X GET https://api.kimbap.io.vn/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

**Ghi chú:**

- Chỉ trả về membership **đang active** (`isActive = true`).
- Mỗi phần tử trong `tenants` gồm: `id`, `code`, `name`, `logoUrl`, `role`, `status`.
- `logoUrl`: URL logo tổ chức trên MinIO; `null` nếu chưa upload.
- Danh sách `tenants` được **cache Redis** (key `list:user-tenants:{userId}`, TTL 60s). Lần đầu query DB rồi ghi cache; các lần sau đọc cache. Cache bị xóa (lazy delete) khi user **accept lời mời** hoặc **tạo tổ chức mới** — lần gọi tiếp theo sẽ query DB lại.
---

## Cách 2 — Lấy danh sách khi đăng nhập

**Endpoint:** `POST /auth/login`

**Body:**

```json
{
  "email": "user@example.com",
  "password": "matKhau123"
}
```

Hoặc đăng nhập bằng SĐT:

```json
{
  "phone": "0901234567",
  "password": "matKhau123"
}
```

**Response mẫu (rút gọn):**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "cuid-user",
      "email": "user@example.com",
      "name": "Nguyen Van A",
      "emailVerified": true,
      "phoneVerified": false,
      "isPlatformAdmin": false
    },
    "tenants": [
      {
        "id": "tenant-id-1",
        "code": "ACME",
        "name": "Acme Corp",
        "logoUrl": "http://localhost:9000/inventory/tenants/tenant-id-1/logo.png",
        "role": "admin",
        "status": "active"
      }
    ],
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

**Khác biệt so với `/auth/me`:** mỗi tenant có thêm `status` (`active` | `suspended`).

**Lỗi thường gặp:**

| Mã | HTTP | Nguyên nhân |
|----|------|-------------|
| `INVALID_CREDENTIALS` | 401 | Email/SĐT hoặc mật khẩu sai |
| `USER_INACTIVE` | 403 | Tài khoản bị khóa |
| `RATE_LIMITED` | 429 | Quá 10 lần login / 15 phút (theo IP) |

---

## Chọn tổ chức để gọi API nghiệp vụ

Hầu hết API (kho, sản phẩm, phiếu nhập/xuất, …) yêu cầu **context tổ chức** qua header:

```
X-Tenant-Id: <tenant-id>
```

Ví dụ — lấy danh sách kho sau khi đã chọn tổ chức:

```bash
curl -X GET https://api.kimbap.io.vn/api/v1/warehouses \
  -H "Authorization: Bearer eyJ..." \
  -H "X-Tenant-Id: tenant-id-1"
```

**Lỗi thường gặp khi thiếu/sai tenant:**

| Mã | HTTP | Nguyên nhân |
|----|------|-------------|
| `TENANT_REQUIRED` | 400 | Thiếu header `X-Tenant-Id` |
| `PERMISSION_DENIED_TENANT` | 403 | User không thuộc tenant đó |
| `TENANT_SUSPENDED` | 403 | Tổ chức bị suspend |
| `EMAIL_NOT_VERIFIED` | 403 | Tài khoản chưa verify email hoặc SĐT |

---

## Luồng tích hợp app (mobile/web)

```mermaid
sequenceDiagram
  participant User
  participant App
  participant API

  User->>App: Đăng nhập
  App->>API: POST /auth/login
  API-->>App: user + tenants[] + tokens

  alt Nhiều tổ chức
    App->>User: Hiển thị màn chọn tổ chức
    User->>App: Chọn một tenant
  else Một tổ chức
    App->>App: Tự chọn tenant duy nhất
  else Không có tổ chức
    App->>User: Hướng tạo mới hoặc chờ lời mời
  end

  App->>App: Lưu tenantId đã chọn (localStorage / secure storage)
  App->>API: GET /warehouses (Bearer + X-Tenant-Id)
  API-->>App: Dữ liệu theo tenant

  Note over App,API: Sau khi accept invite hoặc tạo tenant mới
  App->>API: GET /auth/me
  API-->>App: tenants[] cập nhật
```

### Gợi ý lưu trữ phía client

```typescript
// Sau login hoặc GET /auth/me
interface TenantSummary {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
  role: string;
}

// Lưu token
localStorage.setItem('accessToken', data.accessToken);
localStorage.setItem('refreshToken', data.refreshToken);

// Lưu tenant đang chọn
localStorage.setItem('currentTenantId', selectedTenant.id);

// Mọi request nghiệp vụ
fetch('/api/v1/warehouses', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'X-Tenant-Id': currentTenantId,
  },
});
```

---

## Các thao tác liên quan đến tổ chức

### Tạo tổ chức mới

User tự tạo tổ chức và trở thành `admin`:

**Endpoint:** `POST /auth/tenants`

```json
{
  "code": "ACME",
  "name": "Acme Corp"
}
```

Sau khi tạo, gọi lại `GET /auth/me` để cập nhật danh sách `tenants`.

### Tham gia tổ chức qua lời mời

1. Admin gửi lời mời: `POST /tenants/current/invitations` (cần `X-Tenant-Id` + role `admin`).
2. User đăng nhập và chấp nhận: `POST /auth/invitations/accept` với `{ "token": "..." }`.
3. Gọi `GET /auth/me` — tenant mới xuất hiện trong `tenants`.

Chi tiết luồng mời: xem [API.md](./API.md) mục **Tenant — Quản lý tổ chức**.

### Upload / xóa logo tổ chức

Chỉ **admin** của tổ chức mới upload hoặc xóa logo. Logo lưu trên MinIO; URL trả về trong `logoUrl`.

| Hành động | Endpoint | Ghi chú |
|-----------|----------|---------|
| Upload / thay logo | `POST /tenants/current/logo` | `multipart/form-data`, field `logo` — JPEG/PNG/WebP/GIF, tối đa 2MB |
| Xóa logo | `DELETE /tenants/current/logo` | Set `logoUrl` về `null` |
| Xem chi tiết tổ chức | `GET /tenants/current` | Trả đầy đủ thông tin tenant kèm `logoUrl` |

**Upload logo (cURL):**

```bash
curl -X POST https://api.kimbap.io.vn/api/v1/tenants/current/logo \
  -H "Authorization: Bearer eyJ..." \
  -H "X-Tenant-Id: tenant-id-1" \
  -F "logo=@/path/to/logo.png"
```

Sau upload, gọi lại `GET /auth/me` hoặc `GET /tenants/current` để lấy `logoUrl` mới.

**Yêu cầu hạ tầng:** MinIO phải chạy (`npm run docker:redis-minio`). Chi tiết: [API.md](./API.md) mục **Tenant — Quản lý tổ chức**.

---

## Câu hỏi thường gặp

### User có 0 tổ chức — làm gì?

- Tạo mới: `POST /auth/tenants`
- Hoặc chờ admin mời và accept qua link email

### Làm sao biết user là admin của tổ chức nào?

Kiểm tra field `role` trong mảng `tenants` từ `/auth/me` hoặc `/auth/login`. `role === "admin"` mới gọi được các API quản trị (mời user, tạo user nội bộ, …).

### Có API đổi tổ chức không?

Không có endpoint “switch tenant”. Client chỉ cần **đổi giá trị header `X-Tenant-Id`** sang `id` của tổ chức khác trong danh sách `tenants`.

### Khi nào cần gọi lại `/auth/me`?

- Sau `POST /auth/invitations/accept`
- Sau `POST /auth/tenants` (tạo tổ chức mới)
- Khi user bấm “Làm mới” trên màn chọn tổ chức
- Sau khi admin thêm/xóa quyền (nếu app cần role mới nhất)

### `refresh` có trả lại danh sách tenant không?

**Không.** `POST /auth/refresh` chỉ trả `accessToken` và `refreshToken`. Muốn cập nhật danh sách tổ chức, gọi `GET /auth/me`.

---

## Tóm tắt nhanh

| Hành động | Endpoint | Header bắt buộc |
|-----------|----------|-----------------|
| Lấy danh sách tổ chức | `GET /auth/me` | `Authorization` |
| Login + lấy danh sách | `POST /auth/login` | — |
| Chi tiết tổ chức đang chọn | `GET /tenants/current` | `Authorization` + `X-Tenant-Id` |
| Upload logo tổ chức | `POST /tenants/current/logo` | `Authorization` + `X-Tenant-Id` (admin) |
| Xóa logo tổ chức | `DELETE /tenants/current/logo` | `Authorization` + `X-Tenant-Id` (admin) |
| Gọi API theo tổ chức | `GET/POST /warehouses`, … | `Authorization` + `X-Tenant-Id` |
| Tạo tổ chức mới | `POST /auth/tenants` | `Authorization` |
| Chấp nhận lời mời | `POST /auth/invitations/accept` | `Authorization` |
