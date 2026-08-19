# Inventory Backend GĐ0+GĐ1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây nền tảng SaaS (tenant/auth/email/Prisma) + MVP kho GĐ1 (master data, tồn đầu kỳ, nhập/xuất, StockBalance/Ledger) trên `test-y-Backend`.

**Architecture:** Modular monolith Express + Prisma + Redis + MinIO + Nodemailer (SMTP từ ktx-be-new). Mọi API nghiệp vụ qua `/api/v1`, JWT mỏng + `X-Tenant-Id`.

**Tech Stack:** Express, TypeScript, Prisma, PostgreSQL, Zod, JWT, bcrypt, ioredis, BullMQ, Nodemailer, Handlebars, decimal.js, Vitest

**Design ref:** `docs/superpowers/specs/2026-08-14-inventory-backend-design.md`

**Out of scope this plan:** GĐ2–4 đầy đủ (batch FEFO nâng cao, transfer, location enforce, cache-aside Outbox, SSE) — chỉ để schema hooks nếu cần; implement sau.

---

## File map (GĐ0+GĐ1)

| Path | Responsibility |
|---|---|
| `docker-compose.yml` | Postgres, Redis, MinIO |
| `prisma/schema.prisma` | Toàn bộ model GĐ1 (+ stub field GĐ2/3 nếu cần) |
| `src/config/env.ts` | Zod env (DB, JWT, SMTP, Redis, MinIO) |
| `src/infra/prisma.ts` | Prisma client singleton |
| `src/infra/redis.ts` | ioredis |
| `src/infra/smtp.ts` | Nodemailer transporter |
| `src/services/email/**` | EmailService + handlers (port ktx) |
| `src/middlewares/**` | auth, tenant, rbac, error |
| `src/modules/auth/**` | register/verify/login/refresh |
| `src/modules/tenant/**` | create tenant, invite, users |
| `src/modules/warehouse/**` | CRUD warehouses |
| `src/modules/product/**` | products + units |
| `src/modules/supplier/**` | suppliers |
| `src/modules/customer/**` | customers |
| `src/modules/stock-opening/**` | opening balance post |
| `src/modules/stock-receipt/**` | receipt workflow + complete |
| `src/modules/stock-issue/**` | issue workflow + complete |
| `src/modules/stock-balance/**` | reader/writer services |
| `src/modules/stock-ledger/**` | append-only record |
| `src/utils/numbering.ts` | atomic phiếu codes |
| `src/app.ts` | mount `/api/v1` |
| `tests/**` | unit + integration critical paths |

---

### Task 1: Dependencies + Docker + env

- [ ] Add packages: `@prisma/client`, `prisma`, `zod`, `bcryptjs`, `jsonwebtoken`, `ioredis`, `bullmq`, `nodemailer`, `handlebars`, `decimal.js`, `uuid`, `@types/*`, `vitest`
- [ ] Create `docker-compose.yml` (postgres:5432, redis:6379, minio:9000)
- [ ] Expand `.env.example` + local `.env` (no secrets in git)
- [ ] Replace `src/config` with Zod-validated `env.ts`

### Task 2: Prisma schema GĐ1 + migrate

- [ ] Models: Tenant, User, UserTenant, UserWarehouse, Invitation, SendEmailLog, RefreshToken, NumberingCounter, Warehouse, Product, ProductUnit, Supplier, Customer, Department, StockOpening*, StockReceipt*, StockIssue*, StockBalance, StockLedger, StockReservation (for submit), DocumentAttachment/File stubs
- [ ] `npx prisma migrate dev`
- [ ] `src/infra/prisma.ts`

### Task 3: App shell + error contract

- [ ] `AppError` with `code` + HTTP status
- [ ] errorHandler format `{ success, error: { code, message, details } }`
- [ ] Restructure routes under `/api/v1`
- [ ] Health check remains

### Task 4: Email module (ktx port)

- [ ] Nodemailer from SMTP_* 
- [ ] EmailService + Handlebars templates (otp, invite, welcome)
- [ ] SendEmailLog pending → send → success/failed
- [ ] Unit test: `isSmtpConfigured` / template render

### Task 5: Auth + Tenant + RBAC

- [ ] Register (email|phone), verify OTP, login, refresh rotate, logout
- [ ] Create tenant, invite, accept, create internal user
- [ ] Middlewares: auth, tenant, rbac
- [ ] Permission cache in Redis (simple get/set)
- [ ] Integration: unverified user blocked; wrong tenant 403

### Task 6: Master data CRUD

- [ ] Warehouse, Product(+units), Supplier, Customer
- [ ] Soft delete products; tenant-scoped queries
- [ ] Numbering util test

### Task 7: Stock core services

- [ ] StockBalanceWriter applyIncrease/applyDecrease (bulk, version)
- [ ] StockLedgerService.record
- [ ] available qty with reservations
- [ ] Unit tests with mocked prisma or integration DB

### Task 8: Opening + Receipt + Issue

- [ ] Opening post once per warehouse
- [ ] Receipt: draft→submit→approve→complete (cộng tồn)
- [ ] Issue: draft→submit(reserve)→approve→complete (trừ tồn, no negative)
- [ ] reject/cancel releases reservation
- [ ] Integration: complete issue insufficient → STOCK_INSUFFICIENT; tenant isolation

### Task 9: Verify

- [ ] `npm run typecheck` pass
- [ ] `npm test` critical tests pass
- [ ] README cập nhật cách chạy Docker + migrate + dev

---

## Execution order

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

GĐ2–4: plan riêng sau khi GĐ1 chạy ổn.
