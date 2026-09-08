/**
 * CONTROLLER BÁO CÁO
 * ------------------
 * Nhận HTTP request, lấy tenantId từ middleware, gọi service tương ứng, trả JSON { success, data }.
 */
import { Request, Response } from 'express';
import { reportService } from './report.service';
import { warehouseOverviewService } from './warehouse-overview.service';
import { organizationOverviewService } from './organization-overview.service';

export class ReportController {
  stockBalance = async (req: Request, res: Response) => {
    const data = await reportService.stockBalance(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  stockMovement = async (req: Request, res: Response) => {
    const data = await reportService.stockMovement(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  lowStock = async (req: Request, res: Response) => {
    const data = await reportService.lowStock(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  expiryAlert = async (req: Request, res: Response) => {
    const data = await reportService.expiryAlert(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  warehouseOverviewList = async (req: Request, res: Response) => {
    const data = await warehouseOverviewService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  warehouseOverviewDetail = async (req: Request, res: Response) => {
    const data = await warehouseOverviewService.detail(
      req.tenant!.id,
      req.params.warehouseId as string,
      req.query,
    );
    res.json({ success: true, data });
  };

  organizationOverview = async (req: Request, res: Response) => {
    const ctx = organizationOverviewService.buildContext(
      req.tenant!.id,
      req.user!.id,
      req.tenant!.role,
      req.tenant!.warehouseIds,
    );
    const data = await organizationOverviewService.getOverview(ctx, req.query);
    res.json({ success: true, data });
  };
}

export const reportController = new ReportController();
