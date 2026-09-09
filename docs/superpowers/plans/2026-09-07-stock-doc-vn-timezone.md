# Stock doc VN timezone Implementation Plan

> **For agentic workers:** Use TDD on `vn-time` helper first, then wire services.

**Goal:** Ngày phiếu và timestamp trả về theo UTC+7 cho stock docs.

**Architecture:** Pure helpers `toVnDate` / `formatVnDateOnly` / `formatVnDateTime` / `withVnTimestamps`; services dùng khi ghi và trước khi trả response.

**Tech Stack:** TypeScript, Node, Prisma `@db.Date`

---

### Task 1: Helper + tests

- [x] `tests/utils/vn-time.test.ts` (RED)
- [x] `src/utils/vn-time.ts` (GREEN)

### Task 2: Wire stock services

- [x] receipt / issue / opening: write via `toVnDate`
- [x] serialize responses via `withVnTimestamps`
- [x] line helpers expiry via `toVnDate` where applicable
