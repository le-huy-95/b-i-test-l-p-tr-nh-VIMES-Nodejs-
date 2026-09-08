# Product list newest-first

**Date:** 2026-09-04  
**Status:** Approved

## Goal

API danh sách sản phẩm trả về sản phẩm **mới tạo trước** (`createdAt` giảm dần).

## Behavior

| Endpoint / path | Sort |
|-----------------|------|
| `ProductService.list` (không query / có pagination) | `orderBy: { createdAt: "desc" }` |

Trước đây: `orderBy: { sku: "asc" }`.

## Changes

- `src/modules/product/product.service.ts`: đổi `orderBy` ở cả hai nhánh `findMany` trong `list`.

## Out of scope

- Query param sort linh hoạt
- Đổi sort các master data khác (customer, supplier, …)
- Đổi cache key / ép bust cache sau deploy (TTL + invalidate khi write vẫn áp dụng)

## Cache note

List cache key không encode sort. Sau deploy, entry cũ có thể còn sort theo SKU đến khi TTL hết hoặc invalidate khi create/update/delete.
