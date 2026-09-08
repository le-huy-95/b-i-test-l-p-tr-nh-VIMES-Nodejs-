/**
 * WebSocket thuần (thư viện `ws`) gắn vào HTTP server tại path /notifications.
 *
 * Luồng:
 * 1. Client gửi HTTP Upgrade kèm JWT (query ?token= hoặc Authorization)
 * 2. Verify JWT → 401 nếu sai
 * 3. connectionManager.add(userId) để push sau này
 * 4. PING/PONG application-level + heartbeat TCP ping mỗi 30s
 * 5. Idle > 60s thì terminate (client chết / NAT timeout)
 *
 * Lưu ý: upgrade tới /socket.io được bỏ qua để Socket.IO tự xử lý.
 */
import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WsInboundMessage } from '../dto/notification.dto';
import { connectionManager, type WsPeer } from './connection-manager';
import { extractWsToken, verifyWsToken } from './auth';
import { SOCKET_IO_PATH } from './socketio-server';

/** WebSocket cộng thêm mốc thời gian lần cuối nhận traffic (message/pong). */
type ManagedWebSocket = WebSocket & { _lastSeen?: number };

/** Chu kỳ gửi ping TCP xuống client. */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Không có traffic quá lâu → coi như chết, đóng socket. */
const IDLE_TIMEOUT_MS = 60_000;

/** Cập nhật _lastSeen = now, dùng cho idle check. */
function markAlive(ws: ManagedWebSocket): void {
  ws._lastSeen = Date.now();
}

/**
 * Bọc raw WebSocket thành WsPeer thống nhất với Socket.IO.
 * ConnectionManager không cần biết protocol bên dưới.
 */
function toPeer(ws: WebSocket): WsPeer {
  return {
    send: (payload: string) => {
      // Chỉ gửi khi socket còn OPEN, tránh throw khi đang đóng
      if (ws.readyState === ws.OPEN) ws.send(payload);
    },
    isOpen: () => ws.readyState === ws.OPEN,
  };
}

/**
 * Gắn WSS noServer=true rồi tự handle event 'upgrade' của HTTP server.
 * @param path path URL phải bắt đầu bằng giá trị này (mặc định /notifications)
 */
export function attachWebSocketServer(server: Server, path = '/notifications'): WebSocketServer {
  // noServer: không tự listen, chia sẻ cổng với Express
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = req.url ?? '';

    // Nhường Socket.IO: nếu tự handleUpgrade sẽ phá handshake Engine.IO
    if (url.startsWith(SOCKET_IO_PATH)) {
      return;
    }

    // Path khác (ví dụ health) không phải WS của ta
    if (!url.startsWith(path)) {
      return;
    }

    try {
      const token = extractWsToken(url, req.headers as Record<string, string | string[] | undefined>);
      const auth = token ? await verifyWsToken(token) : null;
      if (!auth) {
        console.warn('[ws] upgrade rejected — invalid or missing token');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      console.log(`[ws] upgrade accepted — userId: ${auth.userId}`);

      // Hoàn tất handshake WS rồi emit 'connection' kèm userId đã verify
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, auth.userId);
      });
    } catch (err) {
      console.error('[ws] upgrade error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    const managedWs = ws as ManagedWebSocket;
    markAlive(managedWs);
    const peer = toPeer(ws);
    // Đăng ký để Kafka/relay có thể push NOTIFICATION_NEW tới user này
    connectionManager.add(userId, peer);

    ws.on('message', (raw) => {
      markAlive(managedWs);
      try {
        const msg = JSON.parse(raw.toString()) as WsInboundMessage;
        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    // Trả lời ping TCP của server (thư viện ws tự emit 'pong')
    ws.on('pong', () => {
      markAlive(managedWs);
    });

    ws.on('close', (code, reason) => {
      console.log(`[ws] connection closed — userId: ${userId}, code: ${code}, reason: ${reason.toString() || 'n/a'}`);
      connectionManager.remove(userId, peer);
    });

    ws.on('error', (err) => {
      console.error(`[ws] socket error for userId ${userId}:`, err);
      connectionManager.remove(userId, peer);
    });
  });

  // Heartbeat: ping client còn sống; idle quá lâu thì terminate
  const interval = setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((ws) => {
      const managedWs = ws as ManagedWebSocket;
      const idle = now - (managedWs._lastSeen ?? now);
      if (idle > IDLE_TIMEOUT_MS) {
        ws.terminate();
        return;
      }
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Tránh interval chạy mãi sau khi WSS đóng (shutdown)
  wss.on('close', () => clearInterval(interval));

  return wss;
}
