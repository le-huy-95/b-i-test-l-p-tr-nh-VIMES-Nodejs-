/**
 * ROUTES FILE (/api/v1/files)
 * ---------------------------
 * Upload media (ảnh sản phẩm, logo...), lấy URL signed từ MinIO.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { tenantMiddleware } from '../../middlewares/tenant';
import { asyncHandler, uploadHandler } from '../../middlewares/errorHandler';
import { uploadMediaFile } from '../../middlewares/upload';
import { fileController } from './file.controller';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.post('/', uploadHandler(uploadMediaFile), asyncHandler(fileController.upload));
router.put('/:id', uploadHandler(uploadMediaFile), asyncHandler(fileController.replace));
router.get('/', asyncHandler(fileController.list));
router.get('/:id', asyncHandler(fileController.getOne));
router.delete('/:id', asyncHandler(fileController.remove));

export default router;
