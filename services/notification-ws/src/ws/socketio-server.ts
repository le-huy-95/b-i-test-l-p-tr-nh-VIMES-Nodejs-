/**
 * Socket.IO server — alternative realtime cho client không dùng WS thuần
 * (web browser, fallback polling khi WS bị proxy chặn).
 *
 * Auth: JWT trong handshake.query.token hoặc handshake.auth.token.
 * Peer được đăng vào cùng ConnectionManager với WS thuần → push 1 lần là tới cả hai.
 */
import type { Server as HttpServer } from 'http';
import { Server as SocketIoServer, type Socket } from 'socket.io';
import { env } from '../../../../src/config/env';
import type { WsInboundMessage, WsOutboundMessage } from '../dto/notification.dto';
import { verifyWsToken } from './auth';
import { connectionManager } from './connection-manager';

/** Path Engine.IO; ws/server.ts phải skip upgrade này. */
export const SOCKET_IO_PATH = '/socket.io';

/** Tách CORS_ORIGINS (csv) thành mảng origin cho Socket.IO. */
function corsOrigins(): string[] {
  return env.CORS_ORIGINS.split(',').map((o) => o.trim());
}

/**
 * Lấy JWT từ handshake.
 * Ưu tiên query.token (dễ gắn URL), sau đó auth.token (Socket.IO v4 chuẩn).
 */
function resolveToken(socket: Socket): string | null {
  const query = socket.handshake.query.token;
  if (typeof query === 'string' && query.length > 0) return query;

  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.length > 0) return auth.token;

  return null;
}

/**
 * Gắn Socket.IO lên cùng HTTP server (path /socket.io, CORS giống REST).
 */
export function attachSocketIoServer(server: HttpServer): SocketIoServer {
  const io = new SocketIoServer(server, {
    path: SOCKET_IO_PATH,
    // websocket trước, polling nếu upgrade thất bại
    transports: ['websocket', 'polling'],
    cors: {
      origin: corsOrigins(),
      credentials: true,
    },
  });

  // Middleware handshake: fail → client nhận 'unauthorized', không vào 'connection'
  io.use(async (socket, next) => {
    try {
      const token = resolveToken(socket);
      const auth = token ? await verifyWsToken(token) : null;
      if (!auth) {
        next(new Error('unauthorized'));
        return;
      }
      // Gắn userId vào socket.data cho handler connection
      socket.data.userId = auth.userId;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    console.log(`[socket.io] connected — userId: ${userId}, id: ${socket.id}`);

    const peer = {
      send: (payload: string) => socket.send(payload),
      isOpen: () => socket.connected,
    };
    connectionManager.add(userId, peer);

    const sendPong = (): void => {
      const pong: WsOutboundMessage = { type: 'PONG' };
      socket.send(JSON.stringify(pong));
    };

    /**
     * Client có thể gửi PING dạng event 'message' (JSON string/object)
     * hoặc event tên 'PING' — cả hai đều trả PONG.
     */
    const handleRaw = (raw: unknown): void => {
      try {
        const parsed =
          typeof raw === 'string'
            ? (JSON.parse(raw) as WsInboundMessage)
            : (raw as WsInboundMessage | null);
        if (parsed?.type === 'PING') {
          sendPong();
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.on('message', handleRaw);
    socket.on('PING', sendPong);

    socket.on('disconnect', (reason) => {
      console.log(`[socket.io] disconnected — userId: ${userId}, id: ${socket.id}, reason: ${reason}`);
      connectionManager.remove(userId, peer);
    });
  });

  return io;
}
