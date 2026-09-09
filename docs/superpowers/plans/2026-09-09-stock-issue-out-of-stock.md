# Stock Issue Out-of-Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi phiếu xuất thiếu tồn lúc reserve hoặc complete → soft-fail sang `out_of_stock`, notify admin/accountant + creator; khi nhập kho đủ hàng → restore status đích và notify.

**Architecture:** Extend `DocStatus` + fields trên `StockIssue`. Soft-catch `STOCK_INSUFFICIENT` trong `markPendingApproval` / `completeNow`. Dual-publish notify (roles + creator). After receipt `completeNow` posting in, call `tryResolveOutOfStockIssues` trên issue service.

**Tech Stack:** Prisma, TypeScript, Vitest, existing notification outbox/Kafka helpers.

**Spec:** `docs/superpowers/specs/2026-09-09-stock-issue-out-of-stock-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | `DocStatus.out_of_stock`; StockIssue fields; `NotificationType` mới |
| `prisma/migrations/20260909140000_stock_issue_out_of_stock/` | SQL migration |
| `src/shared/notifications/event-types.ts` | `ISSUE_OUT_OF_STOCK`, `ISSUE_STOCK_AVAILABLE` |
| `src/shared/notifications/stock-doc-notify.ts` | `notifyIssueOutOfStock`, `notifyIssueStockAvailable` (dual publish) |
| `src/modules/stock-issue/stock-issue.service.ts` | Soft-fail, guards, cancel/reject clear fields, `tryResolveOutOfStockIssues` |
| `src/modules/stock-receipt/stock-receipt.service.ts` | Hook resolve sau complete |
| `src/modules/report/warehouse-overview.helpers.ts` | `DOC_STATUSES` + `emptyStatusCounts` |
| `tests/modules/stock-issue.out-of-stock.test.ts` | Unit tests soft-fail + resolve + guards |
| `tests/modules/stock-issue.lifecycle.test.ts` | Mock notify mới; regression |
| `docs/API.md` hoặc `docs/STOCK_DOCUMENT_API.md` | Ghi status + notify (ngắn) |

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260909140000_stock_issue_out_of_stock/migration.sql`

- [ ] **Step 1: Update Prisma schema**

`DocStatus` add `out_of_stock`.

`NotificationType` add `issue_out_of_stock`, `issue_stock_available`.

`StockIssue` add:
```prisma
  statusBeforeOutOfStock DocStatus? @map("status_before_out_of_stock")
  outOfStockAt           DateTime?  @map("out_of_stock_at")
  outOfStockReason       String?    @map("out_of_stock_reason")
```

- [ ] **Step 2: Write migration SQL**

```sql
-- AlterEnum DocStatus
ALTER TYPE "DocStatus" ADD VALUE 'out_of_stock';

-- AlterEnum NotificationType
ALTER TYPE "NotificationType" ADD VALUE 'issue_out_of_stock';
ALTER TYPE "NotificationType" ADD VALUE 'issue_stock_available';

-- AlterTable
ALTER TABLE "stock_issues" ADD COLUMN "status_before_out_of_stock" "DocStatus",
ADD COLUMN "out_of_stock_at" TIMESTAMP(3),
ADD COLUMN "out_of_stock_reason" TEXT;
```

(If Postgres requires commit between enum add and use — follow existing migration style in repo.)

- [ ] **Step 3: Generate client**

Run: `npx prisma generate`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260909140000_stock_issue_out_of_stock
git commit -m "feat: add out_of_stock DocStatus and issue fields"
```

---

### Task 2: Notification events + helpers

**Files:**
- Modify: `src/shared/notifications/event-types.ts`
- Modify: `src/shared/notifications/stock-doc-notify.ts`
- Modify: test mocks that list notify exports (`tests/modules/stock-issue.lifecycle.test.ts`, etc.)

- [ ] **Step 1: Extend event-types**

Add to `NOTIFICATION_EVENT_TYPES` and `EVENT_TYPE_TO_NOTIFICATION_TYPE`:
- `ISSUE_OUT_OF_STOCK` → `issue_out_of_stock`
- `ISSUE_STOCK_AVAILABLE` → `issue_stock_available`

- [ ] **Step 2: Add notify helpers**

Recipient policy không gộp roles+creator → **hai lần** `publishTenantNotification` mỗi helper:

`notifyIssueOutOfStock(tenantId, issue, actor, details?)`:
- Title: `Sản phẩm đã hết trong kho`
- Body: gồm `issue.code`
- `data.insufficient` optional
- Publish 1: `tenant_roles` `['admin','accountant']`
- Publish 2: `source_creator` với `issue.createdById`

`notifyIssueStockAvailable(tenantId, issue, actor)`:
- Title: `Phiếu xuất đã có hàng`
- Body: có thể tiếp tục xử lý `issue.code`
- Cùng dual publish

- [ ] **Step 3: Commit**

```bash
git add src/shared/notifications/
git commit -m "feat: notify issue out-of-stock and stock-available"
```

---

### Task 3: Soft-fail markPendingApproval + completeNow + guards (TDD)

**Files:**
- Create: `tests/modules/stock-issue.out-of-stock.test.ts`
- Modify: `src/modules/stock-issue/stock-issue.service.ts`
- Modify: lifecycle mocks for new notify fns

- [ ] **Step 1: Write failing tests**

Cases:
1. `markPendingApproval` khi allocate fail → status `out_of_stock`, `statusBeforeOutOfStock=pending_approval`, no `createMany` reservation, gọi `notifyIssueOutOfStock`
2. `completeNow` khi allocate fail → `out_of_stock`, previous=`approved`, không `posting.apply`, notify
3. `completeNow` khi status đã `out_of_stock` → 409 `INVALID_STATUS_TRANSITION`
4. `approve` khi `out_of_stock` → 409
5. `cancel` / `reject` từ `out_of_stock` → OK và clear fields out-of-stock

Pattern mock: theo `tests/modules/stock-issue.lifecycle.test.ts` (transaction + lot mocks). Force insufficient bằng empty balances / `consumeLots` path.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/modules/stock-issue.out-of-stock.test.ts`

