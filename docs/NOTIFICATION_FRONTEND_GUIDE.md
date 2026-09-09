# Hướng dẫn tích hợp Notification cho Frontend

> Tài liệu này tổng hợp toàn bộ những gì frontend (Flutter / Web / React / Vue) cần làm
> để tích hợp với hệ thống notification realtime của backend.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Danh sách API và endpoint](#2-danh-sách-api-và-endpoint)
3. [WebSocket Protocol](#3-websocket-protocol)
4. [Cấu trúc dữ liệu](#4-cấu-trúc-dữ-liệu)
5. [Các luồng xử lý frontend cần làm](#5-các-luồng-xử-lý-frontend-cần-làm)
6. [Quản lý state](#6-quản-lý-state)
7. [Xử lý routing / deeplink](#7-xử-lý-routing--deeplink)
8. [Lifecycle và reconnect](#8-lifecycle-và-reconnect)
9. [Edge cases](#9-edge-cases)
10. [Checklist triển khai](#10-checklist-triển-khai)
11. [Phụ thuộc cần thiết](#11-phụ-thuộc-cần-thiết)

---

## 1. Tổng quan kiến trúc

```
┌─────────────┐         WebSocket (port 3001)          ┌───────────────┐
│             │ ◄───────────────────────────────────────┤  WS Server    │
│  Frontend   │ ◄─── NOTIFICATION_NEW (realtime) ───────┤  (push relay)  │
│  (Flutter/  │ ─────── PING (heartbeat) ──────────────►┤               │
│   Web)      │                                         └───────────────┘
│             │
│             │         REST API (port 3000)             ┌───────────────┐
│             │ ──── GET /notifications ────────────────►┤  REST API      │
│             │ ◄─── { items, nextCursor } ──────────────┤  (list,        │
│             │ ──── GET /notifications/unread-count ───►│   unread-count,│
│             │ ◄─── { count } ──────────────────────────┤   detail,      │
│             │ ──── GET /notifications/:id ─────────────►│   mark-read)   │
│             │ ◄─── { item, unreadCount } ──────────────┤                │
│             │ ──── POST /notifications/mark-read ────►└────────────────┘
│             │ ◄─── { updated, unreadCount } ──────────┘
└─────────────┘
```

### Hai kênh bổ sung nhau

| Kênh | Mục đích | Khi nào hoạt động |
|------|----------|-------------------|
| WebSocket | Nhận notification mới theo realtime | App đang mở (foreground) |
| REST API | Lấy danh sách, unread count, đánh dấu đã đọc | Bất cứ lúc nào |

- WebSocket để **push realtime** khi app đang mở
- REST API để **load dữ liệu ban đầu** và **thao tác** (đánh dấu đã đọc, phân trang)

---

## 2. Danh sách API và endpoint

### 2.1 Base URL

```
# Qua Cloudflare Tunnel (Flutter / mobile)
REST:  https://api.kimbap.io.vn/api/v1/notifications
WS:    wss://api.kimbap.io.vn/notifications?token=<JWT_ACCESS_TOKEN>

# Local (không qua tunnel)
REST:  http://localhost:3001/api/v1/notifications
WS:    ws://localhost:3001/notifications?token=<JWT_ACCESS_TOKEN>
```

### 2.2 Headers (REST)

```
Authorization: Bearer <JWT_ACCESS_TOKEN>
Content-Type: application/json
```

### 2.3 Endpoints

#### GET `/notifications` — Lấy danh sách notification

**Query params:**

| Tham số | Kiểu | Mặc định | Mô tả |
|--------|------|----------|-------|
| `limit` | number | 20 | Số item tối đa (1–50) |
| `cursor` | string | — | Cursor từ lần gọi trước (pagination) |
| `onlyUnread` | boolean | false | Chỉ lấy chưa đọc |
| `tenantId` | string | — | Lọc theo tenant |

**Response:**

```json
{
  "success": true,
  "data": {
    "items": [NotificationItem, ...],
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI1..."
  }
}
```

- `nextCursor` = `null` hoặc không có → không còn trang tiếp
- `nextCursor` có giá trị → truyền vào `cursor` ở lần gọi tiếp theo

---

#### GET `/notifications/:id` — Xem chi tiết + tự động đánh dấu đã đọc

**Path params:**

| Tham số | Kiểu | Mô tả |
|--------|------|-------|
| `id` | string | ID của notification |

**Behavior:**
- Lấy chi tiết **1** notification của user hiện tại
- Nếu notification đang **chưa đọc** (`readAt = null`) → server **tự động** set `readAt` (chuyển unread → read)
- Nếu notification **không tồn tại hoặc không thuộc user** → trả `404`:
  ```json
  {
    "success": false,
    "error": { "code": "NOT_FOUND", "message": "Notification not found" }
  }
  ```

**Response:**

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "clx...",
      "type": "receipt_submitted",
      "title": "Phiếu nhập chờ duyệt",
      "body": "Admin đã gửi phiếu nhập PN-001",
      "readAt": "2026-08-19T02:00:00.000Z",
      "routeName": "stock_receipt_detail",
      "routeParams": { "receiptId": "abc123", "tenantId": "tenant-id" }
    },
    "unreadCount": 4
  }
}
```

- `item.readAt` — nếu trước đó chưa đọc, field này **đã được set** bởi server
- `unreadCount` — số thông báo chưa đọc **sau khi** đã đánh dấu, dùng để cập nhật badge ngay

**So với `POST /notifications/mark-read`:**
- `GET /:id` tiện cho luồng "tap vào thông báo → xem chi tiết" vì server tự đánh dấu đọc, frontend không cần gọi thêm request nào
- `POST /mark-read` vẫn dùng cho mark theo nhiều ID hoặc "đánh dấu tất cả"

---

#### GET `/notifications/unread-count` — Lấy số chưa đọc

**Response:**

```json
{
  "success": true,
  "data": { "count": 5 }
}
```

---

#### POST `/notifications/mark-read` — Đánh dấu đã đọc

**Body:**

```json
{
  "notificationIds": ["abc123", "def456"],
  "markAll": false,
  "tenantId": "optional-tenant-id"
}
```

- `notificationIds` + `markAll: false` → đánh dấu theo ID cụ thể
- `markAll: true` → đánh dấu tất cả chưa đọc
- `tenantId` → lọc theo tenant (optional)

**Response:**

```json
{
  "success": true,
  "data": {
    "updated": 3,
    "unreadCount": 2
  }
}
```

---

## 3. WebSocket Protocol

### 3.1 Kết nối

```
ws://<host>:3001/notifications?token=<JWT_ACCESS_TOKEN>
```

- Token truyền qua query param `token`
- Nếu token không hợp lệ → server trả `401` và đóng kết nối

### 3.2 Message từ server → client

#### NOTIFICATION_NEW

```json
{
  "type": "NOTIFICATION_NEW",
  "data": { ...NotificationItem },
  "unreadCount": 6
}
```

| Field | Kiểu | Mô tả |
|-------|------|-------|
| `type` | string | Luôn là `"NOTIFICATION_NEW"` |
| `data` | NotificationItem | Chi tiết notification |
| `unreadCount` | number | Tổng số chưa đọc (đã cập nhật) |

#### PONG

```json
{ "type": "PONG" }
```

- Server phản hồi khi client gửi `PING`
- Dùng để xác nhận kết nối còn sống

### 3.3 Message từ client → server

#### PING

```json
{ "type": "PING" }
```

- Client nên gửi mỗi **25 giây**
- Server sẽ phản hồi `PONG`
- Nếu không nhận `PONG` trong 60s → coi là mất kết nối → reconnect

### 3.4 Server-side heartbeat

- Server gửi `ws.ping()` mỗi **30 giây**
- Nếu không nhận activity (message/pong) trong **60 giây** → server `terminate()` socket
- Client cần phản hồi activity để không bị đóng

---

## 4. Cấu trúc dữ liệu

### 4.1 NotificationItem

```typescript
interface NotificationItem {
  id: string;
  type: string;              // "receipt_submitted", "issue_approved", ...
  title: string;
  body: string;
  tenantId: string | null;
  readAt: string | null;     // ISO 8601 hoặc null nếu chưa đọc
  createdAt: string;         // ISO 8601
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;  // "stock_receipt", "stock_issue", ...
  targetId: string | null;
  routeName: string | null;   // "stock_receipt_detail", ...
  routeParams: Record<string, string> | null;
  deeplink: string | null;    // "myapp://stock-receipts/abc123"
  sourceType: string | null;
  sourceId: string | null;
  data: Record<string, unknown> | null;
}
```

### 4.2 Danh sách `type` có thể nhận

| `type` | `targetType` | `routeName` | Mô tả |
|--------|-------------|------------|-------|
| `invitation_created` | `tenant_invitation` | — | Lời mời vào tenant |
| `invitation_accepted` | `tenant_invitation` | — | Lời mời được chấp nhận |
| `membership_removed` | `tenant_list` | — | Thành viên bị xóa |
| `receipt_submitted` | `stock_receipt` | `stock_receipt_detail` | Phiếu nhập chờ duyệt |
| `receipt_approved` | `stock_receipt` | `stock_receipt_detail` | Phiếu nhập đã duyệt |
| `receipt_rejected` | `stock_receipt` | `stock_receipt_detail` | Phiếu nhập bị từ chối |
| `receipt_completed` | `stock_receipt` | `stock_receipt_detail` | Phiếu nhập hoàn tất |
| `receipt_cancelled` | `stock_receipt` | `stock_receipt_detail` | Phiếu nhập bị hủy |
| `issue_submitted` | `stock_issue` | `stock_issue_detail` | Phiếu xuất chờ duyệt |
| `issue_approved` | `stock_issue` | `stock_issue_detail` | Phiếu xuất đã duyệt |
| `issue_rejected` | `stock_issue` | `stock_issue_detail` | Phiếu xuất bị từ chối |
| `issue_completed` | `stock_issue` | `stock_issue_detail` | Phiếu xuất hoàn tất |
| `issue_cancelled` | `stock_issue` | `stock_issue_detail` | Phiếu xuất bị hủy |

### 4.3 `routeParams` theo `routeName`

| `routeName` | `routeParams` |
|-------------|---------------|
| `stock_receipt_detail` | `{ receiptId: string, tenantId: string }` |
| `stock_issue_detail` | `{ issueId: string, tenantId: string }` |

### 4.4 `deeplink` format

```
myapp://stock-receipts/<receiptId>
myapp://stock-issues/<issueId>
```

---

## 5. Các luồng xử lý frontend cần làm

### 5.1 Luồng khởi tạo

```
App start / User login
    │
    ├─── 1. Gọi GET /notifications?limit=20  → load danh sách ban đầu
    ├─── 2. Gọi GET /notifications/unread-count → load unread badge
    └─── 3. Kết nối WebSocket
              │
              └─── Nếu thành công → lắng nghe NOTIFICATION_NEW
              └─── Nếu thất bại → retry sau 3s (backoff)
```

### 5.2 Luồng nhận notification realtime

```
WebSocket nhận NOTIFICATION_NEW
    │
    ├─── 1. Insert item vào đầu danh sách
    ├─── 2. Cập nhật unreadCount = giá trị từ message
    ├─── 3. Rebuild UI:
    │        - Danh sách có item mới
    │        - Badge số unread cập nhật
    └─── 4. (Optional) Hiển thị toast/snackbar/banner in-app
              - Nếu user đang ở màn hình notification → không cần
              - Nếu user ở màn hình khác → hiển thị banner ngắn
```

### 5.3 Luồng phân trang (load more)

```
User cuộn đến cuối danh sách
    │
    ├─── Kiểm tra nextCursor có giá trị không
    │      └─── null → không còn gì để load
    │      └─── có → tiếp tục
    │
    ├─── Gọi GET /notifications?cursor=<nextCursor>&limit=20
    ├─── Append items vào cuối danh sách
    └─── Cập nhật nextCursor mới
```

### 5.4 Luồng đánh dấu đã đọc

```
User tap vào notification
    │
    ├─── 1. Navigate đến màn hình tương ứng (deeplink/route)
    │
    ├─── 2a. [Khuyến nghị] Gọi GET /notifications/:id
    │          → Server TỰ ĐỘNG đánh dấu đã đọc (set readAt)
    │          → Response: { item (đã có readAt), unreadCount }
    │
    ├─── 2b. [Thủ công] Gọi POST /notifications/mark-read
    │          { notificationIds: [item.id] }
    │
    ├─── 3. Cập nhật local state:
    │        - item.readAt = now (hoặc dùng readAt từ response)
    │        - unreadCount = response.unreadCount
    └─── 4. Rebuild UI (bỏ highlight, cập nhật badge)
```

### 5.5 Luồng đánh dấu tất cả đã đọc

```
User tap "Đánh dấu tất cả đã đọc"
    │
    ├─── Gọi POST /notifications/mark-read { markAll: true }
    ├─── Cập nhật local state:
    │        - Tất cả item.readAt = now
    │        - unreadCount = 0
    └── Rebuild UI
```

---

## 6. Quản lý state

### 6.1 State cần giữ

| State | Kiểu | Nguồn | Mục đích |
|-------|------|-------|----------|
| `items` | `List<NotificationItem>` | REST API + WS | Danh sách notification |
| `unreadCount` | `int` | REST API + WS | Badge số chưa đọc |
| `nextCursor` | `String?` | REST API | Pagination |
| `isLoading` | `bool` | local | Loading indicator |
| `isWsConnected` | `bool` | WS | Trạng thái kết nối |

### 6.2 Đề xuất architecture

```
┌──────────────────────────────────────────────────┐
│              NotificationProvider / Store         │
│                                                   │
│  ┌─────────────┐    ┌──────────────────────────┐  │
│  │  REST API   │    │  WebSocket Service        │  │
│  │  Service    │    │  - connect / disconnect   │  │
│  │  - list     │    │  - heartbeat (25s)        │  │
│  │  - unread   │    │  - reconnect (backoff)    │  │
│  │  - markRead │    │  - onMessage callback     │  │
│  └─────────────┘    └──────────────────────────┘  │
│                                                   │
│  State:                                           │
│  - items: List<NotificationItem>                   │
│  - unreadCount: int                                │
│  - nextCursor: String?                             │
│  - isLoading: bool                                  │
│  - isWsConnected: bool                             │
│                                                   │
│  Actions:                                          │
│  - init(token) → load + connect WS                │
│  - loadMore() → pagination                        │
│  - markAsRead(ids) → API + update local           │
│  - markAllAsRead() → API + update local           │
│  - dispose() → ngắt WS                            │
└──────────────────────────────────────────────────┘
```

### 6.3 unidirectional data flow

```
User action / WS event
        │
        ▼
   Provider Action
        │
        ├─── Gọi API / WS
        │
        ▼
   Cập nhật state
        │
        ▼
   notifyListeners() / setState()
        │
        ▼
   UI rebuild
```

---

## 7. Xử lý routing / deeplink

### 7.1 Thứ tự ưu tiên

```
1. Deeplink (nếu có)
      ↓ myapp://stock-receipts/abc123
      ↓ Parse → navigate

2. routeName + routeParams (nếu không có deeplink)
      ↓ routeName = "stock_receipt_detail"
      ↓ routeParams = { receiptId: "abc123" }
      ↓ Lookup table → navigate

3. Không có cả hai → hiển thị notification detail chung
```

### 7.2 Bảng ánh xạ route

| `routeName` | Route trong app | Params cần |
|-------------|-----------------|------------|
| `stock_receipt_detail` | `/receipts/:receiptId` | `receiptId` |
| `stock_issue_detail` | `/issues/:issueId` | `issueId` |

### 7.3 Deeplink scheme

```
myapp://stock-receipts/<id>   → /receipts/<id>
myapp://stock-issues/<id>     → /issues/<id>
```

### 7.4 Logic xử lý

```dart
void handleNotificationTap(NotificationItem item, Router router) {
  // 1. Thử deeplink
  if (item.deeplink != null) {
    final uri = Uri.parse(item.deeplink!);
    switch (uri.host) {
      case 'stock-receipts':
        router.push('/receipts/${uri.pathSegments.first}');
        return;
      case 'stock-issues':
        router.push('/issues/${uri.pathSegments.first}');
        return;
    }
  }

  // 2. Thử routeName
  if (item.routeName != null) {
    switch (item.routeName) {
      case 'stock_receipt_detail':
        router.push('/receipts/${item.routeParams?['receiptId']}');
        return;
      case 'stock_issue_detail':
        router.push('/issues/${item.routeParams?['issueId']}');
        return;
    }
  }

  // 3. Fallback
  router.push('/notifications/${item.id}');
}
```

---

## 8. Lifecycle và reconnect

### 8.1 App lifecycle

| Trạng thái | Hành động |
|------------|-----------|
| App mở (foreground) | Kết nối WS, lắng nghe realtime |
| App ẩn (background) | Ngắt WS để tiết kiệm pin/data |
| App quay lại (resumed) | Reconnect WS + reload unread count |
| User logout | Ngắt WS, clear state |
| User login | Init state + kết nối WS |

### 8.2 Reconnect strategy

```
WS mất kết nối
    │
    ├─── Lần 1: đợi 3s → reconnect
    ├─── Lần 2: đợi 5s → reconnect
    ├─── Lần 3: đợi 10s → reconnect
    ├─── Lần 4+: đợi 30s → reconnect
    │
    └─── Khi reconnect thành công:
         - Reload unread count (đồng bộ lại)
         - Resume lắng nghe
```

### 8.3 Token hết hạn

```
WS connect fail (401)
    │
    ├─── Refresh token
    ├─── Nếu refresh OK → reconnect với token mới
    └─── Nếu refresh fail → logout user
```

---

## 9. Edge cases

### 9.1 Notification đến khi đang ở màn hình notification

```
→ KHÔNG hiển thị banner/toast
→ Chỉ insert vào đầu danh sách
→ User sẽ thấy trực tiếp
```

### 9.2 Notification đến khi ở màn hình khác

```
→ Hiển thị in-app banner (top sheet / snackbar)
→ User có thể tap để navigate
→ Hoặc dismiss để bỏ qua
```

### 9.3 Notification đến khi app ở background

```
→ WS không hoạt động khi background
→ Cần FCM (Firebase Cloud Messaging) cho push notification background
→ Backend hiện đã có firebase-admin
→ Khi user mở app lại:
  - Reconnect WS
  - Reload danh sách + unread count
  - Đồng bộ lại state
```

### 9.4 Multiple tab / multiple device

```
→ Mỗi tab/device có 1 WS connection riêng
→ Server dùng userId làm key, broadcast tới tất cả connection
→ Tất cả tab đều nhận notification
→ Đánh dấu đã đọc ở tab A → tab B cần đồng bộ
→ Giải pháp: khi markRead xong, WS không push "read" event
  → Tab B nên poll unreadCount định kỳ hoặc reload khi focus
```

### 9.5 Danh sách dài / performance

```
→ Sử dụng lazy loading + cursor pagination
→ Không load toàn bộ notification
→ Giới hạn số item render (ListView.builder với virtual scrolling)
→ Cache item đã load để không gọi lại API
```

### 9.6 Offsets giữa WS và REST

```
→ WS push unreadCount mới (đã tính item vừa push)
→ REST GET unread-count có thể cache 60s
→ Có thể lệch nhỏ giữa WS và REST trong 60s
→ Ưu tiên giá trị từ WS khi có, fallback REST khi WS chưa kết nối
```

---

## 10. Checklist triển khai

### Models / Data Layer

- [ ] Tạo model `NotificationItem` từ JSON
- [ ] Tạo model `WsInboundMessage` (NOTIFICATION_NEW, PONG)
- [ ] Tạo model `WsOutboundMessage` (PING)
- [ ] Tạo enum / mapping cho `type` → display label

### REST API

- [ ] `list({ cursor, onlyUnread, limit })` → GET `/notifications`
- [ ] `getUnreadCount()` → GET `/notifications/unread-count`
- [ ] `getDetail(id)` → GET `/notifications/:id` (tự động đánh dấu đã đọc)
- [ ] `markRead({ notificationIds })` → POST `/notifications/mark-read`
- [ ] `markAllAsRead()` → POST `/notifications/mark-read { markAll: true }`

### WebSocket

- [ ] Connect với token qua query param
- [ ] Heartbeat: gửi PING mỗi 25s
- [ ] Lắng nghe NOTIFICATION_NEW
- [ ] Reconnect với backoff khi mất kết nối
- [ ] Xử lý token hết hạn → refresh → reconnect
- [ ] Disconnect khi app background / user logout

### State Management

- [ ] State: `items`, `unreadCount`, `nextCursor`, `isLoading`, `isWsConnected`
- [ ] Action: `init(token)` — load ban đầu + connect WS
- [ ] Action: `loadMore()` — pagination
- [ ] Action: `markAsRead(ids)` — API + update local
- [ ] Action: `markAllAsRead()` — API + update local
- [ ] Action: `dispose()` — ngắt WS, clear state
- [ ] WS event → insert item + cập nhật unreadCount + rebuild UI

### UI

- [ ] Danh sách notification (ListView với pagination)
- [ ] Badge unread trên icon notification
- [ ] In-app banner khi nhận notification (nếu không ở màn hình notification)
- [ ] Tap notification → navigate (deeplink/routeName)
- [ ] Tap → gọi `GET /notifications/:id` (tự động mark-read) hoặc `markAsRead` + bỏ highlight
- [ ] "Đánh dấu tất cả đã đọc" button
- [ ] Loading indicator khi load more
- [ ] Empty state khi không có notification
- [ ] Phân biệt đã đọc / chưa đọc (background color / icon)

### Routing

- [ ] Parse deeplink `myapp://stock-receipts/<id>` → navigate
- [ ] Lookup `routeName` + `routeParams` → navigate
- [ ] Fallback màn hình notification detail chung

### Lifecycle

- [ ] Foreground → connect WS
- [ ] Background → disconnect WS
- [ ] Resumed → reconnect WS + reload unread count
- [ ] Login → init notifications
- [ ] Logout → dispose notifications

### Edge Cases

- [ ] Token hết hạn → refresh → reconnect
- [ ] WS mất kết nối → reconnect backoff
- [ ] Multiple tab → đồng bộ unread khi focus
- [ ] App background → cần FCM (nếu muốn push notification)

---

## 11. Phụ thuộc cần thiết

### Flutter

```yaml
# pubspec.yaml
dependencies:
  web_socket_channel: ^3.0.1   # WebSocket client
  http: ^1.2.0                  # REST API
  provider: ^6.1.2              # State management (hoặc riverpod / bloc)
  go_router: ^14.0.0            # Routing (hoặc auto_route)
```

### Web (React / Vue / Angular)

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "axios": "^1.7.0"
  }
}
```

- WebSocket native `WebSocket` API
- REST: `axios` hoặc `fetch`
- State: Redux / Pinia / Zustand / NgRx

---

## 12. Tóm tắt

| Phần | Frontend cần làm | Backend đã có |
|------|-----------------|---------------|
| Realtime | Kết nối WS, lắng nghe NOTIFICATION_NEW | WS server + Redis pub/sub relay |
| Danh sách | Gọi REST list + cursor pagination | REST GET /notifications |
| Unread badge | Dùng unreadCount từ WS + REST fallback | REST + WS field |
| Đánh dấu đã đọc | Gọi REST mark-read + update local | REST POST /mark-read |
| Xem chi tiết + tự động đánh dấu đã đọc | Gọi REST GET /notifications/:id | REST GET /notifications/:id (server tự set readAt) |
| Routing | Parse deeplink / routeName → navigate | Payload có sẵn deeplink + routeName |
| Heartbeat | Gửi PING mỗi 25s | Server ping mỗi 30s, timeout 60s |
| Reconnect | Backoff retry + token refresh | Server accept reconnect bất cứ lúc nào |
| Background push | (Optional) FCM integration | firebase-admin đã có sẵn |

---

> **Lưu ý quan trọng:** WebSocket chỉ hoạt động khi app đang mở.  
> Nếu cần notification khi app ở background, cần tích hợp thêm FCM (Firebase Cloud Messaging).  
> Backend đã có `firebase-admin` sẵn, chỉ cần thêm endpoint gửi FCM push.
