import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('generateNextCode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
  });

  it('generates sequential stock receipt codes', async () => {
    const { generateNextCode } = await import('../../src/utils/numbering');

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([{ current_value: 42n }]),
    } as never;

    await expect(generateNextCode('tenant-1', 'stock_receipt', trx)).resolves.toBe(
      'PNK-2026-000042',
    );
    expect(trx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic document prefix', async () => {
    const { generateNextCode } = await import('../../src/utils/numbering');

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([{ current_value: 7n }]),
    } as never;

    await expect(generateNextCode('tenant-1', 'unknown_doc', trx)).resolves.toBe(
      'DOC-2026-000007',
    );
  });
});
