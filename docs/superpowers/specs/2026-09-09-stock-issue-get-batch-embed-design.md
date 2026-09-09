# Stock Issue GET — Embed Batch on Details Design

**Date:** 2026-09-09  
**Status:** Approved  
**Endpoint:** `GET /api/v1/stock-issues/:id`

## Problem

`GET /stock-issues/:id` trả `details[]` chỉ có `batchId`. Client không thấy số lô / HSD mà phải gọi API khác. Phiếu nhập đã có `batchNo` + `expiryDate` trên dòng; phiếu xuất chỉ lưu `batchId` và join sang bảng `batches`.

## Decisions

1. Chỉ thay đổi **`GET /api/v1/stock-issues/:id`**. List / create / update / approve / complete giữ shape cũ.
2. Mỗi dòng `details[]` thêm object lồng **`batch`** (không chỉ flatten `batchNo` / `expiryDate`).
3. Khi `batchId` null → **`batch: null`** (luôn có key).
4. Giữ `batchId` trên dòng để tương thích client hiện tại.
5. Cách làm: **Prisma relation** trên `StockIssueDetail` → `Batch`, query `include: { details: { include: { batch: true } } }`.
6. Field `batch` expose cho client:
   - `id`, `productId`, `warehouseId`, `batchNo`, `manufactureDate`, `expiryDate`, `supplierId`, `unitCost`, `createdAt`
   - **Không** expose: `tenantId`, `receiptDetailId`
7. `requireById` / mutation responses không bắt buộc include `batch`.

## Response shape

```json
{
  "details": [
    {
      "id": "...",
      "productId": "...",
      "batchId": "clxyz...",
      "batch": {
        "id": "clxyz...",
        "productId": "...",
        "warehouseId": "...",
        "batchNo": "L001",
        "manufactureDate": "2026-01-15",
        "expiryDate": "2027-01-15",
        "supplierId": null,
        "unitCost": "10000.0000",
        "createdAt": "2026-09-01T10:00:00.000Z"
      }
    },
    {
      "batchId": null,
      "batch": null
    }
  ]
}
```

(Các field dòng khác giữ nguyên.)

## Schema + query

### Prisma

- `StockIssueDetail`: thêm  
  `batch Batch? @relation(fields: [batchId], references: [id])`
- `Batch`: thêm back-relation  
  `issueDetails StockIssueDetail[]`
- Cột `batch_id` đã tồn tại. Migration chỉ thêm FK (nếu cần) — không đổi cột dữ liệu.

### Service

Trong `StockIssueService.get`:

```ts
include: {
  details: { include: { batch: true } },
  customer: true,
  warehouse: true,
}
```

Map/select để bỏ `tenantId` và `receiptDetailId` khỏi object `batch` trước khi trả (hoặc dùng `select` trong include). Tiếp tục `withVnTimestamps` như hiện tại.

## Docs

- Cập nhật `docs/STOCK_DOCUMENT_API.md` (phần GET phiếu xuất): mô tả `details[].batch`.
- Thay đổi additive — client cũ vẫn đọc `batchId`.

## Out of scope

- List / create / update / approve / complete response shape
- Đổi logic phân bổ lô / reserve / complete
- Thêm cột `batchNo` / `expiryDate` trên `stock_issue_details`
- Cache Redis cho issue get (receipt có cache riêng; issue hiện không có)

## Testing

- `get` với dòng có `batchId` → `details[].batch` có `batchNo`, `expiryDate`, …; không có `tenantId` / `receiptDetailId`
- `get` với `batchId: null` → `batch: null`
- Visibility / 404 không đổi hành vi
