# Stock document Vietnam timezone (+7)

**Date:** 2026-09-07  
**Status:** Approved

## Goal

API tạo/đọc phiếu nhập, xuất, tồn đầu kỳ dùng giờ Việt Nam (UTC+7) cho ngày phiếu và timestamp (`createdAt` / `updatedAt` / …).

## Behavior

| Hướng | Field | Hành vi |
|-------|--------|---------|
| Write | `receiptDate`, `issueDate`, `effectiveDate`, `expiryDate` (date) | Parse theo lịch VN → lưu `@db.Date` đúng ngày VN |
| Read | date-only fields | ISO `YYYY-MM-DDT00:00:00.000+07:00` |
| Read | `createdAt`, `updatedAt`, `approvedAt`, `completedAt`, `postedAt` | ISO wall-clock VN với đuôi `+07:00` |

## Scope

- `stock-receipt`, `stock-issue`, `stock-opening` (list/get/create/update và mutation trả doc)
- Helper `src/utils/vn-time.ts`

## Out of scope

- Global JSON serializer toàn API
- Đổi DB column type / migration
- Client Flutter parse changes (client vẫn nhận ISO có offset)
