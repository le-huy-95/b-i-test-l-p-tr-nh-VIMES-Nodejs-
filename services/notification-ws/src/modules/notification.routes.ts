import { Router } from 'express';
import { asyncHandler } from '../../../../src/middlewares/errorHandler';
import { authMiddleware } from '../middlewares/auth';
import { NotificationController } from './notification.controller';
import type { NotificationService } from './notification.service';

export function createNotificationRoutes(service: NotificationService): Router {
  const router = Router();
  const controller = new NotificationController(service);

  router.use(authMiddleware);
  router.get('/unread-count', asyncHandler(controller.unreadCount));
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.detail));
  router.post('/mark-read', asyncHandler(controller.markRead));

  return router;
}
