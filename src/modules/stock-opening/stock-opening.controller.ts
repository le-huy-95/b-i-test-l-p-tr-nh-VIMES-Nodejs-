import { Request, Response } from 'express';
import { stockOpeningService } from './stock-opening.service';

export class StockOpeningController {
  list = async (req: Request, res: Response) => {
    const data = await stockOpeningService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await stockOpeningService.create(req.tenant!.id, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  post = async (req: Request, res: Response) => {
    const data = await stockOpeningService.post(req.tenant!.id, req.params.id as string, req.user!.id);
    res.json({ success: true, data });
  };
}

export const stockOpeningController = new StockOpeningController();
