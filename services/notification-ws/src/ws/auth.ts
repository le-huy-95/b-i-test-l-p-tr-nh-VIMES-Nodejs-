/**
 * Xác thực JWT cho WebSocket / Socket.IO.
 * Tách khỏi HTTP auth middleware vì handshake WS không đi Express.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../../../src/config/env';
import { prisma } from '../../../../src/infra/prisma';

/**
 * Verify access JWT + đối chiếu DB:
 * - user tồn tại, isActive
 * - tokenVersion khớp (logout-all / revoke sẽ tăng version → token cũ chết)
 *
 * Fail mọi trường hợp (hết hạn, chữ ký sai, user inactive) → null.
 * Caller trả 401 / 'unauthorized', không phân biệt lý do (tránh leak).
 */
export async function verifyWsToken(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      tokenVersion: number;
    };

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isActive: true, tokenVersion: true },
    });

    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      return null;
    }

    return { userId: payload.userId };
  } catch {
    return null;
  }
}

/**
 * Lấy token từ URL query (?token=) hoặc header Authorization: Bearer.
 * Query tiện cho browser WS (không set header upgrade dễ dàng).
 */
export function extractWsToken(url: string | undefined, headers: Record<string, string | string[] | undefined>): string | null {
  if (url) {
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);
    const token = params.get('token');
    if (token) return token;
  }

  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return null;
}
