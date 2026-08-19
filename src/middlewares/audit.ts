import { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';

export interface AuditContext {
  action: string;
  entityType: string;
  entityId?: string;
  entityCode?: string;
  changes?: unknown;
  metadata?: unknown;
}

declare global {
  namespace Express {
    interface Request {
      auditContext?: AuditContext;
    }
  }
}

export class AuditMiddleware {
  constructor(private readonly db: PrismaClient = prisma) {}

  setContext = (ctx: AuditContext) => (_req: Request, _res: Response, next: NextFunction) => {
    _req.auditContext = ctx;
    next();
  };

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

export function withAudit(entityType: string, action: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.auditContext = { entityType, action };
    next();
  };
}

export async function writeAuditLog(
  req: Request,
  entityType: string,
  entityId: string,
  action: string,
  extra?: Partial<AuditContext>,
): Promise<void> {
  return auditMiddleware.log(req, entityType, entityId, action, extra);
}
