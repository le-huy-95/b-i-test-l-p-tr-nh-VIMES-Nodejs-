/**
 * Mở rộng kiểu TypeScript cho Express Request.
 *
 * Khai báo user (AuthUser) và tenant (TenantContext) gắn vào req sau middleware auth,
 * cùng type AuthedRequest cho route bắt buộc đã đăng nhập.
 */
import { Request } from "express";
import { TenantRole } from "../infra/prisma-types";

/* Thông tin người dùng đã xác thực — gắn bởi middleware JWT */
export interface AuthUser {
  id: string;
  tokenVersion: number;
  isPlatformAdmin: boolean;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

/* Ngữ cảnh tenant hiện tại — vai trò và phạm vi kho được phép truy cập */
export interface TenantContext {
  id: string;
  role: TenantRole;
  warehouseIds: string[] | "all";
}

/* Mở rộng namespace Express toàn cục để req.user và req.tenant có kiểu */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenant?: TenantContext;
    }
  }
}

/* Request đã đăng nhập — user bắt buộc; tenant tùy route (multi-tenant header) */
export type AuthedRequest = Request & {
  user: AuthUser;
  tenant?: TenantContext;
};
