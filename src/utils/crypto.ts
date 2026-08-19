import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: { userId: string; tokenVersion: number }): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: { userId: string; jti: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): { userId: string; tokenVersion: number } {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string; tokenVersion: number };
}

export function verifyRefreshToken(token: string): { userId: string; jti: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string; jti: string };
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomOtp(length = 6): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
