import { z } from 'zod';

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

export type RecipientPolicy = z.infer<typeof recipientPolicySchema>;
