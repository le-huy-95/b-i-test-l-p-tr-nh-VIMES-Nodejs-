/**
 * Điểm vào (entrypoint) của microservice notification-ws.
 *
 * Nhiệm vụ:
 * 1. Kết nối Postgres + Redis
 * 2. Tạo HTTP server (REST API thông báo)
 * 3. Gắn WebSocket thuần và Socket.IO để đẩy realtime
 * 4. Khởi động Redis Pub/Sub relay (đẩy đa instance)
 * 5. Khởi động Kafka consumer (nhận sự kiện tạo thông báo)
 * 6. Đăng ký graceful shutdown khi nhận SIGINT / SIGTERM
 */
import http from 'http';
import { clearLocalhostProxyEnv } from '../../../src/config/clear-localhost-proxy';
import { env } from '../../../src/config/env';
import { connectDatabase, closeDatabase } from '../../../src/infra/prisma';
import { connectRedis, closeRedis, getRedis } from '../../../src/infra/redis';
import { createApp } from './app';
import { startNotificationConsumer } from './kafka/consumer';
import { attachWebSocketServer } from './ws/server';
import { attachSocketIoServer } from './ws/socketio-server';
import { NotificationPushRelay } from './ws/push-relay';

clearLocalhostProxyEnv();

/**
 * Khởi động toàn bộ vòng đời service: infra → HTTP/WS → consumer → listen.
 */
async function main() {
  // Kết nối Prisma/Postgres — bắt buộc, không có DB thì service không chạy được
  await connectDatabase();
  try {
    // Redis dùng cho cache unread/list + Pub/Sub đẩy realtime đa process
    await connectRedis();
  } catch (err) {
    // Redis lỗi thì vẫn chạy, chỉ mất cache và đẩy cross-instance
    console.warn('[notification-ws] Redis unavailable, continuing without cache:', err);
  }

  // Express app: REST /health + /api/v1/notifications
  const app = createApp();
  // Dùng http.Server (không phải app.listen) để vừa phục vụ HTTP vừa nâng cấp WebSocket
  const server = http.createServer(app);
  // WebSocket thuần tại path /notifications (Flutter/web có thể dùng ws://)
  attachWebSocketServer(server, '/notifications');
  // Socket.IO tại /socket.io (hỗ trợ polling fallback)
  attachSocketIoServer(server);

  // Relay: instance này publish/subscribe kênh Redis để mọi process đều đẩy được WS
  const relay = new NotificationPushRelay(getRedis());
  await relay.start();

  // Kafka consumer: nhận event → tạo Notification trong DB → đẩy WS qua relay
  const stopConsumer = await startNotificationConsumer(getRedis(), relay);

  // Lắng nghe cổng riêng của notification-ws (tách khỏi API chính)
  server.listen(env.NOTIFICATION_WS_PORT, () => {
    console.log(`Notification WS service listening on port ${env.NOTIFICATION_WS_PORT}`);
  });

  /**
   * Tắt tuần tự: dừng Kafka → dừng Redis subscriber → đóng HTTP → đóng Redis/DB.
   * Tránh mất message đang xử lý và rò connection.
   */
  const shutdown = async () => {
    console.log('Shutting down notification-ws...');
    await stopConsumer();
    await relay.stop();
    server.close();
    await closeRedis();
    await closeDatabase();
    process.exit(0);
  };

  // Ctrl+C khi dev
  process.on('SIGINT', shutdown);
  // Kubernetes / docker stop
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[notification-ws] failed to start:', err);
  process.exit(1);
});
