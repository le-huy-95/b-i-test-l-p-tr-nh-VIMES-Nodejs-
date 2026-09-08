/**
 * ROUTES TENANT (/api/v1/tenants/current)
 * ---------------------------------------
 * Quản lý tenant hiện tại: thông tin, thành viên, mời người, phân quyền kho.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requireRoles, tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler, uploadHandler } from '../../middlewares/errorHandler';
import { uploadTenantLogo } from '../../middlewares/upload';
import { tenantController } from './tenant.controller';

const router = Router();

router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(tenantController.getCurrentTenant));
router.get('/members', asyncHandler(tenantController.listMembers));
router.get('/invitations', asyncHandler(tenantController.listInvitations));
router.post(
  '/logo',
  requireRoles('admin'),
  uploadHandler(uploadTenantLogo),
  asyncHandler(tenantController.uploadLogo),
);
router.delete('/logo', requireRoles('admin'), asyncHandler(tenantController.deleteLogo));
router.post('/invitations', requireRoles('admin'), asyncHandler(tenantController.invite));
router.post('/users', requireRoles('admin'), asyncHandler(tenantController.createInternalUser));

export default router;