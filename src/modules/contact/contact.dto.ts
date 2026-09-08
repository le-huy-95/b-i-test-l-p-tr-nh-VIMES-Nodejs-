/**
 * DTO LIÊN HỆ
 * -----------
 * Zod schema validate input tạo/sửa contact (tên, SĐT, email, ghi chú...).
 */
import { z } from 'zod';

export const contactSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  companyName: z.string().optional(),
  taxCode: z.string().optional(),
  note: z.string().optional(),
  relationType: z.enum(['delivery_person', 'vendor_contact', 'receiver', 'other']).default('other'),
});

export type ContactDto = z.infer<typeof contactSchema>;
export type UpdateContactDto = z.infer<ReturnType<typeof contactSchema.partial>>;
