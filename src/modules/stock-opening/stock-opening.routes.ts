import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { stockOpeningController } from './stock-opening.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(stockOpeningController.list));
router.post('/', asyncHandler(stockOpeningController.create));
router.post('/:id/post', requireRoles('admin', 'accountant'), asyncHandler(stockOpeningController.post));

export default router;
