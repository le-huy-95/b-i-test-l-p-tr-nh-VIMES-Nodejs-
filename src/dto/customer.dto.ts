/**
 * Schema Zod và DTO cho khách hàng (customer).
 *
 * Validate mã, tên và thông tin liên hệ khi tạo/cập nhật khách hàng.
 */
import { z } from 'zod';

/* Schema đầy đủ cho tạo khách hàng */
export const customerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export type CustomerDto = z.infer<typeof customerSchema>;
export type UpdateCustomerDto = z.infer<ReturnType<typeof customerSchema.partial>>;
