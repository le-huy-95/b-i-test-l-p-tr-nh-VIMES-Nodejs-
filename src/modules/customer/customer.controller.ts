/**
 * CONTROLLER KHÁCH HÀNG
 * ---------------------
 * HTTP handler customer CRUD.
 */
import { Request, Response } from 'express';
import { customerService } from './customer.service';
import { ok, created } from '../common/controller.util';

export class CustomerController {
  list = ok(async (req: Request, _res: Response) => {
    return customerService.list(req.tenant!.id, req.query);
  });

  create = created(async (req: Request, _res: Response) => {
    return customerService.create(req.tenant!.id, req.body);
  });

  get = ok(async (req: Request, _res: Response) => {
    return customerService.get(req.tenant!.id, req.params.id as string);
  });

  update = ok(async (req: Request, _res: Response) => {
    return customerService.update(req.tenant!.id, req.params.id as string, req.body);
  });

  softDelete = ok(async (req: Request, _res: Response) => {
    return customerService.softDelete(req.tenant!.id, req.params.id as string);
  });
}

export const customerController = new CustomerController();
