# Notification REST — Client guide (đã verify)

> Verified local `:3001` + production `https://api.kimbap.io.vn` — **2026-09-09**.  
> Backend inbox API **hoạt động đúng**. Nếu FE không mark-read / không mở được inbox, ưu tiên kiểm tra URL, body, và state management theo checklist cuối tài liệu này.

Service: `notification-ws` (không phải Business API). Qua Cloudflare Tunnel cùng host `api.kimbap.io.vn`, path `/api/v1/notifications*` được route sang service này.

---

## 1. Base URL

| Môi trường | REST base | WebSocket |
|------------|-----------|-----------|
| Production | `https://api.kimbap.io.vn/api/v1` | `wss://api.kimbap.io.vn/notifications?token=<ACCESS>` |
| Local | `http://localhost:3001/api/v1` | `ws://localhost:3001/notifications?token=<ACCESS>` |

**Flutter `.env` đúng:**

```env
NOTIFICATION_API_URL=https://api.kimbap.io.vn/api/v1
NOTIFICATION_WS_URL=wss://api.kimbap.io.vn/notifications
```

Full path ví dụ: `{NOTIFICATION_API_URL}/notifications/mark-read`  
→ `https://api.kimbap.io.vn/api/v1/notifications/mark-read`

### Sai URL (đã reproduce → fail)

| URL gọi | Kết quả |
|---------|---------|
| `https://api.kimbap.io.vn/notifications` (thiếu `/api/v1`) | `404 Route not found` |
| `GET .../notifications/mark-read` | `404 Notification not found` (bị match `GET /:id` với `id=mark-read`) |
| `PUT .../notifications/mark-read` | `404 Route not found` |

---

## 2. Auth

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

- Cùng JWT access token với Business API.
- `X-Tenant-Id` **không bắt buộc** cho inbox (server lọc theo `userId` của token). Có gửi cũng không sao.
- Thiếu/sai token → `401 UNAUTHORIZED`.

---

## 3. Endpoints (đủ luồng inbox)

### 3.1 `GET /notifications/unread-count`

**Response 200:**

```json
{ "success": true, "data": { "count": 5 } }
```

Dùng cho badge. Sau khi mark-read / detail, **ưu tiên `unreadCount` trong response của thao tác đó**, không cần poll lại ngay.

---

### 3.2 `GET /notifications`

Query:

| Param | Type | Default | Note |
|-------|------|---------|------|
| `limit` | int | `20` | 1–50 |
| `cursor` | string | — | `nextCursor` trang trước |
| `onlyUnread` | string `"true"` / `"false"` | — | Chỉ gửi khi cần; giá trị phải là chuỗi boolean query |
| `tenantId` | string | — | Lọc theo tenant |

**Response 200:**

```json
{
  "success": true,
  "data": {
    "items": [ /* NotificationItem */ ],
    "nextCursor": "eyJ..."
  }
}
```

- Không còn trang sau → **không có** `nextCursor` (hoặc coi như hết trang).
- `items[].readAt === null` → chưa đọc.

---

### 3.3 `GET /notifications/:id` — xem chi tiết + **tự mark đã đọc**

Dùng khi user **tap 1 thông báo**.

- Nếu `readAt == null` → server set `readAt = now`, cập nhật cache.
- Không thuộc user / không tồn tại → `404 NOT_FOUND`.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "item": { /* NotificationItem, readAt đã có nếu vừa mark */ },
    "unreadCount": 4
  }
}
```

---

### 3.4 `POST /notifications/mark-read`

#### Mark theo ID (1 hoặc nhiều)

```json
{
  "notificationIds": ["cmttt...", "cmttt..."],
  "markAll": false
}
```

`markAll` có thể bỏ (default `false`).

#### Mark tất cả chưa đọc

```json
{
  "markAll": true
}
```

Optional: `"tenantId": "<tenantId>"` để chỉ mark trong 1 tenant.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "updated": 3,
    "unreadCount": 0
  }
}
```

| Field | Nghĩa |
|-------|--------|
| `updated` | Số bản ghi vừa chuyển unread → read |
| `unreadCount` | Số chưa đọc **sau** thao tác → cập nhật badge |

#### Validation / silent no-op (hay làm FE tưởng “không chạy”)

| Body | HTTP | Kết quả |
|------|------|---------|
| `{ "markAll": true }` | 200 | Mark all OK |
| `{ "notificationIds": ["id"], "markAll": false }` | 200 | Mark từng ID OK |
| `{}` hoặc `{ "ids": ["..."] }` (sai tên field) | **200** | `updated: 0` — **không lỗi**, không mark gì |
| `{ "markAll": "true" }` (string) | **400** `VALIDATION_ERROR` | `markAll` phải là **boolean JSON**, không phải string |
| `{ "markAll": 1 }` | **400** | Tương tự |

---

