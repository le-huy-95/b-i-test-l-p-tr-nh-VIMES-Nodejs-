/**
 * Wrapper cho thư viện decimal.js — xử lý số thập phân chính xác trong nghiệp vụ kho/tài chính.
 *
 * Cấu hình precision 28 chữ số, làm tròn HALF_UP; cung cấp helper tạo Decimal và format chuỗi.
 */
import Decimal from 'decimal.js';

/* Cấu hình toàn cục cho Decimal — tránh sai số float khi tính giá, số lượng, tồn kho */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Tạo instance Decimal từ giá trị đầu vào (số, chuỗi hoặc Decimal) */
export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Chuyển giá trị sang chuỗi cố định số chữ số thập phân (mặc định 4) */
export function toDecimalString(value: Decimal.Value, places = 4): string {
  return new Decimal(value).toFixed(places);
}
