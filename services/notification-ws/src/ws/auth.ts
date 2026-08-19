import jwt from 'jsonwebtoken';
import { env } from '../../../../src/config/env';
import { prisma } from '../../../../src/infra/prisma';

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
