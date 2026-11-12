/*
 * POS render-cost: formatCurrency / formatDate must reuse cached Intl
 * formatters instead of constructing one per call. A formatter build
 * is expensive; the POS path formats every price on every render, so
 * one construction per decimals value (and one for formatDate) is the
 * bound. Output must stay byte-identical to a freshly constructed
 * formatter — no rounding, grouping or locale change.
 *
 * These cases drive the real formatCurrency / formatDate over the real
 * getCurrencyDecimals: equality against a fresh Intl reference for
 * every decimals value, and a construction count bound via a spy on
 * the global Intl constructors with a fresh module instance per test.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatCurrency, formatDate } from './format';
import { getCurrencyDecimals } from './currencies';

afterEach(() => {
  vi.restoreAllMocks();
});

const VALUES: Array<number | string | null | undefined> = [
  0,
  75,
  51.33,
  100.005,
  -12.5,
  '200',
  null,
  undefined,
];

// One code per decimals value the system actually has: 2dp and 3dp.
const CODES_BY_DECIMALS: Array<{ code: string; decimals: number }> = [
  { code: 'EGP', decimals: 2 },
  { code: 'USD', decimals: 2 },
  { code: 'KWD', decimals: 3 },
  { code: 'OMR', decimals: 3 },
];

function freshCurrencyReference(value: number | string | null | undefined, decimals: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value || 0));
}

describe('formatCurrency — cached output equals a fresh Intl reference', () => {
  it.each(CODES_BY_DECIMALS)(
    'matches the fresh reference for every value at $decimals dp ($code)',
    ({ code, decimals }) => {
      expect(getCurrencyDecimals(code)).toBe(decimals);
      for (const value of VALUES) {
        expect(formatCurrency(value, code)).toBe(freshCurrencyReference(value, decimals));
      }
    },
  );

  it('formatCurrencyWithSymbol / WithCode route through the same cached formatter', async () => {
    const { formatCurrencyWithSymbol, formatCurrencyWithCode } = await import('./format');
    expect(formatCurrencyWithSymbol(75, 'EGP')).toBe(
      `${freshCurrencyReference(75, 2)} ج.م`,
    );
    expect(formatCurrencyWithCode(51.33, 'KWD')).toBe(
      `${freshCurrencyReference(51.33, 3)} KWD`,
    );
  });
});

describe('formatDate — cached output equals a fresh Intl reference', () => {
  const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };

  it('matches the fresh reference for Date, string and timestamp inputs', () => {
    const inputs: Array<string | Date | number> = [
      new Date(2026, 10, 12, 14, 30),
      '2026-11-12T14:30:00',
      new Date(2026, 0, 1, 0, 5).getTime(),
    ];
    for (const input of inputs) {
      const date = input instanceof Date ? input : new Date(input);
      expect(formatDate(input)).toBe(
        new Intl.DateTimeFormat('en-US', DATE_OPTIONS).format(date),
      );
    }
  });

  it('keeps the falsy / invalid fallbacks', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatCurrency — formatter construction count', () => {
  // A bare vi.spyOn replaces the constructor with a mock whose `new`
  // returns a mock object without .format, so the spy must delegate to
  // the real constructor while still recording every construction.
  function countingNumberFormatSpy() {
    const RealNumberFormat = Intl.NumberFormat;
    return vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (
      this: Intl.NumberFormat,
      ...args: ConstructorParameters<typeof Intl.NumberFormat>
    ) {
      return new RealNumberFormat(...args);
    } as typeof Intl.NumberFormat);
  }

  it('constructs at most 1 NumberFormat across 1000 calls with the same decimals', async () => {
    const spy = countingNumberFormatSpy();
    vi.resetModules();
    const { formatCurrency: freshFormat } = await import('./format');
    for (let i = 0; i < 1000; i++) freshFormat(75 + i, 'EGP');
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('constructs at most one NumberFormat per distinct decimals value', async () => {
    const spy = countingNumberFormatSpy();
    vi.resetModules();
    const { formatCurrency: freshFormat, formatCurrencyWithSymbol } = await import('./format');
    for (let i = 0; i < 500; i++) freshFormat(75 + i, 'EGP');
    for (let i = 0; i < 500; i++) freshFormat(51.33 + i, 'KWD');
    // Symbol/code variants route through formatCurrency: no extra formatters.
    formatCurrencyWithSymbol(75, 'USD');
    formatCurrencyWithSymbol(75, 'OMR');
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('formatDate — formatter construction count', () => {
  it('constructs at most 1 DateTimeFormat across 1000 calls', async () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      this: Intl.DateTimeFormat,
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ) {
      return new RealDateTimeFormat(...args);
    } as typeof Intl.DateTimeFormat);
    vi.resetModules();
    const { formatDate: freshFormatDate } = await import('./format');
    const base = new Date(2026, 10, 12, 14, 30).getTime();
    for (let i = 0; i < 1000; i++) freshFormatDate(new Date(base + i * 60_000));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
