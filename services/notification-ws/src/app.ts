/**
 * Factory tạo Express Application cho notification-ws.
 *
 * Chỉ chứa REST API đọc/đánh dấu thông báo + healthcheck.
 * Không chứa WebSocket — WS được gắn ở index.ts lên cùng http.Server.
 */
import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from '../../../src/config/env';
import { prisma } from '../../../src/infra/prisma';
import { getRedis } from '../../../src/infra/redis';
import { errorHandler, notFoundHandler } from '../../../src/middlewares/errorHandler';
import { RedisNotifCache } from './infra/redis-notif-cache';
import { NotificationService } from './modules/notification.service';
import { createNotificationRoutes } from './modules/notification.routes';

/**
 * Tạo và cấu hình Express app: bảo mật, CORS, JSON, routes, error handler.
 * @returns Application đã sẵn sàng gắn vào http.createServer()
 */
export function createApp(): Application {
  const app = express();

  // Helmet: header bảo mật HTTP. Tắt CORP/COEP vì client (app/web) gọi cross-origin.
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  // CORS: chỉ cho origin trong env, credentials=true để gửi cookie/Authorization
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  // Parse JSON body cho POST /mark-read
  app.use(express.json());

  // Healthcheck cho k8s/load balancer — không cần auth
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'notification-ws' });
  });

  // Cache Redis (có thể null nếu Redis down) + service nghiệp vụ
  const cache = new RedisNotifCache(getRedis());
  const notificationService = new NotificationService(prisma, cache);

  // REST thông báo: unread-count, list, detail, mark-read
  app.use('/api/v1/notifications', createNotificationRoutes(notificationService));

  // 404 cho path không khớp, rồi errorHandler chuẩn hóa AppError → JSON
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
