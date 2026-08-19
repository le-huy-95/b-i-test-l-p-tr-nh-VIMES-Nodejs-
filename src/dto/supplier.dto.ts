import { z } from 'zod';

export const supplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  taxCode: z.string().optional(),
  contact: z.string().optional(),
});

export type SupplierDto = z.infer<typeof supplierSchema>;
export type UpdateSupplierDto = z.infer<ReturnType<typeof supplierSchema.partial>>;
