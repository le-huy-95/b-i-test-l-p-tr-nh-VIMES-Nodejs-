/**
 * Schema Zod và DTO cho tenant (tổ chức) và quản lý thành viên.
 *
 * Bao gồm tạo tenant, mời thành viên, tạo user nội bộ, truy vấn danh sách người
 * và API quản trị nền tảng (platform).
 */
import { z } from 'zod';
import { TenantRole } from '../infra/prisma-types';

/* Enum vai trò trong tenant — đồng bộ với Prisma TenantRole */
export const tenantRoleSchema = z.nativeEnum(TenantRole);

/* --- Tenant cơ bản (người dùng tự tạo) --- */

export const createTenantSchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2),
});

/* --- Mời & phản hồi lời mời --- */

export const inviteSchema = z.object({
  email: z.string().email(),
  role: tenantRoleSchema.default('staff'),
});

export const acceptInviteSchema = z.object({ invitationId: z.string().min(1) });
export const declineInviteSchema = z.object({ invitationId: z.string().min(1) });

/* --- Tạo user nội bộ (admin tenant) --- */

export const createInternalUserSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  password: z.string().min(6),
  role: tenantRoleSchema.default('warehouse_keeper'),
  warehouseIds: z.array(z.string()).optional(),
});

/* --- Truy vấn danh sách thành viên tenant --- */

export const tenantPeopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
});

export type TenantPeopleQueryDto = z.infer<typeof tenantPeopleQuerySchema>;

/* --- API platform admin (quản lý tenant toàn hệ thống) --- */

export const platformCreateTenantSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
});

export const platformPatchTenantSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  name: z.string().optional(),
});

/* --- Kiểu TypeScript suy ra từ schema --- */

export type CreateTenantDto = z.infer<typeof createTenantSchema>;
export type InviteDto = z.infer<typeof inviteSchema>;
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;
export type DeclineInviteDto = z.infer<typeof declineInviteSchema>;
export type CreateInternalUserDto = z.infer<typeof createInternalUserSchema>;
export type PlatformCreateTenantDto = z.infer<typeof platformCreateTenantSchema>;
export type PlatformPatchTenantDto = z.infer<typeof platformPatchTenantSchema>;
