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
  jobId: z.string().optional(),
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
});

export type CustomerPaymentInput = z.input<typeof customerPaymentSchema>;
export type CustomerPaymentOutput = z.output<typeof customerPaymentSchema>;
export type SupplierPaymentInput = z.input<typeof supplierPaymentSchema>;
export type SupplierPaymentOutput = z.output<typeof supplierPaymentSchema>;
