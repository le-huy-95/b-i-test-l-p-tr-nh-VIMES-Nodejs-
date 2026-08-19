# SOLID Pragmatic Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách `src` theo SOLID thực dụng (Stock posting/costing, Auth services, PermissionCache, leftover) mà không đổi API path hay hành vi kho.

**Architecture:** Giữ Express layered. Class fat tách file; costing và permission cache đi qua interface; document `complete`/`post` chỉ điều phối; composition `export const x = new X(...)` cuối file, không DI container.

**Tech Stack:** Express, TypeScript, Prisma, Zod, Vitest, ioredis, AppError

**Spec:** `docs/superpowers/specs/2026-08-14-solid-pragmatic-refactor-design.md`

**Thứ tự:** Task 1–4 Stock (xanh rồi mới Auth) → 5–6 Auth → 7 Tenant/cache → 8 leftover.

Sau mỗi task: `npx vitest run tests/modules` phải pass.

---

## File map

| Path | Việc |
|---|---|
| `src/modules/stock-balance/costing/costing-policy.ts` | `CostingPolicy`, `CostingChangeInput`, `resolveCostingPolicy` |
| `src/modules/stock-balance/costing/avg-costing.policy.ts` | Moving average |
| `src/modules/stock-balance/costing/lot-costing.policy.ts` | FIFO/FEFO no-op |
| `src/modules/stock-balance/qty.ts` | `resolveQtyBaseUnit` |
| `src/modules/stock-balance/stock-ledger.service.ts` | `StockLedgerService` |
| `src/modules/stock-balance/stock-balance.service.ts` | Chỉ balance; `AppError` khi thiếu tồn |
| `src/modules/stock-balance/stock-posting.service.ts` | `apply({ direction, changes, ledger }, trx)` |
| `src/modules/stock-receipt/stock-receipt.service.ts` | `complete` gọi posting |
| `src/modules/stock-issue/stock-issue.service.ts` | `complete` gọi posting; `create`/`submit` import `qty` + `getAvailable` |
| `src/modules/stock-opening/stock-opening.service.ts` | `post` gọi posting |
| `src/modules/auth/otp.service.ts` | OTP |
| `src/modules/auth/token.service.ts` | JWT refresh/logout |
| `src/modules/auth/device.service.ts` | Device |
| `src/modules/auth/auth.service.ts` | register/login/google/me; inject 3 service |
| `src/modules/auth/auth.controller.ts` | Bỏ tenant methods |
| `src/modules/auth/auth.routes.ts` | Handler tenant + `requirePlatformAdmin` |
| `src/modules/tenant/tenant.controller.ts` | Thêm 4 method từ auth |
| `src/middlewares/auth.ts` | `requirePlatformAdmin`; xóa `requireVerified` |
| `src/modules/tenant/permission-cache.ts` | Interface |
| `src/infra/redis-permission-cache.ts` | Redis impl |
| `src/modules/tenant/tenant.service.ts` | Inject cache; không import middleware |
| `src/middlewares/tenant.ts` | Dùng `permissionCache`; xóa `invalidateUserPermissionCache` |
| `src/routes/health.routes.ts` | Prisma raw |
| `src/routes/users.routes.ts` | Xóa |
| `src/database/index.ts` | Xóa |
| `tests/modules/costing.policy.test.ts` | Tạo |
| `tests/modules/stock-posting.service.test.ts` | Tạo |
| `tests/modules/stock-balance.service.test.ts` | AppError + import `qty` |
| `tests/modules/stock-receipt*.test.ts` | Mock posting / `qty` |
| `tests/modules/stock-issue*.test.ts` | Mock posting; submit vẫn mock `getAvailable` |
| `tests/modules/stock-opening.service.test.ts` | Mock posting |
| `tests/modules/auth.service.test.ts` | Vẫn import `authService` |
| `tests/modules/tenant.service.test.ts` | Mock `permissionCache` |
| `tests/modules/redis-permission-cache.test.ts` | Tạo |
| `tests/routes/health.routes.test.ts` | Tạo nếu chưa có; hoặc chạy typecheck |

Không đụng: Product/Customer/Supplier/Warehouse CRUD, email module, `docs/API.md`.

---

### Task 1: CostingPolicy (TDD)

