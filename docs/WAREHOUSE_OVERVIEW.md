# Hướng dẫn API Tổng quan Kho (Warehouse Overview)

Tài liệu này mô tả chi tiết cách gọi **2 API tổng quan kho**, giải thích từng trường trong response, và gợi ý luồng tích hợp Flutter/mobile.

## Tổng quan

| # | Endpoint | Mục đích |
|---|----------|----------|
| 1 | `GET /reports/warehouse-overview` | Dashboard — xem nhanh **tất cả kho** của tổ chức |
| 2 | `GET /reports/warehouse-overview/:warehouseId` | Màn chi tiết — xem sâu **một kho** (cảnh báo, phiếu chờ duyệt, biến động) |

**Prefix:** `/api/v1`

Base URL:

- Local: `http://localhost:3004/api/v1`
- Production: `https://api.kimbap.io.vn/api/v1`

---

## Yêu cầu chung

### Headers bắt buộc

| Header | Giá trị | Ghi chú |
|--------|---------|---------|
| `Authorization` | `Bearer <accessToken>` | Lấy từ `POST /auth/login` |
| `X-Tenant-Id` | `<tenantId>` | ID tổ chức đang chọn — lấy từ `GET /auth/me` → `tenants[].id` |

Xem thêm: [USER_TENANTS.md](./USER_TENANTS.md)

### Quyền truy cập

- Mọi role trong tenant đều gọi được (`admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer`).
- Chỉ thấy dữ liệu thuộc tenant trong `X-Tenant-Id`.

### Response envelope

```json
{
  "success": true,
  "data": { ... }
}
```

Lỗi:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Warehouse not found"
  }
}
```

### Cache

- Dữ liệu được cache Redis **60 giây**.
- Tự xóa cache khi có thay đổi kho, sản phẩm, phiếu nhập/xuất, tồn kho (qua Redis Stream `cache:invalidate`).
- Field `generatedAt` cho biết thời điểm server tính toán dữ liệu — dùng hiển thị “Cập nhật lúc …” trên UI.
- GET chỉ đọc: reservation hết hạn không được `UPDATE`, chỉ loại khỏi số reserved nếu `expiresAt < now`.
- List tất cả kho: tồn kho gộp **1 SQL** theo warehouse, không query từng kho.

### Lọc theo thời gian (`from` / `to`)

| Khối dữ liệu | Trường lọc | Ghi chú |
|--------------|------------|---------|
| `stockIssues`, `stockReceipts`, `stockOpenings` (đếm theo status) | `createdAt` | Áp dụng cả API list và detail |
| `pendingApproval` (API detail) | `createdAt` | Chỉ phiếu chờ duyệt trong khoảng thời gian |
| `recentMovements` (API detail) | `createdAt` | Biến động ledger trong khoảng thời gian |
| `inventory`, `alerts` | — | **Không lọc** — luôn là snapshot tồn kho hiện tại |

Không truyền `from`/`to` → thống kê phiếu và biến động lấy **toàn bộ thời gian**; tồn kho và cảnh báo vẫn là hiện tại.

---

## API 1 — Tổng quan tất cả kho

### Request

```
GET /api/v1/reports/warehouse-overview?from=2026-08-01&to=2026-08-31&expiryDays=30
```

### Query params

| Param | Type | Bắt buộc | Mặc định | Mô tả |
|-------|------|----------|----------|-------|
| `from` | ISO datetime | ❌ | — | Lọc phiếu nhập/xuất/tồn đầu: `createdAt >= from` |
| `to` | ISO datetime | ❌ | — | Lọc phiếu nhập/xuất/tồn đầu: `createdAt <= to` |
| `expiryDays` | integer > 0 | ❌ | `30` | Số ngày tới để tính cảnh báo lô sắp hết hạn (`expiryAlertCount`) |

### cURL

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/warehouse-overview?from=2026-08-01&to=2026-08-31&expiryDays=30" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "X-Tenant-Id: tenant-id-1"
```

