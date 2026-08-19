import { z } from 'zod';

export const documentTypeSchema = z.enum(['stock_issue', 'stock_receipt', 'stock_opening']);

export const workflowActionSchema = z.enum([
  'submit',
  'approve',
  'reject',
  'proxy_sign',
  'skip',
  'cancel',
  'complete',
  'return',
]);

export const workflowActionInputSchema = z.object({
  action: workflowActionSchema,
  stepId: z.string().optional(),
  note: z.string().optional(),
  proxySignerId: z.string().nullish(),
  authorizationIds: z.array(z.string()).optional(),
});

export const assignStepSchema = z.object({
  assignedApproverId: z.string(),
});

export const workflowAssignedApproverIdsSchema = z.array(z.string().min(1)).optional();

export const uploadAuthorizationSchema = z.object({
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  authorizationNo: z.string().optional(),
  issuedBy: z.string().optional(),
  issuedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  note: z.string().optional(),
});

export const workflowListQuerySchema = z.object({
  documentType: documentTypeSchema.optional(),
  status: z.enum(['draft', 'in_review', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  assignedApproverId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const workflowAvailableActionsQuerySchema = z.object({
  userId: z.string().optional(),
});

export type WorkflowActionInputDto = z.infer<typeof workflowActionInputSchema>;
export type AssignStepDto = z.infer<typeof assignStepSchema>;
export type UploadAuthorizationDto = z.infer<typeof uploadAuthorizationSchema>;
export type WorkflowListQueryDto = z.infer<typeof workflowListQuerySchema>;
