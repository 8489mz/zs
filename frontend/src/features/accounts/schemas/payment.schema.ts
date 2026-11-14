import { z } from 'zod';

export const customerPaymentSchema = z.object({
  customerId: z.string().min(1, 'اختر العميل'),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  note: z.string().optional(),
  paymentChannel: z.enum(['cash','bank','card','wallet','instapay']).optional(),
  /* INV-INSTAPAY-FIELD-MISSING: the customer InstaPay account number
   * (IPA) this receipt came from; the form shows the field only when
   * the channel is InstaPay. */
  instapayAddress: z.string().trim().max(100).optional(),
  /* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: the real
   * transfer reference of this receipt; the form shows the field for
   * every non-cash channel and requires at least 3 characters there
   * (enforced in the form; the backend gate refuses shorter). */
  transferReference: z.string().trim().max(100).optional(),
  jobId: z.string().optional(),
}).superRefine((values, ctx) => {
  /* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: a non-cash
   * receipt without a real transfer reference is refused by the
   * backend gate, so the form refuses it first with a field error
   * instead of sending a receipt that can never succeed. */
  const channel = values.paymentChannel || 'cash';
  if (channel !== 'cash' && (values.transferReference || '').trim().length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transferReference'],
      message: 'أدخل رقم مرجع التحويل (3 أحرف/أرقام على الأقل) — التحصيل غير النقدي لا يتم بدون مرجع.',
    });
  }
});

export const supplierPaymentSchema = z.object({
  supplierId: z.string().min(1, 'اختر المورد'),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  note: z.string().optional(),
  paymentChannel: z.enum(['cash','bank','card','wallet','instapay']).optional(),
  /* INV-INSTAPAY-FIELD-MISSING: the supplier InstaPay account number
   * (IPA) this payment was sent to; the form shows the field only
   * when the channel is InstaPay. */
  instapayAddress: z.string().trim().max(100).optional(),
  /* INV-SUPPLIER-ADVANCE-UI-WIRING: true marks this payment as a
   * supplier ADVANCE (Dr 1185, payable untouched) instead of a
   * settlement of a payable. The form shows it as a "دفعة مقدمة"
   * toggle, defaulting ON for a zero-balance supplier — before this
   * field existed the UI could never send an advance at all, so a
   * 200 advance for a zero-balance supplier failed SUPPLIER_NO_BALANCE
   * with a generic error (live trial 2026-11-14). */
  isAdvance: z.boolean().optional(),
});

export type CustomerPaymentInput = z.input<typeof customerPaymentSchema>;
export type CustomerPaymentOutput = z.output<typeof customerPaymentSchema>;
export type SupplierPaymentInput = z.input<typeof supplierPaymentSchema>;
export type SupplierPaymentOutput = z.output<typeof supplierPaymentSchema>;
