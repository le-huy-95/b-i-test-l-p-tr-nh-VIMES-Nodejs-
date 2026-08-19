# Design: DIP Level 2 — Stock ports

> Brainstorming 2026-08-15. User chọn: **Stock only**, tách **Reader/Writer + Ledger**, phiếu dùng **`StockPostingPort`**, tổ chức file **port riêng (Y)**.

## Goal

Siết DIP/ISP cho kho: consumer phụ thuộc interface mỏng, class hiện tại `implements` port. Composition vẫn `new Concrete(...)` cuối file — không DI container.

## Non-goals

- Port Auth / OTP / Token / Device / Prisma / CRUD Product–Customer–Supplier–Warehouse–Report
- Thay đổi API path, JSON, hoặc hành vi nghiệp vụ kho (FIFO/FEFO vẫn no-op costing)
- NestJS / Inversify / repository layer đầy đủ
- Git commit (theo lựa chọn workspace trước đó: chỉ code + test)

## Constraints

- Giữ signature method công khai hiện tại (để `implements` không đổi hành vi)
- Test `tests/modules/*` phải xanh; mock module singleton vẫn hợp lệ
- Pattern giống `PermissionCache` + `CostingPolicy` đã có
- Default constructor parameter trỏ singleton production

## Ports (file riêng)

```
src/modules/stock-balance/
  stock-balance.port.ts
  stock-ledger.port.ts
  stock-posting.port.ts
```

### `stock-balance.port.ts`

- Types dùng chung (chuyển hoặc re-export từ service hiện tại): `BalanceKey`, `QtyChange`
- `StockBalanceReader`:
  - `getAvailable(tenantId, productId, warehouseId, trx?)` — signature khớp `StockBalanceService`
- `StockBalanceWriter`:
  - `applyIncrease(changes, trx)`
  - `applyDecrease(changes, trx)`

`StockBalanceService implements StockBalanceReader, StockBalanceWriter`.

### `stock-ledger.port.ts`

- `StockLedgerWriter`:
  - `record(entries, trx)` — signature khớp `StockLedgerService.record`

`StockLedgerService implements StockLedgerWriter`.

### `stock-posting.port.ts`

- Re-export / định nghĩa types input hiện có: `StockPostingInput`, `StockPostingDirection`, `StockPostingLedgerMeta` (có thể chuyển từ `stock-posting.service.ts` sang port rồi service import lại để tránh circular)
- `StockPostingPort`:
  - `apply(input: StockPostingInput, trx: Prisma.TransactionClient): Promise<void>`

`StockPostingService implements StockPostingPort`.

## Consumer wiring (constructor type = port)

| Consumer | Constructor deps (typed as ports) |
|----------|-----------------------------------|
| `StockPostingService` | `StockBalanceWriter`, `StockLedgerWriter` |
| `AvgCostingPolicy` | `StockBalanceReader` |
| `StockIssueService` | `StockBalanceReader`, `StockPostingPort` |
| `StockReceiptService` | `StockPostingPort` |
| `StockOpeningService` | `StockPostingPort` |

Composition root (không đổi runtime object):

```ts
export const stockPostingService = new StockPostingService(
  stockBalanceService,
  stockLedgerService,
);
export const stockReceiptService = new StockReceiptService(stockPostingService);
// … tương tự issue / opening
```

## Implementation notes

1. **Types location:** Ưu tiên đặt `BalanceKey` / `QtyChange` / posting input types trên file port; service `export type { … } from './….port'` nếu cần tương thích import cũ trong test.
2. **Import type:** Consumer dùng `import type { StockPostingPort }` + value singleton — mock Vitest chỉ stub singleton vẫn chạy.
3. **Không** đổi body `apply` / costing / complete — chỉ đổi type annotation + `implements`.
4. **CostingPolicy** đã là port — không đụng trừ `AvgCostingPolicy` constructor type → `StockBalanceReader`.

## Test plan

- `npx vitest run tests/modules` — 33+ tests xanh
- `npx tsc --noEmit`
- Không bắt buộc viết test mới; optional: unit test posting với fake `StockBalanceWriter` / `StockLedgerWriter` object literals (nice-to-have)

## Success criteria

- Mọi consumer kho liệt kê trên phụ thuộc **interface**, không phụ thuộc class concrete trong type position
- Class service vẫn là implementation duy nhất
- Hành vi và API không đổi; tests xanh
