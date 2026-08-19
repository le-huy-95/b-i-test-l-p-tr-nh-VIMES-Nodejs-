import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('fixed-hash'),
    }),
  },
}));

import { IdempotencyMiddleware } from '../../src/middlewares/idempotency';

const mockDb = {
  idempotencyRecord: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
};

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/v1/products',
    body: { name: 'x' },
    header: vi.fn().mockReturnValue('key-1'),
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    once: vi.fn(),
  } as unknown as Response;
  return res;
}

describe('idempotency middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips non-mutating methods', async () => {
    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const req = makeReq({ method: 'GET' });
    await mw.resolve(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDb.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('skips requests without Idempotency-Key header', async () => {
    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const req = makeReq({ header: vi.fn().mockReturnValue(undefined) });
    await mw.resolve(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDb.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('replays a completed response instead of running the handler again', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'r1',
      key: 'key-1',
      scope: 'user-1',
      requestHash: 'fixed-hash',
      status: 'completed',
      responseStatus: 201,
      responseBody: { success: true, data: { id: 'created-1' } },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq({ header: vi.fn().mockReturnValue('key-1') }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'created-1' } });
    expect(res.set).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
  });

  it('rejects a completed key reused with a different payload', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'r1',
      key: 'key-1',
      scope: 'user-1',
      requestHash: 'some-other-hash',
      status: 'completed',
      responseStatus: 201,
      responseBody: { success: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
      }),
    );
  });

  it('still runs the handler for a fresh key (creates in_progress record)', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue(null);
    mockDb.idempotencyRecord.create.mockResolvedValue({ id: 'r-new' });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledTimes(1);
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: 'key-1', status: 'in_progress' }),
      }),
    );
  });

  it('deletes an expired record and creates a new one', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'r-old',
      key: 'key-1',
      scope: 'user-1',
      status: 'completed',
      expiresAt: new Date(Date.now() - 60_000),
    });
    mockDb.idempotencyRecord.create.mockResolvedValue({ id: 'r-new' });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();

    await mw.resolve(makeReq(), makeRes(), next);

    expect(mockDb.idempotencyRecord.delete).toHaveBeenCalledWith({ where: { id: 'r-old' } });
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('resets a failed record to in_progress and allows re-run', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'r-failed',
      key: 'key-1',
      scope: 'user-1',
      requestHash: 'other-hash',
      status: 'failed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockDb.idempotencyRecord.update.mockResolvedValue({ id: 'r-failed' });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq(), res, next);

    expect(mockDb.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-failed' },
        data: expect.objectContaining({ status: 'in_progress', requestHash: 'fixed-hash' }),
      }),
    );
    expect(res.once).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when a concurrent request hits the unique constraint', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue(null);
    mockDb.idempotencyRecord.create.mockRejectedValue({ code: 'P2002', message: 'unique' });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' }),
      }),
    );
  });

  it('immediately continues on persistence failure (fail-open)', async () => {
    mockDb.idempotencyRecord.findUnique.mockRejectedValue(new Error('db down'));

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    await mw.resolve(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when another request with same key is in progress', async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'r1',
      key: 'key-1',
      scope: 'user-1',
      requestHash: 'fixed-hash',
      status: 'in_progress',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mw = new IdempotencyMiddleware({ db: mockDb as never });
    const next = vi.fn();
    const res = makeRes();

    await mw.resolve(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' }),
      }),
    );
  });
});