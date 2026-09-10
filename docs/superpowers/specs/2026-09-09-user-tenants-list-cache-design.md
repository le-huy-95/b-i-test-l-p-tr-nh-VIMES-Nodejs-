# Design: Cache danh sách tổ chức của user

**Date:** 2026-09-09  
**Status:** Approved

## Goal

Cache-aside danh sách tenant (tổ chức) mà user đang thuộc, dùng chung cho `GET /auth/me` và login (password + Google). Lần đầu miss → query DB → set cache; lần sau đọc cache. Khi membership đổi (accept invite / tạo tenant) → lazy delete key → lần gọi list tiếp theo query DB lại.

## Decisions

- Approach: cache-aside trên `AuthService` qua `listCache` hiện có.
- Scope cache: cả `/auth/me` và login/Google (một key theo `userId`).
- Invalidate: `POST /auth/invitations/accept` và `POST /auth/tenants` (createTenant).
- TTL: `DEFAULT_LIST_CACHE_TTL` (60s), giống các list khác.
- Redis lỗi: fail im lặng, luôn fallback DB (`getOrSet`).

## Cache key & payload

- Key: `list:user-tenants:{userId}`
- Value: mảng DTO dùng chung:

```ts
{ id, code, name, logoUrl, role, status }
```

Chỉ membership `isActive = true`.

`GET /auth/me` bổ sung field `tenants` (hiện code thiếu so với docs), kèm `status` để một cache phục vụ cả login và me.

## Data flow

1. `me` / `buildSessionResponse` gọi `listCache.getOrSet(key, loader)`.
2. Loader: `userTenant.findMany({ where: { userId, isActive: true }, include: { tenant: true } })` rồi map DTO.
3. Hit → trả cached; miss → DB → set → trả.
4. `acceptInvite` / `createTenant` sau khi ghi DB thành công: `listCache.invalidate(key)`.
5. Lần đọc tiếp theo miss → DB → set lại.

## Files

- `src/modules/auth/auth.service.ts` — getOrSet; `me` trả `tenants`.
- `src/modules/tenant/tenant.service.ts` — invalidate sau accept / createTenant.
- Helper key dùng chung (export) để Auth và Tenant không lệch string.
- Tests: `auth.service.test.ts`, `tenant.service.test.ts`.
- Docs: `USER_TENANTS.md` / `API.md` — `/auth/me` có `status` trong mỗi tenant.

## Out of scope

- Invalidate khi đổi logo/tên tenant, decline invite, tạo user nội bộ.
- Endpoint `GET /tenants` riêng.
- Đổi TTL mặc định toàn cục.