**Files:**
- Create: `src/modules/stock-balance/costing/costing-policy.ts`
- Create: `src/modules/stock-balance/costing/avg-costing.policy.ts`
- Create: `src/modules/stock-balance/costing/lot-costing.policy.ts`
- Test: `tests/modules/costing.policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/app-error';
import { AvgCostingPolicy } from '../../src/modules/stock-balance/costing/avg-costing.policy';
import { LotCostingPolicy } from '../../src/modules/stock-balance/costing/lot-costing.policy';
import { resolveCostingPolicy } from '../../src/modules/stock-balance/costing/costing-policy';

function stubEnv() {
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
  vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
  vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
}

describe('costing policies', () => {
  it('AVG uses unitCost when onhand before is zero', async () => {
    stubEnv();
    const trx = {
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', averageCost: '10', costingMethod: 'AVG' }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ onhandQty: '5' }]),
      },
      stockReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { qtyBaseUnit: '0' } }),
      },
    } as never;

    await new AvgCostingPolicy().onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });

    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '20.0000' },
    });
  });

  it('AVG blends previous average when onhand before > 0', async () => {
    stubEnv();
    const trx = {
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'p1', averageCost: '10', costingMethod: 'AVG' }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([{ onhandQty: '15' }]),
      },
      stockReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { qtyBaseUnit: '0' } }),
      },
    } as never;

    await new AvgCostingPolicy().onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });

    // onhandAfter=15, qty=5 → before=10; (10*10 + 5*20)/15 = 13.3333
    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '13.3333' },
    });
  });

  it('lot policy does not update product', async () => {
    const trx = { product: { update: vi.fn() } } as never;
    await new LotCostingPolicy().onStockIncrease({
      tenantId: 't1',
      productId: 'p1',
      warehouseId: 'w1',
      qtyBaseUnit: '5',
      unitCost: '20',
      trx,
    });
    expect(trx.product.update).not.toHaveBeenCalled();
  });

  it('resolveCostingPolicy maps AVG / FIFO / FEFO and rejects unknown', () => {
    expect(resolveCostingPolicy('AVG')).toBeInstanceOf(AvgCostingPolicy);
    expect(resolveCostingPolicy('FIFO')).toBeInstanceOf(LotCostingPolicy);
    expect(resolveCostingPolicy('FEFO')).toBeInstanceOf(LotCostingPolicy);
    expect(() => resolveCostingPolicy('LIFO' as never)).toThrow(AppError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/costing.policy.test.ts`

Expected: FAIL (cannot find module / not exported).

- [ ] **Step 3: Write implementation**

`src/modules/stock-balance/costing/costing-policy.ts`:

```ts
import type { Prisma } from '../../../infra/prisma-types';
import { CostingMethod } from '../../../infra/prisma-types';
import { AppError } from '../../../utils/app-error';
import { AvgCostingPolicy } from './avg-costing.policy';
import { LotCostingPolicy } from './lot-costing.policy';

export interface CostingChangeInput {
  tenantId: string;
  productId: string;
  warehouseId: string;
  qtyBaseUnit: string;
  unitCost: string;
  trx: Prisma.TransactionClient;
}

export interface CostingPolicy {
  onStockIncrease(input: CostingChangeInput): Promise<void>;
}

const avg = new AvgCostingPolicy();
const lot = new LotCostingPolicy();

export function resolveCostingPolicy(method: CostingMethod | string): CostingPolicy {
  if (method === CostingMethod.AVG || method === 'AVG') return avg;
  if (method === CostingMethod.FIFO || method === 'FIFO') return lot;
  if (method === CostingMethod.FEFO || method === 'FEFO') return lot;
  throw new AppError('VALIDATION_ERROR', 400, `Unsupported costing method: ${method}`);
}
```

`src/modules/stock-balance/costing/lot-costing.policy.ts`:

```ts
import type { CostingChangeInput, CostingPolicy } from './costing-policy';

export class LotCostingPolicy implements CostingPolicy {
  async onStockIncrease(_input: CostingChangeInput): Promise<void> {}
}
```

`src/modules/stock-balance/costing/avg-costing.policy.ts`:

```ts
import { d, toDecimalString } from '../../../utils/decimal';
import { stockBalanceService } from '../stock-balance.service';
import type { CostingChangeInput, CostingPolicy } from './costing-policy';

export class AvgCostingPolicy implements CostingPolicy {
  async onStockIncrease(input: CostingChangeInput): Promise<void> {
    const { tenantId, productId, warehouseId, qtyBaseUnit, unitCost, trx } = input;
    const product = await trx.product.findUniqueOrThrow({ where: { id: productId } });
    const bal = await stockBalanceService.getAvailable(tenantId, productId, warehouseId, trx);
    const onhandBefore = bal.onhandQty.minus(qtyBaseUnit);
    const newAvg = onhandBefore.lte(0)
      ? d(unitCost ?? 0)
      : onhandBefore
          .mul(product.averageCost.toString())
          .plus(d(qtyBaseUnit).mul(unitCost ?? 0))
          .div(onhandBefore.plus(qtyBaseUnit));
    await trx.product.update({
      where: { id: productId },
      data: { averageCost: toDecimalString(newAvg, 4) },
    });
  }
}
```

