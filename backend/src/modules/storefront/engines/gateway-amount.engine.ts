import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Gateway amount and currency conversions for storefront payments.
 *
 * Two rules, applied everywhere a gateway amount or currency is built or
 * verified:
 * 1. Amounts are converted at the currency's own ISO 4217 exponent. Stripe
 *    minor units are 0 for zero-decimal currencies (JPY, KRW, ...), 3 for
 *    KWD/BHD/OMR and their peers, and 2 otherwise; Tap amounts are major
 *    units rounded at the same exponent. A hard-coded x100 is wrong for
 *    every currency whose exponent is not 2.
 * 2. The currency sent to a gateway — and checked on its webhook — is
 *    always the tenant's own base currency. No provider may silently
 *    substitute another currency (a Tap charge for an EGP tenant used to
 *    go out denominated SAR, and the webhook check then passed by
 *    construction because it compared the same substituted currency).
 * Paymob/XPay are EGP-only by integration contract and keep returning EGP.
 * An unset base currency keeps the historical provider default (SAR for
 * Tap, USD otherwise): the defect was overriding a currency the tenant
 * did configure, not the default for one they never set.
 * These helpers never throw on a malformed currency code: an unreadable
 * code falls back to exponent 2, and the caller's existing fail-closed
 * checks (amount/currency mismatch -> review) stay the authority.
 */

/** ISO 4217 zero-decimal currencies: Stripe amounts are whole units. */
const zeroDecimalCurrencies = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function gatewayMinorUnitExponent(currency: string): 0 | 2 | 3 {
  const code = String(currency || '')
    .trim()
    .toUpperCase();
  if (zeroDecimalCurrencies.has(code)) return 0;
  try {
    return currencyMoneyDigits(code);
  } catch {
    return 2;
  }
}

/** Major units -> gateway minor units at the currency's exponent (Stripe unit_amount, webhook verification). */
export function toGatewayMinorAmount(amount: number, currency: string): number {
  return Math.round(Number(amount) * 10 ** gatewayMinorUnitExponent(currency));
}

/** A major-unit amount rounded at the currency's exponent (Tap charge payload). */
export function toGatewayMajorAmount(amount: number, currency: string): number {
  const factor = 10 ** gatewayMinorUnitExponent(currency);
  return Math.round(Number(amount) * factor) / factor;
}

/** The currency a gateway charge/webhook check must use for this provider and tenant base currency. */
export function resolveGatewayCurrency(provider: string, baseCurrency: string): string {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase();
  if (normalizedProvider === 'paymob' || normalizedProvider === 'xpay') return 'EGP';
  const code = String(baseCurrency || '')
    .trim()
    .toUpperCase();
  if (code) return code;
  return normalizedProvider === 'tap' ? 'SAR' : 'USD';
}
