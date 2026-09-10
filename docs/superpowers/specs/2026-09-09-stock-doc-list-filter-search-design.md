# Stock Document List Filter & Search Design

**Date:** 2026-09-09  
**Status:** Pending review  
**Approach:** Shared query DTO + Prisma filters (no schema denormalize)

## Problem

Docs ghi `status` / `warehouseId` / `search` trên list phiếu và `GET /documents`, nhưng code hiện chỉ hỗ trợ phân trang (và `/documents` mới có `documentType` / `status` / `assignedApproverId`). Client cần lọc theo trạng thái, kho, và tìm theo mã phiếu hoặc tên kho.

## Decisions

1. Scope API:
   - `GET /stock-issues`
   - `GET /stock-receipts`
   - `GET /stock-openings`
   - `GET /documents`
2. Query params chung (ngoài param riêng của `/documents`):
   | Param | Type | Behavior |
   |---|---|---|
   | `page`, `limit` | int | như hiện tại |
   | `status` | string? | exact match |
   | `warehouseId` | string? | exact match theo kho |
   | `search` | string? | contains, case-insensitive trên **mã phiếu (`code`)** **hoặc** **tên kho (`warehouse.name`)** |
3. `status` semantics:
   - 3 list phiếu: `DocStatus` (`draft` \| `pending_approval` \| `approved` \| `completed` \| `rejected` \| `cancelled`)
   - `GET /documents`: `WorkflowDocumentStatus` (giữ như hiện tại)
4. Giữ visibility list hiện tại (admin / warehouse_keeper / accountant = full; role khác = related-only). Filter/search **AND** với visibility where.
5. Không thêm field `name` cho phiếu. Không denormalize `code`/`warehouseId` vào `document_workflows` trong scope này.
6. Không thêm `pg_trgm` / full-text index trong scope này (có thể làm sau nếu data lớn).

## Filter behavior (3 list phiếu)

Parse query bằng shared schema (mở rộng từ `paginationSchema` hoặc DTO riêng `stockDocListQuerySchema`).

`where` Prisma (sau visibility):

```
tenantId + visibility
+ status?          → exact
+ warehouseId?     → exact
+ search?          → OR [
    { code: { contains: search, mode: insensitive } },
    { warehouse: { name: { contains: search, mode: insensitive } } }
  ]
```

Khi không có query (hoặc chỉ empty object): giữ behavior hiện tại (trả full list không paginate) — **không đổi** contract cũ.

Khi query object có bất kỳ key nào (`page` / `status` / `search` / …): path paginated (default `page=1`, `limit=20` nếu thiếu) + `where` đầy đủ; cache key stringify toàn bộ query đã parse.

## Filter behavior (`GET /documents`)

Giữ: `documentType`, `status`, `assignedApproverId`, `page`, `limit`.

Thêm: `warehouseId?`, `search?`.

Vì `document_workflows` không có `code` / `warehouseId`:

1. Áp `tenantId` + `documentType?` + `status?` + `assignedApproverId?` như hiện tại.
2. Nếu có `warehouseId` hoặc `search`:
   - Resolve `documentId` từ bảng phiếu tương ứng:
     - Có `documentType` → chỉ 1 bảng (`stock_issues` / `stock_receipts` / `stock_opening_balances`).
     - Không có `documentType` → union id từ cả 3 bảng (cùng điều kiện warehouse/search).
   - Thêm `documentId: { in: matchedIds }` vào where workflow.
   - Nếu `matchedIds` rỗng → trả list rỗng + pagination total 0 (không query workflow thừa).
3. `search` trên bước resolve phiếu: cùng rule code OR warehouse.name (insensitive contains).
4. `warehouseId` trên bước resolve: exact trên phiếu.

Response shape `/documents` không đổi (không bắt buộc embed warehouse name trong list item lần này).

## Performance (light optimizations)

Đã có index hữu ích: `(tenantId, status, warehouseId)` trên phiếu → filter `status`/`warehouseId` đi theo index.

`search` `ILIKE '%…%'` không dùng unique `(tenantId, code)`; chấp nhận cho quy mô tenant vừa.

Tối ưu nhẹ trong implementation:

1. Luôn áp `status` / `warehouseId` trước trong `where` (cùng visibility).
2. Với `search` trên list phiếu: dùng relation filter `warehouse.name` (Prisma join) — tránh N+1; không preload toàn bộ kho nếu không cần.
3. Optional micro-opt (nếu đơn giản): khi `search` chỉ cần match tên kho, có thể preselect `warehouseId` trong tenant (`name contains`) rồi `OR code contains OR warehouseId in (...)` — chọn cách nào gọn và đúng hơn khi implement; behavior API giống nhau.
4. `/documents`: nếu có `documentType` thì chỉ lookup 1 bảng phiếu.
5. Out of scope: `pg_trgm` GIN trên `code` / `warehouses.name`.

## Validation

- `status` invalid → 400 validation (Zod enum đúng từng API).
- `warehouseId` / `search` empty string: treat như không gửi (optional coerce/trim) hoặc reject — prefer trim + empty → undefined.
- `search` không bắt buộc min length trong v1 (giống product list).

## Docs

Cập nhật cho khớp code:

- `docs/STOCK_DOCUMENT_API.md` — list phiếu + `/documents`
- `docs/API.md` — query params list nếu thiếu

Ghi rõ: `search` = code **hoặc** tên kho (không phải “tên phiếu”).

## Out of scope

- Tìm theo `note`, product name, supplier/customer name
- Denormalize fields lên `document_workflows`
- Full-text / trigram indexes
- Đổi visibility / cache invalidation strategy (chỉ đảm bảo cache key gồm filter params)
- Thêm `createdById` filter (docs từng ghi nhưng chưa implement — cập nhật docs bỏ claim này cho khớp code)

## Test plan

- Unit: list issue/receipt/opening — filter `status`, `warehouseId`, `search` (code), `search` (warehouse name), kết hợp + visibility staff vẫn AND.
- Unit: `listWorkflows` — `warehouseId`, `search`, có/không `documentType`, empty match → empty page.
- Cache key khác nhau khi filter khác nhau.
- Không regress: list không query → vẫn full array như cũ.
