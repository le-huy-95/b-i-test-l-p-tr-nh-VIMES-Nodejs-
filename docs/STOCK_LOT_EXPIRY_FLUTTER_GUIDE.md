# Client Guide — Lô hàng & hạn sử dụng (Flutter)

Tài liệu **đối chiếu code backend hiện tại** để Flutter bổ sung / sửa UI phiếu nhập, phiếu xuất, phiếu đầu kỳ.

Nguồn tham chiếu đầy đủ hơn: `docs/STOCK_DOCUMENT_API.md` §10, `docs/API.md` (Stock Receipt / Issue / Opening).

---

## 1. Tóm tắt 30 giây

| | Phiếu nhập / đầu kỳ | Phiếu xuất |
|---|---|---|
| Client gửi | `batchNo` + `expiryDate` (optional) | `batchId` (optional) |
| Khi nào có lô thật | Lúc **complete** / **post** | Không tạo lô; chỉ pick / trừ |
| Không gửi lô | Tồn `batchId = null` | Backend tự chọn lô theo `createdAt` ASC |
| Chặn hết hạn | Không | Không |
| Cảnh báo HSD | `GET /reports/expiry-alert` | Cùng API |

Product **không** còn `trackBatch` / `trackExpiry` / `costingMethod`. Lô là **tùy chọn theo dòng**, không bắt buộc theo product.

---

## 2. Breaking / lệch docs cũ (Flutter cần bỏ)

| Giả định cũ (sai) | Thực tế hiện tại |
|---|---|
| Product có `trackBatch` → bắt buộc nhập `batchNo` | Không còn cờ; `batchNo` luôn optional |
| Xuất theo FEFO (ưu tiên HSD sớm) | Chỉ FIFO theo `Batch.createdAt` ASC |
| Complete xuất lỗi `EXPIRED_BATCH` | **Không** throw; lô hết hạn vẫn xuất được |
| Giá xuất = `product.averageCost` | Giá xuất = `Batch.unitCost` của lô pick |
| Nhập gửi `manufactureDate` là đủ | Field Zod nhận nhưng **không lưu** — đừng phụ thuộc |
| Xuất gửi `batchNo` | Xuất chỉ nhận `batchId` |

---

## 3. Model dữ liệu (hiểu đúng để map Dart)

### 3.1 Batch master

Unique: `(tenantId, productId, batchNo)`.

| Field | Ý nghĩa |
|---|---|
| `id` | Dùng làm `batchId` khi xuất |
| `batchNo` | Số lô người dùng nhập khi nhập / đầu kỳ |
| `expiryDate` | Ngày HSD (`@db.Date`, parse lịch VN) |
| `unitCost` | Giá vốn lô (bình quân khi nhập lại cùng số lô) |
| `createdAt` | Thứ tự pick khi xuất tự động |

### 3.2 Tồn theo lô

Khóa balance: `(tenant, product, warehouse, batchId, location)`.

- Cùng sản phẩm nhiều lô → nhiều dòng tồn.
- Tra cứu UI: `GET /products/:id/availability` → `lots[]` có `batchId`, `batchNo`, `expiryDate`, `onhand` / `reserved` / `available`.

---

## 4. Phiếu nhập kho

### 4.1 Payload dòng hàng

```json
{
  "productId": "prd_001",
  "unitName": "thùng",
  "expectedQty": 100,
  "actualQty": 98,
  "unitPrice": 120000,
  "batchNo": "L001",
  "expiryDate": "2027-08-18"
}
```

| Field | Bắt buộc | Ghi chú Flutter |
|---|---|---|
| `batchNo` | ❌ | Cho nhập text; trim; không gửi chuỗi rỗng |
| `expiryDate` | ❌ | Date picker → gửi ngày (ISO date hoặc datetime OK; backend lấy ngày VN) |
| `manufactureDate` | — | **Không dùng** (bị bỏ qua) |

### 4.2 Timeline

```text
Tạo / sửa draft
  → lưu batchNo, expiryDate trên dòng; batchId = null

Complete (approved → completed)
  → có batchNo: ensureBatch → gắn batchId → +onhand theo lô
  → không batchNo: +onhand với batchId = null
```

### 4.3 UI nhập nên có

1. Trên mỗi dòng: field **Số lô**, **Hạn dùng** (optional).
2. Cho phép nhiều dòng cùng product + cùng `batchNo` (backend gộp lúc complete).
3. Sau complete: hiển thị `details[].batchId`, `batchNo`, `expiryDate`.
4. Không hiện / validate theo `trackBatch` trên product.

### 4.4 Endpoint

- `POST /api/v1/stock-receipts`
- `PUT /api/v1/stock-receipts/:id`
- `POST /api/v1/stock-receipts/:id/complete`

---

## 5. Phiếu xuất kho

### 5.1 Payload dòng hàng

```json
{
  "productId": "prd_001",
  "unitName": "thùng",
  "requestedQty": 10,
  "actualQty": 10,
  "unitPrice": 0,
  "batchId": "batch_001"
}
```

| Field | Bắt buộc | Ghi chú Flutter |
|---|---|---|
| `batchId` | ❌ | ID từ availability / danh sách lô — **không** gửi `batchNo` |
| (không có `expiryDate` trên dòng xuất) | — | HSD chỉ xem từ lot picker |

### 5.2 Timeline

```text
Tạo draft (có hoặc không batchId trên dòng)

Approve bước đầu sau creator → doc pending_approval
  → lock tồn, pick lô, tạo StockReservation theo batchId (TTL 24h)

Reject / cancel → release reservation

Complete
  → pick lại, trừ onhand, consume reservation
  → unitCost ledger = Batch.unitCost (hoặc "0")
```

