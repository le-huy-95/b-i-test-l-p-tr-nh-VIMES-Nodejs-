# Tenant People API

Tài liệu sử dụng các API quản lý **thành viên tổ chức (tenant)**, **lời mời thành viên**, và **user nội bộ** trong hệ thống.

## Base URL

- Local: `http://localhost:3000/api/v1`
- Staging / Production: theo domain deploy

## Yêu cầu chung

Hầu hết các API đều cần 2 header bắt buộc:

| Header | Mô tả |
|---|---|
| `Authorization: Bearer <accessToken>` | Token đăng nhập |
| `X-Tenant-Id: <tenantId>` | ID tổ chức hiện tại |

Nếu thiếu hoặc sai, API trả về `401` / `403`.

### Các role trong tenant (`TenantRole`)

| Role | Mô tả |
|---|---|
| `admin` | Quản trị, có toàn quyền (mời thành viên, tạo user, xem lời mời) |
| `warehouse_keeper` | Thủ kho |
| `accountant` | Kế toán |
| `approver` | Người duyệt |
| `viewer` | Chỉ xem |

---

## 1) Danh sách thành viên tổ chức

### `GET /tenants/current/members`

Trả danh sách thành viên của tổ chức hiện tại (được lấy từ `X-Tenant-Id`).

### Quyền

- Bất kỳ member nào của tenant
- Cần `X-Tenant-Id`

### Query params

| Field | Type | Bắt buộc | Default | Mô tả |
|---|---:|---:|---:|---|
| `page` | number | Không | `1` | Trang hiện tại |
| `limit` | number | Không | `20` | Số dòng/trang, tối đa `200` |
| `search` | string | Không | - | Tìm theo `name`, `email`, `phone` |

### Cách hoạt động

- **Không truyền query param nào** → trả **mảng** `Member[]`.
- Có truyền `page` / `limit` / `search` → trả **object phân trang**.

### Ví dụ

```bash
# Lấy tất cả thành viên (mảng)
curl -X GET http://localhost:3000/api/v1/tenants/current/members \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>"

# Phân trang + tìm kiếm
curl -X GET "http://localhost:3000/api/v1/tenants/current/members?search=nguyen&page=1&limit=10" \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>"
```

### Response không phân trang

```json
{
  "success": true,
  "data": [
    {
      "id": "user-tenant-id-1",
      "userId": "user-1",
      "name": "Nguyen Van A",
      "email": "a@example.com",
      "phone": "0901234567",
      "role": "admin",
      "isActive": true,
      "joinedAt": "2026-08-19T10:00:00.000Z"
    }
  ]
}
```

### Response có phân trang

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "user-tenant-id-1",
        "userId": "user-1",
        "name": "Nguyen Van A",
        "email": "a@example.com",
        "phone": "0901234567",
        "role": "admin",
        "isActive": true,
        "joinedAt": "2026-08-19T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

### Field trả về

| Field | Type | Mô tả |
|---|---|---|
| `id` | string | ID bản ghi membership (`UserTenant`) |
| `userId` | string | ID user thật |
| `name` | string \| null | Tên hiển thị |
| `email` | string \| null | Email |
| `phone` | string \| null | SĐT |
| `role` | `TenantRole` | Vai trò trong tenant |
| `isActive` | boolean | Membership có active không |
| `joinedAt` | string (ISO) | Thời điểm tham gia (`createdAt`) |

---

## 2) Danh sách lời mời (gửi đi + nhận được)

### `GET /tenants/current/invitations`

Trả danh sách lời mời của tổ chức hiện tại, gồm **2 loại**:

| Loại | `direction` | Mô tả |
|---|---|---|
| Lời mời do tổ chức gửi đi | `outgoing` | Invitation mà tenant hiện tại tạo ra, chưa được chấp nhận (`acceptedAt = null`) |
| Lời mời gửi đến user hiện tại | `incoming` | Invitation mà **tổ chức khác** gửi đến email/SĐT của user đang đăng nhập, chưa được chấp nhận |

### Quyền

- Bất kỳ member nào của tenant (không còn giới hạn `admin`)
- Cần `X-Tenant-Id`

### Query params

| Field | Type | Bắt buộc | Default | Mô tả |
|---|---:|---:|---:|---|
| `page` | number | Không | `1` | Trang hiện tại |
| `limit` | number | Không | `20` | Số dòng/trang, tối đa `200` |
| `search` | string | Không | - | Tìm theo email, tên/email người mời, tên tổ chức gửi lời mời |

