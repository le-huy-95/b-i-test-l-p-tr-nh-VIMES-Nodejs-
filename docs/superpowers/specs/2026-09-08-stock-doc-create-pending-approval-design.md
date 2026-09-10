# Stock Doc Create → Draft + Workflow In Review Design

**Date:** 2026-09-08  
**Status:** Approved  
**Client handoff:** [`docs/STOCK_DOC_CREATE_PENDING_APPROVAL_CLIENT_GUIDE.md`](../../STOCK_DOC_CREATE_PENDING_APPROVAL_CLIENT_GUIDE.md)

## Problem

Tạo phiếu đang auto-submit → phiếu `pending_approval`. Cần: **bỏ bước gửi**; sau create phiếu ở **`draft` (tạo phiếu)**, thông tin duyệt / workflow ở **`in_review` (đang duyệt)** ngay.

## Decisions

1. Create → DocStatus **`draft`** (không `pending_approval`).
2. Create = start duyệt: auto-approve bước `creator`, workflow → **`in_review`**, `currentStep` = bước kế. **Không** gọi stock `submit` / không sync doc qua `onStatusChanged(in_review)`.
3. Duyệt **bước đầu sau `creator`** (vd. warehouse) → DocStatus `draft` → **`pending_approval`**. (Issue: reserve tồn lúc này.)
4. Update chỉ khi: `draft` + caller = `createdById` + chưa có bước sau `creator` ở `approved` / `signed_by_proxy`. Server luôn đọc lại DB.
5. `POST /:id/submit` và workflow action `submit` sau create mới: **deprecate** (`410` `SUBMIT_DEPRECATED`). Legacy phiếu `draft` + workflow `draft` có thể xử lý riêng nếu cần.
6. Scope: stock issue, stock receipt, stock opening.
7. Notify `*_submitted` phát trong create.
8. Reject cho phép từ `draft` hoặc `pending_approval` (vì có thể reject khi phiếu còn draft).
9. Approve / complete và mã lỗi duyệt trùng giữ nguyên (final approve vẫn từ `pending_approval`).

## Flow

```
POST create
  → doc draft
  → initWorkflow + approve creator + workflow in_review
  → (không submit doc)
  → notify submitted

PUT update (optional)
  → re-check: draft + creator + no later step approved

Approve first post-creator step
  → doc pending_approval (+ issue reserve)

Further approve → doc approved → complete/post → completed
```

## API impact

| Area | Change |
|------|--------|
| `POST` create (3 loại) | Status `draft`; workflow started past creator |
| `POST .../submit` | Deprecated `410` |
| First post-creator approve | Doc → `pending_approval` |
| `PUT` issue/receipt/(opening) | Edit lock rules above |
| Approve / reject / complete | Reject also from `draft`; else unchanged |

## Out of scope

- Đổi template bước duyệt
- Optimistic lock `version` trên phiếu
- Visibility list / timezone
- Migration tự động phiếu cũ

## Testing

- Create → `draft` + creator approved + workflow `in_review`
- First warehouse approve → `pending_approval`
- Update by creator while draft and unlocked → OK
- Update after warehouse approved → 409
- Submit endpoint → 410
- Reject while still draft → OK
