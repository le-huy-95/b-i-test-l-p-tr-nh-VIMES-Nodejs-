import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { tenantMiddleware } from '../../middlewares/tenant';
import { idempotencyMiddleware } from '../../middlewares/idempotency';
import { asyncHandler } from '../../middlewares/errorHandler';
import { documentWorkflowController } from './document-workflow.controller';

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

router.get('/', asyncHandler(documentWorkflowController.list));
router.get('/:documentType/:id', asyncHandler(documentWorkflowController.get));
router.get('/:documentType/:id/available-actions', asyncHandler(documentWorkflowController.availableActions));
router.post('/:documentType/:id/actions', asyncHandler(documentWorkflowController.actions));
router.patch('/:documentType/:id/steps/:stepId/assignee', asyncHandler(documentWorkflowController.assign));
router.post('/:documentType/:id/steps/:stepId/authorizations', asyncHandler(documentWorkflowController.uploadAuthorization));
router.get('/:documentType/:id/timeline', asyncHandler(documentWorkflowController.timeline));

export default router;
