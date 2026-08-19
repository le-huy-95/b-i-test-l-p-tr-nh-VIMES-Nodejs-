import { Request, Response } from 'express';
import { warehouseService } from './warehouse.service';

export class WarehouseController {
  list = async (req: Request, res: Response) => {
    const data = await warehouseService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await warehouseService.create(req.tenant!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await warehouseService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await warehouseService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  softDelete = async (req: Request, res: Response) => {
    const data = await warehouseService.softDelete(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  activate = async (req: Request, res: Response) => {
    const data = await warehouseService.activate(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };
}

export const warehouseController = new WarehouseController();
