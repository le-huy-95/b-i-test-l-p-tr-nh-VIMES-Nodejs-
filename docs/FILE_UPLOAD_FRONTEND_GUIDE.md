# Hướng dẫn tích hợp API Upload File cho Frontend

> Tài liệu hướng dẫn frontend (Flutter / Web / React / Vue) sử dụng API upload file dùng chung
> của hệ thống: upload ảnh, PDF, video, audio — sau đó lưu lại **id file** kèm dữ liệu nghiệp vụ.

---

## Mục lục

1. [Tổng quan & flow tích hợp](#1-tổng-quan--flow-tích-hợp)
2. [Base URL & Headers](#2-base-url--headers)
3. [Cấu trúc dữ liệu File](#3-cấu-trúc-dữ-liệu-file)
4. [Danh sách endpoint](#4-danh-sách-endpoint)
5. [Các loại file được phép & giới hạn](#5-các-loại-file-được-phép--giới-hạn)
6. [Ví dụ code Flutter](#6-ví-dụ-code-flutter)
7. [Ví dụ code Web/React](#7-ví-dụ-code-webreact)
8. [Xử lý lỗi](#8-xử-lý-lỗi)
9. [Best practices & lưu ý](#9-best-practices--lưu-ý)
10. [Checklist triển khai](#10-checklist-triển-khai)

---

## 1. Tổng quan & flow tích hợp

Khi cần gắn file (ảnh đại diện, ảnh sản phẩm, PDF hóa đơn, video...) vào một bản ghi nghiệp vụ,
frontend **không gửi file trực tiếp trong API nghiệp vụ**. Thay vào đó thực hiện **2 bước**:

```
┌────────────┐ ① upload file          ┌─────────────┐
│  Frontend  │ ──────────────────────► │  POST /files │
│            │ ◄────────────────────── │  (multipart) │
└────────────┘    { id, url, ... }     └─────────────┘
        │
        │ ② gửi id file kèm dữ liệu nghiệp vụ
        ▼
   POST /products, POST /stock-receipts, ...
   body: { ..., "fileIds": ["cm..."] }
```

### Tại sao upload trước, lưu id sau?

| Cách | Ưu điểm |
|------|---------|
| Upload file trước, lấy `id` lưu vào DB | File được tải lên độc lập, retry dễ, không phụ thuộc tính hợp lệ của dữ liệu nghiệp vụ, upload song song nhiều file được |
| Gửi file trực tiếp trong API nghiệp vụ | ❌ Body phức tạp (multipart + JSON), không tái sử dụng, khó validate |

### Lưu trữ: dùng `id` hay `url`?

- **Lưu `id`**: nên dùng khi cần quản lý file (xóa/thay thế sau này). `id` là khóa ổn định.
- **Lưu `url`**: dùng để hiển thị trực tiếp (img, video player, mở PDF).
- **Khuyến nghị**: lưu cả hai. `url` để render nhanh, `id` để gọi `PUT/DELETE /files/:id` khi cần đổi/xóa file.

---

## 2. Base URL & Headers

### Base URL

```
REST: http://<host>:3000/api/v1/files
```

### Headers bắt buộc

| Header | Giá trị | Ghi chú |
|--------|---------|---------|
| `Authorization` | `Bearer <JWT_ACCESS_TOKEN>` | Token đăng nhập |
| `X-Tenant-Id` | `<tenant-id>` | Bắt buộc với mọi request có `X-Tenant-Id` theo quy ước hệ thống |

> ⚠️ Với request upload (`multipart/form-data`), **không đặt** `Content-Type: application/json`.
> Thư viện HTTP sẽ tự set `Content-Type: multipart/form-data; boundary=...`.

**Mọi role trong tenant** (admin, warehouse_keeper, accountant, approver, viewer) đều upload được.

---

## 3. Cấu trúc dữ liệu File

Object trả về khi upload/update/get:

```json
{
  "id": "cmabc123def456",
  "tenantId": "tenant-001",
  "uploadedById": "user-001",
  "url": "http://localhost:9000/inventory/media/tenant-001/document/3f2a9c.pdf",
  "originalName": "hoa-don-001.pdf",
  "mimeType": "application/pdf",
  "size": 102400,
  "kind": "document",
  "createdAt": "2026-08-19T09:00:00.000Z"
}
```

| Field | Kiểu | Mô tả |
|-------|------|-------|
| `id` | string | **Khóa chính, dùng để lưu vào DB / update / delete** |
| `tenantId` | string | Tenant sở hữu file |
| `uploadedById` | string | ID user đã upload |
| `url` | string | URL công khai, dùng để hiển thị (img/video/pdf) |
| `originalName` | string | Tên file gốc lúc upload |
| `mimeType` | string | Ví dụ `application/pdf`, `image/png` |
| `size` | number | Dung lượng (bytes) |
| `kind` | string | Nhãn nhóm file (xem bên dưới) |
| `createdAt` | string (ISO) | Thời điểm upload |

### Quy ước `kind`

`kind` là nhãn để phân loại/nhóm file, giúp lọc và tổ chức object trên MinIO.
Chỉ gồm chữ thường, số, `-`, `_` (tối đa 64 ký tự).

Ví dụ đề xuất:

| Nghiệp vụ | `kind` |
|-----------|--------|
| Ảnh đại diện user | `avatar` |
| Ảnh sản phẩm | `product` |
| Ảnh kho | `warehouse` |
| File đính kèm chứng từ | `document` |
| Ảnh/chứng từ tồn đầu kỳ | `opening` |
| Ảnh phiếu nhập/xuất | `receipt` / `issue` |
| Không chỉ định | `general` (mặc định) |

---

## 4. Danh sách endpoint

### 4.1 `POST /files` — Upload file mới

**Content-Type:** `multipart/form-data`

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `file` | file | ✅ | Chỉ 1 file, tối đa 25MB |
| `kind` | text | ❌ | Mặc định `general` |

**Response 201:**

```json
{
  "success": true,
  "data": {
    "id": "cmabc123def456",
    "tenantId": "tenant-001",
    "uploadedById": "user-001",
    "url": "http://localhost:9000/inventory/media/tenant-001/document/3f2a9c.pdf",
    "originalName": "hoa-don-001.pdf",
    "mimeType": "application/pdf",
    "size": 102400,
    "kind": "document",
    "createdAt": "2026-08-19T09:00:00.000Z"
  }
}
```

### 4.2 `PUT /files/:id` — Thay nội dung file (update)

Thay file mới vào bản ghi đã có. **File cũ trên MinIO tự bị xóa.**

**Role:** người upload hoặc `admin`.

| Field | Type | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `file` | file | ✅ | File mới |
| `kind` | text | ❌ | Nếu bỏ trống, giữ `kind` hiện tại |

**Response 200** — object file đã cập nhật (id giữ nguyên, `url`/`originalName`/`size` mới).

### 4.3 `GET /files` — Danh sách file của tenant

**Query params:**

| Tham số | Kiểu | Mặc định | Mô tả |
|---------|------|----------|-------|
| `page` | int | 1 | Trang hiện tại |
| `limit` | int | 20 | Số item/trang (tối đa 200) |
| `kind` | string | — | Lọc theo nhóm |
| `search` | string | — | Tìm theo tên file gốc (không phân biệt hoa thường) |

**Response 200:**

```json
{
  "success": true,
  "data": [ { ...file object... } ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

> Khi **không** truyền `page`/`limit` → trả thẳng mảng `data`, không có `pagination`.
> Khi truyền → có `pagination`. Frontend nên xử lý cả hai dạng.

### 4.4 `GET /files/:id` — Chi tiết một file

**Response 200** — object file.

**Lỗi:** `NOT_FOUND` (404) nếu file không thuộc tenant hiện tại.

### 4.5 `DELETE /files/:id` — Xóa file

Xóa object trên MinIO + bản ghi metadata.

**Role:** người upload hoặc `admin`.

**Response 200:**

```json
{ "success": true, "data": { "id": "cmabc123def456" } }
```

---

## 5. Các loại file được phép & giới hạn

### Giới hạn chung

- **Tối đa 25MB/file**, 1 file/request.
- Field upload bắt buộc tên là `file`.

### MIME types được chấp nhận

| Nhóm | MIME types |
|------|-----------|
| Hình ảnh | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`, `image/avif`, `image/bmp`, `image/tiff`, `image/heic` |
| PDF | `application/pdf` |
| Video | `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`, `video/mpeg`, `video/ogg` |
| Audio | `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/flac`, `audio/mp4`, `audio/x-m4a`, `audio/aac` |

> ⚠️ Máy chủ kiểm tra theo `Content-Type` của file khi upload. Khi chọn file bằng file picker,
> hãy lấy đúng `mimeType` từ hệ thống, tránh đổi đuôi tên.

---

## 6. Ví dụ code Flutter

### 6.1 Model

```dart
class UploadedFile {
  final String id;
  final String tenantId;
  final String uploadedById;
  final String url;
  final String originalName;
  final String mimeType;
  final int size;
  final String kind;
  final DateTime createdAt;

  UploadedFile({
    required this.id,
    required this.tenantId,
    required this.uploadedById,
    required this.url,
    required this.originalName,
    required this.mimeType,
    required this.size,
    required this.kind,
    required this.createdAt,
  });

  factory UploadedFile.fromJson(Map<String, dynamic> json) => UploadedFile(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String,
        uploadedById: json['uploadedById'] as String,
        url: json['url'] as String,
        originalName: json['originalName'] as String,
        mimeType: json['mimeType'] as String,
        size: json['size'] as int,
        kind: json['kind'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
```

### 6.2 Upload file (dùng `http`)

```dart
import 'dart:io';
import 'package:http/http.dart' as http;

Future<UploadedFile> uploadFile({
  required File file,
  required String accessToken,
  required String tenantId,
  String kind = 'general',
}) async {
  final request = http.MultipartRequest(
    'POST',
    Uri.parse('http://<host>:3000/api/v1/files'),
  );

  request.headers.addAll({
    'Authorization': 'Bearer $accessToken',
    'X-Tenant-Id': tenantId,
  });

  // Field nghiệp vụ
  request.fields['kind'] = kind;

  // File: cần truyền đúng mimeType
  final mimeType = lookupMimeType(file.path) ?? 'application/octet-stream';
  request.files.add(
    await http.MultipartFile.fromPath('file', file.path,
        contentType: MediaType.parse(mimeType)),
  );

  final streamed = await request.send();
  final response = await http.Response.fromStream(streamed);
  final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

  if (response.statusCode == 201 && body['success'] == true) {
    return UploadedFile.fromJson(body['data'] as Map<String, dynamic>);
  }
  throw ApiException(body); // xử lý lỗi theo phần 8
}
```

### 6.3 Upload từ gallery / chọn ảnh

```dart
Future<String?> pickAndUploadImage({
  required String accessToken,
  required String tenantId,
  String kind = 'product',
}) async {
  final picker = ImagePicker();
  final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);

  if (picked == null) return null;

  final file = File(picked.path);
  final uploaded = await uploadFile(
    file: file,
    accessToken: accessToken,
    tenantId: tenantId,
    kind: kind,
  );

  // Trả về id — frontend lưu id này kèm dữ liệu nghiệp vụ
  return uploaded.id;
}
```

### 6.4 Update file (thay file cũ)

```dart
Future<UploadedFile> replaceFile({
  required String fileId,
  required File file,
  required String accessToken,
  required String tenantId,
  String? kind, // null => giữ kind cũ
}) async {
  final request = http.MultipartRequest(
    'PUT',
    Uri.parse('http://<host>:3000/api/v1/files/$fileId'),
  );

  request.headers.addAll({
    'Authorization': 'Bearer $accessToken',
    'X-Tenant-Id': tenantId,
  });

  if (kind != null) request.fields['kind'] = kind;

  final mimeType = lookupMimeType(file.path) ?? 'application/octet-stream';
  request.files.add(
    await http.MultipartFile.fromPath('file', file.path,
        contentType: MediaType.parse(mimeType)),
  );

  final streamed = await request.send();
  final response = await http.Response.fromStream(streamed);
  final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

  if (response.statusCode == 200 && body['success'] == true) {
    return UploadedFile.fromJson(body['data'] as Map<String, dynamic>);
  }
  throw ApiException(body);
}
```

### 6.5 Xóa file

```dart
Future<void> deleteFile({
  required String fileId,
  required String accessToken,
  required String tenantId,
}) async {
  final response = await http.delete(
    Uri.parse('http://<host>:3000/api/v1/files/$fileId'),
    headers: {
      'Authorization': 'Bearer $accessToken',
      'X-Tenant-Id': tenantId,
    },
  );

  if (response.statusCode != 200) {
    throw ApiException(jsonDecode(response.body) as Map<String, dynamic>);
  }
}
```

### 6.6 Hiển thị URL

```dart
// Ảnh
Image.network(uploadedFile.url, fit: BoxFit.cover);

// PDF — mở bằng url_launcher
launchUrl(Uri.parse(uploadedFile.url), mode: LaunchMode.externalApplication);

// Video — nếu URL nằm ngoài tên miền public cần cấu hình, hoặc dùng video_player với url này
```

> **Lưu ý dev**: `url` trỏ tới MinIO (`http://minio:9000/...` trong docker). Nếu app thật không truy
> cập được host nội bộ này, cần expose MinIO ra domain công khai (ví dụ `minio.yourdomain.com`)
> hoặc đặt MinIO sau reverse-proxy — backend sẽ trả `url` theo endpoint đã cấu hình.

---

## 7. Ví dụ code Web/React

```ts
// uploadFile.ts
export async function uploadFile(
  file: File,
  opts: { accessToken: string; tenantId: string; kind?: string },
): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', opts.kind ?? 'general');

  const res = await fetch('http://<host>:3000/api/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'X-Tenant-Id': opts.tenantId,
      // KHÔNG set Content-Type — fetch tự thêm boundary
    },
    body: form,
  });

  const json = await res.json();
  if (!res.ok || !json.success) throw new ApiError(json.error);
  return json.data; // { id, url, originalName, mimeType, size, kind, ... }
}
```

Sau khi có `id`:

```ts
const uploaded = await uploadFile(file, { accessToken, tenantId, kind: 'document' });

// Gửi id kèm API nghiệp vụ
await createProduct({
  ...productData,
  fileIds: [uploaded.id], // backend nghiệp vụ lưu id này vào DB
});
```

---

## 8. Xử lý lỗi

Format lỗi chuẩn của hệ thống:

```json
{
  "success": false,
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File must be 25MB or smaller"
  }
}
```

| HTTP | Code | Ý nghĩa | Xử lý frontend |
|------|------|---------|----------------|
| 400 | `FILE_REQUIRED` | Thiếu field `file` | Báo "chưa chọn file" |
| 400 | `INVALID_FILE_TYPE` | Loại file không được hỗ trợ | Báo "Định dạng file không hợp lệ" |
| 400 | `EMPTY_FILE` | File rỗng (0 bytes) | Báo "File trống" |
| 400 | `FILE_TOO_LARGE` | File > 25MB | Báo "File tối đa 25MB" |
| 400 | `INVALID_FILE_UPLOAD` | Lỗi upload khác (Multer) | Báo chung + retry |
| 400 | `VALIDATION_ERROR` | `kind` sai định dạng | Kiểm tra lại `kind` |
| 401 | `UNAUTHORIZED` | Token hết hạn | Đăng nhập lại / refresh token |
| 403 | `FORBIDDEN` | Không phải người upload/admin khi update/delete | Ẩn nút xóa/sửa |
| 404 | `NOT_FOUND` | File không tồn tại / không thuộc tenant | Báo "File không tồn tại" |
| 429 | `RATE_LIMITED` | Quá nhiều request | Chờ rồi retry |

---

## 9. Best practices & lưu ý

1. **Upload trước, lưu id sau** — không gửi file trong API nghiệp vụ.
2. **Hiển thị trước khi lưu**: khi user chọn ảnh xong, gọi upload ngay, hiển thị ảnh từ `url` trả về;
   chỉ khi user bấm **Lưu** mới gửi `fileId` kèm dữ liệu nghiệp vụ.
3. **Hủy = xóa file rác**: nếu user chọn ảnh rồi hủy form, gọi `DELETE /files/:id` để dọn file
   đã upload (tránh file rác trong MinIO).
4. **Thay ảnh = PUT, không upload mới**: khi user thay ảnh cũ, gọi `PUT /files/:id` — backend
   tự xóa file cũ, không phát sinh bản ghi rác.
5. **Validate trước khi gửi**: kiểm tra `mimeType` và dung lượng ≤ 25MB ở phía client để báo lỗi
   sớm, đỡ tốn băng thông.
6. **Upload đồng thời nhiều file**: gọi song song nhiều `POST /files`, backend xử lý độc lập.
7. **Không lạm dụng `kind`**: đặt tên ổn định, không thay đổi giữa chừng — dùng để lọc/group.
8. **File chỉ dùng trong tenant**: mọi file đều gắn với `tenantId`, không thể đọc/xóa file của
   tenant khác.

---

## 10. Checklist triển khai

- [ ] Có `ApiClient` gửi `Authorization` + `X-Tenant-Id` cho mọi request
- [ ] Implement `uploadFile` (multipart, field `file`, field `kind`)
- [ ] Implement `replaceFile` (PUT) để thay ảnh/file
- [ ] Implement `deleteFile` (DELETE) để xóa / dọn file rác
- [ ] Implement `getFile` / `listFiles` nếu cần hiển thị thư viện file
- [ ] Map các error code trong bảng phần 8 thành thông báo tiếng Việt thân thiện
- [ ] Luồng tạo bản ghi: upload → nhận `id` → gửi `id` trong body API nghiệp vụ
- [ ] Luồng sửa bản ghi: thay file = `PUT /files/:id`, xóa file = `DELETE /files/:id`
- [ ] Test thật: upload ảnh JPEG/PNG, PDF, video MP4; upload file > 25MB để thấy lỗi
