/**
 * ROUTES BÁO CÁO (/api/v1/reports)
 * --------------------------------
 * Yêu cầu auth + tenant context. Các endpoint: tồn kho, biến động,
 * cảnh báo tồn thấp/hết hạn, tổng quan kho và tổ chức.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { tenantMiddleware } from '../../middlewares/tenant';
import { asyncHandler } from '../../middlewares/errorHandler';
import { reportController } from './report.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

router.get('/stock-balance', asyncHandler(reportController.stockBalance));
router.get('/stock-movement', asyncHandler(reportController.stockMovement));
router.get('/low-stock', asyncHandler(reportController.lowStock));
router.get('/expiry-alert', asyncHandler(reportController.expiryAlert));
router.get('/warehouse-overview', asyncHandler(reportController.warehouseOverviewList));
router.get('/warehouse-overview/:warehouseId', asyncHandler(reportController.warehouseOverviewDetail));
router.get('/organization-overview', asyncHandler(reportController.organizationOverview));

export default router;
