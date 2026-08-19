import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const DEFAULT_CACHE_DURATION = 60;

export interface CacheOptions {
  duration?: number;
  key?: (req: Request) => string;
}

export function etagCache(options: CacheOptions = {}) {
  const { duration = DEFAULT_CACHE_DURATION, key } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = key ? key(req) : `${req.originalUrl}`;
    const hash = crypto.createHash('md5').update(cacheKey).digest('hex');
    const etag = `"${hash}"`;

    res.set('Cache-Control', `public, max-age=${duration}`);
    res.set('ETag', etag);

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch.includes(etag)) {
      res.status(304).end();
      return;
    }

    const originalSend = res.send;
    res.send = function (body?: unknown): Response {
      if (res.statusCode === 200) {
        res.set('ETag', etag);
      }
      return originalSend.call(this, body);
    };

    next();
  };
}

export function noCache(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}
