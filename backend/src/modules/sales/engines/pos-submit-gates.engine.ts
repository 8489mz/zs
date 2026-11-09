import { AppError } from '../../../common/errors/app-error';

/*
 * INV-REST-PAID-GATES-2 (R4-D): POS submit gates.
 *
 * A pure gate, given computed values only — no DB, no pool handle, so
 * it is unit-testable without PGlite and callable from both createSale
 * and updateSale. It is the backend enforcement point for the gates
 * the POS submit paths share (handleSubmit, split-bill, instant
 * exchange): frontend checks exist too, but only this runs for every
 * POS submit, including the paths that bypass handleSubmit.
 *
 * Every rejection here is POS-source-only (D-R4D-4): conversions
 * (sales orders, quotations, storefront) send source 'dashboard' or
 * unset, and must keep their old shapes — deposit-carrying
 * conversions and guest COD conversions are untouched by these gates.
 */
export function assertPosSubmitGates(params: {
  source: string | null | undefined;
  customerId: number | string | null | undefined;
  paidAmount: number;
  collectibleTotal: number;
  total: number;
  orderType: string | null | undefined;
  collectionStatus: string | null | undefined;
  tableNumber: string | null | undefined;
  cardAmount: number;
  terminalApprovedAmount: number | null | undefined;
  terminalAuthCode: string | null | undefined;
  discount: number;
  subtotal: number;
}): void {
  if (params.source !== 'pos') return;

  // I44 (D-R4D-2): a zero total is not a sale. Zero-total is exactly
  // the 100%-discount case (line prices must be > 0); comps are a
  // future feature, not a silent zero sale.
  if (Number(params.total || 0) <= 0) {
    throw new AppError('إجمالي الفاتورة غير صالح — لا يمكن إتمام بيع بقيمة صفر.', 'ZERO_TOTAL_SALE', 400);
  }

  // I42: a dine-in sale must name its table.
  if (params.orderType === 'dine_in' && !String(params.tableNumber || '').trim()) {
    throw new AppError('اختر طاولة أولًا لطلبات الصالة.', 'DINE_IN_TABLE_REQUIRED', 400);
  }

  // I43 (D-R4D-3): any unpaid remainder needs a customer to carry the
  // debt. The old `!isDelivery` carve-out let a COD delivery with no
  // customer post as a cash sale, paid 0, with no debtor and no
  // receivable. With a customer the sale stays cash/COD and the
  // customer-ledger debt is written by the caller — never reclassified
  // to credit (the silent flip is gone for POS sales).
  const remainingDebt = Number(params.collectibleTotal || 0) - Number(params.paidAmount || 0);
  const hasCustomer = params.customerId !== null && params.customerId !== undefined && String(params.customerId).trim() !== '';
  if (remainingDebt > 0.0001 && !hasCustomer) {
    throw new AppError('المبلغ غير المسدد يحتاج عميلًا مسجلًا.', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
  }

  // I40 (D-R4D-5): when the terminal approved an amount, the card leg
  // must equal it. The pin fires only when both the auth code and the
  // approved amount are present — a manual-auth-code path without an
  // amount stays unpinned.
  const approvedAmount = Number(params.terminalApprovedAmount || 0);
  if (String(params.terminalAuthCode || '').trim() && approvedAmount > 0) {
    if (Math.abs(Number(params.cardAmount || 0) - approvedAmount) > 0.0001) {
      throw new AppError('المبلغ المعتمد من ماكينة الدفع لا يطابق مبلغ البطاقة.', 'TERMINAL_AMOUNT_MISMATCH', 422);
    }
  }

  // I39(b) mirror: the discount may not exceed the cart-line subtotal.
  // (The service already throws INVALID_DISCOUNT at the pre-pass; this
  // keeps the gate self-contained for the updateSale call site too.)
  if (Number(params.discount || 0) > Number(params.subtotal || 0)) {
    throw new AppError('الخصم أكبر من إجمالي الأصناف.', 'INVALID_DISCOUNT', 400);
  }
}
