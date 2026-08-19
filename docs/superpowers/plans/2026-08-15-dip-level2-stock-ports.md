# DIP Level 2 — Stock Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Thêm port mỏng Stock (Reader/Writer, Ledger, Posting); consumer type theo interface; class hiện tại `implements`; không đổi hành vi/API.

**Architecture:** File port riêng cạnh service (pattern `permission-cache.ts`). Composition singleton concrete cuối file. Không DI container.

**Tech Stack:** TypeScript, Prisma `TransactionClient`, Vitest

**Spec:** `docs/superpowers/specs/2026-08-15-dip-level2-stock-ports-design.md`

**Note:** Không git commit (workspace không commit theo lựa chọn trước). Bỏ mọi bước commit.

---

## File map

| File | Action |
|------|--------|
| `src/modules/stock-balance/stock-balance.port.ts` | **Create** — `BalanceKey`, `QtyChange`, `StockBalanceReader`, `StockBalanceWriter` |
| `src/modules/stock-balance/stock-ledger.port.ts` | **Create** — `StockLedgerEntry`, `StockLedgerWriter` |
| `src/modules/stock-balance/stock-posting.port.ts` | **Create** — posting input types + `StockPostingPort` |
| `src/modules/stock-balance/stock-balance.service.ts` | **Edit** — import types from port; `implements` both; re-export types |
| `src/modules/stock-balance/stock-ledger.service.ts` | **Edit** — `implements StockLedgerWriter` |
| `src/modules/stock-balance/stock-posting.service.ts` | **Edit** — deps typed as Writer ports; `implements StockPostingPort`; types from port |
| `src/modules/stock-balance/costing/avg-costing.policy.ts` | **Edit** — ctor `StockBalanceReader` |
| `src/modules/stock-receipt/stock-receipt.service.ts` | **Edit** — ctor `StockPostingPort` |
| `src/modules/stock-opening/stock-opening.service.ts` | **Edit** — ctor `StockPostingPort` |
| `src/modules/stock-issue/stock-issue.service.ts` | **Edit** — ctor `StockBalanceReader` + `StockPostingPort` |

---

### Task 1: Create `stock-balance.port.ts` + wire `StockBalanceService`

**Files:**
- Create: `src/modules/stock-balance/stock-balance.port.ts`
- Modify: `src/modules/stock-balance/stock-balance.service.ts`

- [ ] **Step 1: Create port file**

Create `src/modules/stock-balance/stock-balance.port.ts`:

```ts
import type { Prisma } from '../../infra/prisma-types';
import type { Decimal } from '../../utils/decimal';
import { prisma } from '../../infra/prisma';

export interface BalanceKey {
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId?: string | null;
  locationId?: string | null;
}

export interface QtyChange extends BalanceKey {
  qtyBaseUnit: string;
  unitCost?: string;
}

export interface StockAvailableQty {
  onhandQty: Decimal;
  reservedQty: Decimal;
  availableQty: Decimal;
}

export type BalanceApplyResult = { key: BalanceKey; balanceAfter: string };

export interface StockBalanceReader {
  getAvailable(
    tenantId: string,
    productId: string,
    warehouseId: string,
    trx?: Prisma.TransactionClient,
  ): Promise<StockAvailableQty>;
}

export interface StockBalanceWriter {
  applyIncrease(
    changes: QtyChange[],
    trx: Prisma.TransactionClient,
  ): Promise<BalanceApplyResult[]>;
  applyDecrease(
    changes: QtyChange[],
    trx: Prisma.TransactionClient,
  ): Promise<BalanceApplyResult[]>;
}
```

Note: Do **not** import `prisma` in the port file if unused — remove unused import. Default `trx` stays on the **class** implementation only; port method may declare `trx?: Prisma.TransactionClient` without default, matching call sites that pass trx. Align with current service signature:

Current service has `trx: Prisma.TransactionClient = prisma`. Port should mirror optional-with-default via overload or keep the same signature including default in the class only. Prefer port signature:

```ts
getAvailable(
  tenantId: string,
  productId: string,
  warehouseId: string,
  trx?: Prisma.TransactionClient,
): Promise<StockAvailableQty>;
```

Class keeps `trx: Prisma.TransactionClient = prisma` — still assignable to Reader.

