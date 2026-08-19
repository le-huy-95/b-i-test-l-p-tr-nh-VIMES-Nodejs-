# Hướng dẫn API Tổng quan Tổ chức (Organization Overview)

API dashboard **toàn tổ chức** — gom tất cả kho, phiếu nhập/xuất, thống kê sản phẩm nhập/xuất nhiều nhất, với **phân quyền theo role**.

## Endpoint

```
GET /api/v1/reports/organization-overview
```

Base URL:

- Local: `http://localhost:3004/api/v1`
- Production: `https://api.kimbap.io.vn/api/v1`

---

## Headers bắt buộc

| Header | Giá trị |
|--------|---------|
| `Authorization` | `Bearer <accessToken>` |
| `X-Tenant-Id` | `<tenantId>` |

---

## Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|----------|-------|
| `from` | ISO datetime | — | Lọc phiếu theo `createdAt >= from`; lọc số lượng SP theo `completedAt >= from` |
| `to` | ISO datetime | — | Lọc phiếu theo `createdAt <= to`; lọc số lượng SP theo `completedAt <= to` |
| `expiryDays` | integer > 0 | `30` | Ngưỡng cảnh báo hết hạn (block `inventory`) |
| `topLimit` | integer 1–20 | `5` | Số sản phẩm top nhập/xuất |
| `recentLimit` | integer 1–20 | `5` | Số phiếu chờ duyệt trả về |

### Ví dụ

```bash
curl -X GET "https://api.kimbap.io.vn/api/v1/reports/organization-overview?from=2026-08-01&to=2026-08-31&topLimit=10" \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "X-Tenant-Id: tenant-id-1"
```

---

## Phân quyền (quan trọng)

API tự xác định phạm vi dữ liệu qua field `visibilityScope` trong response.

| Role | `visibilityScope` | Dữ liệu thấy được |
|------|-------------------|-------------------|
| `admin` | `organization` | **Toàn bộ** tổ chức (mọi kho, mọi phiếu) |
| `accountant` | `organization` | **Toàn bộ** (kế toán / kế toán trưởng) |
| `approver` | `organization` | **Toàn bộ** (người duyệt) |
| `warehouse_keeper` | `own_documents` | Chỉ phiếu **mình tạo** hoặc **mình duyệt** |
| `viewer` | `own_documents` | Chỉ phiếu **mình tạo** hoặc **mình duyệt** |

**Điều kiện “phiếu do tôi xử lý”:**

```
createdById = userId  OR  approvedById = userId
```

**Phạm vi kho:**

- `admin`: tất cả kho active của tenant
- Role khác: chỉ kho được gán trong `user_warehouses`

**Khác biệt theo scope:**

| Khối dữ liệu | `organization` | `own_documents` |
|--------------|----------------|-----------------|
| `organization.warehouseCount` | Tổng kho trong phạm vi | Kho được gán |
| `documents.*` | Tất cả phiếu | Phiếu của user |
| `productMovement.*` | Tất cả phiếu **completed** | Phiếu completed của user |
| `inventory` | Có — tồn kho tổng hợp | `null` |
| `warehousesBreakdown` | Có — chi tiết từng kho | `[]` (rỗng) |

---

