# Design: Bỏ bước delivery khỏi workflow số (xuất/nhập)

**Ngày:** 2026-08-20  
**Trạng thái:** Approved (hướng A)

## Mục tiêu

Phiếu xuất/nhập duyệt xong trên hệ thống khi đủ chữ ký số:

`creator → warehouse → chief_accountant`

Người giao hàng **không** nằm trong chuỗi duyệt số; chỉ lưu thông tin (contact / `deliveredByName`) để **ký tay sau khi in phiếu**.

## Quyết định

- Gỡ `delivery` khỏi template `stock_issue` / `stock_receipt`.
- `workflowAssignedApproverIds` cần **2** ID: `[thủ_kho, kế_toán_trưởng]`.
- Giữ API contact / field tên người giao hàng trên phiếu.
- `stock_opening` không đổi.
- Phiếu cũ đã init workflow (còn bước `delivery`) giữ nguyên hành vi.

## Phạm vi

- `src/modules/document-workflow/workflow-templates.ts`
- Tests template (+ docs Flutter / STOCK API mapping)
- Không migration DB; không magic-link cho shipper

## Rủi ro

- Flutter phải deploy đồng bộ (mapping 3 → 2), tránh gán nhầm người duyệt.
