import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WsInboundMessage } from '../dto/notification.dto';
import { connectionManager, type WsPeer } from './connection-manager';
import { extractWsToken, verifyWsToken } from './auth';
import { SOCKET_IO_PATH } from './socketio-server';

type ManagedWebSocket = WebSocket & { _lastSeen?: number };

const HEARTBEAT_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

function markAlive(ws: ManagedWebSocket): void {
  ws._lastSeen = Date.now();
}

function toPeer(ws: WebSocket): WsPeer {
  return {
    send: (payload: string) => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    },
    isOpen: () => ws.readyState === ws.OPEN,
  };
}

export function attachWebSocketServer(server: Server, path = '/notifications'): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = req.url ?? '';

    if (url.startsWith(SOCKET_IO_PATH)) {
      return;
    }

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

  wss.on('close', () => clearInterval(interval));

  return wss;
}