### Response mẫu

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T13:00:00.000Z",
    "expiryDays": 30,
    "filters": {
      "from": "2026-08-01",
      "to": "2026-08-31",
      "expiryDays": 30
    },
    "warehouses": [
      {
        "warehouse": { ... },
        "inventory": { ... },
        "stockIssues": { ... },
        "stockReceipts": { ... },
        "stockOpenings": { ... }
      }
    ]
  }
}
```

### Giải thích từng trường — cấp root

| Trường | Type | Mô tả |
|--------|------|-------|
| `generatedAt` | string (ISO 8601) | Thời điểm server tạo báo cáo |
| `expiryDays` | number | Giá trị `expiryDays` đã dùng để tính |
| `filters` | object | Echo query: `{ from, to, expiryDays }` — giá trị `null` khi không truyền |
| `warehouses` | array | Danh sách kho **active**, sắp xếp theo `code` ASC |

Mỗi phần tử trong `warehouses[]` gồm 5 khối: `warehouse`, `inventory`, `stockIssues`, `stockReceipts`, `stockOpenings`.

---

### Object `warehouse`

Thông tin cơ bản của kho.

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string | ID kho — dùng gọi API chi tiết |
| `code` | string | Mã kho, ví dụ `WH01` |
| `name` | string | Tên kho |
| `address` | string \| null | Địa chỉ |
| `isActive` | boolean | Luôn `true` (API chỉ trả kho active) |
| `latitude` | string \| null | Vĩ độ dạng chuỗi decimal |
| `longitude` | string \| null | Kinh độ dạng chuỗi decimal |

---

### Object `inventory`

Chỉ số tồn kho tổng hợp của **một kho**.

| Trường | Type | Mô tả |
|--------|------|-------|
| `skuCount` | number | Số **SKU** có tồn > 0 tại kho này |
| `totalOnhandQty` | string | Tổng số lượng tồn thực tế (4 chữ số thập phân). *Lưu ý: cộng across đơn vị khác nhau — chỉ mang tính tham khảo* |
| `totalReservedQty` | string | Tổng số lượng đang **giữ chỗ** (reservation `active` và còn hạn) |
| `totalAvailableQty` | string | Tồn khả dụng = `onhand − reserved` |
| `estimatedStockValue` | string | Giá trị tồn ước tính (2 chữ số thập phân) = Σ(onhand × `product.averageCost`) |
| `lowStockCount` | number | Số sản phẩm có tồn khả dụng < `minStockLevel` |
| `expiryAlertCount` | number | Số dòng tồn (balance) thuộc lô sắp hết hạn trong `expiryDays` ngày |
| `activeReservationCount` | number | Số reservation `active` còn hạn tại kho |
| `qtyByUnit` | array | Chi tiết theo đơn vị: `{ baseUnitName, onhandQty, reservedQty, availableQty }` |

Ví dụ `qtyByUnit`:

```json
[
  { "baseUnitName": "cái", "onhandQty": "1200.0000", "reservedQty": "80.0000", "availableQty": "1120.0000" },
  { "baseUnitName": "kg", "onhandQty": "380.0000", "reservedQty": "40.0000", "availableQty": "340.0000" }
]
```

---

### Object `stockIssues` / `stockReceipts` (API list)

Thống kê phiếu xuất / phiếu nhập theo trạng thái.

| Trường | Type | Mô tả |
|--------|------|-------|
| `byStatus` | object | Map số lượng phiếu theo từng status (xem bảng DocStatus bên dưới) |
| `total` | number | Tổng số phiếu (= cộng tất cả status) |
| `pendingApproval` | number | Số phiếu `pending_approval` — **shortcut** để hiện badge trên UI |
| `draft` | number | Số phiếu `draft` — **shortcut** |

Ví dụ `byStatus`:

```json
{
  "draft": 1,
  "pending_approval": 2,
  "approved": 0,
  "completed": 85,
  "rejected": 1,
  "cancelled": 0
}
```

---

### Object `stockOpenings` (API list)

Thống kê phiếu tồn đầu kỳ.

| Trường | Type | Mô tả |
|--------|------|-------|
| `byStatus` | object | Số phiếu tồn đầu theo DocStatus |
| `total` | number | Tổng số phiếu tồn đầu |

---

## API 2 — Tổng quan chi tiết một kho

### Request

```
GET /api/v1/reports/warehouse-overview/{warehouseId}?from=2026-08-01&to=2026-08-31&expiryDays=30&recentLimit=5
```

### Path params

| Param | Type | Mô tả |
|-------|------|-------|
| `warehouseId` | string | ID kho — lấy từ `warehouses[].warehouse.id` hoặc `GET /warehouses` |

### Query params

| Param | Type | Bắt buộc | Mặc định | Mô tả |
|-------|------|----------|----------|-------|
| `from` | ISO datetime | ❌ | — | Lọc phiếu và biến động: `createdAt >= from` |
| `to` | ISO datetime | ❌ | — | Lọc phiếu và biến động: `createdAt <= to` |
| `expiryDays` | integer > 0 | ❌ | `30` | Ngưỡng ngày cảnh báo hết hạn |
| `recentLimit` | integer 1–20 | ❌ | `5` | Số bản ghi tối đa cho: phiếu chờ duyệt, biến động gần nhất |

### cURL

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/warehouse-overview/clxyz123?from=2026-08-01&to=2026-08-31&expiryDays=30&recentLimit=10" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "X-Tenant-Id: tenant-id-1"
```

