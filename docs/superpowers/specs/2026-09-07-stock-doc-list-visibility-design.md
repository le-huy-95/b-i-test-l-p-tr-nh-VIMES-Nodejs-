# Stock Document List Visibility Design

**Date:** 2026-09-07  
**Status:** Approved

## Problem

API danh sách phiếu xuất / nhập / đầu kỳ hiện chỉ lọc theo `tenantId`, nên mọi thành viên tổ chức đều thấy toàn bộ phiếu. Cần giới hạn theo role và quan hệ với phiếu.

## Rules

### Full access (xem tất cả phiếu trong tenant)

Roles: `admin`, `warehouse_keeper`, `accountant`

### Related-only (role còn lại, ví dụ `staff`)

Phiếu hiển thị nếu **một** trong các điều kiện đúng:

1. `createdById` = user đang đăng nhập
2. `approvedById` = user đang đăng nhập
3. Có bước workflow của phiếu với `assignedApproverId` **hoặc** `requiredSignerId` **hoặc** `actualSignerId` = user

### API scope

| Loại phiếu | List | Detail `GET /:id` |
|------------|------|-------------------|
| Stock issue | Có | Có — không liên quan → 404 |
| Stock receipt | Có | Có — không liên quan → 404 |
| Stock opening | Có | Không có endpoint detail hiện tại — chỉ list |

Không đổi quyền update/submit/approve (đã có workflow + `requireRoles`).

## Approach

Shared helper (cùng tinh thần `organization-overview.helpers`, nhưng full-access gồm thêm `warehouse_keeper` và điều kiện workflow rộng hơn).

- Controller truyền `{ userId, role }` từ `req.user` / `req.tenant`
- Service `list` / `get` merge filter visibility vào `where`
- Cache list: key gồm visibility scope + `userId` khi related-only; full-access dùng key `org` dùng chung. Invalidation theo prefix `list:…:tenantId:` vẫn đủ

## Out of scope

- Đổi visibility của organization overview / warehouse overview
- Thêm `GET` detail cho stock opening
- Lọc theo `authorizedSignerId`
