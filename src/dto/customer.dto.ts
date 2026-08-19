import { z } from 'zod';

export const customerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export type CustomerDto = z.infer<typeof customerSchema>;
export type UpdateCustomerDto = z.infer<ReturnType<typeof customerSchema.partial>>;
