/**
 * Định nghĩa các route HTTP cho module quy trình duyệt chứng từ (document workflow).
 *
 * Mọi endpoint đều yêu cầu xác thực người dùng, ngữ cảnh tenant và middleware idempotency
 * để tránh xử lý trùng lặp khi client gửi lại cùng một yêu cầu.
 *
 * Các route hỗ trợ: liệt kê workflow, xem chi tiết, thực hiện hành động duyệt,
 * gán người duyệt, tải lên ủy quyền ký thay và xem timeline lịch sử trạng thái.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { documentWorkflowController } from './document-workflow.controller';

const router = Router();

// --- Middleware chung: xác thực, tenant, idempotency ---
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

// --- Các endpoint workflow ---
router.get('/', asyncHandler(documentWorkflowController.list));
router.get('/:documentType/:id', asyncHandler(documentWorkflowController.get));
router.get('/:documentType/:id/available-actions', asyncHandler(documentWorkflowController.availableActions));
router.post('/:documentType/:id/actions', asyncHandler(documentWorkflowController.actions));
router.patch('/:documentType/:id/steps/:stepId/assignee', asyncHandler(documentWorkflowController.assign));
router.post('/:documentType/:id/steps/:stepId/authorizations', asyncHandler(documentWorkflowController.uploadAuthorization));
router.get('/:documentType/:id/timeline', asyncHandler(documentWorkflowController.timeline));

export default router;