### Cách hoạt động

- **Không truyền query param** → trả **mảng** `Invitation[]`.
- Có query param → trả **object phân trang**.

### Ví dụ

```bash
# Tất cả lời mời (gửi đi + nhận được), dạng mảng
curl -X GET http://localhost:3000/api/v1/tenants/current/invitations \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>"

# Phân trang + tìm kiếm
curl -X GET "http://localhost:3000/api/v1/tenants/current/invitations?search=admin&page=1&limit=10" \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>"
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "inv-1",
      "email": "invitee@example.com",
      "role": "viewer",
      "status": "pending",
      "direction": "outgoing",
      "tenantId": "tenant-id",
      "tenantName": "Công ty A",
      "expiresAt": "2026-08-20T10:00:00.000Z",
      "invitedAt": "2026-08-19T10:00:00.000Z",
      "invitedBy": {
        "id": "user-1",
        "name": "Admin A",
        "email": "admin@example.com"
      }
    },
    {
      "id": "inv-2",
      "email": "me@example.com",
      "role": "admin",
      "status": "pending",
      "direction": "incoming",
      "tenantId": "other-tenant-id",
      "tenantName": "Công ty B",
      "expiresAt": "2026-08-21T10:00:00.000Z",
      "invitedAt": "2026-08-18T10:00:00.000Z",
      "invitedBy": {
        "id": "user-2",
        "name": "Admin B",
        "email": "admin-b@example.com"
      }
    }
  ]
}
```

Khi phân trang, response có dạng `{ data, pagination }` giống API số 1.

### Field trả về

| Field | Type | Mô tả |
|---|---|---|
| `id` | string | ID invitation |
| `email` | string | Email được mời |
| `role` | `TenantRole` | Role được gán khi accept |
| `status` | `pending` \| `expired` \| `accepted` \| `declined` | Trạng thái hiển thị theo `expiresAt` / `acceptedAt` / `declinedAt` |
| `direction` | `outgoing` \| `incoming` | Lời mời org gửi đi, hay gửi đến user hiện tại |
| `tenantId` | string | ID tổ chức tạo lời mời |
| `tenantName` | string | Tên tổ chức tạo lời mời |
| `expiresAt` | string (ISO) | Thời điểm hết hạn |
| `invitedAt` | string (ISO) | Thời điểm tạo lời mời |
| `invitedBy.id` | string | ID người mời |
| `invitedBy.name` | string \| null | Tên người mời |
| `invitedBy.email` | string \| null | Email người mời |

### Ghi chú

- `incoming` chỉ hiển thị khi email/SĐT của lời mời **khớp** với email/SĐT của user đang đăng nhập.
- Khi accept lời mời `incoming`, user sẽ gia nhập tổ chức `tenantId` của lời mời đó.
- Lời mời đã `declined` sẽ không xuất hiện trong danh sách `GET /tenants/current/invitations`.

---

## 3) Mời thành viên mới

### `POST /tenants/current/invitations`

Tạo lời mời bằng email. Backend sẽ:

1. Tạo invitation mới và lưu vào hệ thống.
2. Gửi email theo template chuyên nghiệp, không gửi raw link/token trong nội dung.
3. Nếu email đã có user trong hệ thống → bắn notification realtime.
4. Invalidate cache danh sách thành viên/lời mời.

### Quyền

- Chỉ **`admin`**

### Body

| Field | Type | Bắt buộc | Default | Mô tả |
|---|---:|---:|---:|---|
| `email` | string | ✅ | - | Email người được mời |
| `role` | `TenantRole` | Không | `viewer` | Role sẽ gán sau khi accept |

### Ví dụ

```bash
curl -X POST http://localhost:3000/api/v1/tenants/current/invitations \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invitee@example.com",
    "role": "warehouse_keeper"
  }'
```

### Response 201

```json
{
  "success": true,
  "data": {
    "id": "invitation-id",
    "email": "invitee@example.com",
    "role": "warehouse_keeper",
    "acceptUrl": "https://app.example.com/invite/accept/invitation-id"
  }
}
```

### Lưu ý

- Không được trả token riêng; backend chỉ trả `acceptUrl` và invitation id.
- Thời gian hết hạn mặc định theo `INVITE_EXPIRES_HOURS` (tính bằng giờ).
- Nếu mời email trùng user đã tồn tại, backend vẫn tạo invitation và thông báo realtime cho user đó.

---

