/**
 * Tiện ích mã hóa và xác thực cho module auth.
 *
 * Bao gồm: băm/mật khẩu (bcrypt), ký và xác minh JWT (access/refresh token),
 * hash SHA-256, sinh OTP ngẫu nhiên và token bảo mật.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

/* --- Mật khẩu (bcrypt) --- */

/** Băm mật khẩu người dùng với cost factor 10 */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/** So sánh mật khẩu thô với hash đã lưu trong DB */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/* --- JWT Access Token --- */

/** Ký access token chứa userId và tokenVersion (dùng để vô hiệu hóa phiên cũ) */
export function signAccessToken(payload: { userId: string; tokenVersion: number }): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

/** Xác minh access token và trả về payload đã giải mã */
export function verifyAccessToken(token: string): { userId: string; tokenVersion: number } {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string; tokenVersion: number };
}

/* --- JWT Refresh Token --- */

/** Ký refresh token với jti (JWT ID) để quản lý thu hồi từng thiết bị */
export function signRefreshToken(payload: { userId: string; jti: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

/** Xác minh refresh token và trả về userId cùng jti */
export function verifyRefreshToken(token: string): { userId: string; jti: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string; jti: string };
}

/* --- Hash và token ngẫu nhiên --- */

/** Tính SHA-256 hex của chuỗi đầu vào (ví dụ: hash refresh token trước khi lưu DB) */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Sinh mã OTP số có độ dài cố định, zero-pad bên trái */
export function randomOtp(length = 6): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

/** Sinh token ngẫu nhiên 32 byte dạng hex (dùng cho reset password, session key, v.v.) */
export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
