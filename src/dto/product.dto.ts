import { z } from 'zod';

export const productSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(1),
  imageUrl: z.string().url().optional(),
  imageFileId: z.string().min(1).optional(),
  fileIds: z.array(z.string().min(1)).max(1).optional(),
  baseUnitName: z.string().default('cái'),
  minStockLevel: z.number().nonnegative().default(0),
  maxStockLevel: z.number().nonnegative().optional(),
  reorderPoint: z.number().nonnegative().optional(),
  averageCost: z.number().nonnegative().default(0),
  units: z
    .array(
      z.object({
        unitName: z.string(),
        conversionRate: z.number().positive(),
      }),
    )
    .optional(),
});

export type ProductDto = z.infer<typeof productSchema>;
export type UpdateProductDto = z.infer<ReturnType<typeof productSchema.partial>>;
