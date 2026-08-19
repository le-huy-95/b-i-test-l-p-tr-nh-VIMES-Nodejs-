import crypto from 'crypto';

export interface RetryConfig {
  maxAttempts?: number; // tổng số lần thử (>=1), default 3
  baseDelayMs?: number; // delay cơ sở, default 200
  maxDelayMs?: number; // delay tối đa, default 5_000
  factor?: number; // hệ số tăng delay, default 2
  jitter?: boolean; // thêm jitter tránh thundering herd, default true
  shouldRetry?: (error: unknown, attempt: number) => boolean; // quyết định retry hay không
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultShouldRetry(): boolean {
  // Mặc định của withRetry chung: retry mọi lỗi cho tới maxAttempts.
  // Gọi việc thu hẹp (network/5xx/429...) qua tham số shouldRetry khi cần.
  return true;
}

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

/**
 * Generic async retry với exponential backoff + jitter.
 * - Nếu shouldRetry trả false → throw ngay lỗi hiện tại.
 * - Sau maxAttempts lần đều fail → throw lỗi của lần cuối.
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

      const jitterMs = jitter ? Math.random() * delay * 0.3 : 0;
      const wait = Math.min(delay + jitterMs, maxDelayMs);
      onRetry?.(err, attempt, wait);
      await sleep(wait);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  throw lastError;
}

export interface RetryableFetchOptions extends RetryConfig {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number; // default 10_000
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_NAMES = new Set(['TypeError', 'FetchError', 'AbortError', 'TimeoutError']);

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && NETWORK_ERROR_NAMES.has(error.name);
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function shouldRetryFetch(error: unknown): boolean {
  if (error instanceof IdempotentRequestError) {
    return error.retryable;
  }
  return isNetworkError(error);
}

/**
 * HTTP client wrapper dùng chung cho các request ra ngoài:
 * - Tự sinh Idempotency-Key (hoặc nhận sẵn) cho request có body, GIỮ NGUYÊN key qua các lần
 *   retry để server không chạy lại side-effect đã hoàn thành.
 * - Retry trên network error + HTTP 408/429/5xx với backoff.
 * - Không retry các lỗi 4xx khác (client error).
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