### 5.3 Cách chọn lô trên UI

**Cách A — User chọn lô**

1. Gọi `GET /products/:id/availability` (lọc theo `warehouseId` nếu API hỗ trợ).
2. Hiện picker: `batchNo`, `expiryDate`, `available`.
3. Gửi `lines[].batchId`.

**Cách B — Để backend tự pick**

1. Không gửi `batchId`.
2. Backend chọn lô `createdAt` ASC cho đến đủ qty.
3. Có thể tách nhiều lô cho một dòng; `details[].batchId` chỉ chắc chắn khi pick đúng **một** lô.

### 5.4 Không làm trên Flutter

- Không expect lỗi `EXPIRED_BATCH`.
- Không sort FEFO phía client rồi giả định backend cùng thứ tự (trừ khi user đã chọn đúng `batchId`).
- Không chặn submit/complete chỉ vì HSD đã qua — backend không chặn; nếu business cần chặn thì làm **cảnh báo UX** (confirm), không dựa error code.

### 5.5 Endpoint

- `POST /api/v1/stock-issues`
- `PUT /api/v1/stock-issues/:id`
- Complete / approve / reject / cancel như workflow hiện tại  
  (xem thêm `docs/STOCK_DOC_CREATE_PENDING_APPROVAL_CLIENT_GUIDE.md`)

---

## 6. Phiếu đầu kỳ

Giống nhập về lô:

```json
{
  "productId": "prd_001",
  "qty": 50,
  "unitCost": 10000,
  "batchNo": "L001",
  "expiryDate": "2027-08-18"
}
```

- `batchNo` / `expiryDate` optional.
- Lô được tạo lúc **post** (không phải lúc create draft).

---

## 7. API hỗ trợ UI

| Mục đích | API |
|---|---|
| Tồn theo kho + lô | `GET /api/v1/products/:id/availability` |
| Cảnh báo sắp hết hạn | `GET /api/v1/reports/expiry-alert?days=30&warehouseId=` |
| Badge overview | `expiryAlertCount` trong warehouse/org overview |

Response availability (ý tưởng):

```json
{
  "lots": [
    {
      "batchId": "cuid",
      "batchNo": "LOT-0001",
      "expiryDate": "2027-01-01",
      "onhand": "10.0000",
      "reserved": "2.0000",
      "available": "8.0000"
    }
  ]
}
```

---

## 8. Mapping lỗi liên quan lô

| Code | UI gợi ý |
|---|---|
| `STOCK_INSUFFICIENT` | Không đủ tồn (lô chỉ định hoặc tổng các lô) — refresh availability, giảm qty / đổi lô |
| `VERSION_CONFLICT` | Xung đột tồn — thử lại |
| `VALIDATION_ERROR` | `batchNo` gửi rỗng / field form sai |
| ~~`EXPIRED_BATCH`~~ | **Không còn** — đừng map |

---

## 9. Checklist sửa Flutter

### Model / DTO

- [ ] Receipt line: `batchNo`, `expiryDate` optional; bỏ phụ thuộc `manufactureDate`
- [ ] Issue line: `batchId` optional; **không** có `batchNo` / `expiryDate` trên payload xuất
- [ ] Opening line: `batchNo`, `expiryDate` optional
- [ ] Product model: bỏ `trackBatch` / `trackExpiry` / `costingMethod` nếu còn

### Màn nhập

- [ ] Form dòng: Số lô + Hạn dùng (optional)
- [ ] Không validate “bắt buộc vì track batch”
- [ ] Sau complete hiện `batchId` nếu có

### Màn xuất

- [ ] Lot picker từ `availability` → set `batchId`
- [ ] Cho phép “Tự động chọn lô” (không gửi `batchId`)
- [ ] Hiển thị `available` theo lô; xử lý `STOCK_INSUFFICIENT`
- [ ] Cảnh báo HSD (optional UX) — không dựa `EXPIRED_BATCH`

### Báo cáo / badge

- [ ] Màn sắp hết hạn → `GET /reports/expiry-alert`
- [ ] Badge kho → `expiryAlertCount`

### Docs / copy trong app

- [ ] Đổi text “xuất FEFO” (nếu có) → “ưu tiên lô nhập/tạo trước” hoặc “tự chọn lô”
- [ ] Đổi text “chặn hàng hết hạn” nếu đang ghi là hard-block của server

---

## 10. Ví dụ luồng end-to-end

```text
1) Nhập 100 SP-A, batchNo=L001, expiry=2027-08-18
   → complete → Batch L001 + balance 100

2) Nhập thêm 50 SP-A, batchNo=L001 (cùng số lô)
   → complete → cùng Batch, tồn 150, unitCost bình quân

3) Xuất 30 SP-A, không chọn batchId
   → pending_approval: reserve 30 trên L001
   → complete: trừ 30 trên L001

4) Xuất 20 SP-A, user chọn batchId của L002
   → chỉ trừ L002; thiếu → STOCK_INSUFFICIENT
```

---

## 11. Phạm vi ngoài tài liệu này

- FEFO theo `expiryDate` và chặn cứng lô hết hạn: **chưa bật** trong backend (test allocation còn expect FEFO nhưng runtime sort theo `createdAt`).
- Khi backend bật FEFO / `EXPIRED_BATCH`, sẽ cập nhật lại guide này.

Ngày đối chiếu code: **2026-09-09**.
