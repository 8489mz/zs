import { type MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

/** Retained exchange credit is a cash-equivalent liability in the tenant's base currency. */
export function exchangeStoreCreditAmount(retainedCredit: number, digits: MoneyDigits): number {
  if (!Number.isFinite(retainedCredit) || retainedCredit < 0) {
    throw new Error('Invalid exchange credit amount');
  }
  return roundMoney(retainedCredit, digits);
}

/** A posted sale with even one outstanding fil cannot issue exchange credit. */
export function hasUnpaidExchangeBalance(
  invoiceTotal: number,
  paidAmount: number,
  creditUsed: number,
  digits: MoneyDigits,
): boolean {
  if (![invoiceTotal, paidAmount, creditUsed].every(Number.isFinite)) {
    throw new Error('Invalid exchange invoice balance');
  }
  return roundMoney(invoiceTotal - paidAmount - creditUsed, digits) > 0;
}
