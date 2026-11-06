import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * INV-POS-CREDIT-LIMIT: a credit-limit rejection must name the actual
 * numbers — the limit, the customer's current balance, the amount this
 * sale would add, and the excess over the limit — in one Arabic message.
 *
 * Why one helper: the same CUSTOMER_CREDIT_LIMIT rejection is thrown
 * from the create path and the edit path of SalesWriteService and from
 * SalesFinanceService.createCustomerLedgerEntry. Before this package
 * every site threw the bare English 'Customer credit limit exceeded',
 * which the backend error translator (translateErrorMessageFromCode)
 * does not know, so it fell through to the generic
 * 'تعذر تنفيذ العملية المطلوبة.' and the cashier never learned the
 * limit, the balance, or the excess. An Arabic message passes the
 * translator through untouched (its looksArabic branch), and the
 * frontend friendly-error mapper returns it as-is (it is not a
 * technical message), so the numbers reach the submit message
 * verbatim. No static code-map entry is added anywhere: a static
 * entry would replace this dynamic message with a number-less one.
 */
export function formatCreditLimitExceededMessage(input: {
  creditLimit: number;
  currentBalance: number;
  requestedAmount: number;
  digits: MoneyDigits;
}): string {
  const { digits } = input;
  const limit = roundMoney(Number(input.creditLimit || 0), digits);
  const balance = roundMoney(Number(input.currentBalance || 0), digits);
  const amount = roundMoney(Number(input.requestedAmount || 0), digits);
  const nextBalance = roundMoney(balance + amount, digits);
  const excess = roundMoney(nextBalance - limit, digits);
  const fmt = (value: number): string => roundMoney(value, digits).toFixed(digits);
  return (
    `تجاوز الحد الائتماني للعميل: الحد الائتماني ${fmt(limit)}، ` +
    `والرصيد الحالي ${fmt(balance)}، والمبلغ المطلوب ${fmt(amount)}، ` +
    `والزيادة عن الحد ${fmt(excess)}.`
  );
}
