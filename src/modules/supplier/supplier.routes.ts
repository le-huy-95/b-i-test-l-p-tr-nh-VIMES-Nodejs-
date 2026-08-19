import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { supplierController } from './supplier.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(supplierController.list));
router.post('/', requireRoles('admin'), asyncHandler(supplierController.create));
router.get('/:id', asyncHandler(supplierController.get));
router.put('/:id', requireRoles('admin'), asyncHandler(supplierController.update));
router.delete('/:id', requireRoles('admin'), asyncHandler(supplierController.softDelete));

export default router;
