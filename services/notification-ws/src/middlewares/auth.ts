import { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '../../../../src/infra/prisma-types';
import { prisma } from '../../../../src/infra/prisma';
import { AppError } from '../../../../src/utils/app-error';
import { verifyAccessToken } from '../../../../src/utils/crypto';

export class AuthMiddleware {
  constructor(private readonly db: PrismaClient = prisma) {}

  authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new AppError('UNAUTHORIZED', 401, 'Missing access token');
      }
      const token = header.slice(7);
      const payload = verifyAccessToken(token);

      const user = await this.db.user.findUnique({ where: { id: payload.userId } });
      if (!user || !user.isActive) {
        throw new AppError('UNAUTHORIZED', 401, 'User inactive or not found');
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        throw new AppError('TOKEN_REVOKED', 401, 'Token revoked, please login again');
      }

      req.user = {
        id: user.id,
        tokenVersion: user.tokenVersion,
        isPlatformAdmin: user.isPlatformAdmin,
        email: user.email,
        phone: user.phone,
        name: user.name,
      };
      next();
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(new AppError('UNAUTHORIZED', 401, 'Invalid access token'));
    }
  };
}

export const authMiddleware = new AuthMiddleware(prisma).authenticate;
