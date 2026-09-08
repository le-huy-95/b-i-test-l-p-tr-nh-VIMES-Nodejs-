/**
 * ROUTES PHIẾU XUẤT (/api/v1/stock-issues)
 * ----------------------------------------
 * CRUD phiếu xuất kho, submit/hủy, idempotency.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { stockIssueController } from './stock-issue.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(stockIssueController.list));
router.post('/', asyncHandler(stockIssueController.create));
router.get('/:id', asyncHandler(stockIssueController.get));
router.put('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockIssueController.update));
router.post('/:id/submit', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockIssueController.submit));
router.post('/:id/approve', requireRoles('admin', 'accountant'), asyncHandler(stockIssueController.approve));
router.post('/:id/reject', requireRoles('admin', 'accountant'), asyncHandler(stockIssueController.reject));
router.post('/:id/complete', requireRoles('admin', 'accountant'), asyncHandler(stockIssueController.complete));
router.post('/:id/cancel', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockIssueController.cancel));

export default router;
