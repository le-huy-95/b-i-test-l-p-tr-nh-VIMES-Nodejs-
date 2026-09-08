/**
 * DỊCH VỤ TOKEN (JWT)
 * -------------------
 * Phát hành access/refresh token, làm mới phiên, đăng xuất (revoke refresh token).
 * Refresh token lưu hash trong DB, access token stateless ký bằng JWT.
 */
import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { AppError } from '../../utils/app-error';
import {
  randomToken,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/crypto';
import { logoutSchema, refreshTokenSchema } from '../../dto/auth.dto';
import type { TokenIssuer } from './token.port';

export class TokenService implements TokenIssuer {
  constructor(private readonly db: PrismaClient = prisma) {}

  async issueTokens(userId: string, tokenVersion: number) {
    const jti = randomToken();
    const accessToken = signAccessToken({ userId, tokenVersion });
    const refreshToken = signRefreshToken({ userId, jti });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(input: unknown) {
    const { refreshToken } = refreshTokenSchema.parse(input);

    let payload: { userId: string; jti: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid refresh token');
    }

    const hash = sha256(refreshToken);
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError('UNAUTHORIZED', 401, 'Refresh token revoked or expired');
    }

    await this.db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.db.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      throw new AppError('UNAUTHORIZED', 401, 'User inactive');
    }

    return this.issueTokens(user.id, user.tokenVersion);
  }

  async logout(input: unknown) {
    const { refreshToken, deviceId } = logoutSchema.parse(input);
    const hash = sha256(refreshToken);
    await this.db.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (deviceId) {
      const stored = await this.db.refreshToken.findUnique({
        where: { tokenHash: hash },
        select: { userId: true },
      });
      if (stored) {
        await this.db.userDevice.updateMany({
          where: { deviceId, userId: stored.userId, status: { not: 'deleted' } },
          data: { status: 'inactive' },
        });
      }
    }

    return { success: true };
  }
}

export const tokenService = new TokenService(prisma);
