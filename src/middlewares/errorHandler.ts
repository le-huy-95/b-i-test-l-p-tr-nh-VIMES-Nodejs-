/**
 * Xử lý lỗi tập trung cho Express và các helper liên quan HTTP.
 *
 * errorHandler: chuẩn hóa response JSON { success, error } cho AppError, Zod, Multer, 500.
 * notFoundHandler: 404 route không tồn tại.
 * asyncHandler: bọc async route để lỗi được chuyển tới errorHandler.
 * uploadHandler: bọc multer middleware và forward lỗi upload.
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../utils/app-error';
import { ZodError } from 'zod';

/**
 * Middleware lỗi cuối pipeline Express (4 tham số).
 * Map từng loại exception sang status code và mã lỗi API thống nhất.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Lỗi nghiệp vụ có chủ đích (AppError)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Lỗi validate body/query/params từ Zod
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.issues,
      },
    });
    return;
  }

  // Lỗi upload file (kích thước, số file...) — message khác nhau cho logo vs media
  if (err instanceof multer.MulterError) {
    const isLogoRoute = _req.path.endsWith('/tenants/current/logo');
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? isLogoRoute
          ? 'Logo file must be 2MB or smaller'
          : 'File must be 25MB or smaller'
        : isLogoRoute
          ? 'Invalid logo upload'
          : 'Invalid file upload';
    res.status(400).json({
      success: false,
      error: {
        code:
          err.code === 'LIMIT_FILE_SIZE'
            ? isLogoRoute
              ? 'LOGO_TOO_LARGE'
              : 'FILE_TOO_LARGE'
            : isLogoRoute
              ? 'INVALID_LOGO_UPLOAD'
              : 'INVALID_FILE_UPLOAD',
        message,
      },
    });
    return;
  }

  // Lỗi không mong đợi — log server, không lộ chi tiết ra client
  console.error('[Error]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal Server Error',
    },
  });
}

/** Handler cho route không khớp — đặt sau tất cả route definitions */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
}

/**
 * Bọc async route handler: reject/promise rejection → next(err) → errorHandler.
 * Tránh crash process khi quên try/catch trong route async.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Bọc middleware multer: chuyển lỗi upload sang next(err) thay vì treo request.
 */
export function uploadHandler(
  upload: (req: Request, res: Response, next: NextFunction) => void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  };
}
