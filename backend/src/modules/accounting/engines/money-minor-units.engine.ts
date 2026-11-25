/** ISO 4217 minor-unit precision for base-currency bookkeeping. */
export type MoneyDigits = 2 | 3;

const threeDecimalCurrencies = new Set(['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']);

export function currencyMoneyDigits(currency: string): MoneyDigits {
  const code = String(currency || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency code');
  return threeDecimalCurrencies.has(code) ? 3 : 2;
}

export function toMinorUnits(amount: number, digits: MoneyDigits): number {
  const factor = 10 ** digits;
  if (!Number.isFinite(amount)) throw new Error('Non-finite monetary amount');
  const minor = Math.round(amount * factor);
  if (!Number.isSafeInteger(minor) || Math.abs(minor - amount * factor) > 0.000001) {
    throw new Error('Monetary amount exceeds currency minor-unit precision or safe range');
  }
  return minor;
}

export function fromMinorUnits(minor: number, digits: MoneyDigits): number {
  if (!Number.isSafeInteger(minor)) throw new Error('Invalid monetary minor units');
  return minor / 10 ** digits;
}

/** Explicit rounding is for derived values (FX and percentage allocations), not user inputs. */
export function roundMoney(amount: number, digits: MoneyDigits): number {
  if (!Number.isFinite(amount)) throw new Error('Non-finite monetary amount');
  const value = Math.round(amount * 10 ** digits);
  return fromMinorUnits(value, digits);
}