### Lỗi

| Code | HTTP | Khi nào |
|------|------|---------|
| `NOT_FOUND` | 404 | `warehouseId` không tồn tại hoặc không thuộc tenant |
| `VALIDATION_ERROR` | 400 | `recentLimit` > 20 hoặc query không hợp lệ |
| `UNAUTHORIZED` | 401 | Thiếu / sai token |
| `FORBIDDEN` | 403 | User không thuộc tenant |

---

### Giải thích từng trường — cấp root (API detail)

| Trường | Type | Mô tả |
|--------|------|-------|
| `generatedAt` | string | Thời điểm tạo báo cáo |
| `expiryDays` | number | Ngưỡng hết hạn đã dùng |
| `recentLimit` | number | Giới hạn danh sách “gần đây” |
| `filters` | object | Echo query: `{ from, to, expiryDays, recentLimit }` |
| `warehouse` | object | Giống API list |
| `inventory` | object | Giống API list |
| `stockIssues` | object | Thống kê + **danh sách** phiếu xuất chờ duyệt |
| `stockReceipts` | object | Thống kê + **danh sách** phiếu nhập chờ duyệt |
| `stockOpenings` | object | Thống kê phiếu tồn đầu |
| `alerts` | object | Cảnh báo chi tiết: hết hàng, hết hạn |
| `recentMovements` | array | Nhật ký biến động kho gần nhất |

---

### Object `stockIssues` (API detail)

| Trường | Type | Mô tả |
|--------|------|-------|
| `byStatus` | object | Thống kê theo DocStatus |
| `total` | number | Tổng số phiếu xuất |
| `pendingApproval` | **array** | Danh sách phiếu xuất `pending_approval`, sắp `createdAt` ASC (cũ nhất trước), tối đa `recentLimit` |

Mỗi phần tử `pendingApproval[]`:

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string | ID phiếu xuất |
| `code` | string | Số phiếu, ví dụ `PX001` |
| `issueDate` | string (date) | Ngày xuất |
| `issueType` | IssueType | Loại xuất — xem enum bên dưới |
| `createdAt` | string (ISO) | Thời điểm tạo |
| `customer` | object \| null | Khách hàng (khi `issueType = sale`) |
| `customer.id` | string | ID khách |
| `customer.code` | string | Mã khách |
| `customer.name` | string | Tên khách |

---

### Object `stockReceipts` (API detail)

| Trường | Type | Mô tả |
|--------|------|-------|
| `byStatus` | object | Thống kê theo DocStatus |
| `total` | number | Tổng số phiếu nhập |
| `pendingApproval` | **array** | Phiếu nhập chờ duyệt, sắp `createdAt` ASC |

Mỗi phần tử `pendingApproval[]`:

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string | ID phiếu nhập |
| `code` | string | Số phiếu, ví dụ `PN001` |
| `receiptDate` | string (date) | Ngày nhập |
| `receiptType` | ReceiptType | Loại nhập — xem enum bên dưới |
| `totalAmount` | string | Tổng tiền phiếu (2 chữ số thập phân) |
| `createdAt` | string (ISO) | Thời điểm tạo |
| `supplier` | object \| null | Nhà cung cấp |
| `supplier.id` | string | ID NCC |
| `supplier.code` | string | Mã NCC |
| `supplier.name` | string | Tên NCC |

---

### Object `alerts`

#### `alerts.lowStock[]`

Sản phẩm có **tồn khả dụng** < `minStockLevel`, sắp theo `shortageQty` giảm dần (thiếu nhiều nhất lên đầu).