## Response — cấu trúc đầy đủ

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-08-17T14:00:00.000Z",
    "visibilityScope": "organization",
    "role": "admin",
    "filters": {
      "from": "2026-08-01T00:00:00.000Z",
      "to": "2026-08-31T23:59:59.999Z",
      "expiryDays": 30,
      "topLimit": 5,
      "recentLimit": 5
    },
    "organization": { ... },
    "documents": { ... },
    "productMovement": { ... },
    "inventory": { ... },
    "warehousesBreakdown": [ ... ]
  }
}
```

---

### `organization`

| Trường | Type | Mô tả |
|--------|------|-------|
| `warehouseCount` | number | Tổng số kho active trong phạm vi user |
| `warehouses` | array | Danh sách kho `{ id, code, name }` |

---

### `documents.stockReceipts` / `documents.stockIssues`

Thống kê phiếu nhập / phiếu xuất.

| Trường | Type | Mô tả |
|--------|------|-------|
| `byStatus` | object | Số phiếu theo DocStatus |
| `total` | number | Tổng số phiếu |
| `pendingApproval` | number | Số phiếu `pending_approval` |
| `draft` | number | Số phiếu `draft` |
| `completed` | number | Số phiếu `completed` |
| `pendingApprovalList` | array | Chi tiết phiếu chờ duyệt (tối đa `recentLimit`) |

**Phần tử `pendingApprovalList` — phiếu nhập:**

| Trường | Mô tả |
|--------|-------|
| `id`, `code` | ID và số phiếu |
| `receiptDate` | Ngày nhập |
| `receiptType` | Loại nhập (`purchase`, `customer_return`, …) |
| `totalAmount` | Tổng tiền (string) |
| `status` | Trạng thái |
| `createdAt` | Thời điểm tạo |
| `warehouse` | `{ id, code, name }` |
| `supplier` | `{ id, code, name }` hoặc null |
| `createdById` | User tạo phiếu |

**Phần tử `pendingApprovalList` — phiếu xuất:**

| Trường | Mô tả |
|--------|-------|
| `id`, `code` | ID và số phiếu |
| `issueDate` | Ngày xuất |
| `issueType` | Loại xuất (`sale`, `internal_use`, …) |
| `status`, `createdAt` | Trạng thái, thời gian tạo |
| `warehouse` | Kho |
| `customer` | Khách hàng (khi xuất bán) |
| `createdById` | User tạo phiếu |

### `documents.stockOpenings`

Thống kê phiếu tồn đầu kỳ — cùng cấu trúc `byStatus`, `total`, `pendingApproval`, `draft`, `completed` (không có `pendingApprovalList`).

---

### `productMovement`

Thống kê **sản phẩm nhập/xuất** từ phiếu **đã hoàn tất** (`status = completed`).

| Trường | Type | Mô tả |
|--------|------|-------|
| `totalImportedQty` | string | **Tổng số lượng** sản phẩm nhập (cộng mọi đơn vị, 4 decimal) |
| `totalExportedQty` | string | **Tổng số lượng** sản phẩm xuất |
| `importedQtyByUnit` | array | SL nhập **theo từng đơn vị cơ bản** `{ baseUnitName, qty }` |
| `exportedQtyByUnit` | array | SL xuất **theo từng đơn vị cơ bản** `{ baseUnitName, qty }` |
| `topImportedProducts` | array | SP nhập **nhiều nhất** |
| `topExportedProducts` | array | SP xuất **nhiều nhất** |

**Phần tử `topImportedProducts[]` / `topExportedProducts[]`:**

| Trường | Mô tả |
|--------|-------|
| `productId` | ID sản phẩm |
| `sku` | Mã SKU |
| `name` | Tên sản phẩm |
| `baseUnitName` | Đơn vị cơ bản |
| `totalQty` | Tổng số lượng nhập/xuất (completed) |
| `documentCount` | Số phiếu completed chứa SP này |

Ví dụ `productMovement` (rút gọn):

```json
{
  "totalImportedQty": "100.0000",
  "totalExportedQty": "50.0000",
  "importedQtyByUnit": [
    { "baseUnitName": "cái", "qty": "80.0000" },
    { "baseUnitName": "kg", "qty": "20.0000" }
  ],
  "exportedQtyByUnit": [
    { "baseUnitName": "cái", "qty": "50.0000" }
  ],
  "topImportedProducts": [
    {
      "productId": "...",
      "sku": "SP001",
      "name": "Gạo",
      "baseUnitName": "kg",
      "totalQty": "20.0000",
      "documentCount": 3
    }
  ],
  "topExportedProducts": []
}
```

---

### `inventory` (chỉ `visibilityScope = organization`)

Tồn kho **tổng hợp** tất cả kho trong phạm vi.

| Trường | Mô tả |
|--------|-------|
| `skuCount` | Số SKU distinct có tồn > 0 |
| `totalOnhandQty` | Tổng tồn thực tế |
| `totalReservedQty` | Tổng giữ chỗ |
| `totalAvailableQty` | Tồn khả dụng |
| `estimatedStockValue` | Giá trị tồn ước tính (VND) |
| `lowStockCount` | Số SP sắp hết hàng |
| `expiryAlertCount` | Số lô sắp hết hạn |
| `activeReservationCount` | Số reservation active |
| `qtyByUnit` | Tồn theo từng đơn vị `{ baseUnitName, onhandQty, reservedQty, availableQty }` |

`null` khi user có scope `own_documents`.

Ví dụ `qtyByUnit`:

```json
[
  { "baseUnitName": "cái", "onhandQty": "120.0000", "reservedQty": "10.0000", "availableQty": "110.0000" },
  { "baseUnitName": "kg", "onhandQty": "50.0000", "reservedQty": "0.0000", "availableQty": "50.0000" }
]
```

---

### `warehousesBreakdown[]` (chỉ `organization`)

Chi tiết **từng kho** — mảng rỗng với `own_documents`.

| Trường | Mô tả |
|--------|-------|
| `warehouse` | `{ id, code, name }` |
| `productMovement.totalImportedQty` | Tổng SL nhập completed tại kho |
| `productMovement.totalExportedQty` | Tổng SL xuất completed tại kho |
| `productMovement.importedQtyByUnit` | SL nhập theo đơn vị `{ baseUnitName, qty }` |
| `productMovement.exportedQtyByUnit` | SL xuất theo đơn vị `{ baseUnitName, qty }` |
| `stockReceipts` | Thống kê phiếu nhập theo status |
| `stockIssues` | Thống kê phiếu xuất theo status |

---

## Cache & hiệu năng

- Redis TTL **60 giây**, key theo tenant + scope + user (nếu own) + query.
- Invalidate qua Redis Stream khi thay đổi phiếu / tồn / master data.
- Query budget **không tăng theo số kho** (~11 query admin, ~10 query thủ kho). GET chỉ đọc: reservation hết hạn bị loại bằng `expiresAt >= now`, không `UPDATE`.
- Tồn kho cộng trong SQL (không `findMany` hết balance về app). Tổng SL nhập/xuất theo kho gộp 1 `UNION ALL`. Admin lấy `documents.*.byStatus` từ `GROUP BY warehouseId, status`. Top nhập/xuất dùng 1 `product.findMany`.

### Index phục vụ API này

Migration `20260817160000_overview_query_indexes`:

| Index | Dùng cho |
|-------|----------|
| `(tenant_id, status, completed_at)` trên phiếu nhập/xuất | Tổng SL + top SP phiếu `completed`, lọc `from`/`to` |
| `(tenant_id, created_by_id)` / `(tenant_id, approved_by_id)` | Scope `own_documents` (thủ kho/viewer) |
| `(product_id)` trên dòng phiếu | `GROUP BY productId` top nhập/xuất |
| `(tenant_id, warehouse_id, expiry_date)` trên lô | Cảnh báo hết hạn |
| `(tenant_id, status, expires_at)` trên reservation | Lọc reservation còn hạn khi đếm tồn khả dụng (read-only) |

Deploy: `npx prisma migrate deploy`

---

## Luồng Flutter gợi ý

```
Login → chọn tenant → GET /organization-overview
  │
  ├─ visibilityScope = organization  → Dashboard đầy đủ (admin/kế toán)
  │     ├─ warehouseCount, inventory
  │     ├─ topImportedProducts / topExportedProducts
  │     └─ warehousesBreakdown → tap → GET /warehouse-overview/:id
  │
  └─ visibilityScope = own_documents   → Dashboard cá nhân (thủ kho/viewer)
        ├─ documents.stockIssues / stockReceipts
        └─ productMovement (chỉ SP từ phiếu của mình)
```

---

## So sánh với Warehouse Overview

| | Organization Overview | Warehouse Overview |
|--|----------------------|-------------------|
| Endpoint | `/reports/organization-overview` | `/reports/warehouse-overview` |
| Phạm vi | Toàn tổ chức | Từng kho / list kho |
| Lọc `from`/`to` | Có (phiếu + SL SP) | Có (phiếu + biến động) |
| Top SP nhập/xuất | Có | Không |
| Phân quyền own docs | Có | Không |
| Chi tiết alerts/movements | Không | Có (API detail) |

---

## Tài liệu liên quan

- [WAREHOUSE_OVERVIEW.md](./WAREHOUSE_OVERVIEW.md) — tổng quan theo từng kho
- [USER_TENANTS.md](./USER_TENANTS.md) — lấy tenantId
- [API.md](./API.md) — reference đầy đủ
