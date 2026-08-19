import { z } from 'zod';
import { TenantRole } from '../infra/prisma-types';

export const tenantRoleSchema = z.nativeEnum(TenantRole);

export const createTenantSchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: tenantRoleSchema.default('staff'),
});

export const acceptInviteSchema = z.object({ invitationId: z.string().min(1) });
export const declineInviteSchema = z.object({ invitationId: z.string().min(1) });

export const createInternalUserSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  password: z.string().min(6),
  role: tenantRoleSchema.default('warehouse_keeper'),
  warehouseIds: z.array(z.string()).optional(),
});

export const tenantPeopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
});

export type TenantPeopleQueryDto = z.infer<typeof tenantPeopleQuerySchema>;

export const platformCreateTenantSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
});

export const platformPatchTenantSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  name: z.string().optional(),
});

export type CreateTenantDto = z.infer<typeof createTenantSchema>;
export type InviteDto = z.infer<typeof inviteSchema>;
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;
export type DeclineInviteDto = z.infer<typeof declineInviteSchema>;
export type CreateInternalUserDto = z.infer<typeof createInternalUserSchema>;
export type PlatformCreateTenantDto = z.infer<typeof platformCreateTenantSchema>;
export type PlatformPatchTenantDto = z.infer<typeof platformPatchTenantSchema>;