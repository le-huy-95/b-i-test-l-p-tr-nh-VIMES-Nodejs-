import { describe, expect, it, vi } from 'vitest';
import {
  withRetry,
  fetchWithRetry,
  createIdempotencyKey,
  IdempotentRequestError,
} from '../../src/utils/retry';

describe('withRetry', () => {
  it('returns result of first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success then returns value', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    await expect(withRetry(fn, { maxAttempts: 4, baseDelayMs: 1 })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no-retry'));
    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow('no-retry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes attempt number to fn', async () => {
    const seen: number[] = [];
    const fn = vi.fn(async (attempt: number) => {
      seen.push(attempt);
      if (attempt < 3) throw new Error('x');
      return true;
    });
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('fetchWithRetry', () => {
  it('reuses the same Idempotency-Key across retries', async () => {
    const body = { name: 'x' };
    const seenKeys: (string | null)[] = [];

    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      seenKeys.push((init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? null);
      if (seenKeys.length === 1) {
        return new Response('{}', { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('http://x/api', { json: body, maxAttempts: 3, baseDelayMs: 1 });

    expect(resp.status).toBe(200);
    expect(seenKeys.length).toBe(2);
    expect(seenKeys[1]).toBeTruthy();
    expect(seenKeys[0]).toBe(seenKeys[1]);
    vi.unstubAllGlobals();
  });

  it('does not retry on 4xx client errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 422 }));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      fetchWithRetry('http://x/api', { json: { a: 1 }, maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 422, retryable: false });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('retries 429 and 5xx statuses', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls += 1;
      return new Response('{}', { status: calls === 1 ? 429 : 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('http://x/api', { json: { a: 1 }, maxAttempts: 3, baseDelayMs: 1 });
    expect(resp.status).toBe(200);
    expect(calls).toBe(2);
    vi.unstubAllGlobals();
  });

  it('retries network errors', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('http://x/api', { json: {}, maxAttempts: 3, baseDelayMs: 1 });
    expect(resp.status).toBe(200);
    vi.unstubAllGlobals();
  });
});

describe('createIdempotencyKey', () => {
  it('generates a unique key each call', () => {
    const a = createIdempotencyKey();
    const b = createIdempotencyKey();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('exports IdempotentRequestError with retryable flag', () => {
    const err = new IdempotentRequestError('x', 503, true);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(503);
  });
});