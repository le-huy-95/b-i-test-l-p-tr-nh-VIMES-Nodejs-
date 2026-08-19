import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function toDecimalString(value: Decimal.Value, places = 4): string {
  return new Decimal(value).toFixed(places);
}
