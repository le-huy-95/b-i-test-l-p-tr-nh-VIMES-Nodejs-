/**
 * Schema Zod và DTO cho phiếu xuất kho (stock issue).
 *
 * Validate loại xuất, dòng hàng, kho, khách hàng (nếu xuất bán) và người duyệt workflow.
 */
import { z } from 'zod';

/* Loại phiếu xuất: bán, dùng nội bộ, trả NCC, thanh lý */
export const issueTypeSchema = z.enum([
  'sale',
  'internal_use',
  'return_to_supplier',
  'disposal',
]);

/* Schema một dòng chi tiết phiếu xuất */
export const stockIssueLineSchema = z.object({
  productId: z.string(),
  unitName: z.string(),
  requestedQty: z.number().positive(),
  actualQty: z.number().positive(),
  unitPrice: z.number().nonnegative().optional(),
  batchId: z.string().optional(),
});

/* Schema tạo/cập nhật phiếu xuất — tối thiểu một dòng hàng */
export const createStockIssueSchema = z.object({
  warehouseId: z.string(),
  issueType: issueTypeSchema,
  customerId: z.string().optional(),
  issueDate: z.string(),
  deliveredByName: z.string().optional(),
  note: z.string().optional(),
  workflowAssignedApproverIds: z.array(z.string().min(1)).optional(),
  lines: z.array(stockIssueLineSchema).min(1),
});

export const updateStockIssueSchema = createStockIssueSchema;

export type CreateStockIssueDto = z.infer<typeof createStockIssueSchema>;
