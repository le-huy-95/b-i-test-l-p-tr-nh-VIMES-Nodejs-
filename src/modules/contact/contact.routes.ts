/**
 * ROUTES LIÊN HỆ TENANT (/api/v1/tenant/contacts)
 * -----------------------------------------------
 * Danh bạ liên hệ nội bộ / đối tác của tenant.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { tenantMiddleware, requireRoles } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { contactController } from './contact.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(contactController.listByRelationType));
router.post('/', asyncHandler(contactController.create));
router.get('/:id', asyncHandler(contactController.get));
router.put('/:id', requireRoles('admin'), asyncHandler(contactController.update));
router.delete('/:id', requireRoles('admin'), asyncHandler(contactController.softDelete));

export default router;
