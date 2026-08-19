# Hướng dẫn API Báo cáo — Tổng quan

Tài liệu này **tổng hợp toàn bộ 7 endpoint báo cáo** của hệ thống quản lý kho, giải thích mục đích, tham số, cấu trúc response, phân quyền, cache và luồng tích hợp gợi ý.

> Chi tiết sâu từng dashboard: [WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md) · [ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md)

---

## Mục lục

1. [Yêu cầu chung](#yêu-cầu-chung)
2. [Danh mục API](#danh-mục-api)
3. [Nhóm A — Báo cáo nghiệp vụ cơ bản](#nhóm-a--báo-cáo-nghiệp-vụ-cơ-bản)
   - [GET /reports/stock-balance](#get-reportsstock-balance)
   - [GET /reports/stock-movement](#get-reportsstock-movement)
   - [GET /reports/low-stock](#get-reportslow-stock)
   - [GET /reports/expiry-alert](#get-reportsexpiry-alert)
4. [Nhóm B — Dashboard theo kho](#nhóm-b--dashboard-theo-kho)
   - [GET /reports/warehouse-overview](#get-reportswarehouse-overview)
   - [GET /reports/warehouse-overview/:warehouseId](#get-reportswarehouse-overviewwarehouseid)
5. [Nhóm C — Dashboard toàn tổ chức](#nhóm-c--dashboard-toàn-tổ-chức)
   - [GET /reports/organization-overview](#get-reportsorganization-overview)
6. [So sánh các API](#so-sánh-các-api)
7. [Enums tham chiếu](#enums-tham-chiếu)
8. [Luồng tích hợp gợi ý](#luồng-tích-hợp-gợi-ý)
9. [Tài liệu liên quan](#tài-liệu-liên-quan)

---

## Yêu cầu chung

### Base URL

| Môi trường | URL |
|------------|-----|
| Local | `http://localhost:3004/api/v1` |
| Production | `https://api.kimbap.io.vn/api/v1` |

**Prefix module:** `/reports`

### Headers bắt buộc

| Header | Giá trị | Ghi chú |
|--------|---------|---------|
| `Authorization` | `Bearer <accessToken>` | Lấy từ `POST /auth/login` |
| `X-Tenant-Id` | `<tenantId>` | ID tổ chức — xem [USER_TENANTS.md](./USER_TENANTS.md) |

### Quyền truy cập

- Tất cả endpoint báo cáo yêu cầu **đăng nhập + chọn tenant**.
- Mọi role trong tenant đều gọi được: `admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer`.
- **Ngoại lệ phân quyền dữ liệu:** `GET /organization-overview` tự lọc theo role (xem [Phân quyền Organization Overview](#phân-quyền-organization-overview)).

### Response envelope

**Thành công:**

```json
{ "success": true, "data": { ... } }
```

**Lỗi:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Warehouse not found"
  }
}
```

| Code | HTTP | Khi nào |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Thiếu / sai token |
| `FORBIDDEN` | 403 | User không thuộc tenant |
| `NOT_FOUND` | 404 | Kho không tồn tại (warehouse detail) |
| `VALIDATION_ERROR` | 400 | Query không hợp lệ |

### Cache Redis

| Prefix cache | TTL | API |
|--------------|-----|-----|
| `report:stock-balance` | 60s | stock-balance |
| `report:stock-movement` | 60s | stock-movement |
| `report:low-stock` | 60s | low-stock |
| `report:expiry-alert` | 60s | expiry-alert |
| `report:warehouse-overview` | 60s | warehouse-overview (list + detail) |
| `report:organization-overview` | 60s | organization-overview |

- Cache tự **invalidate** qua Redis Stream `cache:invalidate` khi thay đổi master data, phiếu nhập/xuất/tồn đầu, hoặc tồn kho.
- Dashboard có field `generatedAt` — dùng hiển thị “Cập nhật lúc …” trên UI.
- GET chỉ đọc: reservation hết hạn **không UPDATE**, chỉ loại khỏi số reserved nếu `expiresAt < now`.

### Phân trang (pagination)

Áp dụng cho `stock-balance` và `stock-movement`:

| Param | Type | Mặc định | Giới hạn |
|-------|------|----------|----------|
| `page` | integer ≥ 1 | `1` | — |
| `limit` | integer ≥ 1 | `20` | tối đa `200` |

Response có thêm object `pagination`:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## Danh mục API

| # | Endpoint | Nhóm | Mục đích chính |
|---|----------|------|----------------|
| 1 | `GET /reports/stock-balance` | A | Tồn kho hiện tại (theo dòng balance) |
| 2 | `GET /reports/stock-movement` | A | Nhật ký biến động kho (ledger) |
| 3 | `GET /reports/low-stock` | A | Sản phẩm sắp hết hàng |
| 4 | `GET /reports/expiry-alert` | A | Lô sắp hết hạn |
| 5 | `GET /reports/warehouse-overview` | B | Dashboard tất cả kho |
| 6 | `GET /reports/warehouse-overview/:warehouseId` | B | Dashboard chi tiết một kho |
| 7 | `GET /reports/organization-overview` | C | Dashboard toàn tổ chức |

---

## Nhóm A — Báo cáo nghiệp vụ cơ bản

Các API này phục vụ **tra cứu / xuất báo cáo** trực tiếp, không gom dashboard. Dữ liệu lấy từ bảng `stock_balance`, `stock_ledger`, hoặc tính toán realtime từ tồn + reservation + lô.

---

### `GET /reports/stock-balance`

**Mục đích:** Báo cáo **tồn kho hiện tại** theo từng dòng balance (product × warehouse × batch nếu có).

#### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `warehouseId` | string | ❌ | Lọc theo kho |
| `page` | integer | ❌ | Trang (mặc định 1) |
| `limit` | integer | ❌ | Số bản ghi/trang (mặc định 20, max 200) |

#### Ví dụ

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/stock-balance?warehouseId=wh-1&page=1&limit=50" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: tenant-id-1"
```

#### Response

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "cuid",
        "tenantId": "...",
        "productId": "...",
        "warehouseId": "...",
        "batchId": null,
        "onhandQty": "150.0000",
        "version": 3,
        "updatedAt": "2026-08-17T10:00:00.000Z",
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
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "totalPages": 3
    }
  }
}
```

#### Ghi chú

- Sắp xếp: `warehouseId ASC`, `productId ASC`.
- Mỗi dòng = một balance record; cùng sản phẩm ở nhiều lô sẽ có nhiều dòng.

---

### `GET /reports/stock-movement`

**Mục đích:** Nhật ký **xuất nhập tồn** (bảng `stock_ledger`), sắp mới nhất trước.

#### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `warehouseId` | string | ❌ | Lọc theo kho |
| `from` | ISO datetime | ❌ | `createdAt >= from` |
| `to` | ISO datetime | ❌ | `createdAt <= to` |
| `page` | integer | ❌ | Trang |
| `limit` | integer | ❌ | Số bản ghi/trang (max 200) |

#### Ví dụ

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/stock-movement?warehouseId=wh-1&from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: tenant-id-1"
```

#### Response

```json
{
  "success": true,
  "data": {
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
        "createdAt": "2026-08-15T08:00:00.000Z",
        "product": { "id": "...", "sku": "SP001", "name": "Sản phẩm A" },
        "warehouse": { "id": "...", "code": "WH01", "name": "Kho chính" }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 500, "totalPages": 25 }
  }
}
```

#### Ghi chú

- `refDocType` + `refDocId` dùng navigate sang phiếu gốc (nhập/xuất/điều chỉnh…).
- `qtyChange`: dương = nhập, âm = xuất.

---

### `GET /reports/low-stock`

**Mục đích:** Danh sách sản phẩm có **tồn khả dụng** (`onhand − reserved`) **< `minStockLevel`**.

#### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `warehouseId` | string | ❌ | Lọc theo kho; không truyền = gộp toàn tenant |

#### Ví dụ

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/low-stock?warehouseId=wh-1" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: tenant-id-1"
```

#### Response

```json
{
  "success": true,
  "data": [
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
  ]
}
```

#### Giải thích trường

| Trường | Mô tả |
|--------|-------|
| `onhandQty` | Tổng tồn thực tế (gộp các balance) |
| `reservedQty` | Tổng giữ chỗ (reservation `active` còn hạn) |
| `availableQty` | `onhandQty − reservedQty` |
| `shortageQty` | `minStockLevel − availableQty` |

> Không phân trang — trả về mảng đầy đủ. Chỉ tính sản phẩm `isActive = true`.

---

### `GET /reports/expiry-alert`

**Mục đích:** Cảnh báo **lô còn tồn**, hạn dùng trong vòng `days` ngày tới.

#### Query params

| Param | Type | Bắt buộc | Mặc định | Mô tả |
|-------|------|----------|----------|-------|
| `warehouseId` | string | ❌ | — | Lọc theo kho |
| `days` | integer > 0 | ❌ | `30` | Số ngày tới để cảnh báo |

#### Ví dụ

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/expiry-alert?days=15&warehouseId=wh-1" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: tenant-id-1"
```

#### Response (không lọc kho — có thêm `warehouse`)

```json
{
  "success": true,
  "data": [
    {
      "batchId": "...",
      "batchNo": "LOT-001",
      "expiryDate": "2026-09-01T00:00:00.000Z",
      "daysToExpiry": 15,
      "onhandQty": "50.0000",
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

#### Ghi chú

- Sắp xếp theo `expiryDate ASC` (sắp hết hạn trước).
- `daysToExpiry` âm = đã quá hạn.
- Khi có `warehouseId`: response **không** có field `warehouse`.
- Chỉ trả lô có `onhandQty > 0`.

---

## Nhóm B — Dashboard theo kho

Hai API gom **tồn kho + thống kê phiếu + cảnh báo + biến động** theo từng kho. Phù hợp màn hình dashboard mobile/web.

> **Tài liệu chi tiết từng trường, enum, ví dụ Dart:** [WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md)

---

### `GET /reports/warehouse-overview`

**Mục đích:** Dashboard — xem nhanh **tất cả kho active** của tổ chức.

#### Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|----------|-------|
| `from` | ISO datetime | — | Lọc phiếu: `createdAt >= from` |
| `to` | ISO datetime | — | Lọc phiếu: `createdAt <= to` |
| `expiryDays` | integer > 0 | `30` | Ngưỡng cảnh báo hết hạn (`expiryAlertCount`) |

#### Response — cấu trúc

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T13:00:00.000Z",
    "expiryDays": 30,
    "filters": { "from": null, "to": null, "expiryDays": 30 },
    "warehouses": [
      {
        "warehouse": { "id", "code", "name", "address", "isActive", "latitude", "longitude" },
        "inventory": {
          "skuCount", "totalOnhandQty", "totalReservedQty", "totalAvailableQty",
          "estimatedStockValue", "lowStockCount", "expiryAlertCount", "activeReservationCount",
          "qtyByUnit": [{ "baseUnitName", "onhandQty", "reservedQty", "availableQty" }]
        },
        "stockIssues": { "byStatus", "total", "pendingApproval": 2, "draft": 1 },
        "stockReceipts": { "byStatus", "total", "pendingApproval": 1, "draft": 0 },
        "stockOpenings": { "byStatus", "total" }
      }
    ]
  }
}
```

#### Lọc thời gian

| Khối | Lọc `from`/`to`? |
|------|------------------|
| `stockIssues`, `stockReceipts`, `stockOpenings` | ✅ theo `createdAt` |
| `inventory` | ❌ snapshot hiện tại |

#### Điểm đặc biệt (API list)

- `pendingApproval` và `draft` là **number** (shortcut badge UI).
- Không có `alerts`, `recentMovements`.

---

### `GET /reports/warehouse-overview/:warehouseId`

**Mục đích:** Dashboard **chi tiết một kho** — cảnh báo, phiếu chờ duyệt, biến động gần nhất.

#### Path params

| Param | Mô tả |
|-------|-------|
| `warehouseId` | ID kho — lấy từ list hoặc `GET /warehouses` |

#### Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|----------|-------|
| `from` | ISO datetime | — | Lọc phiếu + biến động |
| `to` | ISO datetime | — | Lọc phiếu + biến động |
| `expiryDays` | integer > 0 | `30` | Ngưỡng hết hạn |
| `recentLimit` | integer 1–20 | `5` | Số phiếu chờ duyệt + biến động gần nhất |

#### Response — khối bổ sung so với list

| Khối | Mô tả |
|------|-------|
| `stockIssues.pendingApproval` | **array** phiếu xuất chờ duyệt (không phải number) |
| `stockReceipts.pendingApproval` | **array** phiếu nhập chờ duyệt |
| `alerts.lowStock[]` | SP sắp hết, sắp theo `shortageQty` giảm dần |
| `alerts.expiry[]` | Lô sắp hết hạn tại kho này |
| `recentMovements[]` | Ledger gần nhất, sắp `createdAt DESC` |

#### Lọc thời gian

| Khối | Lọc `from`/`to`? |
|------|------------------|
| Thống kê phiếu (`byStatus`) | ✅ `createdAt` |
| `pendingApproval` | ✅ `createdAt` |
| `recentMovements` | ✅ `createdAt` |
| `inventory`, `alerts` | ❌ snapshot hiện tại |

---

## Nhóm C — Dashboard toàn tổ chức

> **Tài liệu chi tiết phân quyền + từng trường:** [ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md)

---

### `GET /reports/organization-overview`

**Mục đích:** Dashboard **toàn tổ chức** — gom kho, phiếu, tổng SL nhập/xuất, top sản phẩm, tồn kho tổng hợp, breakdown theo kho.

#### Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|----------|-------|
| `from` | ISO datetime | — | Lọc phiếu theo `createdAt`; lọc SL SP theo `completedAt` |
| `to` | ISO datetime | — | Tương tự |
| `expiryDays` | integer > 0 | `30` | Ngưỡng cảnh báo hết hạn (block `inventory`) |
| `topLimit` | integer 1–20 | `5` | Số SP top nhập/xuất |
| `recentLimit` | integer 1–20 | `5` | Số phiếu chờ duyệt trả về |

#### Phân quyền Organization Overview

API tự xác định phạm vi qua `visibilityScope` trong response.

| Role | `visibilityScope` | Dữ liệu |
|------|-------------------|---------|
| `admin` | `organization` | Toàn bộ tổ chức |
| `accountant` | `organization` | Toàn bộ |
| `approver` | `organization` | Toàn bộ |
| `warehouse_keeper` | `own_documents` | Chỉ phiếu mình tạo/duyệt |
| `viewer` | `own_documents` | Chỉ phiếu mình tạo/duyệt |

**Điều kiện “phiếu do tôi xử lý”:** `createdById = userId OR approvedById = userId`

**Phạm vi kho:**

- `admin`: tất cả kho active
- Role khác: kho trong `user_warehouses`

**Khác biệt theo scope:**

| Khối | `organization` | `own_documents` |
|------|----------------|-----------------|
| `inventory` | Có — tồn tổng hợp | `null` |
| `warehousesBreakdown` | Có — chi tiết từng kho | `[]` |
| `documents.*` | Tất cả phiếu | Phiếu của user |
| `productMovement.*` | Phiếu completed toàn org | Phiếu completed của user |

#### Response — cấu trúc đầy đủ

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T14:00:00.000Z",
    "visibilityScope": "organization",
    "role": "admin",
    "filters": {
      "from": null, "to": null,
      "expiryDays": 30, "topLimit": 5, "recentLimit": 5
    },
    "organization": {
      "warehouseCount": 3,
      "warehouses": [{ "id", "code", "name" }]
    },
    "documents": {
      "stockReceipts": {
        "byStatus", "total", "pendingApproval", "draft", "completed",
        "pendingApprovalList": [ ... ]
      },
      "stockIssues": {
        "byStatus", "total", "pendingApproval", "draft", "completed",
        "pendingApprovalList": [ ... ]
      },
      "stockOpenings": { "byStatus", "total", "pendingApproval", "draft", "completed" }
    },
    "productMovement": {
      "totalImportedQty": "100.0000",
      "totalExportedQty": "50.0000",
      "importedQtyByUnit": [{ "baseUnitName", "qty" }],
      "exportedQtyByUnit": [{ "baseUnitName", "qty" }],
      "topImportedProducts": [{ "productId", "sku", "name", "baseUnitName", "totalQty", "documentCount" }],
      "topExportedProducts": [ ... ],
      "dailyMovement": [{ "date", "importedQty", "exportedQty" }]
    },
    "inventory": {
      "skuCount", "totalOnhandQty", "totalReservedQty", "totalAvailableQty",
      "estimatedStockValue", "lowStockCount", "expiryAlertCount", "activeReservationCount",
      "qtyByUnit": [{ "baseUnitName", "onhandQty", "reservedQty", "availableQty" }]
    },
    "warehousesBreakdown": [
      {
        "warehouse": { "id", "code", "name" },
        "productMovement": {
          "totalImportedQty", "totalExportedQty",
          "importedQtyByUnit", "exportedQtyByUnit"
        },
        "stockReceipts": { "byStatus", "total", ... },
        "stockIssues": { "byStatus", "total", ... }
      }
    ]
  }
}
```

#### `productMovement.dailyMovement`

Chuỗi **nhập/xuất theo ngày** — chỉ có khi **cả `from` và `to` đều được truyền**.

| Trường | Mô tả |
|--------|-------|
| `date` | `YYYY-MM-DD` (UTC) |
| `importedQty` | Tổng SL nhập completed trong ngày |
| `exportedQty` | Tổng SL xuất completed trong ngày |

Ngày không có giao dịch vẫn trả về với qty = `"0.0000"`.

#### `pendingApprovalList` — phiếu nhập

| Trường | Mô tả |
|--------|-------|
| `id`, `code`, `receiptDate`, `receiptType`, `totalAmount`, `status`, `createdAt` | Thông tin phiếu |
| `warehouse` | `{ id, code, name }` |
| `supplier` | `{ id, code, name }` hoặc null |
| `createdById` | User tạo phiếu |

#### `pendingApprovalList` — phiếu xuất

| Trường | Mô tả |
|--------|-------|
| `id`, `code`, `issueDate`, `issueType`, `status`, `createdAt` | Thông tin phiếu |
| `warehouse` | `{ id, code, name }` |
| `customer` | Khách hàng (khi xuất bán) |
| `createdById` | User tạo phiếu |

---

## So sánh các API

### Theo use case

| Use case | API đề xuất |
|----------|-------------|
| Tra cứu tồn từng dòng balance | `stock-balance` |
| Xem lịch sử biến động đầy đủ (phân trang) | `stock-movement` |
| Danh sách SP sắp hết (đơn giản) | `low-stock` |
| Danh sách lô sắp hết hạn (đơn giản) | `expiry-alert` |
| Màn chọn kho / badge tổng quan | `warehouse-overview` (list) |
| Màn chi tiết kho + alerts + phiếu chờ | `warehouse-overview/:id` |
| Dashboard CEO / kế toán / admin | `organization-overview` |
| Dashboard cá nhân thủ kho | `organization-overview` (scope `own_documents`) |

### Ma trận tính năng

| Tính năng | stock-balance | stock-movement | low-stock | expiry-alert | wh list | wh detail | org overview |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Phân trang | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lọc `from`/`to` | ❌ | ✅ | ❌ | ❌ | ✅ (phiếu) | ✅ (phiếu + ledger) | ✅ |
| Tồn kho snapshot | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Thống kê phiếu | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Cảnh báo chi tiết | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ (chỉ count) |
| Top SP nhập/xuất | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Phân quyền own docs | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Breakdown theo kho | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Biểu đồ theo ngày | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`dailyMovement`) |

### Warehouse vs Organization Overview

| | Warehouse Overview | Organization Overview |
|--|-------------------|----------------------|
| Phạm vi | Từng kho / list kho | Toàn tổ chức |
| Top SP nhập/xuất | ❌ | ✅ |
| Phân quyền own docs | ❌ | ✅ |
| Alerts / movements chi tiết | ✅ (detail) | ❌ |
| `dailyMovement` | ❌ | ✅ (khi có from+to) |

---

## Enums tham chiếu

### DocStatus — trạng thái phiếu

| Giá trị | Ý nghĩa |
|---------|---------|
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

## Luồng tích hợp gợi ý

### Luồng dashboard chính (Flutter / Web)

```
Login → GET /auth/me (lấy tenantId)
  │
  ├─ Role admin/accountant/approver
  │     GET /organization-overview
  │       ├─ inventory, topImportedProducts, topExportedProducts
  │       ├─ dailyMovement (nếu có from+to → vẽ chart)
  │       └─ warehousesBreakdown → tap kho
  │             GET /warehouse-overview/:warehouseId
  │
  └─ Role warehouse_keeper/viewer
        GET /organization-overview (scope own_documents)
          ├─ documents.stockReceipts / stockIssues
          └─ productMovement (phiếu của mình)
                GET /warehouse-overview/:id (chi tiết kho được gán)
```

### Luồng báo cáo tra cứu

```
Màn "Tồn kho"        → GET /stock-balance?page=&limit=&warehouseId=
Màn "Biến động"      → GET /stock-movement?from=&to=&warehouseId=
Màn "Sắp hết hàng"   → GET /low-stock?warehouseId=
Màn "Sắp hết hạn"    → GET /expiry-alert?days=&warehouseId=
```

### Mapping UI ↔ API (dashboard kho)

| Thành phần UI | Nguồn dữ liệu |
|---------------|---------------|
| Thẻ kho (tên, mã) | `warehouse-overview` → `warehouses[].warehouse` |
| Badge phiếu chờ duyệt | `pendingApproval` — **number** (list) / **array** (detail) |
| Badge hết hàng / hết hạn | `inventory.lowStockCount` / `inventory.expiryAlertCount` |
| Giá trị tồn kho | `inventory.estimatedStockValue` |
| Danh sách SP sắp hết | `warehouse-overview/:id` → `alerts.lowStock[]` |
| Timeline biến động | `warehouse-overview/:id` → `recentMovements[]` |
| “Cập nhật lúc …” | `generatedAt` |

### Pull-to-refresh

Sau thao tác phiếu (submit / approve / complete), gọi lại API overview. Cache server tự invalidate trong vài giây.

---

## Tài liệu liên quan

| Tài liệu | Nội dung |
|----------|----------|
| [API.md](./API.md) | Reference đầy đủ mọi endpoint hệ thống |
| [WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md) | Chi tiết từng trường Warehouse Overview + ví dụ Dart |
| [ORGANIZATION_OVERVIEW.md](./ORGANIZATION_OVERVIEW.md) | Chi tiết phân quyền + response Organization Overview |
| [USER_TENANTS.md](./USER_TENANTS.md) | Lấy `tenantId` và header `X-Tenant-Id` |
| [PUSH_NOTIFICATION_FLUTTER.md](./PUSH_NOTIFICATION_FLUTTER.md) | Push khi có phiếu chờ duyệt |

---

## Source code tham chiếu

| File | Vai trò |
|------|---------|
| `src/modules/report/report.routes.ts` | Định nghĩa 7 route |
| `src/modules/report/report.controller.ts` | Controller |
| `src/modules/report/report.service.ts` | stock-balance, stock-movement, low-stock, expiry-alert |
| `src/modules/report/warehouse-overview.service.ts` | warehouse-overview list + detail |
| `src/modules/report/organization-overview.service.ts` | organization-overview |
| `src/dto/report.dto.ts` | Schema query params (Zod) |
| `src/modules/report/stock-alert.helpers.ts` | Logic low-stock + expiry-alert |
