/* INV-INSTAPAY-FIELD-MISSING: the supplier edit/create forms collect
 * the InstaPay account number in metadata.instapayAddress, but the
 * payload builders used to drop `metadata` entirely — so an edit
 * never saved the IPA (and even nulled the stored metadata), and a
 * create never saved it either. These specs pin the single shared
 * builder both mutations now use: the whole metadata object, IPA
 * included, reaches the server. */
import { describe, it, expect } from 'vitest';
import { buildSupplierPayload, supplierFormSchema } from './supplier.schema';

describe('buildSupplierPayload', () => {
  it('carries metadata with the InstaPay IPA to the server', () => {
    const payload = buildSupplierPayload({
      name: 'مورد اختبار',
      phone: '020',
      address: '',
      balance: 0,
      notes: '',
      metadata: { currency: 'EGP', supplierType: 'factory', instapayAddress: 'vendor@instapay' },
    });
    expect(payload.metadata).toEqual({
      currency: 'EGP',
      supplierType: 'factory',
      instapayAddress: 'vendor@instapay',
    });
    expect(payload.name).toBe('مورد اختبار');
  });

  it('carries the IPA on create values too (no metadata key is dropped)', () => {
    const payload = buildSupplierPayload({
      name: 'مورد جديد',
      metadata: { instapayAddress: 'new@instapay' },
    });
    expect(payload.metadata).toEqual({ instapayAddress: 'new@instapay' });
    expect(payload.balance).toBe(0);
  });

  it('passes metadata through unchanged when it holds no IPA', () => {
    const payload = buildSupplierPayload({
      name: 'مورد اختبار',
      metadata: { currency: 'USD', supplierType: 'factory' },
    });
    expect(payload.metadata).toEqual({ currency: 'USD', supplierType: 'factory' });
  });
});

describe('supplier form schema round-trips the IPA', () => {
  it('parses metadata.instapayAddress from the edit form values', () => {
    const parsed = supplierFormSchema.parse({
      name: 'مورد اختبار',
      phone: '020',
      address: '',
      balance: 0,
      notes: '',
      metadata: { currency: 'EGP', supplierType: 'factory', instapayAddress: 'vendor@instapay' },
    });
    const payload = buildSupplierPayload(parsed);
    expect((payload.metadata as Record<string, unknown>).instapayAddress).toBe('vendor@instapay');
  });
});
