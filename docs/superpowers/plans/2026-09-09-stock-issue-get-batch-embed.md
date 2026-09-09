# Stock Issue GET — Embed Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/v1/stock-issues/:id` trả `details[].batch` (object lô đầy đủ field client-safe) thay vì chỉ `batchId`.

**Architecture:** Thêm Prisma relation `StockIssueDetail.batch` → `Batch`, `include` + `select` field an toàn trong `StockIssueService.get` only. `withVnTimestamps` đã deep-map nên `expiryDate` / `manufactureDate` / `createdAt` trên nested `batch` tự format +07:00.

**Tech Stack:** Prisma, TypeScript, Vitest, Express route hiện có.

**Spec:** `docs/superpowers/specs/2026-09-09-stock-issue-get-batch-embed-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Relation `batch` trên `StockIssueDetail` + back-relation trên `Batch` |
| `prisma/migrations/20260909130000_stock_issue_detail_batch_fk/migration.sql` | FK `stock_issue_details.batch_id` → `batches.id` (SET NULL) |
| `src/modules/stock-issue/stock-issue.service.ts` | `get()` include batch với select field client-safe |
| `tests/modules/stock-issue.get-batch.test.ts` | Unit tests cho get + batch embed / null |
| `docs/STOCK_DOCUMENT_API.md` | Document response `details[].batch` ở §4.3 |

---

### Task 1: Failing tests for GET embed batch

**Files:**
- Create: `tests/modules/stock-issue.get-batch.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockIssueService } from "../../src/modules/stock-issue/stock-issue.service";

