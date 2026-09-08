/**
 * Định nghĩa route Express cho module phiếu tồn kho đầu kỳ.
 *
 * Tất cả route đều yêu cầu:
 * - authMiddleware      — xác thực JWT
 * - tenantMiddleware    — gắn tenant context
 * - idempotencyMiddleware — chống gửi trùng request
 *
 * Route POST /:id/post yêu cầu thêm role admin hoặc accountant.
 */

import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { stockOpeningController } from './stock-opening.controller';

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

// ─── Endpoints ──────────────────────────────────────────────────────────────

router.get('/', asyncHandler(stockOpeningController.list));
router.post('/', asyncHandler(stockOpeningController.create));
router.post('/:id/post', requireRoles('admin', 'accountant'), asyncHandler(stockOpeningController.post));

export default router;