## 4) Chấp nhận lời mời

### `POST /auth/invitations/accept`

User **đang đăng nhập** dùng `invitationId` để gia nhập tenant. Không cần `X-Tenant-Id` (chưa thuộc tenant nào).

### Quyền

- User đã đăng nhập (`Authorization: Bearer`)
- Không cần `X-Tenant-Id`

### Body

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| `invitationId` | string | ✅ | ID của invitation |

### Ví dụ

```bash
# Dùng invitationId từ response: invitation-id
curl -X POST http://localhost:3000/api/v1/auth/invitations/accept \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{ "invitationId": "invitation-id" }'
```

### Response 200

```json
{
  "success": true,
  "data": {
    "tenantId": "tenant-id",
    "role": "viewer"
  }
}
```

### Các bước backend kiểm tra

1. Invitation hợp lệ (tồn tại, chưa hết hạn, chưa accept).
2. Invitation chưa được dùng (`acceptedAt = null`).
3. Email của user đang login khớp với email invitation.

### Lưu ý

- Sau khi accept, membership `UserTenant` được **tạo mới** hoặc **cập nhật** (`isActive = true`, cập nhật role mới).
- Nếu email không khớp → lỗi `INVITE_EMAIL_MISMATCH` (403).
- Sau khi thành công, cache của tenant và permission của user được invalidate.

### Lỗi có thể gặp

| Code | HTTP | Khi nào |
|---|---|---|
| `INVALID_INVITE` | 400 | Invitation sai, đã hết hạn, hoặc đã dùng |
| `INVITE_EMAIL_MISMATCH` | 403 | Email user không khớp invitation |

---

## 5) Từ chối lời mời

### `POST /auth/invitations/decline`

User **đang đăng nhập** dùng `invitationId` để từ chối lời mời. Không cần `X-Tenant-Id`.

### Quyền

- User đã đăng nhập (`Authorization: Bearer`)
- Không cần `X-Tenant-Id`

### Body

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---:|
| `invitationId` | string | ✅ | ID của invitation |

### Ví dụ

```bash
# Dùng invitationId từ response: invitation-id
curl -X POST http://localhost:3000/api/v1/auth/invitations/decline \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{ "invitationId": "invitation-id" }'
```

### Response 200

```json
{
  "success": true,
  "data": {
    "tenantId": "tenant-id",
    "invitationId": "invitation-id"
  }
}
```

### Các bước backend kiểm tra

1. Invitation hợp lệ (tồn tại, chưa hết hạn, chưa accept, chưa decline).
2. Email của user đang login khớp với email invitation.
3. Đánh dấu invitation bằng `declinedAt`.
4. Gửi notification realtime cho người đã mời.

### Lưu ý

- Từ chối lời mời **không** tạo membership `UserTenant`.
- Nếu email không khớp → lỗi `INVITE_EMAIL_MISMATCH` (403).
- Nếu invitation đã được accept/decline hoặc đã hết hạn → lỗi `INVALID_INVITE` (400).
- Lời mời đã từ chối sẽ không xuất hiện trong `GET /tenants/current/invitations`.

### Lỗi có thể gặp

| Code | HTTP | Khi nào |
|---|---|---|
| `INVALID_INVITE` | 400 | Invitation sai, đã hết hạn, đã dùng hoặc đã từ chối |
| `INVITE_EMAIL_MISMATCH` | 403 | Email user không khớp invitation |

---

## 6) Tạo user nội bộ trong tenant

### `POST /tenants/current/users`

Tạo user mới và gán sẵn membership vào tenant. Dùng khi bạn muốn tạo tài khoản trực tiếp (không qua luồng mời).

### Quyền

- Chỉ **`admin`**

### Body

| Field | Type | Bắt buộc | Default | Mô tả |
|---|---:|---:|---:|---|
| `email` | string | Không* | - | Email user |
| `phone` | string | Không* | - | SĐT user |
| `name` | string | Không | - | Tên hiển thị |
| `password` | string | ✅ | - | Mật khẩu, tối thiểu 6 ký tự |
| `role` | `TenantRole` | Không | `warehouse_keeper` | Role trong tenant |
| `warehouseIds` | string[] | Không | - | Gán quyền truy cập các kho |

> *`email` và `phone` cần **ít nhất một** trong hai. Nếu có email, user sẽ được đánh dấu `emailVerifiedAt` (coi như đã verify).

### Ví dụ