Nếu `AvgCostingPolicy` import `stockBalanceService` gây cycle lúc load test: copy `getAvailable` logic vào policy **không được** (SRP). Cycle chấp nhận được nếu `stock-balance.service.ts` không import costing. Factory import policy; policy import `stockBalanceService`; `stock-balance.service.ts` **không** import costing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/costing.policy.test.ts`

Expected: PASS (4 tests). Nếu AVG blend làm tròn khác `13.3333`, sửa assertion theo `toDecimalString` thật (4 chữ số).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock-balance/costing tests/modules/costing.policy.test.ts
git commit -m "$(cat <<'EOF'
Extract costing policy interface for AVG and lot no-op.

EOF
)"
```

---

### Task 2: Tách ledger + qty; AppError trên decrease

**Files:**
- Create: `src/modules/stock-balance/qty.ts`
- Create: `src/modules/stock-balance/stock-ledger.service.ts`
- Modify: `src/modules/stock-balance/stock-balance.service.ts`
- Modify: `tests/modules/stock-balance.service.test.ts`
- Modify imports in receipt/issue/opening **tạm**: `resolveQtyBaseUnit` từ `../stock-balance/qty`, `stockLedgerService` từ `../stock-balance/stock-ledger.service`. `complete` vẫn gọi increase/decrease+ledger cho đến Task 4.

- [ ] **Step 1: Update failing assertion in balance test**

Trong `tests/modules/stock-balance.service.test.ts`, đổi test insufficient:

```ts
await expect(
  stockBalanceService.applyDecrease(
    [{ tenantId: 'tenant-1', productId: 'p1', warehouseId: 'w1', qtyBaseUnit: '5' }],
    trx,
  ),
).rejects.toMatchObject({
  name: 'AppError',
  code: 'STOCK_INSUFFICIENT',
  statusCode: 409,
  details: [{ productId: 'p1', available: '2', requested: '5' }],
});
```

Đổi import `resolveQtyBaseUnit` sang `../../src/modules/stock-balance/qty`.

- [ ] **Step 2: Run that test — expect FAIL** (vẫn `Error` + `productId` top-level, hoặc module qty missing).

Run: `npx vitest run tests/modules/stock-balance.service.test.ts`

- [ ] **Step 3: Implement split + AppError**

`qty.ts`: cắt nguyên `resolveQtyBaseUnit` từ file cũ (imports: prisma-types, prisma, decimal).

`stock-ledger.service.ts`: cắt nguyên class `StockLedgerService` + `export const stockLedgerService = new StockLedgerService()`.

`stock-balance.service.ts`: xóa class ledger và `resolveQtyBaseUnit`. Trong `applyDecrease`, thay `Object.assign(new Error(...))` bằng:

```ts
import { AppError } from '../../utils/app-error';

throw new AppError('STOCK_INSUFFICIENT', 409, 'Không đủ tồn kho', [
  { productId: c.productId, available: current.toString(), requested: c.qtyBaseUnit },
]);
```

Khi `!existing`: `available: '0'`. Khi `updated.count === 0`:

```ts
throw new AppError('VERSION_CONFLICT', 409, 'Xung đột tồn kho, thử lại', [
  { productId: c.productId },
]);
```

Cập nhật import ở:

- `stock-receipt.service.ts`: `resolveQtyBaseUnit` từ `../stock-balance/qty`; `stockLedgerService` từ `../stock-balance/stock-ledger.service`; `stockBalanceService` giữ file cũ.
- `stock-issue.service.ts`: tương tự.
- `stock-opening.service.ts`: ledger từ file mới.

Cập nhật `vi.mock('../../src/modules/stock-balance/stock-balance.service')` trong test receipt/issue/opening: **tách mock** — vẫn mock `stockBalanceService` ở file cũ; thêm:

```ts
vi.mock('../../src/modules/stock-balance/qty', () => ({
  resolveQtyBaseUnit: vi.fn(),
}));
vi.mock('../../src/modules/stock-balance/stock-ledger.service', () => ({
  stockLedgerService: { record: mockRecord },
}));
```

Xóa `stockLedgerService` và `resolveQtyBaseUnit` khỏi mock file `stock-balance.service`.

Issue `complete` hiện map `err.productId` từ Error gán field. Trong Task 2 đổi thành rethrow `AppError`:

```ts
if (err instanceof AppError && err.code === 'STOCK_INSUFFICIENT') throw err;
if (err instanceof AppError && err.code === 'VERSION_CONFLICT') throw err;
```

Task 4 sẽ xóa cả khối try/catch map này.
- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/modules`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock-balance src/modules/stock-receipt src/modules/stock-issue src/modules/stock-opening tests/modules
git commit -m "$(cat <<'EOF'
Split stock ledger and qty helpers; throw AppError on insufficient stock.

EOF
)"
```

---

### Task 3: StockPostingService (TDD)

