# Contact API Documentation

## Overview

Contact module quản lý danh sách liên hệ (đối tác giao hàng, người nhận, nhà cung cấp) thuộc mỗi tenant.

## Base URL

```
/api/v1/contacts
```

## Authentication

Tất cả endpoints đều yêu cầu:
- Bearer token trong header `Authorization`
- Token phải thuộc tenant đang hoạt động

## Contact Data Model

### Entity: Contact

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` (cuid) | ID duy nhất của contact |
| `tenantId` | `String` (cuid) | ID của tenant sở hữu contact |
| `kind` | `ContactKind` | Loại contact: `internal` (nội bộ) hoặc `external` (bên ngoài). **Mặc định: `external`** |
| `relationType` | `ContactRelationType` | Loại quan hệ với doanh nghiệp |
| `fullName` | `String` | Họ tên đầy đủ của người liên hệ |
| `phone` | `String?` | Số điện thoại (nullable) |
| `email` | `String?` | Địa chỉ email (nullable) |
| `companyName` | `String?` | Tên công ty/đơn vị (nullable) |
| `taxCode` | `String?` | Mã số thuế (nullable) |
| `note` | `String?` | Ghi chú bổ sung (nullable) |
| `isActive` | `Boolean` | Trạng thái hoạt động. **Mặc định: `true`** |
| `createdAt` | `DateTime` (ISO 8601) | Thời điểm tạo contact |
| `updatedAt` | `DateTime` (ISO 8601) | Thời điểm cập nhật cuối |

### Enums

#### ContactKind
| Value | Type | Description |
|-------|------|-------------|
| `internal` | String | Nhân viên nội bộ công ty |
| `external` | String | Đối tượng bên ngoài (mặc định khi tạo mới) |

#### ContactRelationType
| Value | Type | Description |
|-------|------|-------------|
| `delivery_person` | String | Người giao hàng |
| `vendor_contact` | String | Liên hệ nhà cung cấp |
| `receiver` | String | Người nhận hàng |
| `other` | String | Khác (mặc định khi tạo mới) |

## Flutter/Dart Type Definitions

### Dart Models

```dart
// Enum: ContactKind
enum ContactKind {
  internal,
  external,
}

// Enum: ContactRelationType
enum ContactRelationType {
  deliveryPerson('delivery_person'),
  vendorContact('vendor_contact'),
  receiver('receiver'),
  other('other');

  final String value;
  const ContactRelationType(this.value);

  static ContactRelationType fromString(String value) {
    return ContactRelationType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => ContactRelationType.other,
    );
  }
}

// Model: Contact
class Contact {
  final String id;
  final String tenantId;
  final ContactKind kind;
  final ContactRelationType relationType;
  final String fullName;
  final String? phone;
  final String? email;
  final String? companyName;
  final String? taxCode;
  final String? note;
  final bool isActive;
  final DateTime createdAt;
  final DateTime updatedAt;

