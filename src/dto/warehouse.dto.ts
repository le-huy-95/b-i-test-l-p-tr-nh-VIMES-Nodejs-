/**
 * Schema Zod và DTO cho kho hàng (warehouse).
 *
 * Validate mã, tên, địa chỉ và tọa độ GPS khi tạo/cập nhật kho.
 */
import { z } from 'zod';

/* Schema kho — latitude/longitude tùy chọn trong phạm vi hợp lệ */
export const warehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().nullish(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export type WarehouseDto = z.infer<typeof warehouseSchema>;
export type UpdateWarehouseDto = z.infer<ReturnType<typeof warehouseSchema.partial>>;
