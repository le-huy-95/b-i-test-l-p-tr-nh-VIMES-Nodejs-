# Client Guide — Tạo phiếu `draft` + workflow `in_review` (bỏ bước Submit)

Tài liệu **bắt buộc** cho Flutter / web client khi backend đổi contract tạo phiếu kho.

Áp dụng: **phiếu xuất**, **phiếu nhập**, **phiếu đầu kỳ**.

---

## 1. Thay đổi chính (breaking)

| Trước | Sau |
|-------|-----|
| `POST create` → `status: pending_approval` (hoặc `draft` rồi submit) | `POST create` → phiếu **`draft`** |
| Workflow sau create: `draft` hoặc cần submit | Workflow sau create: **`in_review`**; bước `creator` = `approved`; bước kế = `pending` |
| Client gọi `POST /:id/submit` | **Không gọi** — `410` `SUBMIT_DEPRECATED` |
| Chỉ sửa khi `draft` (trước gửi) | Sửa khi `draft` + đúng người tạo + chưa có bước sau `creator` đã duyệt |
| `pending_approval` = vừa gửi duyệt | `pending_approval` = đã có ≥1 bước sau `creator` duyệt |

UI: phiếu hiện **tạo phiếu / nháp**; khối thông tin duyệt hiện **đang duyệt**. Không còn nút Gửi duyệt sau create.

---

## 2. Luồng mới

```text
[Form tạo phiếu + chọn người duyệt]
        │
        ▼
POST create  ──────────────────────────────►  Doc: draft
                                              Workflow: in_review
                                              creator: approved
                                              bước kế (warehouse…): pending
                                              Notify: *_submitted
        │
        ├─ (tuỳ chọn) PUT update ──► chỉ người tạo, khi chưa ai duyệt bước sau creator
        │
        ▼
Approve bước đầu sau creator ──────────────►  Doc: pending_approval
                                              (phiếu xuất: reserve tồn lúc này)
        │
        ▼
Approve hết bước → Doc: approved → complete → completed
```

Reject / cancel giữ như cũ (reject được cả khi phiếu còn `draft`).

---

## 3. Client phải sửa gì

### 3.1 Bỏ Submit

- Xóa nút / action **Gửi duyệt**.
- Không gọi `POST .../submit` hay workflow `action: "submit"` sau create.
- Endpoint submit → `410` `SUBMIT_DEPRECATED`.

### 3.2 Sau create

```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "draft"
  }
}
```

| Field | Expect |
|-------|--------|
| Doc `status` | `draft` |
| Workflow `status` | `in_review` |
| Step `creator` | `approved` |
| `currentStepCode` | bước sau creator (vd. `warehouse`) |
| `available-actions` | không có `submit`; có `approve` / `reject` / `cancel` (tùy user) |

### 3.3 Form tạo

Vẫn bắt buộc `workflowAssignedApproverIds` đủ người duyệt.

### 3.4 Sửa phiếu

Chỉ khi: `draft` + user = `createdById` + chưa có bước sau `creator` ở `approved` / `signed_by_proxy`.

### 3.5 UI theo DocStatus

| Status | Gợi ý |
|--------|--------|
| `draft` (workflow `in_review`) | Sửa (creator + chưa khóa), Duyệt/Từ chối theo available-actions, Hủy |
| `pending_approval` | Duyệt tiếp, Hủy; không sửa |
| `approved` | Hoàn tất, Hủy |
| `rejected` / `cancelled` / `completed` | Như cũ |

### 3.6 Notification

`*_submitted` phát lúc **create**.

---

## 4. Mapping lỗi

| Code | HTTP | Khi nào |
|------|------|---------|
| `SUBMIT_DEPRECATED` | 410 | Còn gọi submit |
| `FORBIDDEN` | 403 | Update không phải người tạo |
| `INVALID_STATUS_TRANSITION` | 409 | Update khi đã khóa / sai status |
| `STEP_NOT_PENDING` / `INVALID_ACTION` | 409 | Duyệt trùng / stale |

---

## 5. Checklist app

- [ ] Sau create expect doc `draft` + workflow `in_review`
- [ ] Xóa Submit UI/API
- [ ] Label: phiếu = tạo phiếu; duyệt = đang duyệt
- [ ] Nút Sửa theo 3 điều kiện
- [ ] Sau duyệt bước đầu sau creator expect `pending_approval`
- [ ] available-actions là nguồn hiện nút

---

## 6. Tham chiếu

- Design: `docs/superpowers/specs/2026-09-08-stock-doc-create-pending-approval-design.md`
