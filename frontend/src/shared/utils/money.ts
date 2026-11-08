/*
 * INV-FE1-FRONTEND-BOOK-DIGITS (U6 FE1): canonical frontend money rounding.
 *
 * The frontend used to round money at hardcoded 2dp in every feature
 * (`Number(x.toFixed(2))`, `Math.round(x * 100) / 100`, local `roundMoney`
 * / `roundAmount` / `toMoney` helpers) while the backend rounds at the
 * tenant's book digits (2, or 3 for KWD/OMR/BHD/JOD/TND/IQD/LYD). On a
 * 3-decimal tenant the frontend truncated fils (and the POS derived
 * totals even mixed toFixed(2) and toFixed(3) legs in one computation),
 * so preview totals, payload totals, change due, split shares and
 * loyalty values disagreed with the journal the backend posts.
 *
 * This module mirrors `backend/src/modules/accounting/engines/
 * money-minor-units.engine.ts` exactly: the same 3-decimal currency
 * set, the same half-up `Math.round(amount * 10 ** digits) / 10 ** digits`
 * algorithm, the same fail-closed errors. Every computed-money site in
 * the frontend routes through it with the tenant's book digits; the
 * backend stays the posting authority and re-resolves digits server-side.
 *
 * Pure module: zero imports, no React, no DOM, no localStorage — safe
 * to import from backend ts-node specs as well as from Vitest.
 * Display-only formatting (JSX `{x.toFixed(2)}`, receipt text) is out
 * of scope for this package and stays untouched.
 */

export type MoneyDigits = 2 | 3;

const threeDecimalCurrencies = new Set(['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']);

/*
 * Mirrors backend `currencyMoneyDigits` exactly, including the full
 * 3-decimal set. NOTE: the frontend's `getCurrencyDecimals` in
 * `lib/currencies.ts` only knows KWD/BHD/OMR — JOD/TND/IQD/LYD tenants
 * were silently rounded at 2dp by every display helper that used it.
 * This function is the correct mapping; fixing `getCurrencyDecimals`
 * itself belongs to FE3 (it owns `lib/`).
 *
 * Empty/undefined currency falls back to 2 (tenant settings still
 * loading — matches the UI's long-standing 'EGP' default). A malformed
 * non-empty code throws, like the backend.
 */
export function currencyMoneyDigits(currency: string | null | undefined): MoneyDigits {
  if (currency === null || currency === undefined || String(currency).trim() === '') return 2;
  const code = String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency code');
  return threeDecimalCurrencies.has(code) ? 3 : 2;
}

/*
 * Mirrors backend `roundMoney` exactly: half-up rounding at the given
 * book digits. Non-finite amounts throw; digits other than 2 | 3 throw.
 * Values already rounded at `digits` pass through unchanged (idempotent),
 * so re-rounding an already-rounded total is safe.
 */
export function roundMoneyValue(amount: number, digits: MoneyDigits): number {
  if (!Number.isFinite(amount)) throw new Error('Non-finite monetary amount');
  if (digits !== 2 && digits !== 3) throw new Error('Money digits must be 2 or 3');
  const factor = 10 ** digits;
  const minor = Math.round(amount * factor);
  if (!Number.isSafeInteger(minor)) throw new Error('Monetary amount exceeds safe range');
  return minor / factor;
}
