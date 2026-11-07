/* INV-INSTAPAY-FIELD-MISSING: the payment forms never sent an
 * InstaPay account number (IPA) anywhere — the shared payment forms
 * had no channel selector at all, the balance-card forms offered
 * InstaPay with no IPA field, and the DTOs had no IPA field to carry
 * (the global pipe is whitelist + forbidNonWhitelisted). These specs
 * pin the payload builders the forms go through: the IPA travels,
 * trimmed, only for an InstaPay payment, and the supplier payment
 * forms prefill it from the IPA saved on the supplier record. */
import { describe, it, expect } from 'vitest';
import {
  buildCustomerPaymentPayload,
  buildSupplierPaymentPayload,
  normalizePaymentInstapayAddress,
  readSupplierInstapayAddress,
} from './contracts';
import { customerPaymentSchema, supplierPaymentSchema } from './schemas/payment.schema';
import { buildSettleSupplierPaymentSchedulePayload } from './api/supplier-balance-schedule.api';

describe('normalizePaymentInstapayAddress', () => {
  it('keeps a trimmed IPA for an InstaPay payment', () => {
    expect(normalizePaymentInstapayAddress('instapay', '  ahmed@instapay  ')).toBe('ahmed@instapay');
  });

  it('drops the IPA for any other channel', () => {
    expect(normalizePaymentInstapayAddress('cash', 'ahmed@instapay')).toBeUndefined();
    expect(normalizePaymentInstapayAddress('bank', 'ahmed@instapay')).toBeUndefined();
    expect(normalizePaymentInstapayAddress('card', 'ahmed@instapay')).toBeUndefined();
    expect(normalizePaymentInstapayAddress('wallet', 'ahmed@instapay')).toBeUndefined();
    expect(normalizePaymentInstapayAddress(undefined, 'ahmed@instapay')).toBeUndefined();
  });

  it('drops a blank IPA even for InstaPay', () => {
    expect(normalizePaymentInstapayAddress('instapay', '')).toBeUndefined();
    expect(normalizePaymentInstapayAddress('instapay', '   ')).toBeUndefined();
    expect(normalizePaymentInstapayAddress('instapay', undefined)).toBeUndefined();
  });
});

describe('readSupplierInstapayAddress', () => {
  it('reads the IPA saved on the supplier record', () => {
    expect(readSupplierInstapayAddress({ metadata: { instapayAddress: 'vendor@instapay' } })).toBe(
      'vendor@instapay',
    );
  });

  it('trims the saved IPA', () => {
    expect(readSupplierInstapayAddress({ metadata: { instapayAddress: '  vendor@instapay  ' } })).toBe(
      'vendor@instapay',
    );
  });

  it('returns empty when nothing is saved', () => {
    expect(readSupplierInstapayAddress(undefined)).toBe('');
    expect(readSupplierInstapayAddress(null)).toBe('');
    expect(readSupplierInstapayAddress({})).toBe('');
    expect(readSupplierInstapayAddress({ metadata: {} })).toBe('');
    expect(readSupplierInstapayAddress({ metadata: 'vendor@instapay' })).toBe('');
    expect(readSupplierInstapayAddress({ metadata: { instapayAddress: 42 } })).toBe('');
  });
});

describe('party payment payloads carry the IPA', () => {
  it('supplier payment via InstaPay carries the trimmed IPA', () => {
    const payload = buildSupplierPaymentPayload({
      supplierId: '7',
      amount: 250,
      paymentChannel: 'instapay',
      instapayAddress: '  ahmed@instapay  ',
    });
    expect(payload.paymentChannel).toBe('instapay');
    expect(payload.instapayAddress).toBe('ahmed@instapay');
    expect(payload.amount).toBe(250);
  });

  it('supplier payment via cash drops the IPA', () => {
    const payload = buildSupplierPaymentPayload({
      supplierId: '7',
      amount: 250,
      paymentChannel: 'cash',
      instapayAddress: 'ahmed@instapay',
    });
    expect(payload.paymentChannel).toBe('cash');
    expect(payload.instapayAddress).toBeUndefined();
  });

  it('customer receipt via InstaPay carries the trimmed IPA', () => {
    const payload = buildCustomerPaymentPayload({
      customerId: '3',
      amount: 150,
      paymentChannel: 'instapay',
      instapayAddress: 'sara@instapay',
    });
    expect(payload.paymentChannel).toBe('instapay');
    expect(payload.instapayAddress).toBe('sara@instapay');
  });

  it('customer receipt via cash drops the IPA', () => {
    const payload = buildCustomerPaymentPayload({
      customerId: '3',
      amount: 150,
      paymentChannel: 'cash',
      instapayAddress: 'sara@instapay',
    });
    expect(payload.instapayAddress).toBeUndefined();
  });

  it('installment settlement via InstaPay carries the trimmed IPA', () => {
    const payload = buildSettleSupplierPaymentSchedulePayload({
      amount: 400,
      paymentChannel: 'instapay',
      instapayAddress: '  supplier@instapay  ',
      note: 'قسط 1',
    });
    expect(payload.paymentChannel).toBe('instapay');
    expect(payload.instapayAddress).toBe('supplier@instapay');
    expect(payload.amount).toBe(400);
    expect(payload.note).toBe('قسط 1');
  });

  it('installment settlement via cash drops the IPA', () => {
    const payload = buildSettleSupplierPaymentSchedulePayload({
      amount: 400,
      paymentChannel: 'cash',
      instapayAddress: 'supplier@instapay',
    });
    expect(payload.instapayAddress).toBeUndefined();
  });
});

describe('payment form schemas accept the IPA', () => {
  it('supplier payment schema keeps a trimmed IPA', () => {
    const parsed = supplierPaymentSchema.parse({
      supplierId: '7',
      amount: 250,
      paymentChannel: 'instapay',
      instapayAddress: '  ahmed@instapay  ',
    });
    expect(parsed.instapayAddress).toBe('ahmed@instapay');
  });

  it('customer payment schema keeps a trimmed IPA', () => {
    const parsed = customerPaymentSchema.parse({
      customerId: '3',
      amount: 150,
      paymentChannel: 'instapay',
      instapayAddress: 'sara@instapay',
    });
    expect(parsed.instapayAddress).toBe('sara@instapay');
  });

  it('an over-long IPA is rejected by the schema', () => {
    expect(() =>
      supplierPaymentSchema.parse({
        supplierId: '7',
        amount: 250,
        paymentChannel: 'instapay',
        instapayAddress: 'x'.repeat(101),
      }),
    ).toThrow();
  });
});
