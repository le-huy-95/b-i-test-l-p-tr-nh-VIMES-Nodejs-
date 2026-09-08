/**
 * Schema và kiểu dữ liệu chính sách người nhận thông báo.
 *
 * Mỗi sự kiện thông báo kèm `recipientPolicy` mô tả cách xác định user nhận:
 * - `explicit_users`: danh sách userId cố định (ví dụ người được mời)
 * - `tenant_roles`: tất cả thành viên tenant có một trong các vai trò chỉ định
 * - `source_creator`: người tạo chứng từ nguồn (phiếu nhập/xuất)
 *
 * Schema Zod dùng để validate payload từ Kafka/outbox trước khi consumer xử lý.
 */

import { z } from 'zod';

/**
 * Schema discriminated union theo trường `type`.
 * Consumer đọc `type` để biết cách resolve danh sách userId nhận thông báo.
 */
export const recipientPolicySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('explicit_users'),
    userIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('tenant_roles'),
    roles: z.array(z.enum(['admin', 'warehouse_keeper', 'accountant', 'staff'])).min(1),
  }),
  z.object({
    type: z.literal('source_creator'),
    createdByUserId: z.string(),
  }),
]);

/** Kiểu TypeScript suy ra từ recipientPolicySchema */
export type RecipientPolicy = z.infer<typeof recipientPolicySchema>;
