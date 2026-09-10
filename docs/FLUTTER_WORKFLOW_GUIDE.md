# Hướng dẫn Flutter cho luồng tạo phiếu và workflow duyệt nhiều cấp

Tài liệu này hướng dẫn cách xây dựng frontend Flutter dựa trên backend workflow architecture hiện có, bao gồm:

- Cách tổ chức màn hình và state management
- Luồng tạo/sửa/submit/duyệt/hoàn tất phiếu
- Cách gọi API và gắn header bắt buộc
- Cách render stepper chữ ký theo template (xuất/nhập: 3 bước số; đầu kỳ: 4) và giấy ủy quyền
- Cách xử lý lỗi, idempotency, retry và optimistic UI
- Mapping dữ liệu backend sang model Flutter

---

## Mục lục

1. [Phạm vi và nguyên tắc](#1-phạm-vi-và-nguyên-tắc)
2. [Kiến trúc màn hình Flutter](#2-kiến-trúc-màn-hình-flutter)
3. [Service layer và API client](#3-service-layer-và-api-client)
4. [Model dữ liệu Flutter](#4-model-dữ-liệu-flutter)
5. [Luồng màn hình theo nghiệp vụ](#5-luồng-màn-hình-theo-nghiệp-vụ)
6. [Cách render workflow steps](#6-cách-render-workflow-steps)
7. [Xử lý ký thay và giấy ủy quyền](#7-xử-lý-ký-thay-và-giấy-ủy-quyền)
8. [Quy tắc phân quyền trên UI](#8-quy-tắc-phân-quyền-trên-ui)
9. [Quy tắc validate form](#9-quy-tắc-validate-form)
10. [Cơ chế Idempotency và retry](#10-cơ-chế-idempotency-và-retry)
11. [Xử lý lỗi backend](#11-xử-lý-lỗi-backend)
12. [Chiến lược state management](#12-chiến-lược-state-management)
13. [Ví dụ request/response mapping](#13-ví-dụ-requestresponse-mapping)
14. [Checklist triển khai Flutter](#14-checklist-triển-khai-flutter)

---

## 1. Phạm vi và nguyên tắc

### Mục tiêu frontend

Frontend Flutter cần đảm bảo:

- Hiển thị đúng trạng thái phiếu theo dữ liệu backend
- Chỉ hiện action mà user có quyền thực hiện
- Gửi request chuẩn theo workflow backend
- Không cho bấm trùng nhờ idempotency
- Hiển thị timeline, note, người ký, người ủy quyền, file ủy quyền

### Nguyên tắc thiết kế

1. **Backend là nguồn sự thật** cho state và permission.
2. **Frontend chỉ suy diễn UI** từ response backend, không tự quyết định business logic.
3. **Mỗi màn hình chỉ gọi API cần thiết** để giảm độ nặng.
4. **List nhẹ, detail nặng**: danh sách không tải hết steps nếu không cần.
5. **Action phải có confirm** với các thao tác nhạy cảm như approve, reject, complete, cancel.
6. **Mọi mutation nên có `Idempotency-Key`**.

---

## 2. Kiến trúc màn hình Flutter

### 2.1 Danh sách màn hình đề xuất

- `LoginScreen`
- `TenantSelectScreen`
- `DocumentListScreen`
- `DocumentDetailScreen`
- `DocumentFormScreen`
- `DocumentWorkflowActionSheet`
- `AuthorizationUploadScreen` hoặc bottom sheet upload
- `DocumentTimelineScreen`

### 2.2 Điều hướng chính

```text
Login -> chọn tenant -> danh sách phiếu -> chi tiết phiếu -> action
```

### 2.3 Phân module UI

Nên chia theo module:

- `features/auth`
- `features/tenant`
- `features/documents`
- `features/workflow`
- `features/authorization`
- `features/timeline`

### 2.4 UX gợi ý

- List dùng `RefreshIndicator`
- Detail dùng `TabBar` hoặc `SliverAppBar`
- Workflow action dùng `bottom sheet` hoặc `dialog`
- Approval/reject/complete nên có confirm dialog
- Timeline hiển thị dạng vertical stepper

---

## 3. Service layer và API client

### 3.1 API client chung

Nên có một `ApiClient` hoặc `DioClient` với interceptor:

- `AuthorizationInterceptor`
- `TenantInterceptor`
- `IdempotencyInterceptor`
- `ErrorInterceptor`

### 3.2 Headers bắt buộc

Mọi request sau login đều cần:

```http
Authorization: Bearer <access_token>
X-Tenant-Id: <tenant_id>
```

Mọi mutation cần thêm:

```http
Idempotency-Key: <uuid>
```

### 3.3 API cần dùng theo flow

#### List
- `GET /document-workflows`

#### Detail
- `GET /document-workflows/:documentType/:id`

#### Action
- `POST /document-workflows/:documentType/:id/actions`

#### Assign
- `PATCH /document-workflows/:documentType/:id/steps/:stepId/assignee`

#### Upload giấy ủy quyền
- `POST /document-workflows/:documentType/:id/steps/:stepId/authorizations`

#### Timeline
- `GET /document-workflows/:documentType/:id/timeline`

---

## 4. Model dữ liệu Flutter

### 4.1 Document summary

Danh sách chỉ cần summary:

```dart
class DocumentSummary {
  final String id;
  final String code;
  final String documentType;
  final String documentStatus;
  final String? currentStepCode;
  final String? currentStepStatus;
  final DateTime? currentStepUpdatedAt;
  final String? createdById;
  final DateTime? createdAt;
  final DateTime? updatedAt;
}
```

### 4.2 Workflow step

```dart
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
  final List<AuthorizationDocument> authorizations;
}
```

### 4.3 Authorization document

```dart
class AuthorizationDocument {
  final String id;
  final String? fileUrl;
  final String? fileName;
  final String? authorizationNo;
  final String? issuedBy;
  final DateTime? issuedAt;
  final DateTime? validFrom;
  final DateTime? validTo;
  final String? note;
}
```

### 4.4 Document detail

```dart
class DocumentDetail {
  final String id;
  final String documentType;
  final String code;
  final String documentStatus;
  final String? currentStepCode;
  final String? currentStepStatus;
  final DateTime? currentStepUpdatedAt;
  final String? lastActionById;
  final DateTime? lastActionAt;
  final List<WorkflowStep> steps;
}
```

### 4.5 Timeline event

```dart
class TimelineEvent {
  final String id;
  final String fromStatus;
  final String toStatus;
  final String changedById;
  final String? changedByRole;
  final String? note;
  final DateTime changedAt;
  final Map<String, dynamic>? metadata;
}
```

---

## 5. Luồng màn hình theo nghiệp vụ

## 5.1 Màn danh sách phiếu

### Mục tiêu

- xem nhanh các phiếu đang tạo, đang chờ duyệt, đã hoàn tất
- lọc theo loại phiếu, kho, trạng thái, người xử lý

### Dữ liệu cần gọi

- `GET /document-workflows`

### UI cần hiển thị

- mã phiếu
- loại phiếu
- trạng thái tổng
- bước hiện tại
- người tạo
- thời điểm cập nhật gần nhất
- badge màu theo status

### Action trên list

- mở chi tiết
- pull-to-refresh
- tìm kiếm theo code

---

## 5.2 Màn chi tiết phiếu

### Mục tiêu

- xem đầy đủ thông tin phiếu
- xem workflow steps theo template (không còn bước `delivery` số trên phiếu mới)
- xem giấy ủy quyền
- thực hiện action nếu có quyền

### Dữ liệu cần gọi

- `GET /document-workflows/:documentType/:id`
- có thể gọi thêm `GET /timeline` khi user mở tab lịch sử

### UI nên có

- header phiếu: code, status, loại phiếu
- thông tin nghiệp vụ: kho, ngày phiếu, đối tác, note
- tab workflow steps
- tab timeline
- nút action ở bottom bar hoặc sticky footer

### Trạng thái nút theo phiếu

| documentStatus | Nút |
|---|---|
| `draft` | Edit, Submit, Cancel |
| `in_review` | Approve, Reject, Proxy Sign, Skip, Cancel |
| `approved` | Complete, Cancel |
| `rejected` | Clone / Create new |
| `cancelled` | Không có action |
| `completed` | Không có action |

---

## 5.3 Màn tạo/sửa phiếu

### Mục tiêu

- tạo phiếu mới
- sửa phiếu ở trạng thái draft

### API

Backend nghiệp vụ cũ vẫn dùng cho create/update dữ liệu phiếu:

- `POST /stock-issues`
- `PUT /stock-issues/:id`
- `POST /stock-receipts`
- `PUT /stock-receipts/:id`
- `POST /stock-opening-balances`

Sau khi tạo thành công, frontend sẽ gọi workflow init nếu backend chưa auto-init.

### UX

- autosave nháp nếu cần
- validate form trước khi submit
- disable submit khi loading

---

## 5.4 Màn action workflow

### Mục tiêu

Xử lý các action:

- submit
- approve
- reject
- proxy_sign
- skip
- cancel
- complete

### API

`POST /document-workflows/:documentType/:id/actions`

### Body mẫu

```json
{
  "action": "approve",
  "stepId": "step_003",
  "note": "Đã kiểm tra đủ hàng"
}
```

### UX

- luôn có confirm dialog
- với reject cần nhập lý do
- với proxy_sign cần chọn file giấy ủy quyền
- khi mutate thành công thì reload detail + list

---

## 6. Cách render workflow steps

### 6.1 Hiển thị dạng stepper

Mỗi bước gồm:

- tên bước
- người được yêu cầu ký
- người ký thực tế
- người ký thay nếu có
- status
- note
- action time
- file ủy quyền

### 6.2 Màu trạng thái đề xuất

| Status | Màu |
|---|---|
| `pending` | xám |
| `approved` | xanh |
| `signed_by_proxy` | xanh lam |
| `rejected` | đỏ |
| `skipped` | cam |
| `cancelled` | xám đậm |

### 6.3 UI từng card step

- Step name
- Required signer
- Assigned approver
- Actual signer
- Note
- Time
- Authorization chip
- Action icon

### 6.4 Tối ưu trải nghiệm

- step đang pending nên nổi bật
- step đã xử lý có icon check
- step rejected có icon warning
- step proxy sign có badge `Ký thay`

---

## 7. Xử lý ký thay và giấy ủy quyền

### 7.1 Quy trình upload

1. user mở action `Proxy Sign`
2. chọn hoặc upload file giấy ủy quyền
3. backend tạo authorization record
4. frontend nhận `authorizationId`
5. gọi action `proxy_sign` kèm `authorizationIds`

### 7.2 Form giấy ủy quyền

- file PDF / ảnh
- số giấy ủy quyền
- người/đơn vị cấp
- ngày cấp
- ngày hiệu lực
- ngày hết hạn
- ghi chú

### 7.3 Luật UI

- nếu step không có giấy ủy quyền hợp lệ thì không cho proxy sign
- nếu backend trả `AUTHORIZATION_INVALID` thì phải hiện rõ nguyên nhân

---

## 8. Quy tắc phân quyền trên UI

### 8.1 Quy tắc hiển thị action

Frontend nên lấy theo 2 nguồn:

1. role tenant hiện tại
2. status của workflow / step

### 8.2 Action theo role

- Mọi thành viên tổ chức (admin, warehouse_keeper, accountant, approver, viewer)
  - tạo phiếu (xuất / nhập / đầu kỳ) ở trạng thái `draft`
- `warehouse_keeper`
  - sửa draft
  - submit
  - cancel
- `accountant`
  - approve
  - reject
  - complete
- `approver`
  - approve
  - reject
  - complete
- `admin`
  - có thể thấy hầu hết action

### 8.3 Không nên hard-code

Không nên tự suy diễn quá nhiều ở frontend. Luôn ưu tiên:

- data `currentStepCode`
- data `currentStepStatus`
- `assignedApproverId`
- `requiredRole`
- status tổng

---

## 9. Quy tắc validate form

### 9.1 Phiếu xuất kho

- `issueType` bắt buộc
- nếu `sale` thì `customerId` bắt buộc
- `lines.length >= 1`
- `requestedQty > 0`
- `actualQty > 0`
- `unitName` bắt buộc

### 9.2 Phiếu nhập kho

- `receiptType` bắt buộc
- `lines.length >= 1`
- `expectedQty >= 0`
- `actualQty > 0`
- `unitPrice >= 0`
- `batchNo` / `expiryDate` tùy chọn trên từng dòng nhập (không còn cờ track batch trên product)

### 9.3 Phiếu đầu kỳ

- `warehouseId` bắt buộc
- `effectiveDate` bắt buộc
- `lines.length >= 1`
- `qty > 0`
- `unitCost >= 0`

### 9.4 Workflow action

- approve/reject/proxy_sign phải có `stepId`
- proxy_sign phải có `authorizationIds`
- reject nên có reason/note
- complete chỉ hiện khi status `approved`

---

## 10. Cơ chế Idempotency và retry

### 10.1 Khi nào dùng

- submit
- approve
- reject
- proxy_sign
- complete
- cancel
- upload authorization

### 10.2 Chiến lược

- sinh UUID khi user bấm action
- giữ UUID này trong state cho tới khi request xong
- nếu retry cùng request thì dùng lại key cũ

### 10.3 UX

- disable button trong lúc loading
- hiển thị spinner
- nếu request bị network error, cho retry với cùng idempotency key

---

## 11. Xử lý lỗi backend

### 11.1 Mapping lỗi quan trọng

| Code | Cách xử lý trên UI |
|---|---|
| `UNAUTHORIZED` | Chuyển về login |
| `TENANT_REQUIRED` | Chọn tenant |
| `FORBIDDEN` | Báo không đủ quyền |
| `WORKFLOW_NOT_FOUND` | Refresh / báo không tìm thấy workflow |
| `STEP_NOT_FOUND` | Refresh detail |
| `INVALID_ACTION` | Hiển thị action không hợp lệ |
| `STEP_NOT_PENDING` | Báo step đã xử lý |
| `AUTHORIZATION_INVALID` | Hiển thị lỗi giấy ủy quyền |
| `IDEMPOTENCY_IN_PROGRESS` | Báo đang xử lý |
| `IDEMPOTENT_SKIP` | Tự refresh, coi như thành công |

### 11.2 UX gợi ý

- lỗi form: hiển thị ngay dưới field
- lỗi business: snackbar hoặc dialog
- lỗi nghiêm trọng: điều hướng về list để refresh

---

## 12. Chiến lược state management

### 12.1 Gợi ý

Có thể dùng:

- `Riverpod`
- `Bloc`
- `Cubit`
- `Provider` nếu app nhỏ

### 12.2 State nên có

#### List state
- loading
- success
- empty
- error

#### Detail state
- loading
- success
- refreshing
- error

#### Action state
- idle
- submitting
- success
- error

### 12.3 Tối ưu refresh

Sau action thành công:

1. refresh detail
2. refresh list
3. nếu có timeline thì refresh timeline

---

## 13. Ví dụ request/response mapping

### 13.1 Response detail mẫu

```json
{
  "success": true,
  "data": {
    "id": "wf_001",
    "documentType": "stock_issue",
    "code": "PXK-0001",
    "documentStatus": "in_review",
    "currentStepCode": "warehouse",
    "currentStepStatus": "pending",
    "steps": [
      {
        "id": "step_001",
        "stepCode": "creator",
        "stepName": "Người lập phiếu",
        "sequence": 1,
        "status": "approved",
        "requiredSignerId": "user_1",
        "assignedApproverId": "user_1",
        "actualSignerId": "user_1",
        "note": "Đã tạo phiếu"
      }
    ]
  }
}
```

### 13.2 Flutter mapping

```dart
final status = response.data.documentStatus;
final canEdit = status == 'draft';
final canApprove = status == 'in_review';
final canComplete = status == 'approved';
```

### 13.3 Không nên quyết định business logic bằng UI

Chỉ dùng logic UI để show/hide nút. Quyết định cuối cùng vẫn do backend validate.

---

## 14. Checklist triển khai Flutter

### Core

- [ ] có `ApiClient` với interceptor
- [ ] có storage token và tenant
- [ ] có màn login và tenant switch
- [ ] có list/detail/form/workflow/timeline screens

### Workflow

- [ ] render steps theo template (`creator` → `warehouse` → `chief_accountant` [→ `admin`])
- [ ] hiển thị note và time từng bước
- [ ] hiển thị file ủy quyền
- [ ] hỗ trợ proxy sign
- [ ] confirm dialog cho action nhạy cảm

### UX

- [ ] loading state cho từng màn
- [ ] error state rõ ràng
- [ ] retry với idempotency key cũ
- [ ] refresh sau mutation

### Validation

- [ ] validate form client-side
- [ ] không cho gửi action thiếu `stepId`
- [ ] không cho proxy sign nếu chưa có file ủy quyền

---

## Kết luận

Frontend Flutter nên bám sát workflow backend theo nguyên tắc:

- list nhẹ, detail đầy đủ
- action thống nhất qua endpoint workflow
- render steps và authorization như timeline
- dùng header `Authorization`, `X-Tenant-Id`, `Idempotency-Key`
- chỉ hiển thị action theo role + status

Nếu bạn muốn, mình có thể viết tiếp cho bạn một file riêng **chi tiết kiến trúc Flutter codebase** gồm:

- folder structure
- provider/bloc/cubit design
- repository pattern
- DTO mapping
- UI widgets cho stepper/timeline/authorization upload