- [ ] **Step 2: Update `stock-balance.service.ts`**

1. Remove local `BalanceKey` / `QtyChange` interface definitions.
2. Add:

```ts
import type {
  BalanceApplyResult,
  BalanceKey,
  QtyChange,
  StockBalanceReader,
  StockBalanceWriter,
} from './stock-balance.port';
import {
  type BalanceKey as BalanceKeyReexport,
  type QtyChange as QtyChangeReexport,
} from './stock-balance.port';
```

Simpler — import types and re-export:

```ts
import type { Prisma } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { d } from '../../utils/decimal';
import { AppError } from '../../utils/app-error';
import type {
  BalanceKey,
  QtyChange,
  StockBalanceReader,
  StockBalanceWriter,
} from './stock-balance.port';

export type { BalanceKey, QtyChange } from './stock-balance.port';

export class StockBalanceService implements StockBalanceReader, StockBalanceWriter {
  // … existing methods unchanged …
}

export const stockBalanceService = new StockBalanceService();
```

Ensure return types of `applyIncrease` / `applyDecrease` stay compatible (`BalanceApplyResult[]`). No logic changes.

- [ ] **Step 3: Typecheck this slice**

Run: `npx tsc --noEmit`
Expected: exit 0 (or only unrelated pre-existing errors — fix any from this change).

- [ ] **Step 4: Skip commit** (per workspace preference).

---

### Task 2: Create `stock-ledger.port.ts` + wire `StockLedgerService`

**Files:**
- Create: `src/modules/stock-balance/stock-ledger.port.ts`
- Modify: `src/modules/stock-balance/stock-ledger.service.ts`

- [ ] **Step 1: Create port**

```ts
import type { LedgerTxnType, Prisma } from '../../infra/prisma-types';

export interface StockLedgerEntry {
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId?: string | null;
  locationId?: string | null;
  transactionType: LedgerTxnType;
  refDocType: string;
  refDocId: string;
  qtyChange: string;
  qtyBalanceAfter: string;
  unitCost?: string;
  note?: string;
  createdById: string;
}

export interface StockLedgerWriter {
  record(
    entries: StockLedgerEntry[],
    trx: Prisma.TransactionClient,
  ): Promise<void>;
}
```

- [ ] **Step 2: Update ledger service**

```ts
import { Prisma } from '../../infra/prisma-types';
import type { StockLedgerEntry, StockLedgerWriter } from './stock-ledger.port';

export class StockLedgerService implements StockLedgerWriter {
  async record(entries: StockLedgerEntry[], trx: Prisma.TransactionClient) {
    // … existing body unchanged …
  }
}

export const stockLedgerService = new StockLedgerService();
```

- [ ] **Step 3: `npx tsc --noEmit`** — expect exit 0.

- [ ] **Step 4: Skip commit.**

---

### Task 3: Create `stock-posting.port.ts` + wire `StockPostingService`

**Files:**
- Create: `src/modules/stock-balance/stock-posting.port.ts`
- Modify: `src/modules/stock-balance/stock-posting.service.ts`

- [ ] **Step 1: Create posting port**

```ts
import type { Prisma } from '../../infra/prisma-types';
import type { QtyChange } from './stock-balance.port';

export type StockPostingDirection = 'in' | 'out' | 'opening';

export interface StockPostingLedgerMeta {
  refDocType: string;
  refDocId: string;
  createdById: string;
}

export interface StockPostingInput {
  direction: StockPostingDirection;
  changes: QtyChange[];
  ledger: StockPostingLedgerMeta;
}

export interface StockPostingPort {
  apply(input: StockPostingInput, trx: Prisma.TransactionClient): Promise<void>;
}
```

- [ ] **Step 2: Update posting service**

Replace type definitions and constructor types:

