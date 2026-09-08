/**
 * Controller HTTP cho phiếu tồn kho đầu kỳ (Stock Opening Balance).
 *
 * Lớp này nhận request từ Express, trích xuất tenant/user từ middleware,
 * gọi StockOpeningService và trả về JSON chuẩn `{ success, data }`.
 *
 * Các endpoint tương ứng:
 * - GET  /          — danh sách phiếu tồn đầu kỳ
 * - POST /          — tạo phiếu mới (draft)
 * - POST /:id/post  — hạch toán tồn đầu kỳ vào sổ kho (yêu cầu admin/accountant)
 */

import { Request, Response } from 'express';
import { stockOpeningService } from './stock-opening.service';

// ─── Controller ───────────────────────────────────────────────────────────────

export class StockOpeningController {
  /** Liệt kê phiếu tồn đầu kỳ theo tenant, hỗ trợ phân trang qua query string */
  list = async (req: Request, res: Response) => {
    const data = await stockOpeningService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  /** Tạo phiếu tồn đầu kỳ mới và khởi tạo workflow duyệt */
  create = async (req: Request, res: Response) => {
    const data = await stockOpeningService.create(req.tenant!.id, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  /** Hạch toán (post) phiếu tồn đầu kỳ — cập nhật số dư kho và sổ cái */
  post = async (req: Request, res: Response) => {
    const data = await stockOpeningService.post(req.tenant!.id, req.params.id as string, req.user!.id);
    res.json({ success: true, data });
  };
}

/** Singleton controller dùng chung cho routes */
export const stockOpeningController = new StockOpeningController();
