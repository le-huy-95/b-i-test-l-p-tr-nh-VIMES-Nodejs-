# Hướng dẫn Flutter — Sửa đọc tiền phiếu nhập + lưu ý GET `/stock-receipts/:id`

**Ngày:** 2026-09-08  
**API liên quan:** `GET /api/v1/stock-receipts/:id` (cũng ảnh hưởng list / create / update khi parse số tiền)

---

## 1. Backend đã sửa gì?

### 1.1 Bug tổng tiền / số Decimal (đã sửa)

**Trước đây:** Sau khi gắn múi giờ VN (`withVnTimestamps`), các field `Decimal` của Prisma bị “bóc” thành object nội bộ:

```json
"totalAmount": { "s": 1, "e": 6, "d": [4250000] }
```

App Flutter nếu expect `String` / `num` sẽ parse fail → màn hình như **không có tổng tiền**.

**Hiện tại:** Backend giữ nguyên Decimal; JSON serialize thành **chuỗi số**:

```json
"totalAmount": "4250000"
```

Cùng kiểu với các field dòng hàng: `unitPrice`, `lineAmount`, `expectedQty`, `actualQty`, `qtyBaseUnit`, …

> Lỗi này cũng từng ảnh hưởng `GET /stock-receipts` (list), `POST`, `PUT` — không chỉ get by id.

### 1.2 Cache Redis cho chi tiết phiếu (backend-only)

`GET /stock-receipts/:id` giờ cache Redis (TTL ~60s), key theo tenant + phạm vi xem + id.

- Create / update / approve / reject / complete / cancel / clone → backend **lazy xóa cache**.
- Flutter **không cần** gọi API invalidate; cũng **không cần** đổi URL hay header.

| Hành vi | Ý nghĩa với Flutter |
|---------|---------------------|
| GET lần 1 | Có thể chậm hơn một chút (miss → DB) |
| GET lần 2 trong TTL | Nhanh hơn (hit cache) |
| Sau khi sửa/duyệt phiếu | GET lại sẽ ra data mới (cache đã xóa) |

---

## 2. Flutter cần sửa gì?

### 2.1 Parse tiền / số lượng — chấp nhận `String` số

**Khuyến nghị:** mọi field tiền/số lượng parse an toàn từ `String` hoặc `num`, **không** expect object `{s,e,d}`.

Ví dụ helper:

```dart
double? parseMoney(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  // Phòng hờ response cũ (bug Decimal) — có thể bỏ sau khi backend đã deploy ổn định
  if (value is Map && value['d'] is List && (value['d'] as List).isNotEmpty) {
    final digits = (value['d'] as List).map((e) => e.toString()).join();
    final e = value['e'];
    if (e is int) {
      final asInt = int.tryParse(digits);
      if (asInt != null) {
        return asInt * (e >= digits.length - 1
            ? 1.0
            : 1 / (10 * (digits.length - 1 - e))); // fallback thô — ưu tiên upgrade backend
      }
    }
  }
  return null;
}
```

Với backend đã fix, chỉ cần:

```dart
double? parseMoney(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
```

Áp dụng cho model phiếu nhập (và nên đồng bộ phiếu xuất nếu dùng chung parser):

| Field | Ý nghĩa |
|-------|---------|
| `totalAmount` | Tổng tiền phiếu |
| `details[].unitPrice` | Đơn giá |
| `details[].lineAmount` | Thành tiền dòng |
| `details[].expectedQty` / `actualQty` / `qtyBaseUnit` | Số lượng |

### 2.2 Model / `fromJson` — ví dụ

```dart
class StockReceipt {
  final String id;
  final String? totalAmount; // giữ String để không mất precision, format khi hiển thị
  // ...

  factory StockReceipt.fromJson(Map<String, dynamic> json) {
    return StockReceipt(
      id: json['id'] as String,
      totalAmount: _asMoneyString(json['totalAmount']),
      // ...
    );
  }
}

String? _asMoneyString(dynamic v) {
  if (v == null) return null;
  if (v is String) return v;
  if (v is num) return v.toString();
  return null; // bỏ qua object lỗi cũ
}
```

