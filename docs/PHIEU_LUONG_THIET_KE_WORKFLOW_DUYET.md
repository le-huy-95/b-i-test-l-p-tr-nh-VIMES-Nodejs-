# Thiết kế Workflow Duyệt Phiếu Nhiều Cấp — Schema & API Spec

Tài liệu này thiết kế hệ thống **duyệt/ký phiếu nhiều cấp** cho các phiếu kho (`stock_issue`, `stock_receipt`, `stock_opening`), hỗ trợ:

- Người duyệt nội bộ theo cấp bậc: người lập phiếu, thủ kho, kế toán trưởng, admin (đầu kỳ)
- Người giao hàng **không** nằm trong chuỗi duyệt số; lưu contact/`deliveredBy` trên phiếu để **ký tay sau khi in**
- Mỗi bước duyệt số có **status riêng**, **note riêng**, **thời điểm xử lý riêng**
- Hỗ trợ **ký thay (proxy signing)** kèm **giấy ủy quyền** đính kèm
- Lịch sử trạng thái đầy đủ (audit log)
- API tối ưu: list nhẹ, detail đầy đủ, action thống nhất

---

## Mục lục

> Hướng dẫn sử dụng API phiếu xuất/nhập/đầu kỳ: xem **`STOCK_DOCUMENT_API.md`**

