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

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier card carries a
 * top-level type (عادي / فري لانس) and an overdraft limit. The type
 * is NOT metadata.supplierType (factory/shipping/customs — the import
 * classification); it is its own field, and the limit is null when
 * the owner leaves it empty (uncapped), never 0. */
describe('buildSupplierPayload carries supplierType + overdraftLimit', () => {
  it('passes a freelancer with a 5,000 limit through', () => {
    const payload = buildSupplierPayload({
      name: 'فري لانس',
      supplierType: 'freelancer',
      overdraftLimit: 5000,
    });
    expect(payload.supplierType).toBe('freelancer');
    expect(payload.overdraftLimit).toBe(5000);
  });

  it('passes an empty limit through as null (uncapped), never 0', () => {
    const payload = buildSupplierPayload({
      name: 'مورد عادي',
      supplierType: 'supplier',
      overdraftLimit: null,
    });
    expect(payload.supplierType).toBe('supplier');
    expect(payload.overdraftLimit).toBeNull();
  });

  it('parses both fields from the edit form values', () => {
    const parsed = supplierFormSchema.parse({
      name: 'فري لانس',
      balance: 0,
      supplierType: 'freelancer',
      overdraftLimit: 5000,
    });
    expect(parsed.supplierType).toBe('freelancer');
    expect(parsed.overdraftLimit).toBe(5000);
    expect(buildSupplierPayload(parsed).overdraftLimit).toBe(5000);
  });

  it('rejects a negative overdraft limit', () => {
    expect(() => supplierFormSchema.parse({
      name: 'فري لانس',
      balance: 0,
      supplierType: 'freelancer',
      overdraftLimit: -100,
    })).toThrow();
  });

  it('rejects an unknown supplier type', () => {
    expect(() => supplierFormSchema.parse({
      name: 'مورد',
      balance: 0,
      supplierType: 'employee',
    })).toThrow();
  });
});
