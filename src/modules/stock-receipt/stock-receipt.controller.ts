/**
 * CONTROLLER PHIẾU NHẬP
 * ---------------------
 * HTTP handler stock receipt lifecycle.
 */
import { Request, Response } from 'express';
import { stockReceiptService } from './stock-receipt.service';
import { rejectDocumentSchema } from '../../dto/stock-receipt.dto';
import { requestActor } from '../../shared/notifications/request-actor';

export class StockReceiptController {
  list = async (req: Request, res: Response) => {
    const data = await stockReceiptService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await stockReceiptService.create(req.tenant!.id, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await stockReceiptService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await stockReceiptService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  submit = async (req: Request, res: Response) => {
    const data = await stockReceiptService.submit(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  approve = async (req: Request, res: Response) => {
    const data = await stockReceiptService.approve(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  reject = async (req: Request, res: Response) => {
    const { reason } = rejectDocumentSchema.parse(req.body);
    const data = await stockReceiptService.reject(
      req.tenant!.id,
      req.params.id as string,
      reason ?? 'Rejected',
      requestActor(req),
    );
    res.json({ success: true, data });
  };

  complete = async (req: Request, res: Response) => {
    const data = await stockReceiptService.complete(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  cancel = async (req: Request, res: Response) => {
    const data = await stockReceiptService.cancel(req.tenant!.id, req.params.id as string, requestActor(req));
    res.json({ success: true, data });
  };

  cloneFromRejected = async (req: Request, res: Response) => {
    const data = await stockReceiptService.cloneFromRejected(
      req.tenant!.id,
      req.params.id as string,
      req.user!.id,
    );
    res.status(201).json({ success: true, data });
  };
}

export const stockReceiptController = new StockReceiptController();
