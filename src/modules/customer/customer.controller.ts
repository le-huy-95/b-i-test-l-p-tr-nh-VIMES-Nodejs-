import { Request, Response } from 'express';
import { customerService } from './customer.service';

export class CustomerController {
  list = async (req: Request, res: Response) => {
    const data = await customerService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await customerService.create(req.tenant!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await customerService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await customerService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  softDelete = async (req: Request, res: Response) => {
    const data = await customerService.softDelete(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };
}

export const customerController = new CustomerController();
