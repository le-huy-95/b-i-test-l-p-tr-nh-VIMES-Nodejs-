# Stock Issue Out-of-Stock Status & Notification Design

**Date:** 2026-09-09  
**Status:** Approved (brainstorm)  
**Scope:** Phiếu xuất kho (`stock_issue`) only

## Problem

Khi duyệt / xuất phiếu xuất mà tồn kho không đủ, hệ thống hiện trả `STOCK_INSUFFICIENT` (409) hoặc (async complete) chỉ log lỗi — **không gửi thông báo** và **không có status “hết hàng”**. Client/admin không biết phiếu đang bị kẹt chờ nhập kho, và khi nhập đủ hàng cũng không tự mở khóa phiếu.

## Decisions

1. Soft-fail (không 409) khi thiếu tồn ở **cả hai** thời điểm: `markPendingApproval` (reserve lúc bước kho duyệt) và `completeNow` (xuất).
2. Thêm `DocStatus.out_of_stock` (“hết hàng”). **Không** thêm status mới trên workflow enum.
3. Workflow step approve vẫn ghi nhận thành công khi soft-fail lúc reserve; phiếu business → `out_of_stock`.
4. Lưu `statusBeforeOutOfStock` = **status đích đã định vào** khi soft-fail (không phải status “kẹt” trước đó):
   - Soft-fail lúc reserve (`markPendingApproval`): `statusBeforeOutOfStock = pending_approval` (workflow bước kho đã approve; khi có hàng → vào `pending_approval` + tạo reservation).
   - Soft-fail lúc complete: `statusBeforeOutOfStock = approved` (mở khóa để user complete lại).
5. Notify khi hết hàng: recipients = `tenant_roles` `admin` + `accountant` **và** `source_creator`.
6. Khi phiếu nhập kho `complete` tăng tồn đủ cho **toàn bộ dòng** của phiếu xuất đang `out_of_stock` (cùng warehouse + product overlap) → restore `statusBeforeOutOfStock`; nếu `pending_approval` thì tạo reservation; nếu `approved` thì chỉ mở khóa (không auto-complete).
7. Notify khi có hàng lại (`ISSUE_STOCK_AVAILABLE`) cùng recipient policy.
8. Partial fulfill **không** resolve — phải đủ tất cả dòng của phiếu.

## Flow

```
Approve (warehouse / enter pending_approval)
  → allocate/reserve
  → đủ hàng: pending_approval + reservations (như hiện tại)
  → thiếu hàng: out_of_stock + statusBeforeOutOfStock=pending_approval
                 + notify ISSUE_OUT_OF_STOCK
                 (không reservation; HTTP success)

Complete / xuất
  → đủ hàng: completed (như hiện tại)
  → thiếu hàng: out_of_stock + statusBeforeOutOfStock=approved
                 + notify ISSUE_OUT_OF_STOCK
                 (không posting out; HTTP success / queue soft-fail)

Receipt complete (direction in)
  → posting applyIncrease
  → tryResolveOutOfStockIssues(tenant, warehouse, productIds)
       → với mỗi issue out_of_stock đủ tồn:
            restore statusBeforeOutOfStock
            clear out-of-stock fields
            nếu pending_approval → tạo reservation
            notify ISSUE_STOCK_AVAILABLE
```

## Schema

### `DocStatus`

Thêm: `out_of_stock`

### `StockIssue`

| Field | Type | Notes |
|-------|------|--------|
| `statusBeforeOutOfStock` | `DocStatus?` | Status khôi phục khi có hàng |
| `outOfStockAt` | `DateTime?` | Thời điểm chuyển hết hàng |
| `outOfStockReason` | `String?` | Tóm tắt / JSON ngắn (product thiếu) — optional cho UI/debug |

Receipt / opening: không dùng status này.

### Notifications

| Event | DB `NotificationType` | Recipients |
|-------|----------------------|------------|
| `ISSUE_OUT_OF_STOCK` | `issue_out_of_stock` | admin, accountant + creator |
| `ISSUE_STOCK_AVAILABLE` | `issue_stock_available` | cùng policy |

Payload theo `TenantNotificationEvent` hiện có; `data` có thể chứa danh sách dòng thiếu (`productId`, `available`, `requested`). Route: `stock_issue_detail` / deeplink issue như các event issue khác.

## API impact

| Area | Change |
|------|--------|
| GET/list issue | `status` có thể là `out_of_stock`; filter list nhận giá trị mới |
| Workflow approve → `markPendingApproval` | Thiếu tồn → 200 + body `status: out_of_stock` (+ details), không 409 |
| Complete issue | Thiếu tồn → soft-fail như trên |
| Actions khi `out_of_stock` | Không complete / không final approve / không reserve path cũ; cho phép cancel / reject |
| Receipt complete | Side-effect resolve issue `out_of_stock` đủ hàng |

## Guards

- `complete` / `approve` (final) / re-enter `pending_approval` qua path cũ: **409** nếu đang `out_of_stock` (chỉ mở qua resolve hook hoặc cancel/reject).
- `cancel` / `reject` từ `out_of_stock`: cho phép; clear `statusBeforeOutOfStock` / out-of-stock fields.

## Components

| Unit | Responsibility |
|------|----------------|
| `stock-issue.service` | Soft-fail → `out_of_stock`; guards; restore + optional reserve |
| `stock-doc-notify` + `event-types` + Prisma `NotificationType` | Hai event mới |
| `stock-receipt.service` `completeNow` | Gọi resolve sau tăng tồn |
| `tryResolveOutOfStockIssues` (helper, cạnh issue hoặc stock-balance) | Query + check allocate + restore |
| DTO / list filters / warehouse-overview `DOC_STATUSES` | Nhận `out_of_stock` |

## Out of scope

- Status `out_of_stock` cho phiếu nhập / opening
- Xuất một phần (partial issue)
- Đổi workflow template / thêm `WorkflowDocumentStatus`
- Auto-complete phiếu sau khi có hàng (user vẫn complete thủ công nếu previous = `approved`)
- Đổi recipient policy các event issue cũ

## Testing

- Reserve thiếu tồn → `out_of_stock`, `statusBeforeOutOfStock=pending_approval`, notify out-of-stock, không reservation
- Complete thiếu tồn → `out_of_stock`, previous=`approved`, không posting out
- Receipt complete chưa đủ → issue vẫn `out_of_stock`
- Receipt complete đủ toàn bộ dòng → restore đúng previous; `pending_approval` có reservation; `approved` không auto-complete; notify stock-available
- Guard: complete khi `out_of_stock` → 409
- Cancel/reject từ `out_of_stock` → OK
