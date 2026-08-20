import type { Request, Response, NextFunction } from 'express';

/**
 * Creates a controller handler that automatically wraps the result in { success: true, data }
 * and handles the response status code.
 * 
 * @param fn - Async function that returns the data
 * @param status - HTTP status code (default: 200)
 * @returns Express handler function
 */
export function ok(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  status = 200,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req, res, next);
      res.status(status).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Creates a controller handler for 201 Created responses.
 * 
 * @param fn - Async function that returns the created data
 * @returns Express handler function
 */
export function created(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return ok(fn, 201);
}

/**
 * Creates a controller handler for 204 No Content responses.
 * 
 * @param fn - Async function that performs the action
 * @returns Express handler function
 */
export function noContent(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
      res.status(204).json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}
