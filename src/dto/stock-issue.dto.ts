import { z } from 'zod';

export const issueTypeSchema = z.enum([
  'sale',
  'internal_use',
  'return_to_supplier',
  'disposal',
]);

export const stockIssueLineSchema = z.object({
  productId: z.string(),
  unitName: z.string(),
  requestedQty: z.number().positive(),
  actualQty: z.number().positive(),
  unitPrice: z.number().nonnegative().optional(),
  batchId: z.string().optional(),
});

export const createStockIssueSchema = z.object({
  warehouseId: z.string(),
  issueType: issueTypeSchema,
  customerId: z.string().optional(),
  issueDate: z.string(),
  note: z.string().optional(),
  workflowAssignedApproverIds: z.array(z.string().min(1)).optional(),
  lines: z.array(stockIssueLineSchema).min(1),
});

export const updateStockIssueSchema = createStockIssueSchema;

export type CreateStockIssueDto = z.infer<typeof createStockIssueSchema>;
