# Hướng dẫn frontend dùng WebSocket cho notification

> Backend notification-ws hiện **hỗ trợ song song 2 giao thức**:
> - raw WebSocket: `wss://api.kimbap.io.vn/notifications?token=<ACCESS_TOKEN>` (local: `ws://localhost:3001/notifications?...`)
> - Socket.IO: `wss://api.kimbap.io.vn/socket.io/` (local: `ws://localhost:3001/socket.io/`)

---

## 1. Hai cách kết nối đều được hỗ trợ

| Cách | URL | Ghi chú |
|------|-----|---------|
| Raw WebSocket (`ws`) | `wss://api.kimbap.io.vn/notifications?token=<ACCESS_TOKEN>` | Khuyến nghị (tunnel) |
| Socket.IO client | `https://api.kimbap.io.vn` + `path: '/socket.io'` | Client gửi `token` qua `query` hoặc `auth` |
| Local (không tunnel) | `ws://localhost:3001/...` | Dev máy local |

Cả hai đều dùng **cùng access token**, cùng format message bên dưới.

### Nếu client gọi vào `/socket.io/?...` mà bị reject

Trước đây backend chỉ nhận path `/notifications` nên mọi kết nối `/socket.io/` bị reject:

```text
[ws] upgrade rejected — path mismatch: /socket.io/?...
```

Từ bản cập nhật này backend đã gắn Socket.IO server vào path `/socket.io/`, nên socket.io-client kết nối được bình thường (đồng thời vẫn giữ raw WebSocket `/notifications`).

---

## 2. Protocol phía backend

### Client gửi lên server

```json
{ "type": "PING" }
```

### Server phản hồi

```json
{ "type": "PONG" }
```

### Notification mới từ server

```json
{
  "type": "NOTIFICATION_NEW",
  "data": { ...notificationItem },
  "unreadCount": 5
}
```

---

## 4. Cách kết nối đúng

### 4.1 Token cần dùng

Dùng **access token** của user đang đăng nhập.

- Không dùng refresh token
- Token phải còn hạn
- Token phải khớp `tokenVersion` trong DB
- User phải còn active

---

## 5. Ví dụ Flutter

### 5.1 Cài dependency

```yaml
dependencies:
  web_socket_channel: ^3.0.1
```

### 5.2 Client WebSocket

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

class NotificationWsClient {
  WebSocket? _socket;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  bool _disposed = false;

  final String token;
  final void Function(Map<String, dynamic> payload) onNotification;
  final void Function(int unreadCount)? onUnreadCount;
  final void Function()? onConnected;
  final void Function()? onDisconnected;

  NotificationWsClient({
    required this.token,
    required this.onNotification,
    this.onUnreadCount,
    this.onConnected,
    this.onDisconnected,
  });

  Future<void> connect() async {
    if (_disposed) return;

    final uri = Uri.parse('wss://api.kimbap.io.vn/notifications?token=$token');

    try {
      _socket = await WebSocket.connect(uri.toString());
      onConnected?.call();

      _socket!.listen(
        (event) {
          try {
            final msg = jsonDecode(event as String) as Map<String, dynamic>;
            final type = msg['type'] as String?;

            if (type == 'NOTIFICATION_NEW') {
              onNotification(msg);
              final unreadCount = msg['unreadCount'] as int?;
              if (unreadCount != null) {
                onUnreadCount?.call(unreadCount);
              }
            }
          } catch (_) {
            // Ignore invalid JSON payload
          }
        },
        onDone: _handleDisconnect,
        onError: (_) => _handleDisconnect(),
      );

      _startHeartbeat();
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _startHeartbeat() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      _socket?.add(jsonEncode({'type': 'PING'}));
    });
  }

  void _handleDisconnect() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _socket = null;
    onDisconnected?.call();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed) return;

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), () {
      void reconnect() async {
        await connect();
      }

      reconnect();
    });
  }

  void dispose() {
    _disposed = true;
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _socket?.close();
    _socket = null;
  }
}
```

### 5.3 Cách dùng trong app

```dart
final client = NotificationWsClient(
  token: accessToken,
  onNotification: (payload) {
    print('New notification: $payload');
  },
  onUnreadCount: (count) {
    print('Unread count: $count');
  },
);

await client.connect();
```

---

## 6. Ví dụ Web / React

### 6.1 Dùng native WebSocket

```ts
const token = accessToken;
const ws = new WebSocket(`ws://localhost:3001/notifications?token=${token}`);

ws.onopen = () => {
  console.log('connected');

  setInterval(() => {
    ws.send(JSON.stringify({ type: 'PING' }));
  }, 25000);
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'NOTIFICATION_NEW') {
    console.log('notification', msg.data);
    console.log('unreadCount', msg.unreadCount);
  }

  if (msg.type === 'PONG') {
    console.log('pong');
  }
};

