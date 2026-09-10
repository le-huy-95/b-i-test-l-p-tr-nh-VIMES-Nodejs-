# User Tenants List Cache — Implementation Plan

> **For agentic workers:** Use TDD. Steps use checkbox syntax.

**Goal:** Cache-aside danh sách tổ chức user (`list:user-tenants:{userId}`) cho `/auth/me` + login; invalidate khi accept invite / create tenant.

**Architecture:** `AuthService` `getOrSet` qua `listCache`; `TenantService` `invalidate` key sau membership đổi. Helper key dùng chung.

**Tech Stack:** Redis `listCache`, Vitest, Prisma

---

### Task 1: Helper key + auth tests (RED)

- [ ] Add `src/modules/auth/user-tenants-cache.ts` với `userTenantsCacheKey(userId)`
- [ ] Mock `listCache` trong `tests/modules/auth.service.test.ts`
- [ ] Test: `me` miss → DB → set; hit → không gọi findMany lần 2; response có `tenants`
- [ ] Test: `login` dùng cùng key / getOrSet
- [ ] Run tests — expect fail (chưa implement)

### Task 2: AuthService (GREEN)

- [ ] Inject `listCache`; `buildTenantMemberships` wrap getOrSet + map DTO
- [ ] `me` trả profile + `tenants`
- [ ] Login/Google dùng helper đã cache
- [ ] Tests pass

### Task 3: Tenant invalidate (RED → GREEN)

- [ ] Test createTenant gọi `invalidate(userTenantsCacheKey(userId))`
- [ ] Test acceptInvite gọi invalidate cùng key
- [ ] Implement invalidate trong `createTenant` + `acceptInvite`
- [ ] Tests pass

### Task 4: Docs sync

- [ ] Cập nhật `docs/API.md` / `docs/USER_TENANTS.md`: `/auth/me` có `status` trong tenants; ghi chú cache + invalidate
