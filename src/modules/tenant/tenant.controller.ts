import { Request, Response } from 'express';
import { tenantService } from './tenant.service';

export class TenantController {
  invite = async (req: Request, res: Response) => {
    const data = await tenantService.invite(req.tenant!.id, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  listMembers = async (req: Request, res: Response) => {
    const data = await tenantService.listMembers(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  listInvitations = async (req: Request, res: Response) => {
    const data = await tenantService.listInvitations(req.tenant!.id, req.user!.id, req.query);
    res.json({ success: true, data });
  };

  createInternalUser = async (req: Request, res: Response) => {
    const data = await tenantService.createInternalUser(
      req.tenant!.id,
      req.user!.id,
      req.body,
    );
    res.status(201).json({ success: true, data });
  };

  createTenant = async (req: Request, res: Response) => {
    const data = await tenantService.createTenant(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  acceptInvite = async (req: Request, res: Response) => {
    const data = await tenantService.acceptInvite(req.user!.id, req.body);
    res.json({ success: true, data });
  };

  declineInvite = async (req: Request, res: Response) => {
    const data = await tenantService.declineInvite(req.user!.id, req.body);
    res.json({ success: true, data });
  };

  platformCreateTenant = async (req: Request, res: Response) => {
    const data = await tenantService.platformCreateTenant(req.body);
    res.status(201).json({ success: true, data });
  };

  platformPatchTenant = async (req: Request, res: Response) => {
    const data = await tenantService.platformPatchTenant(req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  getCurrentTenant = async (req: Request, res: Response) => {
    const data = await tenantService.getCurrentTenant(req.tenant!.id);
    res.json({ success: true, data });
  };

  uploadLogo = async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'LOGO_REQUIRED', message: 'Logo file is required' },
      });
      return;
    }
    const data = await tenantService.uploadLogo(req.tenant!.id, {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
    res.json({ success: true, data });
  };

  deleteLogo = async (req: Request, res: Response) => {
    const data = await tenantService.deleteLogo(req.tenant!.id);
    res.json({ success: true, data });
  };
}

export const tenantController = new TenantController();