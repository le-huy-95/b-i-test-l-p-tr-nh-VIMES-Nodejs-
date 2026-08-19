import { z } from 'zod';

export const stockBalanceQuerySchema = z.object({
  warehouseId: z.string().optional(),
});

export const stockMovementQuerySchema = z.object({
  warehouseId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const lowStockQuerySchema = z.object({
  warehouseId: z.string().optional(),
});

export const expiryAlertQuerySchema = z.object({
  warehouseId: z.string().optional(),
  days: z.coerce.number().int().positive().default(30),
});

export const warehouseOverviewQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  expiryDays: z.coerce.number().int().positive().default(30),
  recentLimit: z.coerce.number().int().positive().max(20).default(5),
});

export const organizationOverviewQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  expiryDays: z.coerce.number().int().positive().default(30),
  topLimit: z.coerce.number().int().positive().max(20).default(5),
  recentLimit: z.coerce.number().int().positive().max(20).default(5),
});

export type StockBalanceQueryDto = z.infer<typeof stockBalanceQuerySchema>;
export type StockMovementQueryDto = z.infer<typeof stockMovementQuerySchema>;
export type WarehouseOverviewQueryDto = z.infer<typeof warehouseOverviewQuerySchema>;
export type OrganizationOverviewQueryDto = z.infer<typeof organizationOverviewQuerySchema>;
