import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../utils/app-error';
import { ZodError } from 'zod';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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

  console.error('[Error]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal Server Error',
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

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
