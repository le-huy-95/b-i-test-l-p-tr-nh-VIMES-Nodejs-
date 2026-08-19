import { z } from 'zod';
import { ReceiptType } from '../infra/prisma-types';

export const stockReceiptLineSchema = z.object({
  productId: z.string(),
  unitName: z.string(),
  expectedQty: z.number().nonnegative(),
  actualQty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  batchNo: z.string().optional(),
  expiryDate: z.string().datetime().optional().or(z.string().optional()),
  manufactureDate: z.string().datetime().optional().or(z.string().optional()),
});

export const createStockReceiptSchema = z.object({
  warehouseId: z.string(),
  supplierId: z.string().optional(),
  receiptType: z.nativeEnum(ReceiptType).default('purchase'),
  receiptDate: z.string(),
  deliveredByName: z.string().optional(),
  note: z.string().optional(),
  workflowAssignedApproverIds: z.array(z.string().min(1)).optional(),
  lines: z.array(stockReceiptLineSchema).min(1),
});

export const updateStockReceiptSchema = createStockReceiptSchema;

export const rejectDocumentSchema = z.object({
  reason: z.string().optional(),
});

export type CreateStockReceiptDto = z.infer<typeof createStockReceiptSchema>;
export type RejectDocumentDto = z.infer<typeof rejectDocumentSchema>;
