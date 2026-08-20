import { Request, Response } from 'express';
import { contactService } from './contact.service';
import { ok, created } from '../common/controller.util';
import type { ContactRelationType } from '../../infra/prisma-types';

export class ContactController {
  listByRelationType = ok(async (req: Request, _res: Response) => {
    const relationType = req.query.relationType as ContactRelationType;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    return contactService.listByRelationType(req.tenant!.id, relationType, limit);
  });

  create = created(async (req: Request, _res: Response) => {
    return contactService.create(req.tenant!.id, req.body);
  });

  get = ok(async (req: Request, _res: Response) => {
    return contactService.get(req.tenant!.id, req.params.id as string);
  });

  update = ok(async (req: Request, _res: Response) => {
    return contactService.update(req.tenant!.id, req.params.id as string, req.body);
  });

  softDelete = ok(async (req: Request, _res: Response) => {
    return contactService.softDelete(req.tenant!.id, req.params.id as string);
  });
}

export const contactController = new ContactController();