## 4. `NotificationItem` (REST + WS)

```ts
interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  tenantId: string | null;
  readAt: string | null;       // ISO-8601; null = chưa đọc
  createdAt: string;           // ISO-8601
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  routeName: string | null;
  routeParams: Record<string, string> | null;
  deeplink: string | null;
  sourceType: string | null;
  sourceId: string | null;
  data: Record<string, unknown> | null;
}
```

### `type` hiện có

| `type` | `routeName` (nếu có) | Ghi chú |
|--------|----------------------|---------|
| `invitation_created` / `invitation_accepted` / `invitation_declined` | — | |
| `membership_removed` | — | |
| `user_created` / `user_login` | — | |
| `receipt_*` | `stock_receipt_detail` | `routeParams.receiptId`, `tenantId` |
| `issue_*` | `stock_issue_detail` | `routeParams.issueId`, `tenantId` |
| `issue_out_of_stock` / `issue_stock_available` | `stock_issue_detail` | Hết hàng / có hàng lại |

Deeplink mẫu: `myapp://stock-receipts/<id>`, `myapp://stock-issues/<id>`.

---

## 5. Luồng FE khuyến nghị

### Tap 1 thông báo

```
1. (Optional navigate theo deeplink / routeName)
2. Gọi một trong hai:
   A) GET /notifications/:id          ← khuyến nghị (server tự mark)
   B) POST /notifications/mark-read
        { "notificationIds": [id], "markAll": false }
3. Cập nhật local:
   - item.readAt = response item.readAt || now
   - unreadCount = response.unreadCount
4. Không nuốt lỗi API im lặng — nếu fail, rollback optimistic UI hoặc hiện snackbar
```

### Đọc tất cả

```
POST /notifications/mark-read
{ "markAll": true }

→ set mọi item.readAt local = now
→ unreadCount = data.unreadCount (thường 0)
```

### Mở inbox / “xem tất cả”

```
GET /notifications?limit=20
GET /notifications/unread-count   (song song được)
```

Phân trang: khi `nextCursor` có giá trị → `GET /notifications?cursor=<nextCursor>&limit=20`.

---

## 6. Checklist sửa Flutter (dựa trên code hiện tại)

Các điểm dưới đây khớp repo frontend; backend đã verify OK nên ưu tiên sửa phía client:

1. **URL**  
   `NOTIFICATION_API_URL` phải là `.../api/v1` (đã đúng trong `.env.example`).  
   Không gọi `https://api.kimbap.io.vn/notifications` cho REST.

2. **Mark-read body**  
   Field đúng: `notificationIds` + `markAll` (boolean).  
   Sai tên (`ids`) → HTTP 200 nhưng `updated: 0` → UI tưởng đã gọi API mà DB không đổi.

3. **Không nuốt lỗi**  
   `NotificationBloc._onMarkRead` / `_onMarkAllRead` đang `catch` rồi chỉ log — user không thấy fail; sau refresh lại thành chưa đọc.

4. **Một `NotificationBloc` dùng chung**  
   App root đã có `BlocProvider<NotificationBloc>`, nhưng route `/notifications` đang **tạo bloc mới**.  
   Hệ quả: mark-read trên inbox không đồng bộ badge ở sidebar; “xem tất cả” load state tách khỏi badge.  
   **Nên:** dùng `BlocProvider.value` / không tạo bloc mới trên route inbox.

5. **Thiếu `GET /notifications/:id`**  
   Service hiện chỉ `list` / `unread-count` / `mark-read`.  
   Nên thêm `getDetail(id)` và gọi khi tap (hoặc giữ `mark-read` nhưng phải xử lý lỗi + sync bloc đúng).

6. **Label type**  
   Bổ sung `issue_out_of_stock`, `issue_stock_available`, `user_login`, `user_created`, `invitation_declined` trong UI map.

7. **Sau mark-read**  
   Dùng `data.unreadCount` từ response để set badge — đừng chỉ optimistic rồi bỏ qua response.

---

## 7. curl nhanh

```bash
TOKEN='<accessToken>'
BASE='https://api.kimbap.io.vn/api/v1'

curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/notifications?limit=20"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/notifications/unread-count"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/notifications/<id>"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"notificationIds":["<id>"],"markAll":false}' "$BASE/notifications/mark-read"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"markAll":true}' "$BASE/notifications/mark-read"
```

---

## 8. Tài liệu liên quan

- WebSocket: [NOTIFICATION_FRONTEND_WEBSOCKET_GUIDE.md](./NOTIFICATION_FRONTEND_WEBSOCKET_GUIDE.md)
- Tổng quan service: [NOTIFICATION_WS.md](./NOTIFICATION_WS.md)
- Hướng dẫn FE dài (architecture): [NOTIFICATION_FRONTEND_GUIDE.md](./NOTIFICATION_FRONTEND_GUIDE.md)
