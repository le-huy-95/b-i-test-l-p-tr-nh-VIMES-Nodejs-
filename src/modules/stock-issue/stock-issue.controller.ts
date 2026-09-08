/**
 * CONTROLLER PHIẾU XUẤT
 * ---------------------
 * HTTP handler stock issue lifecycle.
 */
import { Request, Response } from 'express';
import { stockIssueService } from './stock-issue.service';
import { rejectDocumentSchema } from '../../dto/stock-receipt.dto';
import { requestActor } from '../../shared/notifications/request-actor';

export class StockIssueController {
  list = async (req: Request, res: Response) => {
    const data = await stockIssueService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await stockIssueService.create(req.tenant!.id, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await stockIssueService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await stockIssueService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  submit = async (req: Request, res: Response) => {
    const data = await stockIssueService.submit(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  approve = async (req: Request, res: Response) => {
    const data = await stockIssueService.approve(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  reject = async (req: Request, res: Response) => {
    const { reason } = rejectDocumentSchema.parse(req.body);
    const data = await stockIssueService.reject(
      req.tenant!.id,
      req.params.id as string,
      reason ?? 'Rejected',
      requestActor(req),
    );
    res.json({ success: true, data });
  };

  complete = async (req: Request, res: Response) => {
    const data = await stockIssueService.complete(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  cancel = async (req: Request, res: Response) => {
    const data = await stockIssueService.cancel(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };
}

export const stockIssueController = new StockIssueController();
