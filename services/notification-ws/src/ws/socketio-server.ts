import type { Server as HttpServer } from 'http';
import { Server as SocketIoServer, type Socket } from 'socket.io';
import { env } from '../../../../src/config/env';
import type { WsInboundMessage, WsOutboundMessage } from '../dto/notification.dto';
import { verifyWsToken } from './auth';
import { connectionManager } from './connection-manager';

export const SOCKET_IO_PATH = '/socket.io';

function corsOrigins(): string[] {
  return env.CORS_ORIGINS.split(',').map((o) => o.trim());
}

function resolveToken(socket: Socket): string | null {
  const query = socket.handshake.query.token;
  if (typeof query === 'string' && query.length > 0) return query;

  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.length > 0) return auth.token;

  return null;
}

export function attachSocketIoServer(server: HttpServer): SocketIoServer {
  const io = new SocketIoServer(server, {
    path: SOCKET_IO_PATH,
    transports: ['websocket', 'polling'],
    cors: {
      origin: corsOrigins(),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = resolveToken(socket);
      const auth = token ? await verifyWsToken(token) : null;
      if (!auth) {
        next(new Error('unauthorized'));
        return;
      }
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