ws.onclose = () => {
  console.log('disconnected');
};

ws.onerror = (err) => {
  console.error('ws error', err);
};
```

### 6.2 Không dùng `socket.io-client`

```ts
// Sai cho backend hiện tại
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  transports: ['websocket'],
  auth: { token },
});
```

Code trên sẽ luôn gọi vào `/socket.io/`, trong khi backend hiện tại không hỗ trợ Socket.IO.

---

## 7. Những gì frontend cần làm

### 7.1 Ở màn hình app start / login thành công

1. Lấy access token
2. Gọi REST API để load notification ban đầu
3. Gọi REST API để lấy unread count
4. Mở WebSocket realtime

### 7.2 Khi nhận `NOTIFICATION_NEW`

- Thêm notification mới vào đầu danh sách
- Cập nhật badge unread
- Nếu đang ở trang khác, có thể hiển thị toast/banner

### 7.3 Khi user tap notification

- Navigate đến màn hình liên quan
- Gọi `GET /api/v1/notifications/:id` → server **tự động** đánh dấu đã đọc, trả về `{ item, unreadCount }`
- (Hoặc gọi `POST /api/v1/notifications/mark-read` nếu muốn mark thủ công)
- Contract REST đầy đủ + checklist lỗi FE: [NOTIFICATION_REST_CLIENT_GUIDE.md](./NOTIFICATION_REST_CLIENT_GUIDE.md)
- Cập nhật local state

### 7.4 Khi app background / logout

- Ngắt kết nối WebSocket
- Clear timer heartbeat
- Clear state nếu logout

---

## 8. REST API frontend cần gọi

### 8.1 Lấy danh sách

```http
GET /api/v1/notifications?limit=20
Authorization: Bearer <token>
```

### 8.2 Lấy unread count

```http
GET /api/v1/notifications/unread-count
Authorization: Bearer <token>
```

### 8.3 Xem chi tiết + tự động đánh dấu đã đọc (khi tap thông báo)

```http
GET /api/v1/notifications/:id
Authorization: Bearer <token>
```

- Server **tự động** set `readAt` nếu notification đang chưa đọc
- Trả về `{ item, unreadCount }` để cập nhật UI/badge ngay
- Không tìm thấy hoặc không thuộc user → `404 NOT_FOUND`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "clx...",
      "readAt": "2026-08-19T02:00:00.000Z"
    },
    "unreadCount": 4
  }
}
```

### 8.4 Đánh dấu đã đọc (nhiều item / mark all)

```http
POST /api/v1/notifications/mark-read
Authorization: Bearer <token>
Content-Type: application/json

{
  "notificationIds": ["id1", "id2"]
}
```

Hoặc:

```json
{
  "markAll": true
}
```

---

## 9. Các lỗi thường gặp

### 9.1 `path mismatch: /socket.io/`

**Nguyên nhân:** frontend còn dùng Socket.IO.

**Cách sửa:** chuyển sang raw WebSocket với URL `/notifications`.

---

### 9.2 `401 Unauthorized`

**Nguyên nhân thường gặp:**
- token sai
- token hết hạn
- token bị revoke
- user inactive

**Cách sửa:** login lại hoặc refresh token rồi reconnect.

---

### 9.3 Không nhận được notification

**Kiểm tra:**
- notification-ws service có đang chạy không
- frontend có connect đúng URL không
- token có hợp lệ không
- backend logs có `upgrade accepted` không

---

## 10. Checklist chuyển frontend sang raw WebSocket

- [ ] Xóa `socket.io-client`
- [ ] Dùng `WebSocket` native hoặc `web_socket_channel`
- [ ] Kết nối tới `/notifications?token=...`
- [ ] Gửi `PING` định kỳ 25 giây
- [ ] Xử lý `NOTIFICATION_NEW`
- [ ] Cập nhật unread badge
- [ ] Reload state khi reconnect
- [ ] Ngắt socket khi logout/background
- [ ] Dùng REST API cho list / detail (tự động mark-read) / mark read

---

## 11. Kết luận

Backend hiện tại **không dùng Socket.IO**. Nếu frontend dùng Socket.IO client thì sẽ luôn lỗi kết nối.

Cách đúng là:

- dùng **raw WebSocket**
- connect vào **`/notifications`**
- truyền **access token** qua query param
- tự xử lý **PING/PONG**, reconnect, và state update ở frontend

Nếu muốn giữ Socket.IO ở frontend thì phải đổi backend notification-ws sang Socket.IO server, nhưng hiện tại hướng hợp lý nhất là **đổi frontend sang raw WebSocket**.