Hiển thị:

```dart
Text(formatVnd(receipt.totalAmount)) // parse String → format 4.250.000
```

### 2.3 Ngày giờ (không đổi trong lần này, nhắc lại)

Các field ngày vẫn là ISO **+07:00**:

- Date-only: `receiptDate` → `2026-09-07T00:00:00.000+07:00`
- DateTime: `createdAt`, `updatedAt`, `approvedAt`, `completedAt`

Parse bằng `DateTime.parse` là đủ; không cần đổi vì fix Decimal.

### 2.4 Cache — Flutter không làm gì thêm

- Không thêm cache client bắt buộc.
- Sau mutation (PUT / approve / …) nếu đang mở màn detail: **gọi lại GET** (hoặc dùng response của mutation) để UI khớp server.
- Không cần “bust cache” đặc biệt; backend đã invalidate.

---

## 3. Thủ kho & kế toán — backend **chưa** trả trên GET phiếu

`GET /stock-receipts/:id` **vẫn không** trả object tên thủ kho / kế toán.

Hiện có tối đa:

- `createdById` — người tạo phiếu
- `approvedById` — người duyệt cấp phiếu (nếu dùng approve 1 cấp; với workflow nhiều bước có thể không đủ)

Thủ kho / kế toán nằm ở **workflow**:

| Bước (`stepCode`) | Vai trò UI |
|-------------------|------------|
| `warehouse` | Thủ kho |
| `chief_accountant` | Kế toán trưởng |

### Cách lấy trên Flutter (giữ như design hiện tại)

1. `GET /api/v1/stock-receipts/:id` — header + dòng hàng + tiền  
2. `GET /api/v1/document-workflows/stock_receipt/:id` — `steps[]` với `assignedApproverId` / `actualSignerId`  
3. Map tên từ `GET /api/v1/tenant/members` (hoặc cache members local)

```dart
final warehouseStep = workflow.steps.firstWhere((s) => s.stepCode == 'warehouse');
final accountantStep = workflow.steps.firstWhere((s) => s.stepCode == 'chief_accountant');

final keeperName = membersById[warehouseStep.assignedApproverId]?.fullName;
final accountantName = membersById[accountantStep.assignedApproverId]?.fullName;
```

> Nếu cần backend trả sẵn `{ id, name }` trên get phiếu — đó là feature riêng, **chưa** nằm trong đợt sửa này.

---

## 4. Checklist sửa Flutter

- [ ] Parser tiền/số lượng: `String` | `num` → không crash nếu gặp Map (optional guard)
- [ ] UI tổng tiền đọc `totalAmount` dạng chuỗi số
- [ ] UI dòng hàng đọc `unitPrice` / `lineAmount`
- [ ] Smoke: mở chi tiết phiếu đã có tiền → thấy tổng đúng
- [ ] Smoke: sửa phiếu → mở lại detail → tiền/dòng cập nhật
- [ ] Thủ kho / kế toán: vẫn lấy từ workflow + members (không đợi field mới trên get)

---

## 5. Ví dụ response get (rút gọn, sau fix)

```json
{
  "success": true,
  "data": {
    "id": "rcpt_...",
    "code": "PNK-2026-000012",
    "status": "draft",
    "totalAmount": "4250000.00",
    "receiptDate": "2026-09-07T00:00:00.000+07:00",
    "createdAt": "2026-09-07T17:00:00.000+07:00",
    "createdById": "user_001",
    "approvedById": null,
    "warehouse": { "id": "wh_001", "name": "Kho HN" },
    "supplier": { "id": "sup_001", "name": "NCC A" },
    "details": [
      {
        "productId": "prod_1",
        "unitPrice": "1000.5000",
        "lineAmount": "2001.00",
        "actualQty": "2.0000"
      }
    ]
  }
}
```

**Lưu ý:** sau khi qua Redis cache, số có thể là `"4250000"` (không luôn đủ 2 chữ số thập phân). Flutter nên `double.tryParse` / format display, không hard-code độ dài phần thập phân từ raw string.
