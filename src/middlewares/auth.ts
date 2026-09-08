/**
 * Middleware xác thực JWT access token và gắn thông tin user vào request.
 *
 * Luồng: đọc header Authorization Bearer → verify token → load user DB →
 * kiểm tra active + tokenVersion → gán req.user cho các route/handler phía sau.
 * Có thêm requirePlatformAdmin cho route chỉ dành quản trị nền tảng.
 */
import { Request, Response, NextFunction } from "express";
import type { PrismaClient } from "../infra/prisma-types";
import { prisma } from "../infra/prisma";
import { AppError } from "../utils/app-error";
import { verifyAccessToken } from "../utils/crypto";

/**
 * Class middleware auth — inject Prisma để test dễ dàng.
 * Method authenticate là handler Express chuẩn.
 */
export class AuthMiddleware {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Middleware bắt buộc đăng nhập: validate JWT và populate req.user.
   * Từ chối nếu thiếu token, user không tồn tại/inactive, hoặc token đã revoke (đổi tokenVersion).
   */
  authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw new AppError("UNAUTHORIZED", 401, "Missing access token");
      }
      const token = header.slice(7);
      const payload = verifyAccessToken(token);

      const user = await this.db.user.findUnique({
        where: { id: payload.userId },
      });
      if (!user || !user.isActive) {
        throw new AppError("UNAUTHORIZED", 401, "User inactive or not found");
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        throw new AppError(
          "TOKEN_REVOKED",
          401,
          "Token revoked, please login again",
        );
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
      next(new AppError("UNAUTHORIZED", 401, "Invalid access token"));
    }
  };
}

/** Instance mặc định dùng prisma production */
export const authMiddlewareInstance = new AuthMiddleware(prisma);
export const authMiddleware = authMiddlewareInstance.authenticate;

/**
 * Middleware yêu cầu user là platform admin (isPlatformAdmin).
 * Phải chạy sau authMiddleware để req.user đã có.
 */
export function requirePlatformAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.user?.isPlatformAdmin) {
    return next(new AppError("FORBIDDEN", 403, "Platform admin only"));
  }
  next();
}