| Trường | Type | Mô tả |
|--------|------|-------|
| `productId` | string | ID sản phẩm |
| `sku` | string | Mã SKU |
| `name` | string | Tên sản phẩm |
| `baseUnitName` | string | Đơn vị cơ bản, ví dụ `cái` |
| `minStockLevel` | string | Mức tồn tối thiểu (4 decimal) |
| `onhandQty` | string | Tồn thực tế |
| `reservedQty` | string | Đang giữ chỗ |
| `availableQty` | string | Khả dụng = onhand − reserved |
| `shortageQty` | string | Số lượng thiếu = minStock − available |

#### `alerts.expiry[]`

Lô còn tồn, hạn dùng trong vòng `expiryDays` ngày.

| Trường | Type | Mô tả |
|--------|------|-------|
| `batchId` | string | ID lô |
| `batchNo` | string | Mã lô |
| `expiryDate` | string (date) \| null | Ngày hết hạn |
| `daysToExpiry` | number \| null | Số ngày còn lại (âm = đã hết hạn) |
| `onhandQty` | string | Tồn lô tại kho này |
| `product` | object | Sản phẩm |
| `product.id` | string | ID SP |
| `product.sku` | string | SKU |
| `product.name` | string | Tên SP |
| `product.baseUnitName` | string | Đơn vị |

---

### Array `recentMovements[]`

Nhật ký xuất/nhập/tồn gần nhất, sắp `createdAt` DESC.

| Trường | Type | Mô tả |
|--------|------|-------|
| `id` | string | ID bản ghi ledger |
| `transactionType` | LedgerTxnType | Loại giao dịch — xem enum |
| `refDocType` | string | Loại chứng từ gốc, ví dụ `stock_issue`, `stock_receipt` |
| `refDocId` | string | ID chứng từ gốc — dùng navigate sang màn chi tiết phiếu |
| `qtyChange` | string | Số lượng thay đổi (+ nhập, − xuất) |
| `qtyBalanceAfter` | string | Tồn sau giao dịch |
| `unitCost` | string | Đơn giá vốn |
| `createdAt` | string (ISO) | Thời điểm ghi sổ |
| `product` | object | Sản phẩm liên quan |
| `product.id` | string | ID SP |
| `product.sku` | string | SKU |
| `product.name` | string | Tên SP |
| `product.baseUnitName` | string | Đơn vị |

---

## Enums tham chiếu

### DocStatus — trạng thái phiếu

| Giá trị | Ý nghĩa UI gợi ý |
|---------|------------------|
| `draft` | Nháp |
| `pending_approval` | Chờ duyệt |
| `approved` | Đã duyệt, chờ hoàn tất |
| `completed` | Hoàn tất |
| `rejected` | Từ chối |
| `cancelled` | Đã hủy |

### IssueType — loại phiếu xuất

| Giá trị | Ý nghĩa |
|---------|---------|
| `sale` | Xuất bán |
| `internal_use` | Xuất nội bộ |
| `return_to_supplier` | Trả NCC |
| `disposal` | Xuất hủy |

### ReceiptType — loại phiếu nhập

| Giá trị | Ý nghĩa |
|---------|---------|
| `purchase` | Nhập mua |
| `customer_return` | Khách trả hàng |
| `transfer_in` | Nhập điều chuyển |
| `production_output` | Nhập thành phẩm |
| `other` | Khác |

### LedgerTxnType — loại biến động kho

| Giá trị | Ý nghĩa |
|---------|---------|
| `opening` | Tồn đầu kỳ |
| `in` | Nhập |
| `out` | Xuất |
| `transfer_in` | Điều chuyển vào |
| `transfer_out` | Điều chuyển ra |
| `adjust` | Điều chỉnh |
| `transfer_cancel_return` | Hủy điều chuyển (hoàn) |

---

## Luồng tích hợp Flutter gợi ý

```
┌─────────────────┐     GET /auth/me      ┌──────────────────┐
│  Chọn tổ chức   │ ────────────────────► │  Lưu tenantId    │
└────────┬────────┘                       └────────┬─────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────┐   GET /warehouse-overview     ┌──────────────────┐
│ Dashboard kho   │ ◄──────────────────────────── │  List tất cả kho │
└────────┬────────┘                               └──────────────────┘
         │ tap 1 kho (warehouse.id)
         ▼
┌─────────────────┐   GET /warehouse-overview/:id ┌──────────────────┐
│ Chi tiết kho    │ ◄──────────────────────────── │  Badge, alerts,  │
└────────┬────────┘                               │  phiếu chờ duyệt │
         │ tap phiếu / movement                    └──────────────────┘
         ▼
┌─────────────────┐
│ GET /stock-     │
│ issues/:id      │
│ hoặc receipts   │
└─────────────────┘
```

