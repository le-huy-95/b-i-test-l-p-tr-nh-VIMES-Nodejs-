import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { customerController } from './customer.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(customerController.list));
router.post('/', asyncHandler(customerController.create));
router.get('/:id', asyncHandler(customerController.get));
router.put('/:id', requireRoles('admin'), asyncHandler(customerController.update));
router.delete('/:id', requireRoles('admin'), asyncHandler(customerController.softDelete));

export default router;