```ts
import type { Prisma } from '../../infra/prisma-types';
import type { QtyChange } from './stock-balance.port';
import type { StockBalanceWriter } from './stock-balance.port';
import { stockBalanceService } from './stock-balance.service';
import type { StockLedgerWriter } from './stock-ledger.port';
import { stockLedgerService } from './stock-ledger.service';
import { resolveCostingPolicy } from './costing/costing-policy';
import type {
  StockPostingInput,
  StockPostingPort,
} from './stock-posting.port';

export type {
  StockPostingDirection,
  StockPostingInput,
  StockPostingLedgerMeta,
} from './stock-posting.port';

export class StockPostingService implements StockPostingPort {
  constructor(
    private readonly balance: StockBalanceWriter = stockBalanceService,
    private readonly ledger: StockLedgerWriter = stockLedgerService,
  ) {}

  async apply(input: StockPostingInput, trx: Prisma.TransactionClient) {
    // … existing body unchanged …
  }
}

export const stockPostingService = new StockPostingService(
  stockBalanceService,
  stockLedgerService,
);
```

Keep `compareQtyChangeKey` and body identical.

- [ ] **Step 3: `npx tsc --noEmit`** — expect exit 0.

- [ ] **Step 4: Skip commit.**

---

### Task 4: Wire consumers (AvgCosting, receipt, opening, issue)

**Files:**
- Modify: `src/modules/stock-balance/costing/avg-costing.policy.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`
- Modify: `src/modules/stock-opening/stock-opening.service.ts`
- Modify: `src/modules/stock-issue/stock-issue.service.ts`

- [ ] **Step 1: `AvgCostingPolicy`**

```ts
import type { StockBalanceReader } from '../stock-balance.port';
import { stockBalanceService } from '../stock-balance.service';
// remove StockBalanceService type import

export class AvgCostingPolicy implements CostingPolicy {
  constructor(private readonly balance: StockBalanceReader = stockBalanceService) {}
  // body unchanged
}
```

- [ ] **Step 2: `StockReceiptService`**

```ts
import type { StockPostingPort } from '../stock-balance/stock-posting.port';
import { stockPostingService } from '../stock-balance/stock-posting.service';

export class StockReceiptService {
  constructor(private readonly posting: StockPostingPort = stockPostingService) {}
  // …
}
export const stockReceiptService = new StockReceiptService(stockPostingService);
```

- [ ] **Step 3: `StockOpeningService`** — same pattern as receipt (`StockPostingPort`).

- [ ] **Step 4: `StockIssueService`**

```ts
import type { StockBalanceReader } from '../stock-balance/stock-balance.port';
import { stockBalanceService } from '../stock-balance/stock-balance.service';
import type { StockPostingPort } from '../stock-balance/stock-posting.port';
import { stockPostingService } from '../stock-balance/stock-posting.service';

export class StockIssueService {
  constructor(
    private readonly balance: StockBalanceReader = stockBalanceService,
    private readonly posting: StockPostingPort = stockPostingService,
  ) {}
  // …
}
export const stockIssueService = new StockIssueService(
  stockBalanceService,
  stockPostingService,
);
```

- [ ] **Step 5: Full verify**

Run:

```bash
npx vitest run tests/modules
npx tsc --noEmit
```

Expected:

```
Test Files  11 passed (11)
Tests  33 passed (33)
```

and `tsc` exit 0.

- [ ] **Step 6: Skip commit.**

---

### Task 5: Spec self-check (no new test required)

- [ ] **Step 1: Grep concrete types in consumer constructors**

Run:

```bash
rg "private readonly (balance|ledger|posting): Stock(Balance|Ledger|Posting)Service" src/modules
```

Expected: no matches (all should be `*Port` / `*Reader` / `*Writer`).

- [ ] **Step 2: Confirm implements**

```bash
rg "implements Stock" src/modules/stock-balance
```

Expected lines for `StockBalanceService`, `StockLedgerService`, `StockPostingService`.

- [ ] **Step 3: Done** — report to user with short Vietnamese summary of DIP level-2.

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `stock-balance.port.ts` Reader+Writer + types | Task 1 |
| `stock-ledger.port.ts` | Task 2 |
| `stock-posting.port.ts` | Task 3 |
| Posting deps Writer ports | Task 3 |
| AvgCosting → Reader | Task 4 |
| Receipt/Opening/Issue → PostingPort (+ Reader on issue) | Task 4 |
| Tests xanh / tsc | Task 4 Step 5 |
| No Auth/CRUD ports | — out of scope |
| No commits | All tasks |

## Placeholder / commit note

Plan intentionally omits `git commit` steps. Do not invent Auth ports or change costing/FIFO behavior.