**Files:**
- Create: `src/modules/stock-balance/stock-posting.service.ts`
- Test: `tests/modules/stock-posting.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApplyIncrease = vi.fn();
const mockApplyDecrease = vi.fn();
const mockRecord = vi.fn();
const mockOnIncrease = vi.fn();

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'a');
vi.stubEnv('JWT_REFRESH_SECRET', 'b');

vi.mock('../../src/modules/stock-balance/stock-balance.service', () => ({
  stockBalanceService: {
    applyIncrease: mockApplyIncrease,
    applyDecrease: mockApplyDecrease,
  },
}));

vi.mock('../../src/modules/stock-balance/stock-ledger.service', () => ({
  stockLedgerService: { record: mockRecord },
}));

vi.mock('../../src/modules/stock-balance/costing/costing-policy', () => ({
  resolveCostingPolicy: vi.fn(() => ({ onStockIncrease: mockOnIncrease })),
}));

describe('stock posting service', () => {
  beforeEach(() => {
    mockApplyIncrease.mockReset().mockResolvedValue([
      { key: { tenantId: 't1', productId: 'p1', warehouseId: 'w1' }, balanceAfter: '10' },
    ]);
    mockApplyDecrease.mockReset().mockResolvedValue([
      { key: { tenantId: 't1', productId: 'p1', warehouseId: 'w1' }, balanceAfter: '4' },
    ]);
    mockRecord.mockReset();
    mockOnIncrease.mockReset();
  });

  const change = {
    tenantId: 't1',
    productId: 'p1',
    warehouseId: 'w1',
    qtyBaseUnit: '6',
    unitCost: '12',
  };

  it('direction in increases, records ledger in, applies costing', async () => {
    const trx = {
      product: { findUniqueOrThrow: vi.fn().mockResolvedValue({ costingMethod: 'AVG' }) },
    } as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'in',
        changes: [change],
        ledger: { refDocType: 'stock_receipt', refDocId: 'r1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyIncrease).toHaveBeenCalledWith([change], trx);
    expect(mockRecord).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          transactionType: 'in',
          qtyChange: '6',
          qtyBalanceAfter: '10',
          unitCost: '12',
          refDocType: 'stock_receipt',
          refDocId: 'r1',
          createdById: 'u1',
        }),
      ],
      trx,
    );
    expect(mockOnIncrease).toHaveBeenCalledTimes(1);
  });

  it('direction out decreases and does not call costing', async () => {
    const trx = {} as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'out',
        changes: [change],
        ledger: { refDocType: 'stock_issue', refDocId: 'i1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyDecrease).toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      [expect.objectContaining({ transactionType: 'out', qtyChange: '-6' })],
      trx,
    );
    expect(mockOnIncrease).not.toHaveBeenCalled();
  });

  it('direction opening increases, ledger opening, always sets averageCost', async () => {
    const trx = {
      product: { update: vi.fn().mockResolvedValue({}) },
    } as never;
    const { stockPostingService } = await import('../../src/modules/stock-balance/stock-posting.service');
    await stockPostingService.apply(
      {
        direction: 'opening',
        changes: [change],
        ledger: { refDocType: 'stock_opening_balance', refDocId: 'o1', createdById: 'u1' },
      },
      trx,
    );
    expect(mockApplyIncrease).toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      [expect.objectContaining({ transactionType: 'opening' })],
      trx,
    );
    expect(trx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { averageCost: '12' },
    });
    expect(mockOnIncrease).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (module missing).

Run: `npx vitest run tests/modules/stock-posting.service.test.ts`

- [ ] **Step 3: Implement `stock-posting.service.ts`**

```ts
import type { Prisma } from '../../infra/prisma-types';
import type { QtyChange } from './stock-balance.service';
import { stockBalanceService } from './stock-balance.service';
import { stockLedgerService } from './stock-ledger.service';
import { resolveCostingPolicy } from './costing/costing-policy';

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

const LEDGER_TYPE = { in: 'in', out: 'out', opening: 'opening' } as const;

export class StockPostingService {
  async apply(input: StockPostingInput, trx: Prisma.TransactionClient) {
    const { direction, changes, ledger } = input;
    const applied =
      direction === 'out'
        ? await stockBalanceService.applyDecrease(changes, trx)
        : await stockBalanceService.applyIncrease(changes, trx);

    await stockLedgerService.record(
      applied.map((a, i) => ({
        tenantId: a.key.tenantId,
        productId: a.key.productId,
        warehouseId: a.key.warehouseId,
        batchId: a.key.batchId,
        locationId: a.key.locationId,
        transactionType: LEDGER_TYPE[direction],
        refDocType: ledger.refDocType,
        refDocId: ledger.refDocId,
        qtyChange: direction === 'out' ? `-${changes[i].qtyBaseUnit}` : changes[i].qtyBaseUnit,
        qtyBalanceAfter: a.balanceAfter,
        unitCost: changes[i].unitCost,
        createdById: ledger.createdById,
      })),
      trx,
    );

    if (direction === 'opening') {
      for (const c of changes) {
        await trx.product.update({
          where: { id: c.productId },
          data: { averageCost: c.unitCost ?? '0' },
        });
      }
      return;
    }

    if (direction === 'in') {
      for (const c of changes) {
        const product = await trx.product.findUniqueOrThrow({ where: { id: c.productId } });
        await resolveCostingPolicy(product.costingMethod).onStockIncrease({
          tenantId: c.tenantId,
          productId: c.productId,
          warehouseId: c.warehouseId,
          qtyBaseUnit: c.qtyBaseUnit,
          unitCost: c.unitCost ?? '0',
          trx,
        });
      }
    }
  }
}

