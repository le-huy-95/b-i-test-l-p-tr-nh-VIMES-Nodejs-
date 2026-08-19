import { Request, Response } from 'express';
import { listNotificationsQuerySchema, markReadSchema } from '../dto/notification.dto';
import type { NotificationService } from './notification.service';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  unreadCount = async (req: Request, res: Response) => {
    const count = await this.service.getUnreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  };

  list = async (req: Request, res: Response) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    const data = await this.service.list(req.user!.id, query);
    res.json({ success: true, data });
  };

  detail = async (req: Request, res: Response) => {
    const data = await this.service.detail(req.user!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  markRead = async (req: Request, res: Response) => {
    const input = markReadSchema.parse(req.body);
    const data = await this.service.markRead(req.user!.id, input);
    res.json({ success: true, data });
  };
}
