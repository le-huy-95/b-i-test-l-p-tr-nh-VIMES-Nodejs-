/**
 * Giờ Việt Nam (UTC+7) cho ngày phiếu / timestamp stock documents.
 *
 * - toVnDate: lấy ngày lịch VN rồi lưu dạng UTC midnight (phù hợp Prisma @db.Date)
 * - format*: trả ISO có offset +07:00 cho client
 */
import { Decimal } from './decimal';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const DATE_ONLY_KEYS = new Set([
  'receiptDate',
  'issueDate',
  'effectiveDate',
  'sourceDocDate',
  'expiryDate',
  'manufactureDate',
]);

const DATE_TIME_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'approvedAt',
  'completedAt',
  'postedAt',
]);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Parse input thành Date UTC midnight của ngày lịch Asia/Ho_Chi_Minh. */
export function toVnDate(input: string | Date): Date {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(input)}`);
  }
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

/** Format @db.Date (UTC midnight của ngày đã lưu) thành đầu ngày VN. */
export function formatVnDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T00:00:00.000+07:00`;
}

/** Format timestamp thật sang wall-clock VN (+07:00). */
export function formatVnDateTime(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  return `${vn.getUTCFullYear()}-${pad2(vn.getUTCMonth() + 1)}-${pad2(vn.getUTCDate())}T${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())}:${pad2(vn.getUTCSeconds())}.${pad3(vn.getUTCMilliseconds())}+07:00`;
}

function formatKnownDateField(key: string, value: Date | string): string | Date | string {
  if (typeof value === 'string' && value.endsWith('+07:00')) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  if (DATE_ONLY_KEYS.has(key)) return formatVnDateOnly(d);
  if (DATE_TIME_KEYS.has(key)) return formatVnDateTime(d);
  return value;
}

function mapValue(key: string | null, value: unknown): unknown {
  if (key && (value instanceof Date || typeof value === 'string')) {
    if (DATE_ONLY_KEYS.has(key) || DATE_TIME_KEYS.has(key)) {
      return formatKnownDateField(key, value);
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapValue(null, item));
  }
  // Prisma/decimal.js Decimal is an object; do not Object.entries it into {s,e,d}
  if (Decimal.isDecimal(value)) {
    return value;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapValue(k, v);
    }
    return out;
  }
  return value;
}

/** Deep-map Date fields trên payload phiếu sang ISO +07:00. */
export function withVnTimestamps<T>(value: T): T {
  return mapValue(null, value) as T;
}