export const stockPostingService = new StockPostingService();
```

Export `QtyChange` từ `stock-balance.service.ts` (đã có). `unitCost` trên `QtyChange` đã optional.

- [ ] **Step 4: Run** `npx vitest run tests/modules/stock-posting.service.test.ts tests/modules/costing.policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock-balance/stock-posting.service.ts tests/modules/stock-posting.service.test.ts
git commit -m "$(cat <<'EOF'
Add StockPostingService to apply balance, ledger, and costing together.

EOF
)"
```

---

### Task 4: Wire receipt / issue / opening vào posting

**Files:**
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`
- Modify: `src/modules/stock-issue/stock-issue.service.ts`
- Modify: `src/modules/stock-opening/stock-opening.service.ts`
- Modify: `tests/modules/stock-receipt.service.test.ts`
- Modify: `tests/modules/stock-issue.service.test.ts`
- Modify: `tests/modules/stock-opening.service.test.ts`
- Modify lifecycle tests: mock `qty` + `getAvailable` (issue submit); **không** cần mock posting nếu complete không chạy trong lifecycle.

- [ ] **Step 1: Rewrite complete/post tests to mock posting**

`tests/modules/stock-receipt.service.test.ts`:

```ts
const mockApply = vi.fn();
vi.mock('../../src/modules/stock-balance/stock-posting.service', () => ({
  stockPostingService: { apply: mockApply },
}));
vi.mock('../../src/modules/stock-balance/qty', () => ({
  resolveQtyBaseUnit: vi.fn(),
}));
```

Xóa mock `applyIncrease`/`record`. Trong test complete:

```ts
mockApply.mockResolvedValue(undefined);
// trx không cần product.update cho FIFO complete
const result = await stockReceiptService.complete('tenant-1', 'receipt-1', 'user-1');
expect(mockApply).toHaveBeenCalledWith(
  {
    direction: 'in',
    changes: [
      {
        tenantId: 'tenant-1',
        productId: 'product-1',
        warehouseId: 'warehouse-1',
        qtyBaseUnit: '5.0000',
        unitCost: '20.0000',
      },
    ],
    ledger: {
      refDocType: 'stock_receipt',
      refDocId: 'receipt-1',
      createdById: 'user-1',
    },
  },
  trx,
);
expect(result).toMatchObject({ id: 'receipt-1', status: 'completed' });
```

Issue complete test: mock `stockPostingService.apply`; expect `direction: 'out'`; vẫn expect `stockReservation.updateMany` consumed.

Opening post test: mock `apply`; **không** expect `trx.product.update` nữa (posting lo). Expect `direction: 'opening'`.

- [ ] **Step 2: Run those 3 test files — expect FAIL** (`apply` not called / still calling increase).

- [ ] **Step 3: Implement wiring**

Receipt `complete` sau khi build `changes` (giữ `FOR UPDATE` + idempotent):

```ts
await stockPostingService.apply(
  {
    direction: 'in',
    changes,
    ledger: { refDocType: 'stock_receipt', refDocId: id, createdById: userId },
  },
  trx,
);
return trx.stockReceipt.update({
  where: { id },
  data: { status: 'completed', completedAt: new Date() },
  include: { details: true },
});
```

Xóa `applyIncrease`, `stockLedger.record`, vòng AVG. Import `stockPostingService` và `resolveQtyBaseUnit` từ `qty`. `create()` vẫn `resolveQtyBaseUnit`.

Issue `complete`: sau khi build `changes` (vẫn đọc `product.averageCost` / `trackExpiry` placeholder):

```ts
await stockPostingService.apply(
  {
    direction: 'out',
    changes,
    ledger: { refDocType: 'stock_issue', refDocId: id, createdById: userId },
  },
  trx,
);
await trx.stockReservation.updateMany({
  where: { refDocType: 'stock_issue', refDocId: id, status: 'active' },
  data: { status: 'consumed' },
});
return trx.stockIssue.update({ ... });
```

Xóa try/catch map `STOCK_INSUFFICIENT` / `VERSION_CONFLICT` — `AppError` bubble. Giữ catch `IDEMPOTENT_SKIP`. `submit` vẫn `stockBalanceService.getAvailable`.

