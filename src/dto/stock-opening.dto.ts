import { z } from 'zod';

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
