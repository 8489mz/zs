import { roundMoney, type MoneyDigits } from './money-minor-units.engine';

const transitions: Record<string, Record<string, readonly string[]>> = {
  receivable: {
    in_safe: ['deposit', 'collect', 'bounce', 'endorse', 'return', 'cancel'],
    under_collection: ['collect', 'bounce', 'restore_to_safe', 'return', 'cancel'],
    bounced: ['restore_to_safe', 'return', 'cancel'],
  },
  payable: {
    issued: ['clear', 'bounce', 'return', 'cancel'],
    bounced: ['restore_to_safe', 'return', 'cancel'],
  },
};

export function assertPdcTransition(type: string, status: string, action: string): void {
  if (!transitions[type]?.[status]?.includes(action))
    throw new Error('انتقال حالة الشيك غير مسموح؛ لا يمكن تكرار أثر مالي أو إعادة فتح حالة نهائية.');
}

/**
 * Book amount of a cheque in the TENANT's minor units. digits is required,
 * not defaulted: the old hard-coded *100 silently truncated every 3-decimal
 * book amount (KWD 10.123 -> 10.12) in all ten posting methods, even though
 * pdcCurrencySnapshot computes base_amount correctly at book precision.
 * insertPostedJournal's bookDigits normalisation cannot recover an amount
 * truncated before it arrives, so the truncation must not happen here.
 */
export function pdcBookAmount(cheque: { base_amount?: unknown; amount: unknown }, digits: MoneyDigits): number {
  const amount = Number(cheque.base_amount);
  if (cheque.base_amount == null || !Number.isFinite(amount) || amount <= 0)
    throw new Error('القيمة الدفترية للشيك غير مثبتة؛ يلزم مطابقة الشيك القديم قبل تحريكه.');
  return roundMoney(amount, digits);
}