Opening `post`: sau khi build `changes` và check ledgerExists:

```ts
await stockPostingService.apply(
  {
    direction: 'opening',
    changes,
    ledger: { refDocType: 'stock_opening_balance', refDocId: id, createdById: userId },
  },
  trx,
);
return trx.stockOpeningBalance.update({ ... });
```

Xóa `applyIncrease`, `record`, vòng `product.update`.

Issue/receipt `create` import `resolveQtyBaseUnit` from `../stock-balance/qty`.

Lifecycle issue: mock `stock-balance.service` chỉ còn `stockBalanceService.getAvailable`; mock `qty`.

- [ ] **Step 4: Run** `npx vitest run tests/modules`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stock-receipt src/modules/stock-issue src/modules/stock-opening tests/modules
git commit -m "$(cat <<'EOF'
Route stock complete and opening post through StockPostingService.

EOF
)"
```

---

### Task 5: Tách Auth OTP / token / device

**Files:**
- Create: `src/modules/auth/otp.service.ts`
- Create: `src/modules/auth/token.service.ts`
- Create: `src/modules/auth/device.service.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Test: `tests/modules/auth.service.test.ts` (giữ import `authService`; hành vi không đổi)

- [ ] **Step 1: Run existing auth tests as baseline**

Run: `npx vitest run tests/modules/auth.service.test.ts`

Expected: PASS (trước khi sửa). Nếu fail, dừng và sửa baseline.

- [ ] **Step 2: Move methods — keep `AuthService` public API**

`otp.service.ts`: cắt `issueOtp`, `verifyOtp`, `resendOtp` nguyên logic (prisma + `sendOtpEmail` + env OTP). `export const otpService = new OtpService()`.

`token.service.ts`: cắt `issueTokens`, `refresh`, `logout`. `export const tokenService = new TokenService()`.

`device.service.ts`: cắt `registerDevice`, `formatDeviceResponse`, `upsertUserDevice`. `export const deviceService = new DeviceService()`.

`auth.service.ts`:

```ts
import { otpService, OtpService } from './otp.service';
import { tokenService, TokenService } from './token.service';
import { deviceService, DeviceService } from './device.service';

export class AuthService {
  constructor(
    private readonly otp: OtpService = otpService,
    private readonly tokens: TokenService = tokenService,
    private readonly devices: DeviceService = deviceService,
  ) {}

  async register(input: unknown) { /* create user; this.otp.issueOtp; sendWelcomeEmail */ }
  async verifyOtp(input: unknown) { return this.otp.verifyOtp(input); }
  async resendOtp(input: unknown) { return this.otp.resendOtp(input); }
  async login(input: unknown) { /* verify password; this.tokens.issueTokens; tenants */ }
  async loginWithGoogle(input: unknown) { /* firebase; upsert user; this.tokens.issueTokens */ }
  async refresh(input: unknown) { return this.tokens.refresh(input); }
  async logout(input: unknown) { return this.tokens.logout(input); }
  async registerDevice(userId: string, input: unknown) {
    return this.devices.registerDevice(userId, input);
  }
  async me(userId: string) { /* unchanged prisma user + tenants */ }
}

export const authService = new AuthService();
```

Copy body hiện tại từng method; chỉ thay `this.issueOtp` → `this.otp.issueOtp`, `this.issueTokens` → `this.tokens.issueTokens`, `this.upsertUserDevice` → `this.devices.upsertUserDevice`.

Không đổi DTO/email/firebase imports trên orchestrator (register/google vẫn `sendWelcomeEmail`, `verifyGoogleIdToken`).

- [ ] **Step 3: Run** `npx vitest run tests/modules/auth.service.test.ts`

Expected: PASS (cùng 7 tests).

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth tests/modules/auth.service.test.ts
git commit -m "$(cat <<'EOF'
Split AuthService into OTP, token, and device collaborators.

EOF
)"
```

---

### Task 6: Tenant HTTP ra khỏi AuthController

**Files:**
- Modify: `src/middlewares/auth.ts`
- Modify: `src/modules/tenant/tenant.controller.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.routes.ts`

- [ ] **Step 1: Add `requirePlatformAdmin`**

Trong `src/middlewares/auth.ts` (giữ `requireVerified` đến Task 8):

```ts
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isPlatformAdmin) {
    return next(new AppError('FORBIDDEN', 403, 'Platform admin only'));
  }
  next();
}
```

- [ ] **Step 2: Move controller methods**

`tenant.controller.ts` thêm (copy từ auth.controller, bỏ if platform admin):

```ts
createTenant = async (req: Request, res: Response) => {
  const data = await tenantService.createTenant(req.user!.id, req.body);
  res.status(201).json({ success: true, data });
};

