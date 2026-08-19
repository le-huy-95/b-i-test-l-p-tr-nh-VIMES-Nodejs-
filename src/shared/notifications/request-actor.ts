import type { Request } from 'express';
import type { StockDocActor } from '../../shared/notifications/stock-doc-notify';

export function requestActor(req: Request): StockDocActor {
  return {
    userId: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
  };
}
