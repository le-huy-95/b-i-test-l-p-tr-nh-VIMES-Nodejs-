# Hướng dẫn sử dụng API Sản phẩm (dành cho Frontend)

Tài liệu tổng hợp toàn bộ API module sản phẩm, dùng để gọi từ Frontend.

## 1. Thông tin chung

| Thông tin  | Giá trị                           |
| ---------- | --------------------------------- |
| Base URL   | `https://api.kimbap.io.vn/api/v1` |
| Prefix     | `/products`                       |
| Auth       | `Authorization: Bearer <token>`   |
| Tenant     | Header `X-Tenant-Id: <tenantId>`  |
| Rate limit | 300 requests / 15 phút            |

### Response envelope

Mọi API đều trả về chung cấu trúc:

```json
{
  "success": true,
  "data": {}
}
```

Lỗi sẽ có dạng:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Product not found"
  }
}
```

### Phạm vi dữ liệu sản phẩm

API sản phẩm hiện chỉ lưu các thông tin quan trọng cho nghiệp vụ tồn kho và hiển thị:

- `sku`
- `barcode`
- `name`
- `imageUrl`
- `baseUnitName`
- `minStockLevel`
- `maxStockLevel`
- `reorderPoint`
- `averageCost`
- `units[]`

Các trường cấu hình tính giá/ưu tiên xuất lô đã được gỡ khỏi giao diện để đơn giản hóa form sản phẩm.

### Quy tắc xử lý ảnh sản phẩm

Ảnh sản phẩm được xử lý theo 2 bước, không gửi file trực tiếp trong API sản phẩm:

```text
① POST /api/v1/files                 → lưu file vào MinIO, nhận fileId/url
② POST hoặc PUT /api/v1/products/...  → lưu liên kết ảnh vào products.image_url
```

Frontend nên gửi `imageFileId` khi tạo hoặc cập nhật sản phẩm. Backend sẽ kiểm tra file thuộc đúng tenant, kiểm tra đó là file ảnh, sau đó lấy `url` từ bảng `uploaded_files` để lưu vào sản phẩm.

> Không tự tạo URL MinIO ở frontend. Chỉ sử dụng `data.url` do API upload trả về hoặc gửi `imageFileId` để backend tự liên kết.

---

## 2. Danh sách sản phẩm

Lấy danh sách sản phẩm của tenant hiện tại (chỉ các sản phẩm đang hoạt động `isActive = true`).

### Endpoint

```http
GET /api/v1/products
```

### Query params

| Param    | Type   | Bắt buộc | Mô tả                                                             |
| -------- | ------ | -------- | ----------------------------------------------------------------- |
| `page`   | number | ❌       | Trang hiện tại, mặc định `1`                                      |
| `limit`  | number | ❌       | Số bản ghi mỗi trang, mặc định `20`, tối đa `200`                 |
| `search` | string | ❌       | Tìm kiếm không phân biệt hoa thường theo `sku`, `name`, `barcode` |

> Nếu không gửi query param nào, API trả toàn bộ danh sách sản phẩm (không phân trang), sắp xếp theo `sku` tăng dần.

### Ví dụ request

```http
GET https://api.kimbap.io.vn/api/v1/products?page=1&limit=20&search=SP001
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
```

### Response 200

Khi có query param → trả về phân trang:

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "cuid",
        "tenantId": "cuid",
        "sku": "SP001",
        "barcode": "8930000000010",
        "name": "Sản phẩm A",
        "imageUrl": null,
        "baseUnitName": "cái",
        "minStockLevel": "0.0000",
        "maxStockLevel": null,
        "reorderPoint": null,
        "averageCost": "0.0000",
        "isActive": true,
        "units": [
          {
            "id": "cuid",
            "productId": "cuid",
            "unitName": "cái",
            "conversionRate": "1.000000"
          }
        ],
        "createdAt": "2026-08-19T09:00:00.000Z",
        "updatedAt": "2026-08-19T09:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

Khi không có query param → `data` là một mảng trực tiếp.

> Lưu ý: danh sách này có cache Redis, có thể không phản ánh thay đổi ngay lập tức trong thời gian ngắn.

---

## 3. Chi tiết sản phẩm

Lấy thông tin một sản phẩm theo id.

### Endpoint

```http
GET /api/v1/products/:id
```

### Ví dụ request

```http
GET https://api.kimbap.io.vn/api/v1/products/cmsyciymg0001qqckdcqatvy4
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
```

### Response 200

Object `Product` kèm `units[]` (giống item trong danh sách ở mục 2).

### Lỗi

- `404 NOT_FOUND` — không tìm thấy sản phẩm hoặc sản phẩm không thuộc tenant.

---

## 4. Tạo sản phẩm

### Endpoint

```http
POST /api/v1/products
```

**Role:** `admin`, `accountant`, `warehouse_keeper`

### Body

| Field                    | Type   | Bắt buộc            | Default            | Mô tả                                                  |
| ------------------------ | ------ | ------------------- | ------------------ | ------------------------------------------------------ |
| `sku`                    | string | ✅                  |                    | Mã sản phẩm, duy nhất trong tenant                     |
| `barcode`                | string | ❌                  |                    | Mã vạch                                                |
| `name`                   | string | ✅                  |                    | Tên sản phẩm                                           |
| `imageFileId`             | string | ❌                  | `null`             | ID file ảnh nhận từ `POST /api/v1/files`                |
| `fileIds`                 | array  | ❌                  | `[]`              | Có thể dùng thay `imageFileId`, chỉ phần tử đầu tiên được sử dụng |
| `imageUrl`                | string | ❌                  | `null`             | URL ảnh; chỉ dùng khi đã có URL hợp lệ từ file API      |
| `baseUnitName`           | string | ❌                  | `"cái"`            | Đơn vị cơ sở                                           |
| `minStockLevel`          | number | ❌                  | `0`                | Mức tồn tối thiểu                                      |
| `maxStockLevel`          | number | ❌                  | `null`             | Mức tồn tối đa                                         |
| `reorderPoint`           | number | ❌                  | `null`             | Điểm đặt hàng lại                                      |
| `averageCost`            | number | ❌                  | `0`                | Giá vốn hiện tại                                       |
| `units`                  | array  | ❌                  | tự tạo 1 unit base | Danh sách đơn vị quy đổi                               |
| `units[].unitName`       | string | ✅ (nếu có `units`) |                    | Tên đơn vị                                             |
| `units[].conversionRate` | number | ✅ (nếu có `units`) |                    | Tỉ lệ quy đổi về đơn vị cơ sở, phải > 0                |

### Quy trình tạo sản phẩm có ảnh

#### Bước 1: Upload ảnh lên MinIO qua File API

```http
POST /api/v1/files
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
Content-Type: multipart/form-data
```

Form data bắt buộc:

```text
file=<ảnh sản phẩm>
kind=product
```

Không tự đặt header `Content-Type`; thư viện HTTP phải tự thêm multipart boundary.

Response mẫu:

```json
{
  "success": true,
  "data": {
    "id": "cmfile123",
    "url": "http://localhost:9000/inventory/media/tenant-1/product/abc.jpg",
    "mimeType": "image/jpeg",
    "kind": "product"
  }
}
```

Lưu lại `data.id` (`cmfile123`).

#### Bước 2: Tạo sản phẩm và gửi `imageFileId`

```http
POST https://api.kimbap.io.vn/api/v1/products
Content-Type: application/json
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>

