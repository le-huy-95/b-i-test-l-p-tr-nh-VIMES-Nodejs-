/**
 * Middleware điều khiển HTTP caching cho response GET.
 *
 * etagCache: gắn Cache-Control + ETag, trả 304 Not Modified khi client gửi If-None-Match khớp.
 * noCache: tắt cache hoàn toàn — dùng cho dữ liệu nhạy cảm hoặc luôn cần fresh.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/** Thời gian max-age mặc định (giây) cho public cache */
const DEFAULT_CACHE_DURATION = 60;

export interface CacheOptions {
  /** Thời gian cache tính bằng giây (Cache-Control max-age) */
  duration?: number;
  /** Hàm tùy chỉnh khóa cache — mặc định dùng originalUrl */
  key?: (req: Request) => string;
}

/**
 * Middleware cache ETag cho request GET.
 * Hash MD5 của cache key → ETag; client gửi lại If-None-Match thì có thể nhận 304 không body.
 */
export function etagCache(options: CacheOptions = {}) {
  const { duration = DEFAULT_CACHE_DURATION, key } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Chỉ cache GET — POST/PUT/... bỏ qua
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

    // Monkey-patch res.send để đảm bảo ETag vẫn có khi handler gọi send
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

/**
 * Middleware buộc client/proxy không cache response.
 * Dùng cho API auth, dữ liệu tenant, hoặc báo cáo realtime.
 */
export function noCache(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}
