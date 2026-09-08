/**
 * Ghi audit log hành động người dùng trên entity (tenant, document, stock...).
 *
 * Cung cấp:
 * - AuditMiddleware: setContext (gắn metadata trước handler) và log (ghi DB)
 * - withAudit: middleware factory gắn entityType + action vào req.auditContext
 * - writeAuditLog: helper gọi trực tiếp từ service sau khi thao tác thành công
 *
 * Ghi log best-effort — lỗi DB audit không làm fail request chính.
 */
import { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';

/** Dữ liệu ngữ cảnh audit gắn trên request hoặc truyền khi ghi log */
export interface AuditContext {
  action: string;
  entityType: string;
  entityId?: string;
  entityCode?: string;
  changes?: unknown;
  metadata?: unknown;
}

/** Mở rộng Express Request với auditContext tùy chọn */
declare global {
  namespace Express {
    interface Request {
      auditContext?: AuditContext;
    }
  }
}

export class AuditMiddleware {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Factory middleware: gán auditContext cố định lên request trước khi vào route handler.
   */
  setContext = (ctx: AuditContext) => (_req: Request, _res: Response, next: NextFunction) => {
    _req.auditContext = ctx;
    next();
  };

  /**
   * Ghi một dòng audit_log: lấy tenant/user từ req, IP, user-agent; merge extra nếu có.
   */
  log = async (req: Request, entityType: string, entityId: string, action: string, extra?: Partial<AuditContext>) => {
    try {
      await this.db.auditLog.create({
        data: {
          tenantId: req.tenant?.id ?? null,
          userId: req.user?.id ?? null,
          action: action as never,
          entityType,
          entityId,
          entityCode: extra?.entityCode,
          changes: extra?.changes as never,
          metadata: extra?.metadata as never,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        },
      });
    } catch (err) {
      console.error('[AuditLog] Failed to write audit log:', err);
    }
  };
}

export const auditMiddleware = new AuditMiddleware(prisma);

/**
 * Middleware đơn giản: đặt entityType và action trên req.auditContext.
 * Handler/service có thể đọc context này hoặc gọi writeAuditLog sau.
 */
export function withAudit(entityType: string, action: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.auditContext = { entityType, action };
    next();
  };
}

/** Wrapper tiện lợi gọi auditMiddleware.log từ module service */
export async function writeAuditLog(
  req: Request,
  entityType: string,
  entityId: string,
  action: string,
  extra?: Partial<AuditContext>,
): Promise<void> {
  return auditMiddleware.log(req, entityType, entityId, action, extra);
}
