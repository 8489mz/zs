import { AppError } from '../../../common/errors/app-error';

/** Allocate historical booked value cumulatively so the final credit owns the rounding residue. */
export function calculateCarrierCreditBaseAmount(
  invoiceForeign: number,
  invoiceBase: number,
  priorForeign: number,
  creditForeign: number,
): number {
  if (
    ![invoiceForeign, invoiceBase, priorForeign, creditForeign].every(Number.isFinite) ||
    invoiceForeign <= 0 ||
    invoiceBase <= 0 ||
    priorForeign < 0 ||
    creditForeign <= 0 ||
    priorForeign + creditForeign > invoiceForeign + 0.001
  ) {
    throw new AppError('قيمة الإشعار الدائن أو الرصيد الأصلي غير صالح', 'CARRIER_CREDIT_AMOUNT_INVALID', 400);
  }
  const cumulativeBase = Math.round(((priorForeign + creditForeign) / invoiceForeign) * invoiceBase * 100);
  const priorBase = Math.round((priorForeign / invoiceForeign) * invoiceBase * 100);
  const amount = (cumulativeBase - priorBase) / 100;
  if (amount <= 0) {
    throw new AppError('قيمة الإشعار الدائن أقل من دقة العملة الأساسية', 'CARRIER_CREDIT_AMOUNT_INVALID', 400);
  }
  return amount;
}
