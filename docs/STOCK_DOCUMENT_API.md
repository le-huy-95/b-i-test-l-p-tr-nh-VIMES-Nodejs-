# API Phiếu Xuất & Nhập Kho — Hướng dẫn tích hợp Flutter

Tài liệu duy nhất cho frontend về **API phiếu xuất kho, phiếu nhập kho, phiếu đầu kỳ** và **workflow duyệt phiếu** theo mô hình người duyệt nội bộ + người giao hàng contact dùng chung nhiều tenant.

Tài liệu này là nguồn tham chiếu chính cho Flutter.

---

## Mục lục

1. [Quy ước chung](#1-quy-ước-chung)
2. [Mô hình phân quyền](#2-mô-hình-phân-quyền)
3. [Trạng thái phiếu](#3-trạng-thái-phiếu)
4. [API phiếu xuất kho](#4-api-phiếu-xuất-kho)
5. [API phiếu nhập kho](#5-api-phiếu-nhập-kho)
6. [API phiếu đầu kỳ](#6-api-phiếu-đầu-kỳ)
7. [API workflow duyệt phiếu](#7-api-workflow-duyệt-phiếu)
8. [API nhân sự và contact](#8-api-nhân-sự-và-contact)
9. [Ràng buộc dữ liệu](#9-ràng-buộc-dữ-liệu)
10. [Tích hợp Flutter](#10-tích-hợp-flutter)
11. [Mapping lỗi backend → UI Flutter](#11-mapping-lỗi-backend--ui-flutter)
12. [Checklist triển khai](#12-checklist-triển-khai)

---

## 1. Quy ước chung

- Mọi API đều cần tenant context.
- Header bắt buộc:

```http
Authorization: Bearer <access_token>
X-Tenant-Id: <tenant_id>
```

- Request mutate nên gắn thêm `Idempotency-Key` để chống double-tap/retry:

```http
Idempotency-Key: 7d2bb3a5-4f24-4e2f-a4c6-2d7a3e8c1c35
```

- Response thành công:

```json
{ "success": true, "data": {} }
```

- Lỗi:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

---

## 2. Mô hình phân quyền

| Role | Quyền chính |
|---|---|
| `admin` | Thao tác hầu hết nghiệp vụ |
| `warehouse_keeper` | Sửa, submit, hủy phiếu |
| `accountant` | Duyệt, từ chối, hoàn tất |
| `approver` | Duyệt, từ chối tương tự accountant |
| `viewer` | Chỉ xem |

> **Tạo phiếu**: mọi thành viên trong tổ chức (`admin`, `warehouse_keeper`, `accountant`, `approver`, `viewer`) đều có thể **tạo phiếu xuất, phiếu nhập, phiếu đầu kỳ** ở trạng thái `draft`. Quyền duyệt/hủy/hoàn tất vẫn theo workflow và role như bảng trên.

> Người giao hàng **không cần login** — lưu dưới dạng contact, không thuộc role tenant.

---

## 3. Trạng thái phiếu

| Status | Ý nghĩa |
|---|---|
| `draft` | Đang soạn, còn sửa được |
| `pending_approval` | Đã submit, chờ duyệt |
| `approved` | Đã duyệt |
| `rejected` | Bị từ chối |
| `cancelled` | Đã hủy |
| `completed` | Đã ghi nhận tồn kho |

### Chuyển trạng thái hợp lệ (xuất/nhập)

```
draft ──submit──► pending_approval ──approve──► approved ──complete──► completed
                     │                             │
                     ├──reject──► rejected         └──cancel──► cancelled
                     └──cancel──► cancelled
```

---

## 4. API phiếu xuất kho

### 4.1 Danh sách

- `GET /stock-issues`

Query:

| Param | Type | Ghi chú |
|---|---|---|
| `page` | int | trang |
| `limit` | int | số item/trang |
| `status` | string? | lọc theo status |
| `warehouseId` | string? | lọc theo kho |
| `search` | string? | tìm theo code |

### 4.2 Tạo mới

- `POST /stock-issues`
- Role: tất cả thành viên tổ chức (mọi role)

Body:

```json
{
  "warehouseId": "wh_001",
  "issueType": "sale",
  "customerId": "cus_001",
  "issueDate": "2026-08-18T08:00:00.000Z",
  "note": "Xuất bán cho khách",
  "deliveredBy": {
    "contactId": "con_123",
    "kind": "external",
    "fullName": "Nguyễn Văn B",
    "phone": "0909123456",
    "companyName": "Công ty vận tải ABC",
    "note": "Giao ngoài giờ hành chính"
  },
  "workflowAssignedApproverIds": ["user_010", "user_011", "user_012"],
  "lines": [
    {
      "productId": "prd_001",
      "unitName": "thùng",
      "requestedQty": 10,
      "actualQty": 10,
      "unitPrice": 0,
      "batchId": "batch_001"
    }
  ]
}
```

### 4.3 Xem chi tiết

- `GET /stock-issues/:id`

### 4.4 Cập nhật

- `PUT /stock-issues/:id`
- Chỉ cho phiếu `draft`

### 4.5 Submit

- `POST /stock-issues/:id/submit`
- Role: `admin`, `warehouse_keeper`

### 4.6 Approve

- `POST /stock-issues/:id/approve`
- Role: `admin`, `accountant`, `approver`

### 4.7 Reject

- `POST /stock-issues/:id/reject`
- Role: `admin`, `accountant`, `approver`

Body:

```json
{ "reason": "Thiếu thông tin lô hàng" }
```

### 4.8 Complete

- `POST /stock-issues/:id/complete`
- Role: `admin`, `accountant`, `approver`

### 4.9 Cancel

- `POST /stock-issues/:id/cancel`
- Role: `admin`, `warehouse_keeper`

---

## 5. API phiếu nhập kho

### 5.1 Danh sách

- `GET /stock-receipts`

### 5.2 Tạo mới

- `POST /stock-receipts`
- Role: tất cả thành viên tổ chức (mọi role)

Body:

```json
{
  "warehouseId": "wh_001",
  "supplierId": "sup_001",
  "receiptType": "purchase",
  "receiptDate": "2026-08-18T08:00:00.000Z",
  "deliveredBy": {
    "contactId": "con_123",
    "kind": "external",
    "fullName": "Nguyễn Văn B",
    "phone": "0909123456",
    "companyName": "Công ty vận tải ABC"
  },
  "note": "Nhập hàng từ nhà cung cấp",
  "workflowAssignedApproverIds": ["user_010", "user_011", "user_012"],
  "lines": [
    {
      "productId": "prd_001",
      "unitName": "thùng",
      "expectedQty": 100,
      "actualQty": 98,
      "unitPrice": 120000,
      "batchNo": "L001",
      "expiryDate": "2027-08-18T00:00:00.000Z",
      "manufactureDate": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

### 5.3 Xem chi tiết

- `GET /stock-receipts/:id`

### 5.4 Cập nhật

- `PUT /stock-receipts/:id`
- Chỉ cho phiếu `draft`

### 5.5 Submit

- `POST /stock-receipts/:id/submit`

### 5.6 Approve

- `POST /stock-receipts/:id/approve`

### 5.7 Reject

- `POST /stock-receipts/:id/reject`

### 5.8 Complete

- `POST /stock-receipts/:id/complete`

### 5.9 Cancel

- `POST /stock-receipts/:id/cancel`

### 5.10 Clone từ phiếu bị từ chối

- `POST /stock-receipts/:id/clone-from-rejected`
- Role: `admin`, `warehouse_keeper`

---

## 6. API phiếu đầu kỳ

### 6.1 Danh sách

- `GET /stock-openings`

### 6.2 Tạo mới

- `POST /stock-openings`
- Role: tất cả thành viên tổ chức (mọi role)

Body:

```json
{
  "warehouseId": "wh_001",
  "effectiveDate": "2026-08-18T08:00:00.000Z",
  "note": "Tạo phiếu đầu kỳ",
  "workflowAssignedApproverIds": ["user_010", "user_011", "user_012", "user_013"]
}
```

### 6.3 Post phiếu

- `POST /stock-openings/:id/post`
- Role: `admin`, `accountant`, `approver`

---

## 7. API workflow duyệt phiếu

### 7.1 Danh sách workflow

- `GET /documents`

Query:

| Param | Type | Ghi chú |
|---|---|---|
| `documentType` | enum? | `stock_issue` / `stock_receipt` / `stock_opening` |
| `status` | string? | lọc theo `documentStatus` |
| `warehouseId` | string? | lọc theo kho |
| `assignedApproverId` | string? | phiếu đang chờ tôi xử lý |
| `createdById` | string? | phiếu do tôi tạo |
| `search` | string? | tìm theo code |
| `page`, `limit` | int | phân trang |

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "doc_001",
        "code": "PXK-0001",
        "documentType": "stock_issue",
        "documentStatus": "in_review",
        "currentStepCode": "warehouse",
        "currentStepStatus": "pending",
        "createdById": "user_001",
        "createdAt": "2026-08-18T08:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
  }
}
```

### 7.2 Chi tiết workflow

- `GET /documents/:id`

Trả full document + steps + deliverySnapshot + authorizations (xem mục [Data contract](#data-contract-import-ready) bên dưới).

### 7.3 Action

- `POST /documents/:id/actions`

Body:

```json
{
  "action": "approve",
  "stepId": "step_003",
  "note": "Đã kiểm tra đủ hàng, lô đúng hạn",
  "proxySignerId": null,
  "authorizationIds": []
}
```

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `action` | enum | ✅ | `submit`, `approve`, `reject`, `proxy_sign`, `skip`, `cancel`, `complete`, `return` |
| `stepId` | string | tùy action | bắt buộc với `approve`/`reject`/`proxy_sign`/`skip` |
| `note` | string | ❌ | ghi chú |
| `proxySignerId` | string? | với `proxy_sign` | người ký thay |
| `authorizationIds` | string[] | với `proxy_sign` | giấy ủy quyền |

### 7.4 Gán người xử lý lại

- `PATCH /documents/:id/steps/:stepId/assignee`

```json
{ "assignedApproverId": "user_123" }
```

### 7.5 Upload giấy ủy quyền

- `POST /documents/:id/steps/:stepId/authorizations`
- `multipart/form-data`

| Field | Ghi chú |
|---|---|
| `file` | file ảnh/pdf |
| `authorizationNo` | số giấy ủy quyền |
| `issuedBy` | đơn vị/người cấp |
| `issuedAt` | ngày cấp |
| `validFrom` | hiệu lực từ |
| `validTo` | hiệu lực đến |
| `note` | ghi chú |

### 7.6 Timeline

- `GET /documents/:id/timeline`

---

## 8. API nhân sự và contact

### 8.1 Danh sách nhân sự nội bộ

- `GET /tenant/members`

Query:

| Param | Type | Ghi chú |
|---|---|---|
| `search` | string? | tìm theo tên/email/phone |
| `page` | int | phân trang |
| `limit` | int | phân trang |

Response item:

```json
{
  "id": "ut_001",
  "userId": "user_010",
  "name": "Nguyễn Văn A",
  "email": "a@company.com",
  "phone": "0909123456",
  "role": "warehouse_keeper",
  "isActive": true
}
```

> Flutter dùng `role` để chia dropdown: `warehouse_keeper`, `accountant`, `admin`.

### 8.2 Danh sách contact người giao hàng

- `GET /tenant/contacts`

Query:

| Param | Type | Ghi chú |
|---|---|---|
| `search` | string? | tìm theo tên/phone |
| `relationType` | enum? | `delivery_person`, `vendor_contact`, `receiver`, `other` |
| `page` | int | phân trang |
| `limit` | int | phân trang |

Response item:

```json
{
  "id": "con_123",
  "kind": "external",
  "fullName": "Nguyễn Văn B",
  "phone": "0909123456",
  "email": null,
  "companyName": "Công ty vận tải ABC",
  "taxCode": null,
  "note": "Giao hàng tuyến miền Nam",
  "isActive": true
}
```

### 8.3 Tạo contact nhanh

- `POST /tenant/contacts`

Body:

```json
{
  "kind": "external",
  "fullName": "Nguyễn Văn B",
  "phone": "0909123456",
  "companyName": "Công ty vận tải ABC",
  "relationType": "delivery_person"
}
```

### 8.4 Gắn contact vào tenant

- `POST /tenant/contacts/:contactId/link`

```json
{ "relationType": "delivery_person" }
```

---

## 9. Ràng buộc dữ liệu

### Phiếu xuất kho

- `issueType` bắt buộc
- `issueType = sale` → `customerId` bắt buộc
- `lines.length >= 1`
- `requestedQty > 0`, `actualQty > 0`
- `unitName` không rỗng
- `workflowAssignedApproverIds.length` khớp số bước sau `creator`

### Phiếu nhập kho

- `receiptType` bắt buộc
- `lines.length >= 1`
- `expectedQty >= 0`, `actualQty > 0`
- `unitPrice >= 0`
- `workflowAssignedApproverIds.length` khớp số bước sau `creator`

### Theo trạng thái

- Chỉ sửa khi `draft`
- Không submit khi form chưa hợp lệ
- Không approve/reject khi chưa `pending_approval`
- Không complete khi chưa `approved`

### Idempotency

Gắn `Idempotency-Key` cho: tạo phiếu, submit, approve, reject, complete, cancel, tạo contact.

---

## 10. Tích hợp Flutter

### 10.1 Service layer gợi ý

```dart
class StockDocumentApi {
  Future<StockIssue> createIssue(CreateStockIssueRequest body);
  Future<StockReceipt> createReceipt(CreateStockReceiptRequest body);
  Future<StockIssue> submitIssue(String id);
  Future<StockIssue> approveIssue(String id);
  Future<StockIssue> rejectIssue(String id, {String? reason});
  Future<StockIssue> completeIssue(String id);
  Future<StockIssue> cancelIssue(String id);
}

class ContactApi {
  Future<List<DeliveryContact>> listContacts({String? relationType, String? search});
  Future<DeliveryContact> createContact(CreateContactRequest body);
}
```

### 10.2 Chọn người duyệt trên màn tạo phiếu

1. Gọi `GET /tenant/members` → chia theo `role`
2. Gọi `GET /tenant/contacts?relationType=delivery_person` → danh sách người giao hàng
3. Cho phép thêm nhanh contact mới bằng `POST /tenant/contacts`
4. Gửi phiếu kèm `deliveredBy` + `workflowAssignedApproverIds`

### 10.3 UI theo trạng thái

| Status | Nút hiển thị |
|---|---|
| `draft` | Sửa, Submit, Hủy |
| `pending_approval` | Duyệt, Từ chối, (Ký thay nếu có ủy quyền), Hủy |
| `approved` | Hoàn tất, Hủy |
| `rejected` | Tạo lại / Clone |
| `completed` | Chỉ xem |

---

## 11. Mapping lỗi backend → UI Flutter

| Code backend | Cách hiển thị gợi ý |
|---|---|
| `UNAUTHORIZED` | Về màn login |
| `TENANT_REQUIRED` | Yêu cầu chọn tenant |
| `FORBIDDEN` | Không đủ quyền |
| `TENANT_SUSPENDED` | Tenant bị khóa |
| `EMAIL_NOT_VERIFIED` | Yêu cầu xác minh tài khoản |
| `VALIDATION_ERROR` | Highlight form field |
| `NOT_FOUND` | Không tìm thấy dữ liệu |
| `INVALID_STATUS_TRANSITION` | Phiếu không còn ở trạng thái hợp lệ |
| `STOCK_INSUFFICIENT` | Không đủ tồn kho |
| `EXPIRED_BATCH` | Lô hàng đã hết hạn |
| `WORKFLOW_EXISTS` | Phiếu đã có workflow |
| `AUTHORIZATION_INVALID` | Ủy quyền ký thay không hợp lệ |
| `IDEMPOTENCY_IN_PROGRESS` | Đang xử lý, thử lại sau |
| `IDEMPOTENCY_KEY_REUSED` | Yêu cầu đã gửi với dữ liệu khác |

---

## 12. Checklist triển khai

### Backend

- [x] Tạo phiếu (xuất/nhập/đầu kỳ) cho phép mọi thành viên tổ chức
- [ ] Kiểm tra role trước khi thao tác sửa/submit/duyệt/hủy/hoàn tất
- [ ] Luôn truyền tenant context
- [ ] Validate payload bằng schema
- [ ] Idempotency cho mọi mutation
- [ ] Khóa edit khi không còn `draft`
- [ ] Invalidate cache khi phiếu đổi

### Flutter

- [ ] Lưu access token an toàn
- [ ] Lưu tenant hiện tại
- [ ] Gắn đủ headers cho mọi request
- [ ] Validate form trước khi gửi
- [ ] Disable nút khi loading
- [ ] Chọn người duyệt từng bước trên màn tạo phiếu
- [ ] Chọn/thêm nhanh người giao hàng contact
- [ ] Xử lý retry + idempotency
- [ ] Refresh list sau create/update/submit/approve/complete
