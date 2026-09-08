/**
 * Tiện ích retry bất đồng bộ với exponential backoff và HTTP client có idempotency.
 *
 * Cung cấp withRetry cho logic chung, fetchWithRetry cho gọi API ra ngoài,
 * cùng IdempotentRequestError để phân biệt lỗi có thể retry hay không.
 */
import crypto from 'crypto';

/* --- Cấu hình retry --- */

/** Tùy chọn cho hàm withRetry: số lần thử, delay, jitter và callback tùy chỉnh */
export interface RetryConfig {
  maxAttempts?: number; // tổng số lần thử (>=1), default 3
  baseDelayMs?: number; // delay cơ sở, default 200
  maxDelayMs?: number; // delay tối đa, default 5_000
  factor?: number; // hệ số tăng delay, default 2
  jitter?: boolean; // thêm jitter tránh thundering herd, default true
  shouldRetry?: (error: unknown, attempt: number) => boolean; // quyết định retry hay không
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Sinh UUID làm Idempotency-Key cho request có body — giữ nguyên qua các lần retry */
export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Chờ bất đồng bộ trước khi thử lại */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mặc định retry mọi lỗi cho tới maxAttempts.
 * Caller nên truyền shouldRetry riêng để thu hẹp (network, 5xx, 429...).
 */
export function defaultShouldRetry(): boolean {
  return true;
}

/* --- Lỗi idempotent request --- */

/**
 * Lỗi bọc response HTTP hoặc network — có cờ retryable để withRetry quyết định thử lại.
 */
export class IdempotentRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'IdempotentRequestError';
  }
}

/* --- Retry generic --- */

/**
 * Thực thi hàm async với exponential backoff + jitter.
 * - shouldRetry trả false → ném lỗi ngay.
 * - Hết maxAttempts → ném lỗi của lần cuối.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    factor = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = config;

  let lastError: unknown;
  let delay = baseDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;

      let retry = false;
      try {
        retry = shouldRetry(err, attempt);
      } catch {
        retry = true;
      }
      if (!retry) break;

      /* Tính delay kèm jitter ngẫu nhiên, không vượt maxDelayMs */
      const jitterMs = jitter ? Math.random() * delay * 0.3 : 0;
      const wait = Math.min(delay + jitterMs, maxDelayMs);
      onRetry?.(err, attempt, wait);
      await sleep(wait);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  throw lastError;
}

/* --- HTTP fetch với retry --- */

/** Tùy chọn mở rộng RetryConfig cho fetchWithRetry (method, headers, body JSON, timeout) */
export interface RetryableFetchOptions extends RetryConfig {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number; // default 10_000
}

/* Mã HTTP và tên lỗi được coi là có thể retry */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_NAMES = new Set(['TypeError', 'FetchError', 'AbortError', 'TimeoutError']);

/** Kiểm tra lỗi mạng (fetch fail, timeout, abort) */
function isNetworkError(error: unknown): boolean {
  return error instanceof Error && NETWORK_ERROR_NAMES.has(error.name);
}

/** Kiểm tra mã HTTP có trong danh sách retry được không */
function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Quy tắc retry cho fetch: theo cờ retryable của IdempotentRequestError hoặc lỗi mạng */
function shouldRetryFetch(error: unknown): boolean {
  if (error instanceof IdempotentRequestError) {
    return error.retryable;
  }
  return isNetworkError(error);
}

/**
 * HTTP client wrapper dùng chung cho request ra ngoài:
 * - Tự sinh Idempotency-Key (hoặc nhận sẵn) cho request có body, giữ nguyên qua retry.
 * - Retry trên network error + HTTP 408/429/5xx với backoff.
 * - Không retry lỗi 4xx khác (client error).
 */
export async function fetchWithRetry(
  url: string,
  options: RetryableFetchOptions = {},
): Promise<Response> {
  const {
    headers,
    json,
    idempotencyKey,
    timeoutMs = 10_000,
    maxAttempts = 3,
    ...retryConfig
  } = options;

  const finalKey = idempotencyKey ?? (json !== undefined ? createIdempotencyKey() : undefined);
  const method = options.method ?? (json !== undefined ? 'POST' : 'GET');

  const run = async (_attempt: number): Promise<Response> => {
    const init: RequestInit = {
      method,
      headers: { ...headers },
    };

    if (json !== undefined) {
      init.headers = { 'Content-Type': 'application/json', ...init.headers };
      init.body = JSON.stringify(json);
    }

    if (finalKey) {
      init.headers = { 'Idempotency-Key': finalKey, ...init.headers };
    }

    /* Timeout qua AbortController — abort được coi là retryable */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof Error && err.name === 'AbortError'
        ? true
        : isNetworkError(err);
      throw new IdempotentRequestError(message, undefined, retryable, undefined);
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return response;

    /* Đọc body lỗi và ném IdempotentRequestError với cờ retry theo status */
    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    throw new IdempotentRequestError(
      `Request failed: ${response.status} ${response.statusText}`,
      response.status,
      isRetryableStatus(response.status),
      parsed,
    );
  };

  return withRetry(run, {
    maxAttempts,
    shouldRetry: shouldRetryFetch,
    ...retryConfig,
  });
}
