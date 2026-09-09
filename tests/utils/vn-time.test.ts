import { describe, expect, it } from 'vitest';
import {
  formatVnDateOnly,
  formatVnDateTime,
  toVnDate,
  withVnTimestamps,
} from '../../src/utils/vn-time';

describe('toVnDate', () => {
  it('keeps calendar date for date-only UTC midnight', () => {
    expect(toVnDate('2026-09-07').toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('maps Vietnam local midnight sent as UTC to the VN calendar day', () => {
    // 2026-09-07 00:00 +07 = 2026-09-06T17:00:00.000Z
    expect(toVnDate('2026-09-06T17:00:00.000Z').toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  it('accepts explicit +07:00 offset', () => {
    expect(toVnDate('2026-09-07T00:00:00.000+07:00').toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });
});

describe('formatVnDateOnly / formatVnDateTime', () => {
  it('formats @db.Date midnight as start of VN day', () => {
    expect(formatVnDateOnly(new Date('2026-09-07T00:00:00.000Z'))).toBe(
      '2026-09-07T00:00:00.000+07:00',
    );
  });

  it('shifts real timestamps to +07:00 wall clock', () => {
    expect(formatVnDateTime(new Date('2026-09-07T10:00:00.000Z'))).toBe(
      '2026-09-07T17:00:00.000+07:00',
    );
  });
});

describe('withVnTimestamps', () => {
  it('serializes stock doc date and datetime fields recursively', () => {
    const payload = withVnTimestamps({
      receiptDate: new Date('2026-09-07T00:00:00.000Z'),
      createdAt: new Date('2026-09-07T10:00:00.000Z'),
      updatedAt: new Date('2026-09-07T10:30:00.000Z'),
      details: [
        {
          expiryDate: new Date('2027-01-01T00:00:00.000Z'),
          productId: 'p1',
        },
      ],
    });

    expect(payload).toEqual({
      receiptDate: '2026-09-07T00:00:00.000+07:00',
      createdAt: '2026-09-07T17:00:00.000+07:00',
      updatedAt: '2026-09-07T17:30:00.000+07:00',
      details: [
        {
          expiryDate: '2027-01-01T00:00:00.000+07:00',
          productId: 'p1',
        },
      ],
    });
  });

  it('maps paginated list data arrays', () => {
    const payload = withVnTimestamps({
      data: [
        {
          issueDate: new Date('2026-09-07T00:00:00.000Z'),
          createdAt: new Date('2026-09-07T03:00:00.000Z'),
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    expect(payload.data[0]).toEqual({
      issueDate: '2026-09-07T00:00:00.000+07:00',
      createdAt: '2026-09-07T10:00:00.000+07:00',
    });
    expect(payload.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('converts UTC ISO strings from Redis cache without double-shifting', () => {
    const once = withVnTimestamps({
      createdAt: '2026-09-07T10:00:00.000Z',
      receiptDate: '2026-09-07T00:00:00.000Z',
    });
    expect(once).toEqual({
      createdAt: '2026-09-07T17:00:00.000+07:00',
      receiptDate: '2026-09-07T00:00:00.000+07:00',
    });
    expect(withVnTimestamps(once)).toEqual(once);
  });
});