acceptInvite = async (req: Request, res: Response) => {
  const data = await tenantService.acceptInvite(req.user!.id, req.body);
  res.json({ success: true, data });
};

platformCreateTenant = async (req: Request, res: Response) => {
  const data = await tenantService.platformCreateTenant(req.body);
  res.status(201).json({ success: true, data });
};

platformPatchTenant = async (req: Request, res: Response) => {
  const data = await tenantService.platformPatchTenant(req.params.id as string, req.body);
  res.json({ success: true, data });
};
```

Xóa 4 method + import `tenantService` / `AppError` khỏi `auth.controller.ts`.

- [ ] **Step 3: Rewire `auth.routes.ts` — path không đổi**

```ts
import { authMiddleware, requirePlatformAdmin } from '../../middlewares/auth';
import { tenantController } from '../tenant/tenant.controller';

router.post('/tenants', authMiddleware, asyncHandler(tenantController.createTenant));
router.post('/invitations/accept', authMiddleware, asyncHandler(tenantController.acceptInvite));
router.post(
  '/platform/tenants',
  authMiddleware,
  requirePlatformAdmin,
  asyncHandler(tenantController.platformCreateTenant),
);
router.patch(
  '/platform/tenants/:id',
  authMiddleware,
  requirePlatformAdmin,
  asyncHandler(tenantController.platformPatchTenant),
);
```

`tenant.routes.ts` (`/tenants/current`) **không** thêm 4 path này.

- [ ] **Step 4: Run** `npx vitest run tests/modules && npx tsc --noEmit`

Expected: PASS / no TS error.

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/auth.ts src/modules/auth src/modules/tenant
git commit -m "$(cat <<'EOF'
Move tenant HTTP handlers out of AuthController; add platform admin middleware.

EOF
)"
```

---

### Task 7: PermissionCache port

**Files:**
- Create: `src/modules/tenant/permission-cache.ts`
- Create: `src/infra/redis-permission-cache.ts`
- Modify: `src/middlewares/tenant.ts`
- Modify: `src/modules/tenant/tenant.service.ts`
- Modify: `tests/modules/tenant.service.test.ts`
- Test: `tests/modules/redis-permission-cache.test.ts`

- [ ] **Step 1: Write cache unit test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

vi.mock('../../src/infra/redis', () => ({
  getRedis: vi.fn(() => ({ get: mockGet, set: mockSet, del: mockDel })),
}));