{
  "sku": "SP002",
  "barcode": "8930000000027",
  "name": "Sản phẩm B",
  "imageFileId": "cmfile123",
  "baseUnitName": "thùng",
  "minStockLevel": 10,
  "maxStockLevel": null,
  "reorderPoint": null,
  "averageCost": 0,
  "units": [
    { "unitName": "thùng", "conversionRate": 1 },
    { "unitName": "cái", "conversionRate": 12 }
  ]
}
```

Backend sẽ lưu `uploaded_files.url` vào `products.image_url`.

### Quy tắc validation

- `sku` bắt buộc và duy nhất trong tenant → nếu trùng trả `409 DUPLICATE_SKU`.
- `baseUnitName` mặc định là `cái` nếu không gửi.
- `averageCost` mặc định là `0`.
- `units` nếu không gửi thì backend tự tạo một đơn vị cơ sở.

### Response 201

Object `Product` vừa tạo kèm `units[]`.

### Lỗi

- `400 VALIDATION_ERROR` — dữ liệu sai.
- `409 DUPLICATE_SKU` — SKU đã tồn tại trong tenant.

---

## 5. Tồn kho theo kho và lô (Availability)

Tính tồn `onhand` / `reserved` / `available` của sản phẩm theo từng kho và từng lô. Các reservation hết hạn được chuyển `expired` trước khi tính.

### Endpoint

```http
GET /api/v1/products/:id/availability
```

### Ví dụ request

```http
GET https://api.kimbap.io.vn/api/v1/products/cmsyciymg0001qqckdcqatvy4/availability
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
```

### Response 200

```json
{
  "success": true,
  "data": {
    "productId": "cmsyciymg0001qqckdcqatvy4",
    "warehouses": [
      {
        "warehouseId": "cuid",
        "warehouse": {
          "id": "cuid",
          "code": "KHO1",
          "name": "Kho trung tâm"
        },
        "onhandQty": "100.0000",
        "reservedQty": "10.0000",
        "availableQty": "90.0000",
        "lots": [
          {
            "warehouseId": "cuid",
            "warehouse": {
              "id": "cuid",
              "code": "KHO1",
              "name": "Kho trung tâm"
            },
            "batchId": "cuid",
            "batchNo": "LOT-0001",
            "expiryDate": "2027-01-01",
            "onhandQty": "100.0000",
            "reservedQty": "10.0000",
            "availableQty": "90.0000"
          }
        ]
      }
    ]
  }
}
```

Giải thích các field:

| Field          | Ý nghĩa                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `onhandQty`    | Tổng số lượng thực tế đang có                                                      |
| `reservedQty`  | Số lượng đang bị giữ (reservation active)                                          |
| `availableQty` | Số lượng có thể bán = `onhandQty - reservedQty`                                    |
| `lots[]`       | Chi tiết theo lô; nếu sản phẩm không theo dõi lô thì `batchId`/`batchNo` là `null` |

> Tất cả số lượng trả về dạng chuỗi 4 chữ số thập phân (ví dụ `"90.0000"`). Frontend nên xử lý theo kiểu số thập phân thay vì làm tròn trước khi hiển thị.

### Lỗi

- `404 NOT_FOUND` — sản phẩm không tồn tại.

---

## 6. Cập nhật sản phẩm

### Endpoint

```http
PUT /api/v1/products/:id
```

**Role:** `admin`, `accountant`, `warehouse_keeper`

### Body

Body là **partial** — chỉ gửi các field cần sửa. Các field giống bảng trong mục 4 (trừ `units`, endpoint này **không** cập nhật danh sách đơn vị).

### Quy trình cập nhật sản phẩm có ảnh

Có 2 trường hợp:

#### Trường hợp A: Chỉ đổi sản phẩm sang một ảnh đã upload

Không cần upload lại. Gửi `imageFileId` của file mới:

```http
PUT /api/v1/products/:productId
Content-Type: application/json
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>

