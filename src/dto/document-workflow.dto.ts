/**
 * Schema Zod và DTO cho quy trình duyệt chứng từ (document workflow).
 *
 * Định nghĩa loại chứng từ, hành động workflow, gán người duyệt,
 * ủy quyền ký và tham số truy vấn danh sách.
 */
import { z } from 'zod';

/* Loại chứng từ được hỗ trợ workflow */
export const documentTypeSchema = z.enum(['stock_issue', 'stock_receipt', 'stock_opening']);

/* Các hành động người dùng có thể thực hiện trên bước workflow */
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

/* Payload khi thực hiện hành động workflow */
export const workflowActionInputSchema = z.object({
  action: workflowActionSchema,
  stepId: z.string().optional(),
  note: z.string().optional(),
  proxySignerId: z.string().nullish(),
  authorizationIds: z.array(z.string()).optional(),
});

/* Gán người duyệt cho một bước cụ thể */
export const assignStepSchema = z.object({
  assignedApproverId: z.string(),
});

/* Danh sách người duyệt gán sẵn khi tạo chứng từ (tùy chọn) */
export const workflowAssignedApproverIdsSchema = z.array(z.string().min(1)).optional();

/* Metadata tải lên giấy ủy quyền ký thay */
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

/* Tham số lọc/phân trang danh sách workflow */
export const workflowListQuerySchema = z.object({
  documentType: documentTypeSchema.optional(),
  status: z.enum(['draft', 'in_review', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  assignedApproverId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/* Query lấy danh sách hành động khả dụng cho user */
export const workflowAvailableActionsQuerySchema = z.object({
  userId: z.string().optional(),
});

export type WorkflowActionInputDto = z.infer<typeof workflowActionInputSchema>;
export type AssignStepDto = z.infer<typeof assignStepSchema>;
export type UploadAuthorizationDto = z.infer<typeof uploadAuthorizationSchema>;
export type WorkflowListQueryDto = z.infer<typeof workflowListQuerySchema>;
