# Hướng dẫn sử dụng API Warehouse

Tài liệu này mô tả 2 API dùng để thay đổi trạng thái kho trong backend.

## 1. Cập nhật thông tin kho

Dùng khi bạn muốn sửa các thông tin như:

- `code`
- `name`
- `address`
- `phone`
- `latitude`
- `longitude`

### Endpoint

```http
PUT /api/v1/warehouses/:id
```

### Ví dụ request

```http
PUT https://api.kimbap.io.vn/api/v1/warehouses/cmsyciymg0001qqckdcqatvy4
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "Kho trung tâm",
  "address": "123 Nguyễn Văn A",
  "phone": "0909123456"
}
```

### Ghi chú

- API này **không dùng** để đổi trạng thái `isActive`.
- Body gửi lên có thể chỉ chứa các field cần cập nhật.
- Nếu gửi `isActive`, backend sẽ bỏ qua field này.

## 2. Vô hiệu hóa kho

Dùng khi bạn muốn chuyển kho sang trạng thái không hoạt động.

### Endpoint

```http
PATCH /api/v1/warehouses/:id/deactivate
```

### Ví dụ request

```http
PATCH https://api.kimbap.io.vn/api/v1/warehouses/cmsyciymg0001qqckdcqatvy4/deactivate
Authorization: Bearer <token>
```

### Kết quả

- Backend sẽ cập nhật `isActive = false`.
- Kho sẽ không còn xuất hiện trong các danh sách mặc định đang lọc theo kho hoạt động.

## 3. Kích hoạt kho

Dùng khi bạn muốn bật lại một kho đã bị vô hiệu hóa.

### Endpoint

```http
PATCH /api/v1/warehouses/:id/activate
```

### Ví dụ request

```http
PATCH https://api.kimbap.io.vn/api/v1/warehouses/cmsyciymg0001qqckdcqatvy4/activate
Authorization: Bearer <token>
```

### Kết quả

- Backend sẽ cập nhật `isActive = true`.

## 4. Bảng tóm tắt

| Mục đích | Method | Endpoint |
|---|---|---|
| Cập nhật thông tin kho | `PUT` | `/api/v1/warehouses/:id` |
| Vô hiệu hóa kho | `PATCH` | `/api/v1/warehouses/:id/deactivate` |
| Kích hoạt kho | `PATCH` | `/api/v1/warehouses/:id/activate` |

## 5. Lỗi thường gặp

### Gọi sai method

Ví dụ gọi:

```http
PATCH /api/v1/warehouses/:id
```

Backend sẽ trả về:

- `404 Route not found`

Vì route này không tồn tại.

### Gửi `isActive` vào API cập nhật

Ví dụ:

```http
PUT /api/v1/warehouses/:id
{
  "isActive": false
}
```

Backend sẽ không đổi trạng thái kho, vì `isActive` không nằm trong schema cập nhật.

## 6. Kết luận

Nếu bạn chỉ muốn sửa thông tin kho, hãy dùng:

```http
PUT /api/v1/warehouses/:id
```

Nếu bạn muốn đổi trạng thái hoạt động của kho, hãy dùng:

```http
PATCH /api/v1/warehouses/:id/deactivate
PATCH /api/v1/warehouses/:id/activate
```