  Contact({
    required this.id,
    required this.tenantId,
    required this.kind,
    required this.relationType,
    required this.fullName,
    this.phone,
    this.email,
    this.companyName,
    this.taxCode,
    this.note,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Contact.fromJson(Map<String, dynamic> json) {
    return Contact(
      id: json['id'] as String,
      tenantId: json['tenantId'] as String,
      kind: json['kind'] == 'internal' ? ContactKind.internal : ContactKind.external,
      relationType: ContactRelationType.fromString(json['relationType'] as String),
      fullName: json['fullName'] as String,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      companyName: json['companyName'] as String?,
      taxCode: json['taxCode'] as String?,
      note: json['note'] as String?,
      isActive: json['isActive'] as bool,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'tenantId': tenantId,
      'kind': kind.name,
      'relationType': relationType.value,
      'fullName': fullName,
      'phone': phone,
      'email': email,
      'companyName': companyName,
      'taxCode': taxCode,
      'note': note,
      'isActive': isActive,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}
```

### DTO: CreateContactRequest

```dart
class CreateContactRequest {
  final String fullName;
  final String? phone;
  final String? email;
  final String? companyName;
  final String? taxCode;
  final String? note;
  final ContactRelationType relationType;

  CreateContactRequest({
    required this.fullName,
    this.phone,
    this.email,
    this.companyName,
    this.taxCode,
    this.note,
    this.relationType = ContactRelationType.other,
  });

  Map<String, dynamic> toJson() {
    return {
      'fullName': fullName,
      if (phone != null) 'phone': phone,
      if (email != null) 'email': email,
      if (companyName != null) 'companyName': companyName,
      if (taxCode != null) 'taxCode': taxCode,
      if (note != null) 'note': note,
      'relationType': relationType.value,
    };
  }
}
```

### DTO: UpdateContactRequest

```dart
class UpdateContactRequest {
  final String? fullName;
  final String? phone;
  final String? email;
  final String? companyName;
  final String? taxCode;
  final String? note;
  final ContactRelationType? relationType;

  UpdateContactRequest({
    this.fullName,
    this.phone,
    this.email,
    this.companyName,
    this.taxCode,
    this.note,
    this.relationType,
  });

  Map<String, dynamic> toJson() {
    return {
      if (fullName != null) 'fullName': fullName,
      if (phone != null) 'phone': phone,
      if (email != null) 'email': email,
      if (companyName != null) 'companyName': companyName,
      if (taxCode != null) 'taxCode': taxCode,
      if (note != null) 'note': note,
      if (relationType != null) 'relationType': relationType!.value,
    };
  }
}
```

### API Response Wrapper

```dart
class ApiResponse<T> {
  final bool success;
  final T? data;
  final ApiError? error;

  ApiResponse({
    required this.success,
    this.data,
    this.error,
  });

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic) fromJsonT,
  ) {
    return ApiResponse(
      success: json['success'] as bool,
      data: json['data'] != null ? fromJsonT(json['data']) : null,
      error: json['error'] != null
          ? ApiError.fromJson(json['error'] as Map<String, dynamic>)
          : null,
    );
  }
}

class ApiError {
  final String code;
  final String message;
  final int statusCode;

  ApiError({
    required this.code,
    required this.message,
    required this.statusCode,
  });

  factory ApiError.fromJson(Map<String, dynamic> json) {
    return ApiError(
      code: json['code'] as String,
      message: json['message'] as String,
      statusCode: json['statusCode'] as int,
    );
  }
}
```

## Endpoints

### List Contacts by Relation Type

Lấy danh sách liên hệ theo loại quan hệ (có caching).

```
GET /api/v1/contacts?relationType=<type>&limit=<number>
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `relationType` | string | Yes | Một trong: `delivery_person`, `vendor_contact`, `receiver`, `other` |
| `limit` | number | No | Giới hạn số lượng kết quả (mặc định: không giới hạn) |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "clx123abc",
      "kind": "external",
      "relationType": "delivery_person",
      "fullName": "Nguyễn Văn A",
      "phone": "0909123456",
      "email": "nva@example.com",
      "companyName": "Công ty TNHH Giao Hàng Nhanh",
      "taxCode": "0123456789",
      "note": "Giao hàng buổi sáng",
      "isActive": true,
      "tenantId": "clxTenant001",
      "createdAt": "2026-08-20T08:00:00Z",
      "updatedAt": "2026-08-20T08:00:00Z"
    }
  ]
}
```

**Role:** Any authenticated user

---

### Create Contact

Tạo liên hệ mới.

```
POST /api/v1/contacts
```

**Request Body:**

```json
{
  "fullName": "Nguyễn Văn A",
  "phone": "0909123456",
  "email": "nva@example.com",
  "companyName": "Công ty TNHH Giao Hàng Nhanh",
  "taxCode": "0123456789",
  "note": "Giao hàng buổi sáng",
  "relationType": "delivery_person"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fullName` | string | Yes | Họ tên người liên hệ |
| `phone` | string | No | Số điện thoại |
| `email` | string | No | Email (phải hợp lệ) |
| `companyName` | string | No | Tên công ty |
| `taxCode` | string | No | Mã số thuế |
| `note` | string | No | Ghi chú |
| `relationType` | enum | No | Loại quan hệ (default: `other`) |

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "kind": "external",
    "relationType": "delivery_person",
    "fullName": "Nguyễn Văn A",
    "phone": "0909123456",
    "email": "nva@example.com",
    "companyName": "Công ty TNHH Giao Hàng Nhanh",
    "taxCode": "0123456789",
    "note": "Giao hàng buổi sáng",
    "isActive": true,
    "tenantId": "clxTenant001",
    "createdAt": "2026-08-20T08:00:00Z",
    "updatedAt": "2026-08-20T08:00:00Z"
  }
}
```

**Role:** Any authenticated user

---

### Get Contact

Lấy thông tin chi tiết một liên hệ.

```
GET /api/v1/contacts/:id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "kind": "external",
    "relationType": "delivery_person",
    "fullName": "Nguyễn Văn A",
    "phone": "0909123456",
    "email": "nva@example.com",
    "companyName": "Công ty TNHH Giao Hàng Nhanh",
    "taxCode": "0123456789",
    "note": "Giao hàng buổi sáng",
    "isActive": true,
    "tenantId": "clxTenant001",
    "createdAt": "2026-08-20T08:00:00Z",
    "updatedAt": "2026-08-20T08:00:00Z"
  }
}
```

**Role:** Any authenticated user

**Error:** `404 Not Found` - Contact không thuộc tenant hoặc không tồn tại

---

### Update Contact

Cập nhật thông tin liên hệ.

```
PUT /api/v1/contacts/:id
```

**Request Body:** (tất cả fields optional)

```json
{
  "fullName": "Nguyễn Văn B",
  "phone": "0911234567",
  "note": "Cập nhật số điện thoại mới"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "kind": "external",
    "relationType": "delivery_person",
    "fullName": "Nguyễn Văn B",
    "phone": "0911234567",
    "email": "nva@example.com",
    "companyName": "Công ty TNHH Giao Hàng Nhanh",
    "taxCode": "0123456789",
    "note": "Cập nhật số điện thoại mới",
    "isActive": true,
    "tenantId": "clxTenant001",
    "createdAt": "2026-08-20T08:00:00Z",
    "updatedAt": "2026-08-20T09:00:00Z"
  }
}
```

**Role:** `admin` only

**Error:** `403 Forbidden` - User không có quyền

---

### Delete Contact (Soft Delete)

Xóa mềm liên hệ (không xóa vật lý, chỉ đánh dấu `isActive: false`).

```
DELETE /api/v1/contacts/:id
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "isActive": false
  }
}
```

**Role:** `admin` only

**Error:** `403 Forbidden` - User không có quyền

---

## Caching

- Danh sách contacts được cache trong Redis
- Cache tự động invalidate khi có thay đổi (create, update, delete)
- Cache key format: `list:contacts:{tenantId}:{relationType}:{limit|all}`
- **BUG FIXED:** Cache contacts được include trong `masterPrefixes` nên sẽ tự động refresh khi có thay đổi.

## Idempotency

Endpoint `POST /api/v1/contacts` hỗ trợ idempotency:
- Thêm header `Idempotency-Key: <unique-key>` để tránh tạo trùng
- Key tồn tại trong 24 giờ

## Error Responses

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Contact not found",
    "statusCode": 404
  }
}
```

| Code | Status | Description |
|------|--------|-------------|
| `TENANT_REQUIRED` | 400 | Missing tenant context |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Contact not found |
| `VALIDATION_ERROR` | 400 | Invalid request body |
