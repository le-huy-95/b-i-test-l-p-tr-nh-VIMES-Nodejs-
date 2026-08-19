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

export function createApp(): Application {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'notification-ws' });
  });

  const cache = new RedisNotifCache(getRedis());
  const notificationService = new NotificationService(prisma, cache);

  app.use('/api/v1/notifications', createNotificationRoutes(notificationService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
