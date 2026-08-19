import http from 'http';
import { env } from '../../../src/config/env';
import { connectDatabase, closeDatabase } from '../../../src/infra/prisma';
import { connectRedis, closeRedis, getRedis } from '../../../src/infra/redis';
import { createApp } from './app';
import { startNotificationConsumer } from './kafka/consumer';
import { attachWebSocketServer } from './ws/server';
import { attachSocketIoServer } from './ws/socketio-server';
import { NotificationPushRelay } from './ws/push-relay';

async function main() {
  await connectDatabase();
  try {
    await connectRedis();
  } catch (err) {
    console.warn('[notification-ws] Redis unavailable, continuing without cache:', err);
  }

  const app = createApp();
  const server = http.createServer(app);
  attachWebSocketServer(server, '/notifications');
  attachSocketIoServer(server);

  const relay = new NotificationPushRelay(getRedis());
  await relay.start();

  const stopConsumer = await startNotificationConsumer(getRedis(), relay);

  server.listen(env.NOTIFICATION_WS_PORT, () => {
    console.log(`Notification WS service listening on port ${env.NOTIFICATION_WS_PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down notification-ws...');
    await stopConsumer();
    await relay.stop();
    server.close();
    await closeRedis();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[notification-ws] failed to start:', err);
  process.exit(1);
});