### Mapping UI ↔ API

| Thành phần UI | Nguồn dữ liệu |
|---------------|---------------|
| Thẻ kho (tên, mã) | `warehouses[].warehouse` |
| Badge “X phiếu chờ duyệt” | `stockIssues.pendingApproval` — **number** (list) hoặc **array** (detail) |
| Badge cảnh báo hết hàng | `inventory.lowStockCount` |
| Badge cảnh báo hết hạn | `inventory.expiryAlertCount` |
| Giá trị tồn kho | `inventory.estimatedStockValue` |
| Danh sách phiếu xuất chờ duyệt | `stockIssues.pendingApproval[]` (detail) |
| Danh sách sản phẩm sắp hết | `alerts.lowStock[]` |
| Timeline biến động | `recentMovements[]` |
| “Cập nhật lúc …” | `generatedAt` |

### Pull-to-refresh

Sau khi user thao tác phiếu (submit/approve/complete), gọi lại API overview. Cache server tự invalidate trong vòng vài giây; nếu cần dữ liệu tức thì, pull-to-refresh ngay sau action là đủ.

---

## Ví dụ Dart (http)

```dart
Future<Map<String, dynamic>> fetchWarehouseOverviewList({
  required String baseUrl,
  required String accessToken,
  required String tenantId,
  String? from,
  String? to,
  int expiryDays = 30,
}) async {
  final queryParameters = <String, String>{'expiryDays': '$expiryDays'};
  if (from != null) queryParameters['from'] = from;
  if (to != null) queryParameters['to'] = to;

  final uri = Uri.parse('$baseUrl/reports/warehouse-overview')
      .replace(queryParameters: queryParameters);

  final response = await http.get(uri, headers: {
    'Authorization': 'Bearer $accessToken',
    'X-Tenant-Id': tenantId,
  });

  final body = jsonDecode(response.body) as Map<String, dynamic>;
  if (response.statusCode != 200 || body['success'] != true) {
    throw Exception(body['error']?['message'] ?? 'Request failed');
  }
  return body['data'] as Map<String, dynamic>;
}

Future<Map<String, dynamic>> fetchWarehouseOverviewDetail({
  required String baseUrl,
  required String accessToken,
  required String tenantId,
  required String warehouseId,
  String? from,
  String? to,
  int expiryDays = 30,
  int recentLimit = 5,
}) async {
  final queryParameters = <String, String>{
    'expiryDays': '$expiryDays',
    'recentLimit': '$recentLimit',
  };
  if (from != null) queryParameters['from'] = from;
  if (to != null) queryParameters['to'] = to;

  final uri = Uri.parse('$baseUrl/reports/warehouse-overview/$warehouseId')
      .replace(queryParameters: queryParameters);

  final response = await http.get(uri, headers: {
    'Authorization': 'Bearer $accessToken',
    'X-Tenant-Id': tenantId,
  });

  final body = jsonDecode(response.body) as Map<String, dynamic>;
  if (response.statusCode != 200 || body['success'] != true) {
    throw Exception(body['error']?['message'] ?? 'Request failed');
  }
  return body['data'] as Map<String, dynamic>;
}
```

---

## So sánh 2 API

| Tiêu chí | API list (tất cả kho) | API detail (1 kho) |
|----------|----------------------|-------------------|
| Endpoint | `/reports/warehouse-overview` | `/reports/warehouse-overview/:id` |
| `pendingApproval` | **number** (đếm) | **array** (chi tiết phiếu) |
| `draft` | có (number) | không có shortcut |
| `alerts` | không | có (`lowStock`, `expiry`) |
| `recentMovements` | không | có |
| Query `recentLimit` | không | có |
| Use case | Màn dashboard / chọn kho | Màn chi tiết kho |

---

## Tài liệu liên quan

- [API.md](./API.md) — reference đầy đủ tất cả endpoint
- [USER_TENANTS.md](./USER_TENANTS.md) — lấy `tenantId` và header `X-Tenant-Id`
- [PUSH_NOTIFICATION_FLUTTER.md](./PUSH_NOTIFICATION_FLUTTER.md) — push khi có phiếu chờ duyệt (`stock_issue_pending`, `stock_receipt_pending`)