{
  "imageFileId": "cmfile456"
}
```

#### Trường hợp B: Thay nội dung file ảnh hiện tại

Dùng File API trước:

```http
PUT /api/v1/files/:fileId
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
Content-Type: multipart/form-data
```

Form data:

```text
file=<ảnh mới>
kind=product
```

`fileId` được giữ nguyên, còn `url` và object trên MinIO được cập nhật. Sau đó gọi cập nhật sản phẩm để đồng bộ URL:

```http
PUT /api/v1/products/:productId
Content-Type: application/json
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>

{
  "imageFileId": "cmfile456"
}
```

> Gọi `PUT /files/:fileId` một mình chưa đủ trong thiết kế hiện tại vì sản phẩm đang lưu `image_url`; cần gọi tiếp `PUT /products/:productId` để ghi URL mới vào sản phẩm.

#### Trường hợp C: Cập nhật thông tin, giữ nguyên ảnh

Chỉ gửi các field cần đổi và không gửi `imageFileId`, `fileIds` hoặc `imageUrl`:

```http
PUT /api/v1/products/:productId
Content-Type: application/json
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>

{
  "name": "Sản phẩm B (mới)",
  "minStockLevel": 20
}
```

#### Trường hợp D: Gỡ ảnh khỏi sản phẩm

```json
{
  "imageUrl": null
}
```

### Quy tắc validation

- Cùng quy tắc đơn giản hóa như tạo mới (áp dụng trên dữ liệu sau khi merge với dữ liệu hiện tại).

### Response 200

Object `Product` đã cập nhật kèm `units[]`.

### Lỗi

- `400 VALIDATION_ERROR`
- `400 INVALID_FILE_TYPE` — file liên kết không phải ảnh.
- `404 NOT_FOUND` — `productId` hoặc `imageFileId` không tồn tại trong tenant.

---

## 7. Xóa sản phẩm

### Endpoint

```http
DELETE /api/v1/products/:id
```

**Role:** `admin`, `accountant`, `warehouse_keeper`

### Ví dụ request

```http
DELETE https://api.kimbap.io.vn/api/v1/products/cmsyciymg0001qqckdcqatvy4
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
```

### Kết quả

Xóa mềm — đặt `isActive = false`. Sản phẩm sẽ không còn xuất hiện trong danh sách mặc định, nhưng dữ liệu lịch sử (phiếu nhập/xuất, tồn kho) được giữ nguyên.

### Response 200

Object `Product` với `isActive: false`.

### Lỗi

- `404 NOT_FOUND`

---

## 8. Bảng tóm tắt

| Mục đích            | Method   | Endpoint                                | Role    |
| ------------------- | -------- | --------------------------------------- | ------- |
| Danh sách sản phẩm  | `GET`    | `/api/v1/products?page=&limit=&search=` | bất kỳ  |
| Chi tiết sản phẩm   | `GET`    | `/api/v1/products/:id`                  | bất kỳ  |
| Tồn kho theo kho/lô | `GET`    | `/api/v1/products/:id/availability`     | bất kỳ  |
| Tạo sản phẩm        | `POST`   | `/api/v1/products`                      | `admin`, `accountant`, `warehouse_keeper` |
| Cập nhật sản phẩm   | `PUT`    | `/api/v1/products/:id`                  | `admin`, `accountant`, `warehouse_keeper` |
| Xóa sản phẩm        | `DELETE` | `/api/v1/products/:id`                       | `admin`, `accountant`, `warehouse_keeper` |
| Upload ảnh           | `POST`   | `/api/v1/files`                              | mọi role trong tenant                    |
| Thay file ảnh        | `PUT`    | `/api/v1/files/:fileId`                      | người upload hoặc `admin`                |

## 9. Ghi chú quan trọng

- API **tra cứu theo mã vạch** (`GET /products/barcode/:code`) đã bị gỡ. Nếu cần tìm sản phẩm theo mã vạch, hãy dùng `GET /api/v1/products?search=<mã vạch>`.
- Danh sách sản phẩm có cache Redis; sau khi tạo/sửa/xóa, backend tự invalidate cache nhưng có thể có độ trễ nhỏ.
- Các thao tác ghi (`POST`/`PUT`/`DELETE`) đi qua `idempotencyMiddleware` — gửi lại request trùng sẽ không tạo bản ghi trùng.
- Nếu không có quyền `admin`, gọi các API ghi sẽ nhận lỗi quyền (403).
