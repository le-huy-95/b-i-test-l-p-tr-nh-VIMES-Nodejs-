/**
 * Định nghĩa REST routes thông báo.
 * Tất cả endpoint đều đi qua authMiddleware (Bearer JWT).
 */
import { Router } from 'express';
import { asyncHandler } from '../../../../src/middlewares/errorHandler';
import { authMiddleware } from '../middlewares/auth';
import { NotificationController } from './notification.controller';
import type { NotificationService } from './notification.service';

/**
 * Tạo router gắn vào /api/v1/notifications.
 * asyncHandler bắt lỗi async → chuyển sang errorHandler, tránh crash process.
 */
export function createNotificationRoutes(service: NotificationService): Router {
  const router = Router();
  const controller = new NotificationController(service);

  // Mọi request dưới đây đều cần user đã login
  router.use(authMiddleware);
  // Badge số chưa đọc (app thường poll hoặc dùng kèm WS)
  router.get('/unread-count', asyncHandler(controller.unreadCount));
  // Inbox phân trang
  router.get('/', asyncHandler(controller.list));
  // Chi tiết + auto mark-read
  router.get('/:id', asyncHandler(controller.detail));
  // Đánh dấu đã đọc hàng loạt
  router.post('/mark-read', asyncHandler(controller.markRead));

  return router;
}
