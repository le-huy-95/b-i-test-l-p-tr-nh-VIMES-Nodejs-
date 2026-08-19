import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { stockReceiptController } from './stock-receipt.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(stockReceiptController.list));
router.post('/', asyncHandler(stockReceiptController.create));
router.get('/:id', asyncHandler(stockReceiptController.get));
router.put('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockReceiptController.update));
router.post('/:id/submit', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockReceiptController.submit));
router.post('/:id/approve', requireRoles('admin', 'accountant'), asyncHandler(stockReceiptController.approve));
router.post('/:id/reject', requireRoles('admin', 'accountant'), asyncHandler(stockReceiptController.reject));
router.post('/:id/complete', requireRoles('admin', 'accountant'), asyncHandler(stockReceiptController.complete));
router.post('/:id/cancel', requireRoles('admin', 'warehouse_keeper'), asyncHandler(stockReceiptController.cancel));
router.post(
  '/:id/clone-from-rejected',
  requireRoles('admin', 'warehouse_keeper'),
  asyncHandler(stockReceiptController.cloneFromRejected),
);

export default router;
