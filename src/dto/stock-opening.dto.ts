/**
 * Schema Zod và DTO cho phiếu tồn kho đầu kỳ (stock opening).
 *
 * Validate kho, ngày hiệu lực, dòng hàng với số lượng và đơn giá vốn ban đầu.
 */
import { z } from 'zod';

/* Schema tạo phiếu tồn đầu kỳ — mỗi dòng gắn sản phẩm, số lượng và giá vốn */
export const createStockOpeningSchema = z.object({
  warehouseId: z.string(),
  effectiveDate: z.string(),
  note: z.string().optional(),
  workflowAssignedApproverIds: z.array(z.string().min(1)).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        qty: z.number().positive(),
        unitCost: z.number().nonnegative(),
        batchNo: z.string().optional(),
        expiryDate: z.string().datetime().optional().or(z.string().optional()),
      }),
    )
    .min(1),
});

export type CreateStockOpeningDto = z.infer<typeof createStockOpeningSchema>;
