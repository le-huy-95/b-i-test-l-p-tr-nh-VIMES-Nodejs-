/**
 * Schema Zod và DTO cho nhà cung cấp (supplier).
 *
 * Validate mã, tên, mã số thuế và thông tin liên hệ khi tạo/cập nhật NCC.
 */
import { z } from 'zod';

/* Schema đầy đủ cho tạo nhà cung cấp */
export const supplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  taxCode: z.string().optional(),
  contact: z.string().optional(),
});

export type SupplierDto = z.infer<typeof supplierSchema>;
export type UpdateSupplierDto = z.infer<ReturnType<typeof supplierSchema.partial>>;
