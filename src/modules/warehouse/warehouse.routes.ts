/**
 * ROUTES KHO (/api/v1/warehouses)
 * -------------------------------
 * CRUD kho hàng trong phạm vi tenant, yêu cầu auth + tenant middleware.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { warehouseController } from './warehouse.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(warehouseController.list));
router.post('/', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.create));
router.get('/:id', asyncHandler(warehouseController.get));
router.put('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.update));
router.delete('/:id', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.softDelete));
router.patch('/:id/deactivate', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.softDelete));
router.patch('/:id/activate', requireRoles('admin', 'warehouse_keeper'), asyncHandler(warehouseController.activate));

export default router;