1. [Nguyên tắc thiết kế](#1-nguyên-tắc-thiết-kế)
2. [Mô hình tổng quan](#2-mô-hình-tổng-quan)
3. [Schema chi tiết](#3-schema-chi-tiết)
4. [Trạng thái & State Machine](#4-trạng-thái--state-machine)
5. [Cấu hình quy trình (Workflow Template)](#5-cấu-hình-quy-trình-workflow-template)
6. [API Spec](#6-api-spec)
7. [Luồng xử lý phía Backend](#7-luồng-xử-lý-phía-backend)
8. [Kiểm tra ủy quyền hợp lệ](#8-kiểm-tra-ủy-quyền-hợp-lệ)
9. [Đồng bộ trạng thái (Denormalized fields)](#9-đồng-bộ-trạng-thái-denormalized-fields)
10. [Tối ưu hiệu năng & Index](#10-tối-ưu-hiệu-năng--index)
11. [Tích hợp Flutter](#11-tích-hợp-flutter)
12. [Tối ưu API](#12-tối-ưu-api)
13. [Mẫu Request/Response](#13-mẫu-requestresponse)
14. [Kết luận](#14-kết-luận)

---

## 1. Nguyên tắc thiết kế

1. **Giữ bảng nghiệp vụ riêng** (`StockIssue`, `StockReceipt`, `StockOpeningBalance`) — không gộp chung.
2. **Người duyệt nội bộ** và **người giao hàng bên ngoài** là hai nhóm dữ liệu khác nhau.
3. **Tách workflow ra bảng riêng** dùng chung cho mọi loại phiếu — mở rộng không phải đổi schema.
4. **Mỗi bước ký là 1 record** — status, note, actor, thời điểm theo từng bước.
5. **Ủy quyền là dữ liệu riêng** (bảng con của step) — có thể nhiều giấy tờ, kiểm tra được hiệu lực.
6. **Lịch sử là append-only** — mọi chuyển trạng thái đều ghi lại, không bao giờ sửa/xóa.
7. **Denormalize trạng thái lên bảng phiếu** — list nhanh, không cần join.
8. **Một endpoint action thống nhất** — `POST /documents/:id/actions`, dễ dùng, dễ audit.
9. **Idempotency ở mọi mutation** — chống double-tap và retry.

---

## 2. Mô hình tổng quan

```
┌────────────────────────────────────────────────────────────────┐
│                       Bảng phiếu nghiệp vụ                     │
│  stock_issues · stock_receipts · stock_opening_balances        │
│  + documentStatus (denorm) + currentStep* (denorm) + version   │
└───────────────────────────┬────────────────────────────────────┘
                            │ 1:N
┌───────────────────────────▼────────────────────────────────────┐
│                  document_workflow_steps                       │
│  Xuất/nhập: creator → warehouse → chief_accountant             │
│  Đầu kỳ:    creator → warehouse → chief_accountant → admin     │
│  status / note / actionAt / requiredSignerId                   │
│  assignedApproverId / actualSignerId / authorizedSignerId      │
└───────────┬──────────────────────────────┬─────────────────────┘
            │ 1:N                          │ 1:N
┌───────────▼────────────────┐  ┌──────────▼─────────────────────┐
│ document_step_authorizations│  │ document_status_history        │
│ giấy ủy quyền của từng bước │  │ audit log mọi chuyển trạng thái│
└────────────────────────────┘  └────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                    people / contacts                           │
│  person dùng chung cho nhiều tenant, không bắt buộc login       │
│  dùng cho deliveredBy / in phiếu (ký tay), không phải bước số   │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Schema chi tiết

### 3.1 Bảng phiếu nghiệp vụ (bổ sung vào bảng hiện có)

Mỗi bảng `stock_issues` / `stock_receipts` / `stock_opening_balances` bổ sung các cột sau để frontend import một lần là đủ dùng:

- `documentStatus`
- `documentStatusUpdatedAt`
- `currentStepCode`
- `currentStepStatus`
- `currentStepUpdatedAt`
- `lastActionById`
- `lastActionAt`
- `version`
- `deliveryContactId` (nếu phiếu có người giao hàng bên ngoài)
- `deliveryContactName`
- `deliveryContactPhone`
- `deliveryContactEmail`
- `deliveryContactCompanyName`
- `deliveryContactNote`
- `deliveryContactSnapshotAt`

Mỗi cột tương ứng:

| Field | Type | Ghi chú |
|---|---|---|
| `documentStatus` | enum | Trạng thái tổng, denormalize từ steps |
| `documentStatusUpdatedAt` | datetime | Lúc trạng thái tổng đổi gần nhất |
| `currentStepCode` | string? | Code bước đang xử lý |
| `currentStepStatus` | enum? | Status bước đang xử lý |
| `currentStepUpdatedAt` | datetime? | Lúc bước hiện tại đổi |
| `lastActionById` | string? | Người thao tác gần nhất |
| `lastActionAt` | datetime? | Lúc thao tác gần nhất |
| `version` | int | Optimistic lock, đã có sẵn |
| `deliveryContactId` | string? | Contact giao hàng bên ngoài, nếu có |
| `deliveryContactName` | string? | Snapshot tên người giao hàng |
| `deliveryContactPhone` | string? | Snapshot số điện thoại |
| `deliveryContactEmail` | string? | Snapshot email |
| `deliveryContactCompanyName` | string? | Snapshot công ty/đơn vị |
| `deliveryContactNote` | string? | Ghi chú snapshot |
| `deliveryContactSnapshotAt` | datetime? | Thời điểm chụp snapshot |

> Các cột `approvedById`, `approvedAt`, `rejectedById`, `rejectedAt` có thể giữ lại để lọc nhanh, nhưng **không dùng làm nguồn sự thật** — nguồn sự thật nằm ở steps.

---

### 3.2 Bảng `document_workflow_steps`

```prisma
enum WorkflowStepStatus {
  pending
  approved
  rejected
  signed_by_proxy
  skipped
  cancelled
}

model DocumentWorkflowStep {
  id                 String             @id @default(cuid())
  tenantId           String             @map("tenant_id")
  workflowId         String             @map("workflow_id")
  documentType       DocumentType       @map("document_type") // stock_issue | stock_receipt | stock_opening
  documentId         String             @map("document_id")
  stepCode           String             @map("step_code") // creator | warehouse | chief_accountant | admin (| delivery trên phiếu cũ)
  stepName           String             @map("step_name")
  sequence           Int
  requiredRole       TenantRole?        @map("required_role")
  requiredSignerId   String?            @map("required_signer_id") // người phải ký theo quy định
  assignedApproverId String?            @map("assigned_approver_id") // người được phân công xử lý
  actualSignerId     String?            @map("actual_signer_id") // người ký thực tế
  authorizedSignerId String?            @map("authorized_signer_id") // người được ủy quyền ký thay
  status             WorkflowStepStatus @default(pending)
  note               String?
  actionAt           DateTime?          @map("action_at") // lúc bước được xử lý xong
  createdAt          DateTime           @default(now()) @map("created_at")
  updatedAt          DateTime           @updatedAt @map("updated_at")
  version            Int                @default(0)

  authorizations DocumentStepAuthorization[]
  deliverySnapshot DocumentWorkflowStepDeliverySnapshot?

  @@unique([workflowId, stepCode])
  @@index([tenantId, workflowId, sequence])
  @@index([tenantId, assignedApproverId, status])
  @@index([tenantId, requiredSignerId, status])
  @@index([tenantId, documentType, status])
  @@map("document_workflow_steps")
}
```

### 3.3 Bảng `document_step_authorizations`

```prisma
model DocumentStepAuthorization {
  id                String   @id @default(cuid())
  tenantId          String   @map("tenant_id")
  stepId            String   @map("step_id")
  documentId        String   @map("document_id")
  uploadedById      String   @map("uploaded_by_id")
  fileId            String?  @map("file_id")
  fileUrl           String?  @map("file_url")
  fileName          String?  @map("file_name")
  authorizationNo   String?  @map("authorization_no")
  issuedBy          String?  @map("issued_by")
  issuedAt          DateTime? @map("issued_at")
  validFrom         DateTime? @map("valid_from")
  validTo           DateTime? @map("valid_to")
  note              String?
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  step DocumentWorkflowStep @relation(fields: [stepId], references: [id], onDelete: Cascade)

  @@index([tenantId, stepId])
  @@index([tenantId, documentId])
  @@map("document_step_authorizations")
}
```

### 3.4 Bảng `document_status_history`

```prisma
model DocumentStatusHistory {
  id            String   @id @default(cuid())
  tenantId      String   @map("tenant_id")
  documentType  DocumentType @map("document_type")
  documentId    String   @map("document_id")
  stepId        String?  @map("step_id")
  fromStatus    String   @map("from_status")
  toStatus      String   @map("to_status")
  changedById   String   @map("changed_by_id")
  changedByRole String?  @map("changed_by_role")
  note          String?
  metadata      Json?    // payload bổ sung: proxySignerId, authorizationId, ...
  changedAt     DateTime @default(now()) @map("changed_at")

  @@index([tenantId, documentId, changedAt])
  @@index([tenantId, stepId, changedAt])
  @@index([tenantId, documentType, changedAt])
  @@map("document_status_history")
}
```

> Bảng history **chỉ INSERT, không UPDATE/DELETE**. Nếu cần sửa ghi chú sai, thêm record mới `corrected`.

### 3.5 Frontend import-ready data contract

Phần này gom **toàn bộ field cần dùng ở Flutter** vào một chỗ để bạn map nhanh, không phải mở nhiều file rời.

#### 3.5.1 `DocumentDetail`

```json
{
  "id": "doc_001",
  "documentType": "stock_issue",
  "documentId": "si_001",
  "documentStatus": "in_review",
  "documentStatusUpdatedAt": "2026-08-18T09:05:00.000Z",
  "currentStepCode": "warehouse",
  "currentStepStatus": "pending",
  "currentStepUpdatedAt": "2026-08-18T09:05:00.000Z",
  "lastActionById": "user_001",
  "lastActionAt": "2026-08-18T09:05:00.000Z",
  "deliveryContactId": "con_123",
  "deliveryContactName": "Nguyễn Văn B",
  "deliveryContactPhone": "0909123456",
  "deliveryContactEmail": null,
  "deliveryContactCompanyName": "Công ty vận tải ABC",
  "deliveryContactNote": "Giao ngoài giờ hành chính",
  "deliveryContactSnapshotAt": "2026-08-18T08:59:00.000Z",
  "steps": []
}
```

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `id` | string | ✅ | workflow id |
| `documentType` | `stock_issue` \| `stock_receipt` \| `stock_opening` | ✅ | loại phiếu |
| `documentId` | string | ✅ | id phiếu nghiệp vụ |
| `documentStatus` | `draft` \| `in_review` \| `approved` \| `rejected` \| `cancelled` \| `completed` | ✅ | trạng thái tổng |
| `documentStatusUpdatedAt` | datetime | ❌ | thời điểm status tổng đổi |
| `currentStepCode` | string? | ❌ | code bước hiện tại |
| `currentStepStatus` | `pending` \| `approved` \| `rejected` \| `signed_by_proxy` \| `skipped` \| `cancelled`? | ❌ | status của bước hiện tại |
| `currentStepUpdatedAt` | datetime? | ❌ | thời điểm bước hiện tại đổi |
| `lastActionById` | string? | ❌ | user thao tác gần nhất |
| `lastActionAt` | datetime? | ❌ | thời điểm thao tác gần nhất |
| `deliveryContactId` | string? | ❌ | contact giao hàng nếu là bên ngoài |
| `deliveryContactName` | string? | ❌ | snapshot tên người giao hàng |
| `deliveryContactPhone` | string? | ❌ | snapshot phone |
| `deliveryContactEmail` | string? | ❌ | snapshot email |
| `deliveryContactCompanyName` | string? | ❌ | snapshot công ty |
| `deliveryContactNote` | string? | ❌ | snapshot note |
| `deliveryContactSnapshotAt` | datetime? | ❌ | lúc snapshot được chụp |
| `steps` | array `WorkflowStep` | ✅ | danh sách bước |

#### 3.5.2 `WorkflowStep`

```json
{
  "id": "step_001",
  "workflowId": "wf_001",
  "stepCode": "creator",
  "stepName": "Người lập phiếu",
  "sequence": 1,
  "requiredRole": "warehouse_keeper",
  "requiredSignerId": "user_001",
  "assignedApproverId": "user_001",
  "actualSignerId": "user_001",
  "authorizedSignerId": null,
  "status": "approved",
  "note": "Đã tạo phiếu",
  "actionAt": "2026-08-18T08:55:00.000Z",
  "deliverySnapshot": null,
  "authorizations": []
}
```

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `id` | string | ✅ | step id |
| `workflowId` | string | ✅ | workflow id |
| `stepCode` | string | ✅ | `creator`, `warehouse`, `chief_accountant`, `admin` (`delivery` chỉ trên phiếu cũ) |
| `stepName` | string | ✅ | tên hiển thị |
| `sequence` | number | ✅ | thứ tự bước |
| `requiredRole` | `admin` \| `warehouse_keeper` \| `accountant` \| `approver` \| `viewer`? | ❌ | role yêu cầu |
| `requiredSignerId` | string? | ❌ | người phải ký |
| `assignedApproverId` | string? | ❌ | người được giao xử lý |
| `actualSignerId` | string? | ❌ | người ký thực tế |
| `authorizedSignerId` | string? | ❌ | người được ủy quyền ký thay |
| `status` | `pending` \| `approved` \| `rejected` \| `signed_by_proxy` \| `skipped` \| `cancelled` | ✅ | trạng thái bước |
| `note` | string? | ❌ | ghi chú bước |
| `actionAt` | datetime? | ❌ | thời điểm xử lý |
| `deliverySnapshot` | `DeliverySnapshot`? | ❌ | legacy bước `delivery`; phiếu mới dùng `deliveredBy` trên phiếu |
| `authorizations` | array `StepAuthorization` | ✅ | giấy ủy quyền của bước |

#### 3.5.3 `DeliverySnapshot`

```json
{
  "contactId": "con_123",
  "fullName": "Nguyễn Văn B",
  "phone": "0909123456",
  "email": null,
  "companyName": "Công ty vận tải ABC",
  "note": "Giao ngoài giờ hành chính",
  "createdAt": "2026-08-18T08:59:00.000Z"
}
```

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `contactId` | string? | ❌ | contact gốc nếu có |
| `fullName` | string | ✅ | snapshot tên |
| `phone` | string? | ❌ | snapshot số điện thoại |
| `email` | string? | ❌ | snapshot email |
| `companyName` | string? | ❌ | snapshot công ty/đơn vị |
| `note` | string? | ❌ | ghi chú |
| `createdAt` | datetime | ✅ | thời điểm chụp snapshot |

#### 3.5.4 `StepAuthorization`

```json
{
  "id": "auth_001",
  "fileId": "file_001",
  "fileUrl": "https://...",
  "fileName": "giay-uy-quyen.pdf",
  "authorizationNo": "UQ-2026-01",
  "issuedBy": "Công ty A",
  "issuedAt": "2026-08-10T00:00:00.000Z",
  "validFrom": "2026-08-10T00:00:00.000Z",
  "validTo": "2026-12-31T00:00:00.000Z",
  "note": "Ủy quyền ký thay thủ kho",
  "createdAt": "2026-08-18T08:40:00.000Z"
}
```

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `id` | string | ✅ | authorization id |
| `fileId` | string? | ❌ | file đính kèm |
| `fileUrl` | string? | ❌ | url file |
| `fileName` | string? | ❌ | tên file |
| `authorizationNo` | string? | ❌ | số giấy ủy quyền |
| `issuedBy` | string? | ❌ | đơn vị/người cấp |
| `issuedAt` | datetime? | ❌ | ngày cấp |
| `validFrom` | datetime? | ❌ | hiệu lực từ |
| `validTo` | datetime? | ❌ | hiệu lực đến |
| `note` | string? | ❌ | ghi chú |
| `createdAt` | datetime | ✅ | thời điểm tạo |

#### 3.5.5 `DeliveryContact` dùng cho form tạo phiếu

```json
{
  "contactId": "con_123",
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

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `contactId` | string? | ❌ | nếu đã có contact |
| `kind` | `internal` \| `external` | ✅ | loại contact |
| `fullName` | string | ✅ | tên người giao hàng |
| `phone` | string? | ❌ | số điện thoại |
| `email` | string? | ❌ | email |
| `companyName` | string? | ❌ | công ty/đơn vị |
| `taxCode` | string? | ❌ | mã số thuế |
| `note` | string? | ❌ | ghi chú |
| `isActive` | boolean | ✅ | đang dùng hay không |

#### 3.5.6 `WorkflowCreatePayload` chuẩn cho Flutter

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
    "companyName": "Công ty vận tải ABC",
    "note": "Giao ngoài giờ hành chính"
  },
  "workflowAssignedApproverIds": ["user_010", "user_011"],
  "lines": []
}
```

##### Field list

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `warehouseId` | string | ✅ | kho |
| `supplierId` | string? | ❌ | nhà cung cấp |
| `receiptType` | string | ✅ | loại phiếu nhập |
| `receiptDate` | datetime/string | ✅ | ngày phiếu |
| `deliveredBy` | object | ❌ | contact người giao hàng (in / ký tay, không phải bước duyệt số) |
| `workflowAssignedApproverIds` | string[] | ✅ | xuất/nhập: `[thủ_kho, kế_toán_trưởng]` (2 ID) |
| `lines` | array | ✅ | dòng hàng |

##### `deliveredBy` object

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `contactId` | string? | ❌ | id contact nếu đã có |
| `kind` | `internal` \| `external` | ✅ | loại contact |
| `fullName` | string | ✅ | tên người giao hàng |
| `phone` | string? | ❌ | số điện thoại |
| `email` | string? | ❌ | email |
| `companyName` | string? | ❌ | công ty/đơn vị |
| `note` | string? | ❌ | ghi chú |

#### 3.5.7 `StockIssueCreatePayload` đầy đủ

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
    "companyName": "Công ty vận tải ABC"
  },
  "workflowAssignedApproverIds": ["user_010", "user_011"],
  "lines": []
}
```

#### 3.5.8 `StockReceiptCreatePayload` đầy đủ

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
  "workflowAssignedApproverIds": ["user_010", "user_011"],
  "lines": []
}
```

#### 3.5.9 `StockOpeningCreatePayload` đầy đủ

```json
{
  "warehouseId": "wh_001",
  "effectiveDate": "2026-08-18T08:00:00.000Z",
  "note": "Tạo phiếu đầu kỳ",
  "workflowAssignedApproverIds": ["user_010", "user_011", "user_012"],
  "lines": []
}
```

> Với `stock_opening`, `workflowAssignedApproverIds` cần **3** ID cho các bước sau `creator`: `warehouse`, `chief_accountant`, `admin`.

```prisma
model DocumentStatusHistory {
  id            String   @id @default(cuid())
  tenantId      String   @map("tenant_id")
  documentType  DocumentType @map("document_type")
  documentId    String   @map("document_id")
  stepId        String?  @map("step_id")
  fromStatus    String   @map("from_status")
  toStatus      String   @map("to_status")
  changedById   String   @map("changed_by_id")
  changedByRole String?  @map("changed_by_role")
  note          String?
  metadata      Json?    // payload bổ sung: proxySignerId, authorizationId, ...
  changedAt     DateTime @default(now()) @map("changed_at")

  @@index([tenantId, documentId, changedAt])
  @@index([tenantId, stepId, changedAt])
  @@index([tenantId, documentType, changedAt])
  @@map("document_status_history")
}
```

> Bảng history **chỉ INSERT, không UPDATE/DELETE**. Nếu cần sửa ghi chú sai, thêm record mới `corrected`.

---

## 4. Trạng thái & State Machine

### 4.1 Trạng thái tổng phiếu (`documentStatus`)

| Status | Ý nghĩa |
|---|---|
| `draft` | Đang soạn, chưa vào quy trình |
| `in_review` | Đang trong quy trình ký/duyệt |
| `approved` | Tất cả bước hợp lệ đã xong |
| `rejected` | Có bước từ chối |
| `cancelled` | Đã hủy |
| `completed` | Đã ghi nhận tồn kho |

### 4.2 Trạng thái từng bước (`status`)

| Status | Ý nghĩa |
|---|---|
| `pending` | Chờ xử lý |
| `approved` | Duyệt/Ký bởi người đúng thẩm quyền |
| `rejected` | Từ chối bởi người được phân công |
| `signed_by_proxy` | Ký thay bởi người được ủy quyền |
| `skipped` | Bỏ qua (nếu không bắt buộc) |
| `cancelled` | Bước bị hủy do phiếu hủy |

### 4.3 State machine

```
                submit               all steps done
   draft ────────────────► in_review ───────────────► approved
                              │  ▲                        │
                              │  │ complete nghiệp vụ    │ complete
                              │  └────────────────────────▼
                              │                      completed
                              ▼
  (có bước rejected) ──► rejected
  (hủy bất kỳ lúc nào trước completed) ──► cancelled
```

| Từ | Đến | Điều kiện |
|---|---|---|
| `draft` | `in_review` | Action `submit` |
| `in_review` | `approved` | Mọi step đạt `approved`/`signed_by_proxy` |
| `in_review` | `rejected` | Có step bị `rejected` |
| `draft`/`in_review`/`approved` | `cancelled` | Action `cancel` |
| `approved` | `completed` | Action `complete` (sau khi ghi nhận kho) |

### 4.4 Step transition

| Từ | Đến | Action |
|---|---|---|
| `pending` | `approved` | `approve` |
| `pending` | `rejected` | `reject` |
| `pending` | `signed_by_proxy` | `proxy_sign` + ủy quyền hợp lệ |
| `pending` | `skipped` | `skip` (nếu step optional) |
| bất kỳ | `cancelled` | `cancel` |

---

## 5. Cấu hình quy trình (Workflow Template)

Workflow của từng loại phiếu được định nghĩa bằng **template**, lưu trong DB hoặc config.

### 5.1 Phân nhóm người tham gia

- **Người dùng nội bộ**: lấy từ `GET /tenant/members`, dùng cho `creator`, `warehouse`, `chief_accountant`, `admin`
- **Người giao hàng / contact**: lấy từ danh bạ contact, gắn vào phiếu qua `deliveredBy` — **không** tạo bước duyệt số

Người giao hàng có thể là nhân viên công ty hoặc người ngoài. Hệ thống lưu snapshot trên phiếu để in / ký tay; thay đổi contact sau này không làm sai lịch sử phiếu.

```json
{
  "deliveredBy": {
    "contactId": "con_001",
    "fullName": "Nguyễn Văn B",
    "phone": "0909123456",
    "companyName": "Công ty vận tải ABC"
  }
}
```

### 5.2 Template mẫu

**Xuất / nhập** (`stock_issue` / `stock_receipt`):

```json
{
  "documentType": "stock_issue",
  "steps": [
    { "stepCode": "creator",          "sequence": 1, "requiredRole": "warehouse_keeper", "optional": false },
    { "stepCode": "warehouse",        "sequence": 2, "requiredRole": "warehouse_keeper", "optional": false },
    { "stepCode": "chief_accountant", "sequence": 3, "requiredRole": "accountant",       "optional": false }
  ]
}
```

**Đầu kỳ** (`stock_opening`): thêm bước `admin` (sequence 4).

Khi tạo phiếu, backend sẽ:
1. Tạo phiếu ở `draft`
2. Snapshot template → tạo các `DocumentWorkflowStep`
3. Người tạo truyền `workflowAssignedApproverIds` (xuất/nhập: 2 ID; đầu kỳ: 3 ID)
4. Lưu `deliveredBy` / contact trên phiếu nếu có (không tạo step duyệt)
5. Trả về phiếu kèm steps

> Phiếu cũ đã init với bước `delivery` giữ nguyên hành vi. Template mới không còn bước đó.

---

## 6. API Spec

> **Hướng dẫn sử dụng API của phiếu xuất/nhập/đầu kỳ đã được gom về một tài liệu duy nhất:**
>
> 📄 **`STOCK_DOCUMENT_API.md`**
>
> Bao gồm toàn bộ: tạo phiếu, sửa, submit, approve, reject, complete, cancel, workflow action, nhân sự nội bộ, contact người giao hàng, ràng buộc dữ liệu và tích hợp Flutter.

Phần dưới đây mô tả chi tiết workflow-level spec (document, steps, contact snapshot, authorization, timeline).

### 6.1 Danh sách — `GET /documents`

Dùng cùng với:

- `GET /tenant/members` để lấy danh sách nhân sự nội bộ theo tenant
- `GET /tenant/contacts` để lấy danh bạ người giao hàng

Query params:

| Param | Type | Ghi chú |
|---|---|---|
| `documentType` | enum? | `stock_issue` / `stock_receipt` / `stock_opening` |
| `status` | string? | lọc theo `documentStatus` |
| `warehouseId` | string? | lọc theo kho |
| `assignedApproverId` | string? | phiếu đang chờ tôi xử lý |
| `createdById` | string? | phiếu do tôi tạo |
| `search` | string? | tìm theo code |
| `page`, `limit` | int | phân trang |

**Response (summary, nhẹ):**

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
        "currentStepUpdatedAt": "2026-08-18T09:05:00.000Z",
        "createdById": "user_001",
        "createdAt": "2026-08-18T08:00:00.000Z",
        "updatedAt": "2026-08-18T09:05:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
  }
}
```

> Không trả steps ở list → list cực nhẹ, dùng cho Pull-to-refresh nhanh.

---

### 6.2 Chi tiết — `GET /documents/:id`

Trả full:

```json
{
  "success": true,
  "data": {
    "id": "doc_001",
    "code": "PXK-0001",
    "documentType": "stock_issue",
    "documentStatus": "in_review",
    "documentStatusUpdatedAt": "2026-08-18T09:05:00.000Z",
    "currentStepCode": "warehouse",
    "currentStepStatus": "pending",
    "currentStepUpdatedAt": "2026-08-18T09:05:00.000Z",
    "createdById": "user_001",
    "steps": [
      {
        "id": "step_001",
        "stepCode": "creator",
        "stepName": "Người lập phiếu",
        "sequence": 1,
        "status": "approved",
        "requiredSignerId": "user_001",
        "assignedApproverId": "user_001",
        "actualSignerId": "user_001",
        "authorizedSignerId": null,
        "note": "Đã tạo phiếu",
        "actionAt": "2026-08-18T08:55:00.000Z",
        "authorizations": []
      },
      {
        "id": "step_003",
        "stepCode": "warehouse",
        "stepName": "Thủ kho",
        "sequence": 3,
        "status": "pending",
        "requiredSignerId": "user_020",
        "assignedApproverId": "user_020",
        "actualSignerId": null,
        "authorizedSignerId": null,
        "note": null,
        "actionAt": null,
        "authorizations": []
      }
    ]
  }
}
```

> Steps luôn sắp theo `sequence` tăng dần. Detail dùng cho màn chi tiết + timeline trên Flutter.

---

### 6.3 Action — `POST /documents/:id/actions`

**Một endpoint cho mọi thao tác.** Body:

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
| `note` | string | ❌ | ghi chú của người xử lý |
| `proxySignerId` | string? | với `proxy_sign` | người ký thay |
| `authorizationIds` | string[] | với `proxy_sign` | id giấy ủy quyền đã upload |

**Các action được phép theo trạng thái:**

| documentStatus | Action được phép |
|---|---|
| `draft` | `submit`, `cancel` |
| `in_review` | `approve`, `reject`, `proxy_sign`, `skip`, `cancel` |
| `approved` | `complete`, `cancel` |
| `rejected` | (tạo mới / clone) |
| `cancelled` | — |
| `completed` | — |

**Response:** trả về full document (giống `GET /documents/:id`) để Flutter render ngay.

---

### 6.4 Gán người xử lý — `PATCH /documents/:id/steps/:stepId/assignee`

```json
{
  "assignedApproverId": "user_123"
}
```

Dùng khi quản lý phân công lại bước cho đúng người. Chỉ cho phép khi step còn `pending`.

---

### 6.5 Upload giấy ủy quyền — `POST /documents/:id/steps/:stepId/authorizations`

`multipart/form-data`:

| Field | Ghi chú |
|---|---|
| `file` | file ảnh/pdf giấy ủy quyền |
| `authorizationNo` | số giấy ủy quyền |
| `issuedBy` | đơn vị/người cấp |
| `issuedAt` | ngày cấp |
| `validFrom` | hiệu lực từ |
| `validTo` | hiệu lực đến |
| `note` | ghi chú |

**Response:** trả record authorization vừa tạo.

> Upload xong rồi mới gọi `proxy_sign` kèm `authorizationIds`.

---

### 6.6 Timeline — `GET /documents/:id/timeline`

Trả append-only history:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "fromStatus": "draft",
        "toStatus": "in_review",
        "changedById": "user_001",
        "changedByRole": "warehouse_keeper",
        "note": "Submit phiếu",
        "changedAt": "2026-08-18T08:55:00.000Z"
      },
      {
        "fromStatus": "pending",
        "toStatus": "approved",
        "stepCode": "creator",
        "changedById": "user_001",
        "changedByRole": "warehouse_keeper",
        "note": "Đã tạo phiếu",
        "changedAt": "2026-08-18T08:55:01.000Z"
      }
    ]
  }
}
```

> Có thể dùng luôn `steps` + `history` trong detail để giảm request, nhưng để riêng endpoint này khi cần audit chi tiết.

---

## 7. Luồng xử lý phía Backend

### 7.1 Xử lý action (transaction)

```
POST /documents/:id/actions
  └─ begin transaction
       ├─ SELECT document + steps FOR UPDATE  (lock chống race)
       ├─ validate action hợp lệ theo documentStatus
       ├─ validate quyền: role đủ? đúng assignedApproverId?
       ├─ nếu proxy_sign:
       │    ├─ kiểm tra ủy quyền hợp lệ (validFrom ≤ now ≤ validTo)
       │    ├─ kiểm tra proxySignerId đúng trong giấy ủy quyền
       │    └─ ghi actualSignerId + authorizedSignerId
       ├─ update step: status, note, actionAt, actualSignerId, version+1
       ├─ nếu action là submit/approve/cancel...:
       │    ├─ tính lại documentStatus từ các step
       │    └─ update phiếu: documentStatus, currentStep*, statusUpdatedAt, version+1
       └─ INSERT document_status_history
  └─ commit
  └─ invalidate cache + gửi notification (sau commit)
```

### 7.2 Xác định người được xử lý

| Trường hợp | Cho phép |
|---|---|
| Ký đúng người | `req.user.id == step.assignedApproverId` hoặc `requiredSignerId` |
| Ký thay | `req.user.id == proxySignerId` và có ủy quyền hợp lệ |
| Admin | luôn được phép (nếu policy cho phép) |

---

## 8. Kiểm tra ủy quyền hợp lệ

Khi `proxy_sign`, backend bắt buộc kiểm tra:

1. Có ít nhất 1 `DocumentStepAuthorization` hợp lệ cho step
2. `validFrom <= now <= validTo` (nếu set)
3. `proxySignerId` khớp người ký thay trong giấy ủy quyền
4. Giấy ủy quyền thuộc đúng `tenantId` + `stepId`

Nếu thiếu bất kỳ điều kiện nào → lỗi `AUTHORIZATION_INVALID` (400).

---

## 9. Đồng bộ trạng thái (Denormalized fields)

Các cột `documentStatus`, `currentStepCode`, `currentStepStatus` trên bảng phiếu được tính từ steps và **cập nhật trong cùng transaction** khi có action.

| Sự kiện | Cập nhật |
|---|---|
| Tạo phiếu | `documentStatus=draft`, `currentStepCode=creator` |
| Submit | `documentStatus=in_review` |
| Một step approve/reject | `currentStep*` = step pending kế tiếp (hoặc rỗng) |
| Step cuối approve | `documentStatus=approved`, `currentStep*` rỗng |
| Có step reject | `documentStatus=rejected` |
| Complete | `documentStatus=completed` |

Luôn cập nhật:
- `documentStatusUpdatedAt = now`
- `lastActionById = actor.id`
- `lastActionAt = now`

---

## 10. Tối ưu hiệu năng & Index

### 10.1 Index bảng phiếu
```
@@index([tenantId, documentStatus, updatedAt])
@@index([tenantId, documentType, createdAt])
@@index([tenantId, currentStepCode, currentStepStatus])
@@index([tenantId, createdById])
```

### 10.2 Index bảng steps
```
@@unique([documentType, documentId, stepCode])
@@index([tenantId, documentId, sequence])
@@index([tenantId, assignedApproverId, status])   -- màn "chờ tôi duyệt"
@@index([tenantId, requiredSignerId, status])
@@index([tenantId, documentType, status])
```

### 10.3 Index bảng history
```
@@index([tenantId, documentId, changedAt])
@@index([tenantId, stepId, changedAt])
```

### 10.4 Cache
- **List:** Redis cache theo `(tenantId, documentType, query)` — TTL 60s
- **Detail:** cache theo `(documentId, version)` — invalidate khi `version` đổi
- **Notification:** sau commit mới gửi qua Redis Stream `stock-doc-notify` (không gửi trong transaction)

---

## 11. Tích hợp Flutter

### 11.1 Service layer

```dart
class DocumentApi {
  Future<DocumentList> listDocuments({String? documentType, String? status, int? page, int? limit});
  Future<DocumentDetail> getDocument(String id);
  Future<DocumentDetail> postAction(String id, DocumentActionRequest req);
  Future<void> assignStep(String id, String stepId, String assignedApproverId);
  Future<AuthorizationDoc> uploadAuthorization(String id, String stepId, MultipartFile file, {...});
  Future<List<TimelineEvent>> getTimeline(String id);
}
```

### 11.2 Model

```dart
class DocumentDetail {
  final String id;
  final String code;
  final String documentStatus;
  final String? currentStepCode;
  final List<WorkflowStep> steps;
}

class WorkflowStep {
  final String id;
  final String stepCode;
  final String stepName;
  final int sequence;
  final String status;
  final String? requiredSignerId;
  final String? assignedApproverId;
  final String? actualSignerId;
  final String? authorizedSignerId;
  final String? note;
  final DateTime? actionAt;
}
```

### 11.3 UI theo trạng thái

| Trạng thái | Nút hiển thị |
|---|---|
| `draft` | Sửa, Submit, Hủy |
| `in_review` (step đang là của tôi) | Duyệt, Từ chối, (Ký thay nếu có ủy quyền), Hủy |
| `approved` | Hoàn tất, Hủy |
| `rejected` | Tạo lại / Clone |
| `completed` | (chỉ xem) |

### 11.4 Hiển thị 4 chữ ký

Mỗi step render 1 card:

```
┌────────────────────────────────────────┐
│ Thủ kho                                │
│ Trạng thái: Đã duyệt ✓                 │
│ Người ký: user_020                     │
│ Ký thay: user_200 (nếu có)             │
│ Ghi chú: "Đã kiểm tra đủ hàng"         │
│ Thời điểm: 2026-08-18 09:05            │
│ [Xem giấy ủy quyền]  (nếu có)          │
└────────────────────────────────────────┘
```

---

## 12. Tối ưu API

| Nguyên tắc | Cách thực hiện |
|---|---|
| Ít endpoint | 6 endpoints, action dùng chung |
| List nhẹ | không include steps |
| Detail đủ | include steps + authorizations |
| Mutation 1 lần | 1 request = 1 action = 1 transaction |
| Idempotency | gắn `Idempotency-Key` mọi POST/PATCH |
| Phân quyền sớm | middleware role check trước khi vào service |
| Trả dữ liệu render sẵn | response detail = đủ cho UI, không cần gọi thêm |
| N+1 tránh | dùng `findMany include` hoặc query gộp |

---

## 13. Mẫu Request/Response

### 13.1 Submit phiếu

```http
POST /api/v1/documents/doc_001/actions
Authorization: Bearer <access_token>
X-Tenant-Id: <tenant_id>
Idempotency-Key: 9f2c4e6d-1a3b-4c5d-8e7f-0a1b2c3d4e5f
Content-Type: application/json
```

```json
{
  "action": "submit",
  "note": "Hoàn tất khai báo, chuyển sang chờ ký"
}
```

### 13.2 Duyệt phiếu

```json
{
  "action": "approve",
  "stepId": "step_003",
  "note": "Đã kiểm tra tồn kho đủ"
}
```

### 13.3 Ký thay

```json
{
  "action": "proxy_sign",
  "stepId": "step_003",
  "proxySignerId": "user_200",
  "authorizationIds": ["auth_001"],
  "note": "Ký thay thủ kho theo giấy ủy quyền UQ-2026-01"
}
```

### 13.4 Từ chối

```json
{
  "action": "reject",
  "stepId": "step_003",
  "note": "Thiếu chứng từ nhập"
}
```

### 13.5 Lỗi

```json
{
  "success": false,
  "error": {
    "code": "AUTHORIZATION_INVALID",
    "message": "Giấy ủy quyền không hợp lệ hoặc đã hết hạn",
    "details": [{ "field": "authorizationIds", "reason": "expired" }]
  }
}
```

| Error code | HTTP | Ý nghĩa |
|---|---|---|
| `UNAUTHORIZED` | 401 | Chưa đăng nhập |
| `FORBIDDEN` | 403 | Không đủ quyền / không phải người được giao |
| `DOCUMENT_NOT_FOUND` | 404 | Không tìm thấy phiếu |
| `INVALID_ACTION` | 409 | Action không hợp lệ với trạng thái hiện tại |
| `STEP_NOT_PENDING` | 409 | Bước không còn pending |
| `AUTHORIZATION_INVALID` | 400 | Giấy ủy quyền không hợp lệ |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Yêu cầu trùng key đang chạy |
| `IDEMPOTENT_SKIP` | 200 | Phiếu đã hoàn tất trước đó |

---

## 14. Kết luận

Thiết kế này đạt:

- ✅ **4 vị trí chữ ký** mỗi vị trí status riêng, note riêng, thời điểm riêng
- ✅ **Ký thay** + giấy ủy quyền kiểm tra hiệu lực
- ✅ **Người yêu cầu/người được giao/người ký thực tế** lưu đủ theo id
- ✅ **Lịch sử thay đổi** đầy đủ, append-only
- ✅ **API tối ưu**: 6 endpoints, list nhẹ, detail đủ, action thống nhất
- ✅ **Schema chuyên nghiệp**: tách workflow steps, authorizations, history
- ✅ **Mở rộng được**: thêm cấp duyệt = thêm template step, không đổi schema
- ✅ **Hiệu năng**: denormalized status + index + cache + optimistic lock

> Migration gợi ý: thêm 3 bảng mới (`document_workflow_steps`, `document_step_authorizations`, `document_status_history`) trước, rồi bổ sung cột denormalized cho `stock_issues`/`stock_receipts`/`stock_opening_balances`, sau đó mới viết service chuyển đổi từ luồng cũ sang workflow mới.
