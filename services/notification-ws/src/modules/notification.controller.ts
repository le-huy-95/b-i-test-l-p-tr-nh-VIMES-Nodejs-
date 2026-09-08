/**
 * Controller REST cho thông báo.
 * Chỉ parse request / gọi service / trả JSON — không chứa logic DB.
 */
import { Request, Response } from 'express';
import { listNotificationsQuerySchema, markReadSchema } from '../dto/notification.dto';
import type { NotificationService } from './notification.service';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  /**
   * GET /unread-count
   * Trả số thông báo chưa đọc của user đang đăng nhập (ưu tiên Redis cache).
   */
  unreadCount = async (req: Request, res: Response) => {
    const count = await this.service.getUnreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  };

  /**
   * GET /
   * Danh sách thông báo phân trang cursor (query: limit, cursor, onlyUnread, tenantId).
   */
  list = async (req: Request, res: Response) => {
    // Zod parse + coerce query string → number/boolean
    const query = listNotificationsQuerySchema.parse(req.query);
    const data = await this.service.list(req.user!.id, query);
    res.json({ success: true, data });
  };

  /**
   * GET /:id
   * Chi tiết 1 thông báo. Nếu chưa đọc thì tự đánh dấu đã đọc (side-effect).
   */
  detail = async (req: Request, res: Response) => {
    const data = await this.service.detail(req.user!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  /**
   * POST /mark-read
   * Đánh dấu đã đọc: theo danh sách id, hoặc markAll (có thể lọc tenantId).
   */
  markRead = async (req: Request, res: Response) => {
    const input = markReadSchema.parse(req.body);
    const data = await this.service.markRead(req.user!.id, input);
    res.json({ success: true, data });
  };
}