describe('RedisPermissionCache', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
  });

  it('get returns parsed payload and set uses TTL 300', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a');
    vi.stubEnv('JWT_REFRESH_SECRET', 'b');
    mockGet.mockResolvedValue(JSON.stringify({ role: 'admin', warehouseIds: 'all' }));
    const { RedisPermissionCache } = await import('../../src/infra/redis-permission-cache');
    const cache = new RedisPermissionCache();
    await expect(cache.get('u1', 't1')).resolves.toMatchObject({ role: 'admin' });
    expect(mockGet).toHaveBeenCalledWith('cache:user-permissions:u1:t1');
    await cache.set('u1', 't1', {
      role: 'admin',
      warehouseIds: 'all',
      emailVerified: true,
      phoneVerified: false,
      tenantStatus: 'active',
    });
    expect(mockSet).toHaveBeenCalledWith(
      'cache:user-permissions:u1:t1',
      expect.any(String),
      'EX',
      300,
    );
  });

  it('swallows redis errors and get returns null', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a');
    vi.stubEnv('JWT_REFRESH_SECRET', 'b');
    mockGet.mockRejectedValue(new Error('down'));
    const { RedisPermissionCache } = await import('../../src/infra/redis-permission-cache');
    const cache = new RedisPermissionCache();
    await expect(cache.get('u1', 't1')).resolves.toBeNull();
    await expect(cache.invalidate('u1', 't1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement port + Redis + wire**

`permission-cache.ts`:

```ts
import type { TenantRole } from '../../infra/prisma-types';

export interface CachedPermissions {
  role: TenantRole;
  warehouseIds: string[] | 'all';
  emailVerified: boolean;
  phoneVerified: boolean;
  tenantStatus: string;
}

export interface PermissionCache {
  get(userId: string, tenantId: string): Promise<CachedPermissions | null>;
  set(userId: string, tenantId: string, value: CachedPermissions, ttlSeconds?: number): Promise<void>;
  invalidate(userId: string, tenantId: string): Promise<void>;
}
```

`redis-permission-cache.ts`: key helper `cache:user-permissions:${userId}:${tenantId}`. `getRedis()` null → get null, set/invalidate no-op. try/catch nuốt lỗi. `export const permissionCache = new RedisPermissionCache()`.

`tenant.service.ts`:

```ts
import { permissionCache } from '../../infra/redis-permission-cache';
import type { PermissionCache } from './permission-cache';

export class TenantService {
  constructor(private readonly cache: PermissionCache = permissionCache) {}
  // acceptInvite: await this.cache.invalidate(userId, invitation.tenantId);
}
export const tenantService = new TenantService();
```

Xóa `import { invalidateUserPermissionCache } from '../../middlewares/tenant'`.

`middlewares/tenant.ts`: import `permissionCache` + type `CachedPermissions` từ module tenant (middleware phụ thuộc port, không ngược). `loadPermissions`:

```ts
const cached = await permissionCache.get(userId, tenantId);
if (cached) return cached;
// ... prisma load unchanged ...
await permissionCache.set(userId, tenantId, payload);
return payload;
```

Xóa function `invalidateUserPermissionCache` và `getRedis` trực tiếp trong middleware.

`tests/modules/tenant.service.test.ts`: thay mock middleware bằng:

```ts
const mockInvalidate = vi.fn();
vi.mock('../../src/infra/redis-permission-cache', () => ({
  permissionCache: { get: vi.fn(), set: vi.fn(), invalidate: mockInvalidate },
}));
```

- [ ] **Step 4: Run** `npx vitest run tests/modules && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tenant src/infra/redis-permission-cache.ts src/middlewares/tenant.ts tests/modules
git commit -m "$(cat <<'EOF'
Invert permission cache: TenantService depends on a port, not HTTP middleware.

EOF
)"
```

---

### Task 8: Leftover

**Files:**
- Modify: `src/middlewares/auth.ts` — xóa `requireVerified`
- Modify: `src/routes/health.routes.ts`
- Delete: `src/routes/users.routes.ts`
- Delete: `src/database/index.ts`
- Test: `tests/routes/health.routes.test.ts` (tạo)

- [ ] **Step 1: Health test**

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryRaw = vi.fn();

vi.mock('../../src/infra/prisma', () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

describe('health route', () => {
  beforeEach(() => mockQueryRaw.mockReset());

  it('returns database time via prisma', async () => {
    mockQueryRaw.mockResolvedValue([{ current_time: '2026-08-14', pg_version: 'PostgreSQL' }]);
    const { default: healthRoutes } = await import('../../src/routes/health.routes');
    const app = express();
    app.use(healthRoutes);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('API is running');
    expect(res.body.data.database).toMatchObject({ pg_version: 'PostgreSQL' });
  });
});
```

Nếu project **không** có `supertest`: không thêm dependency. Thay bằng unit: extract handler khó — thì test bằng gọi `prisma.$queryRaw` mock qua import router và invoke handler thủ công, **hoặc** bỏ file test health và chỉ `tsc --noEmit`. **Chốt: không thêm supertest.** Health: đổi implementation; verify bằng `npx tsc --noEmit` + grep không còn `from '../database'`.

- [ ] **Step 2: Implement leftover**

`health.routes.ts`:

```ts
import { Router, Request, Response } from 'express';
import { prisma } from '../infra/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<Array<{ current_time: Date; pg_version: string }>>`
      SELECT NOW() AS current_time, version() AS pg_version
    `;
    res.json({
      success: true,
      data: {
        message: 'API is running',
        database: rows[0],
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      error: { message: 'Database connection failed' },
    });
  }
});

export default router;
```

Xóa `requireVerified` khỏi `auth.ts`. Xóa `src/routes/users.routes.ts` và `src/database/index.ts`. Grep `database` và `users.routes` và `requireVerified` trong `src/` + `tests/` — zero hits (trừ comment).

- [ ] **Step 3: Run** `npx vitest run tests/modules && npx tsc --noEmit`

Expected: PASS, no unused imports.

- [ ] **Step 4: Commit**

```bash
git add src/middlewares/auth.ts src/routes/health.routes.ts
git rm src/routes/users.routes.ts src/database/index.ts
git commit -m "$(cat <<'EOF'
Remove dead auth/users helpers and use Prisma for health checks.

EOF
)"
```

---

## Spec coverage

| Spec mục | Task |
|---|---|
| CostingPolicy AVG + lot no-op + factory | 1 |
| Split ledger/qty; AppError decrease | 2 |
| StockPostingService.apply in/out/opening | 3 |
| Receipt/issue/opening gọi posting; opening luôn set avg | 4 |
| Auth split OTP/token/device; public methods giữ | 5 |
| Tenant handlers + requirePlatformAdmin; URL /auth/* | 6 |
| PermissionCache; service không import middleware | 7 |
| requireVerified, users.routes, database pool, health Prisma | 8 |
| Không repository CRUD / không FIFO thật / không đổi API.md | — không có task |

## Ghi chú thực thi

- Cycle `avg-costing.policy` → `stockBalanceService`: `stock-balance.service.ts` không import costing.
- Vitest `vi.mock` path phải khớp import runtime sau split.
- Không commit nếu user không yêu cầu lúc execute; plan vẫn ghi bước commit cho agent khác.