```bash
curl -X POST http://localhost:3000/api/v1/tenants/current/users \
  -H "Authorization: Bearer <accessToken>" \
  -H "X-Tenant-Id: <tenantId>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "staff@example.com",
    "password": "password123",
    "name": "Staff User",
    "role": "warehouse_keeper",
    "warehouseIds": ["warehouse-id-1"]
  }'
```

### Response 201

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

### Lỗi có thể gặp

| Code | HTTP | Khi nào |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Thiếu cả email lẫn phone, hoặc password < 6 ký tự |

### Thông báo realtime

Sau khi tạo user thành công, hệ thống phát **notification realtime** tới tất cả **admin** của tổ chức:

- Event type: `user_created` → tiêu đề "Tài khoản mới được tạo", gồm tên user mới + tên người tạo + tên tổ chức.
- Ngoài ra, khi user này **đăng nhập** thành công (email/mật khẩu hoặc Google), admin của tổ chức sẽ nhận thêm notification `user_login` ("Thành viên đăng nhập").

---

## 7) Tóm tắt nhanh

| API | Method | Đường dẫn | Mục đích | Quyền |
|---|---|---|---|---|
| Danh sách thành viên | `GET` | `/tenants/current/members` | Xem member của tenant | Member của tenant |
| Danh sách lời mời | `GET` | `/tenants/current/invitations` | Lời mời gửi đi + nhận được | Member của tenant |
| Mời thành viên | `POST` | `/tenants/current/invitations` | Tạo lời mời | `admin` |
| Chấp nhận lời mời | `POST` | `/auth/invitations/accept` | Gia nhập tenant | User đã login |
| Từ chối lời mời | `POST` | `/auth/invitations/decline` | Từ chối gia nhập tenant | User đã login |
| Tạo user nội bộ | `POST` | `/tenants/current/users` | Tạo user + gán membership | `admin` |

---

## 8) Luồng sử dụng thực tế

### Luồng A: Mời thành viên qua email

```
1. Tạo invitation mới
2. Email gửi theo template chuyên nghiệp
3. Người nhận mở app/web, đăng nhập đúng email
4. Backend gọi `POST /auth/invitations/accept` với `invitationId`
5. Nếu người nhận không muốn tham gia, gọi `POST /auth/invitations/decline`
```

### Luồng B: Admin tạo user nội bộ trực tiếp

```
1. Admin gọi POST /tenants/current/users
2. User được tạo + gán role + (tùy chọn) gán kho
3. User dùng email/mật khẩu để đăng nhập
```

### Luồng C: Tìm kiếm & quản lý danh sách

```
1. GET /tenants/current/members?search=an&page=1&limit=20
2. GET /tenants/current/invitations  (kiểm tra lời mời còn hạn)
```

---

## 8) Cache

- Kết quả `GET /members` và `GET /invitations` có cache ngắn hạn.
- Cache tự động bị invalidate khi có một trong các thao tác:
  - mời thành viên mới (`POST /invitations`)
  - chấp nhận lời mời (`POST /auth/invitations/accept`)
  - từ chối lời mời (`POST /auth/invitations/decline`)
  - tạo user nội bộ (`POST /users`)

Sau các thao tác trên, lần gọi `GET` tiếp theo sẽ trả dữ liệu mới nhất.

---

## 9) Xử lý lỗi chung

Khi gặp lỗi, response có dạng:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mô tả lỗi"
  }
}
```

| HTTP | Ý nghĩa |
|---|---|
| `400` | Body/query không hợp lệ, invitation sai/hết hạn |
| `401` | Chưa đăng nhập hoặc token hết hạn |
| `403` | Không có quyền (không phải admin, hoặc email không khớp) |
| `404` | Tenant/user không tồn tại |
| `409` | Dữ liệu trùng lặp (vd. code tenant đã tồn tại) |

---

## 10) Lưu ý cho client

1. Luôn gửi đủ `Authorization` và `X-Tenant-Id` (trừ `POST /auth/invitations/accept`, `POST /auth/invitations/decline` và `POST /auth/tenants`).
2. Kiểm tra `status` của invitation (`pending`/`expired`/`accepted`/`declined`) trước khi hiển thị.
3. Khi nhận được email mời, client nên lấy `invitationId` từ API/notification và mở màn hình chấp nhận hoặc từ chối lời mời tương ứng, không parse token.
4. Sau khi `accept` hoặc `decline` thành công, client nên gọi lại `GET /auth/me` (hoặc refresh tenant) để cập nhật danh sách tenant của user.
