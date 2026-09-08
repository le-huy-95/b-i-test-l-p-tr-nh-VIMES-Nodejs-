/**
 * Trích xuất thông tin người thực hiện (actor) từ HTTP request đã xác thực.
 *
 * Các controller xử lý phiếu kho, workflow, ... gọi `requestActor(req)` để lấy
 * userId, name, email của user hiện tại — truyền vào hàm notify* mà không lặp
 * logic đọc `req.user`.
 *
 * Yêu cầu middleware auth đã gắn `req.user`; dùng non-null assertion vì route
 * được bảo vệ bởi auth middleware.
 */

import type { Request } from 'express';
import type { StockDocActor } from '../../shared/notifications/stock-doc-notify';

/**
 * Chuyển `req.user` (sau auth) thành `StockDocActor` dùng cho thông báo chứng từ kho.
 */
export function requestActor(req: Request): StockDocActor {
  return {
    userId: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
  };
}