describe("stock issue get embeds batch", () => {
  const findFirst = vi.fn();
  const workflowFindMany = vi.fn();
  const db = {
    stockIssue: { findFirst },
    documentWorkflowStep: { findMany: workflowFindMany },
  } as any;
  const service = new StockIssueService(db, {} as any, { getOrSet: vi.fn() } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    workflowFindMany.mockResolvedValue([]);
  });

  it("includes selected batch fields and omits tenantId/receiptDetailId", async () => {
    findFirst.mockResolvedValue({
      id: "issue-1",
      tenantId: "tenant-1",
      details: [
        {
          id: "line-1",
          productId: "product-1",
          batchId: "batch-1",
          batch: {
            id: "batch-1",
            productId: "product-1",
            warehouseId: "wh-1",
            batchNo: "L001",
            manufactureDate: new Date("2026-01-15T00:00:00.000Z"),
            expiryDate: new Date("2027-01-15T00:00:00.000Z"),
            supplierId: null,
            unitCost: { toString: () => "10000.0000" },
            createdAt: new Date("2026-09-01T03:00:00.000Z"),
          },
        },
      ],
      customer: null,
      warehouse: { id: "wh-1" },
    });

    const result = await service.get("tenant-1", "issue-1", {
      userId: "admin-1",
      role: "admin",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          details: {
            include: {
              batch: {
                select: {
                  id: true,
                  productId: true,
                  warehouseId: true,
                  batchNo: true,
                  manufactureDate: true,
                  expiryDate: true,
                  supplierId: true,
                  unitCost: true,
                  createdAt: true,
                },
              },
            },
          },
        }),
      }),
    );

    const line = result.details[0] as any;
    expect(line.batchId).toBe("batch-1");
    expect(line.batch).toMatchObject({
      id: "batch-1",
      batchNo: "L001",
      productId: "product-1",
      warehouseId: "wh-1",
      supplierId: null,
    });
    expect(line.batch.tenantId).toBeUndefined();
    expect(line.batch.receiptDetailId).toBeUndefined();
    expect(String(line.batch.expiryDate)).toContain("+07:00");
    expect(String(line.batch.manufactureDate)).toContain("+07:00");
  });

  it("returns batch null when batchId is null", async () => {
    findFirst.mockResolvedValue({
      id: "issue-2",
      tenantId: "tenant-1",
      details: [
        {
          id: "line-2",
          productId: "product-1",
          batchId: null,
          batch: null,
        },
      ],
      customer: null,
      warehouse: { id: "wh-1" },
    });

    const result = await service.get("tenant-1", "issue-2", {
      userId: "admin-1",
      role: "admin",
    });

    expect((result.details[0] as any).batch).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/modules/stock-issue.get-batch.test.ts`

Expected: FAIL — `findFirst` called with `include.details: true` (no batch select), and/or assertion on include shape fails.

- [ ] **Step 3: Commit tests**

```bash
git add tests/modules/stock-issue.get-batch.test.ts
git commit -m "test: cover stock-issue GET embed batch fields"
```

---

### Task 2: Prisma relation + FK migration

**Files:**
- Modify: `prisma/schema.prisma` (`Batch` ~642–665, `StockIssueDetail` ~806–823)
- Create: `prisma/migrations/20260909130000_stock_issue_detail_batch_fk/migration.sql`

- [ ] **Step 1: Update schema**

On `Batch`, add:

```prisma
  issueDetails    StockIssueDetail[]
```

On `StockIssueDetail`, add:

```prisma
  batch   Batch?      @relation(fields: [batchId], references: [id])
```

(Keep existing `issue` / `product` relations.)

- [ ] **Step 2: Add migration SQL**

```sql
-- AlterTable
ALTER TABLE "stock_issue_details"
  ADD CONSTRAINT "stock_issue_details_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

(Same pattern as `stock_opening_balance_details_batch_id_fkey`.)

- [ ] **Step 3: Generate client**

Run: `npx prisma generate`

Expected: success, no schema errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260909130000_stock_issue_detail_batch_fk/
git commit -m "feat: relate stock issue detail to batch"
```

---

### Task 3: Implement `get()` include + select

**Files:**
- Modify: `src/modules/stock-issue/stock-issue.service.ts` (`get` method ~96–109)

- [ ] **Step 1: Change include in `get` only**

Replace:

```ts
include: { details: true, customer: true, warehouse: true },
```

with:

```ts
include: {
  details: {
    include: {
      batch: {
        select: {
          id: true,
          productId: true,
          warehouseId: true,
          batchNo: true,
          manufactureDate: true,
          expiryDate: true,
          supplierId: true,
          unitCost: true,
          createdAt: true,
        },
      },
    },
  },
  customer: true,
  warehouse: true,
},
```

Do **not** change `requireById` or mutation includes.

- [ ] **Step 2: Run tests — expect PASS**

Run: `npx vitest run tests/modules/stock-issue.get-batch.test.ts tests/modules/stock-issue.visibility.test.ts`

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/stock-issue/stock-issue.service.ts
git commit -m "feat: embed batch on stock-issue GET detail"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/STOCK_DOCUMENT_API.md` (§4.3 ~152–153)

- [ ] **Step 1: Document response**

Under `### 4.3 Xem chi tiết`, after the endpoint bullet, add:

```markdown
Response `details[]` gồm `batchId` (giữ tương thích) và object `batch`:

- Có lô: `batch` = `{ id, productId, warehouseId, batchNo, manufactureDate, expiryDate, supplierId, unitCost, createdAt }`
- Không lô (`batchId` null): `batch` = `null`
- Không trả `tenantId` / `receiptDetailId` trong `batch`
- Chỉ endpoint GET by id; list/create/update chưa embed `batch`
```

- [ ] **Step 2: Commit**

```bash
git add docs/STOCK_DOCUMENT_API.md
git commit -m "docs: document stock-issue GET batch embed"
```

---

## Spec coverage checklist

| Spec decision | Task |
|---------------|------|
| Chỉ GET `:id` | Task 3 |
| Nested `batch` object | Task 3 |
| `batch: null` khi không có lô | Task 1 + 3 |
| Giữ `batchId` | Task 1 asserts |
| Prisma relation | Task 2 |
| Field list + omit tenantId/receiptDetailId | Task 1 + 3 select |
| Docs STOCK_DOCUMENT_API | Task 4 |
| Tests | Task 1 |

## Out of scope (do not implement)

- List / mutation response shape
- Redis cache for issue get
- Columns `batchNo`/`expiryDate` on `stock_issue_details`
