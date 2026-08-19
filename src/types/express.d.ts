import { Request } from 'express';
import { TenantRole } from '../infra/prisma-types';

export interface AuthUser {
  id: string;
  tokenVersion: number;
  isPlatformAdmin: boolean;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export interface TenantContext {
  id: string;
  role: TenantRole;
  warehouseIds: string[] | 'all';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenant?: TenantContext;
    }
  }
}

export type AuthedRequest = Request & {
  user: AuthUser;
  tenant?: TenantContext;
};
