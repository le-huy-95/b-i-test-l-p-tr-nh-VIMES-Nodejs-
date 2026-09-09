# Stock Document List Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter stock issue/receipt/opening list (and issue/receipt detail) so only admin/warehouse_keeper/accountant see all docs; other roles see only related docs.

**Architecture:** Shared visibility helper builds Prisma `where` fragments from role + userId + workflow step assignees. Controllers pass actor context; services merge filter into list/get and scope Redis cache keys.

**Tech Stack:** TypeScript, Express, Prisma, Vitest, Redis list cache

---

### Task 1: Visibility helper + unit tests

**Files:**
- Create: `src/modules/stock-balance/stock-doc-visibility.ts`
- Create: `tests/modules/stock-doc-visibility.test.ts`

- [ ] **Step 1: Write failing tests for scope + where builder**
- [ ] **Step 2: Implement helper**
- [ ] **Step 3: Tests pass**

### Task 2: Wire stock-issue list/get

**Files:**
- Modify: `src/modules/stock-issue/stock-issue.service.ts`
- Modify: `src/modules/stock-issue/stock-issue.controller.ts`
- Modify: `tests/modules/stock-issue.service.test.ts` (or new visibility cases)

### Task 3: Wire stock-receipt list/get

**Files:**
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.controller.ts`

### Task 4: Wire stock-opening list

**Files:**
- Modify: `src/modules/stock-opening/stock-opening.service.ts`
- Modify: `src/modules/stock-opening/stock-opening.controller.ts`

### Task 5: Verify

- [ ] Run targeted vitest for visibility + stock services