- [ ] **Step 3: Implement soft-fail + guards**

Trong `markPendingApproval` transaction, wrap `allocateIssueLines`:
```ts
try {
  allocations = await allocateIssueLines(...);
} catch (err) {
  if (err instanceof AppError && err.code === 'STOCK_INSUFFICIENT') {
    return trx.stockIssue.update({
      where: { id },
      data: {
        status: 'out_of_stock',
        statusBeforeOutOfStock: 'pending_approval',
        outOfStockAt: new Date(),
        outOfStockReason: JSON.stringify(err.details ?? err.message),
      },
      include: { details: true },
    });
  }
  throw err;
}
```
Sau txn: nếu `result.status === 'out_of_stock'` → `notifyIssueOutOfStock` rồi return.

Tương tự `completeNow` với `statusBeforeOutOfStock: 'approved'`.

Guards: đầu `completeNow` / `approve` / `markPendingApproval` nếu status `out_of_stock` → 409 (trừ khi đang soft-fail path từ draft/approved).

`reject` / `cancel`: cho phép từ `out_of_stock`; clear `statusBeforeOutOfStock`, `outOfStockAt`, `outOfStockReason`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: soft-fail stock issue to out_of_stock on insufficient stock"
```

---

### Task 4: Resolve on receipt complete (TDD)

**Files:**
- Modify: `tests/modules/stock-issue.out-of-stock.test.ts` (thêm cases resolve)
- Modify: `src/modules/stock-issue/stock-issue.service.ts` — `tryResolveOutOfStockIssues`
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`

- [ ] **Step 1: Failing tests for resolve**

1. `tryResolveOutOfStockIssues`: issue `out_of_stock` cùng warehouse, product overlap, allocate OK → restore `pending_approval` + `createMany` reservation + clear fields + `notifyIssueStockAvailable`
2. Restore `approved` → không reservation, không complete
3. Allocate vẫn fail → giữ `out_of_stock`, không notify available

- [ ] **Step 2: Implement `tryResolveOutOfStockIssues(tenantId, warehouseId, productIds, actor)`**

Query candidates:
```ts
where: {
  tenantId,
  warehouseId,
  status: 'out_of_stock',
  details: { some: { productId: { in: productIds } } },
}
include: { details: true }
```

Với mỗi issue (FOR UPDATE nếu trong txn riêng): thử `allocateIssueLines`; nếu OK:
- target = `statusBeforeOutOfStock` (`pending_approval` | `approved`)
- nếu `pending_approval`: create reservations như markPendingApproval
- update status = target, clear out-of-stock fields
- notify stock available

Export method trên `StockIssueService` / singleton `stockIssueService`.

- [ ] **Step 3: Hook receipt**

Sau successful `completeNow` của receipt (sau notify receipt hoặc trước — sau posting + commit txn):

```ts
const productIds = [...new Set(result.details.map(d => d.productId))];
await stockIssueService.tryResolveOutOfStockIssues(
  tenantId,
  result.warehouseId,
  productIds,
  actor,
);
```

Tránh circular import: lazy import hoặc inject. Prefer method trên existing `stockIssueService` singleton + import từ receipt service (check cycle; nếu cycle thì put helper in `src/modules/stock-issue/out-of-stock-resolve.ts`).

- [ ] **Step 4: Tests pass + commit**

```bash
git commit -m "feat: resolve out-of-stock issues when receipt completes"
```

---

### Task 5: List/report surface + docs

**Files:**
- Modify: `src/modules/report/warehouse-overview.helpers.ts` — add `out_of_stock` to `DOC_STATUSES` + `emptyStatusCounts`
- Modify: docs (API / STOCK_DOCUMENT_API) — status + 2 notify events
- Grep DTO/list filters cho status enum cứng; cập nhật nếu có

- [ ] **Step 1: Update DOC_STATUSES**
- [ ] **Step 2: Short API doc note**
- [ ] **Step 3: Run related tests**

`npx vitest run tests/modules/stock-issue.out-of-stock.test.ts tests/modules/stock-issue.lifecycle.test.ts tests/modules/stock-issue.service.test.ts`

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: document stock-issue out_of_stock status and notifies"
```

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Soft-fail reserve + complete | 3 |
| `DocStatus.out_of_stock` + fields | 1 |
| Notify roles + creator | 2 |
| Restore previous + reserve if pending | 4 |
| Receipt hook | 4 |
| Guards / cancel-reject | 3 |
| DOC_STATUSES / docs | 5 |
| No workflow enum change | — (explicit non-change) |
| Full lines only | 4 (allocate all lines) |

## Execution

User requested plan + implement in one go → use **inline execution** (executing-plans style) in this session, TDD per task, commit after each task.
