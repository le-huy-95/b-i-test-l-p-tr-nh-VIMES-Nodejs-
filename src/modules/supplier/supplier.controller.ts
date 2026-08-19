import { Request, Response } from 'express';
import { supplierService } from './supplier.service';

export class SupplierController {
  list = async (req: Request, res: Response) => {
    const data = await supplierService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await supplierService.create(req.tenant!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await supplierService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await supplierService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  softDelete = async (req: Request, res: Response) => {
    const data = await supplierService.softDelete(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };
}

export const supplierController = new SupplierController();
