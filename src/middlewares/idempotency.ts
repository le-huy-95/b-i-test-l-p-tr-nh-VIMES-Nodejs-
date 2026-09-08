/**
 * Middleware idempotency cho request thay đổi dữ liệu (POST/PUT/PATCH/DELETE).
 *
 * Client gửi header Idempotency-Key để retry an toàn: cùng key + cùng payload →
 * trả lại response đã lưu; key đang xử lý → 409; key dùng với body khác → 409.
 * Lưu trạng thái trong bảng idempotencyRecord (Prisma), TTL cấu hình qua env.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { PrismaClient } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';
import { env } from '../config/env';

/** Các HTTP method cần dedupe — GET/HEAD không áp dụng */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export interface IdempotencyMiddlewareOptions {
  db?: PrismaClient;
  ttlHours?: number;
}

/**
 * Hash nội dung request (method + URL + body JSON) để phát hiện reuse key với payload khác.
 */
function hashRequest(req: Request): string {
  const body = req.body === undefined ? {} : req.body;
  return crypto
    .createHash('sha256')
    .update(`${req.method}\n${req.originalUrl}\n${JSON.stringify(body)}`)
    .digest('hex');
}

/**
 * Phạm vi idempotency key: gắn với user/tenant/IP để hai actor khác nhau không chia sẻ key.
 */
function scopeOf(req: Request): string {
  // Ưu tiên actor đã xác thực, fallback về IP khi middleware đứng ngoài auth.
  return req.user?.id ?? req.tenant?.id ?? req.ip ?? 'unknown';
}

/** Cập nhật bản ghi idempotency sau khi handler hoàn thành (completed hoặc failed) */
async function updateRecord(
  db: PrismaClient,
  recordId: string,
  status: 'completed' | 'failed',
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  try {
    await db.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status,
        responseStatus,
        responseBody: status === 'completed' && responseBody !== undefined ? (responseBody as object) : undefined,
      },
    });
  } catch (err) {
    console.warn('[Idempotency] failed to persist result:', err);
  }
}

/**
 * Hook res.json/res.send và sự kiện finish để capture status + body trả về client.
 */
function captureResponse(res: Response, recordId: string, db: PrismaClient): void {
  let body: unknown = undefined;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = ((value: unknown) => {
    body = value;
    return originalJson(value);
  }) as Response['json'];

  res.send = ((value: unknown) => {
    body = value;
    return originalSend(value);
  }) as Response['send'];

  res.once('finish', () => {
    const status = res.statusCode;
    void updateRecord(db, recordId, status < 500 ? 'completed' : 'failed', status, body);
  });
}

export class IdempotencyMiddleware {
  constructor(private readonly options: IdempotencyMiddlewareOptions = {}) {}

  /**
   * Handler chính: kiểm tra/tạo idempotency record, replay hoặc cho phép chạy handler.
   * Fail-open nếu DB lỗi — request vẫn được xử lý, chỉ mất tính dedupe tạm thời.
   */
  resolve = async (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method)) {
      return next();
    }

    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      return next();
    }

    const db = this.options.db ?? prisma;
    const ttlHours = this.options.ttlHours ?? env.IDEMPOTENCY_TTL_HOURS;

    const scope = scopeOf(req);
    const requestHash = hashRequest(req);

    try {
      let existing = await db.idempotencyRecord.findUnique({
        where: { key_scope: { key, scope } },
      });

      if (existing && existing.expiresAt < new Date()) {
        // Key quá hạn → xem như chưa từng tồn tại, delete và tạo mới ở phía dưới.
        await db.idempotencyRecord.delete({ where: { id: existing.id } });
        existing = null;
      }

      if (existing) {
        if (existing.status === 'completed') {
          // Key đã hoàn thành với payload khác → không cho dùng lại (tránh retry sai).
          if (existing.requestHash !== requestHash) {
            return res.status(409).json({
              success: false,
              error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was already used with a different request' },
            });
          }
          // Retry của request đã thành công → replay kết quả cũ, KHÔNG chạy lại logic.
          res.set('Idempotency-Replayed', 'true');
          return res.status(existing.responseStatus ?? 200).json(existing.responseBody);
        }
        if (existing.status === 'in_progress') {
          // Request trùng key đang chạy → 409 để client chờ/retry sau.
          return res.status(409).json({
            success: false,
            error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is already being processed' },
          });
        }

        // Status 'failed' → retry này được phép chạy lại; reset record về in_progress.
        const updated = await db.idempotencyRecord.update({
          where: { id: existing.id },
          data: {
            requestHash,
            status: 'in_progress',
            responseStatus: null,
            responseBody: undefined,
            expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
          },
        });
        captureResponse(res, updated.id, db);
        return next();
      }

      // Lần đầu: tạo mới + chạy handler.
      let record: { id: string };
      try {
        record = await db.idempotencyRecord.create({
          data: {
            key,
            scope,
            method: req.method,
            path: req.originalUrl,
            requestHash,
            status: 'in_progress',
            expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        // P2002: hai request cùng key chạy đồng thời — request rồi xem như đang xử lý.
        if (err && (err as { code?: string }).code === 'P2002') {
          return res.status(409).json({
            success: false,
            error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is already being processed' },
          });
        }
        throw err;
      }

      captureResponse(res, record.id, db);
      return next();
    } catch (err) {
      // DB lỗi → fail-open, không chặn request thật.
      console.warn('[Idempotency] middleware error, proceeding without dedupe:', err);
      return next();
    }
  };
}

export const idempotencyMiddlewareInstance = new IdempotencyMiddleware();
export const idempotencyMiddleware = idempotencyMiddlewareInstance.resolve;

/**
 * Job dọn dẹp bản ghi idempotency đã hết hạn — gọi định kỳ từ scheduler/cron.
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<void> {
  try {
    const result = await prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      console.log(`[Idempotency] cleaned up ${result.count} expired record(s)`);
    }
  } catch (err) {
    console.warn('[Idempotency] cleanup failed:', err);
  }
}
