/**
 * Schema Zod và DTO cho phiếu nhập kho (stock receipt).
 *
 * Validate dòng hàng, thông tin kho/nhà cung cấp, loại nhập và người duyệt workflow.
 */
import { z } from 'zod';
import { ReceiptType } from '../infra/prisma-types';

/* Schema một dòng chi tiết phiếu nhập */
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

/* Schema tạo/cập nhật phiếu nhập — tối thiểu một dòng hàng */
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

/* Schema từ chối chứng từ trong quy trình duyệt */
export const rejectDocumentSchema = z.object({
  reason: z.string().optional(),
});

export type CreateStockReceiptDto = z.infer<typeof createStockReceiptSchema>;
export type RejectDocumentDto = z.infer<typeof rejectDocumentSchema>;
