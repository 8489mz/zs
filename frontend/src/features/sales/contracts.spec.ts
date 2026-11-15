/* INV-SALE-EDIT-NO-PAIDAMOUNT: the invoice-edit PUT payload must contain
 * ONLY fields UpsertSaleDto declares. The global requestValidationPipe
 * runs with whitelist + forbidNonWhitelisted, so any extra key is a 400
 * before the service runs — live trial 2026-11-15, invoice Z-261115-16456
 * (60.00, card): changing the payment channel card -> cash was rejected
 * twice with "الحقل paidAmount غير مسموح إرساله" even though the manager
 * code was accepted. The builder used to emit paidAmount (always 0),
 * subTotal, taxAmount and total on EVERY save, so ANY invoice edit
 * failed this way, not just payment-channel changes. The backend never
 * reads those four: updateSale derives paidAmount from the tender
 * allocation and recomputes totals server-side.
 *
 * RED (before the fix): buildSaleUpdatePayload returns a payload whose
 * keys include paidAmount, subTotal, taxAmount and total — the first
 * assertion below fails on 'paidAmount' in the result.
 * GREEN (after the fix): the built payload carries none of those keys
 * and still carries the edited fields (paymentChannel 'cash').
 */
import { describe, it, expect } from 'vitest';
import { buildSaleUpdatePayload } from './contracts';
import type { Sale } from '@/types/domain';

const cardSale = {
  id: '16456',
  docNo: 'Z-261115-16456',
  customerId: '',
  customerName: '',
  paymentType: 'cash',
  paymentChannel: 'card',
  subTotal: 60,
  discount: 0,
  taxRate: 0,
  taxAmount: 0,
  pricesIncludeTax: false,
  total: 60,
  paidAmount: 60,
  status: 'posted',
  note: '',
  createdBy: 'owner',
  branchId: '',
  branchName: '',
  locationId: '',
  locationName: '',
  date: '2026-11-15',
  items: [
    { productId: '7', name: 'Item', qty: 1, price: 60, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' },
  ],
} as Sale;

const editPayload = {
  paymentType: 'cash',
  paymentChannel: 'cash',
  discount: 0,
  note: '',
  editReason: 'تغيير طريقة الدفع',
  managerPin: '1234',
  items: [
    { productId: '7', qty: 1, price: 60, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' },
  ],
};

describe('buildSaleUpdatePayload (INV-SALE-EDIT-NO-PAIDAMOUNT)', () => {
  it('sends no paidAmount, subTotal, taxAmount or total — the fields UpsertSaleDto does not declare', () => {
    const result = buildSaleUpdatePayload(cardSale, editPayload) as Record<string, unknown>;

    expect('paidAmount' in result).toBe(false);
    expect('subTotal' in result).toBe(false);
    expect('taxAmount' in result).toBe(false);
    expect('total' in result).toBe(false);
  });

  it('sends exactly the whitelisted edit fields, nothing else', () => {
    const result = buildSaleUpdatePayload(cardSale, editPayload) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual([
      'branchId',
      'customerId',
      'discount',
      'editReason',
      'items',
      'locationId',
      'managerPin',
      'note',
      'paymentChannel',
      'paymentType',
      'pricesIncludeTax',
      'storeCreditUsed',
      'taxRate',
    ]);
  });

  it('keeps the edited payment channel card -> cash from the live trial', () => {
    const result = buildSaleUpdatePayload(cardSale, editPayload);

    expect(result.paymentChannel).toBe('cash');
    expect(result.paymentType).toBe('cash');
    expect(result.discount).toBe(0);
    expect(result.editReason).toBe('تغيير طريقة الدفع');
    expect(result.managerPin).toBe('1234');
    expect(result.items).toEqual([
      { productId: 7, qty: 1, unitName: 'قطعة', unitMultiplier: 1, price: 60, priceType: 'retail' },
    ]);
  });

  it('forces paymentChannel credit on a credit sale', () => {
    const result = buildSaleUpdatePayload(
      { ...cardSale, paymentType: 'credit', paymentChannel: 'credit', customerId: '9' },
      { ...editPayload, paymentType: 'credit', paymentChannel: 'credit' },
    );

    expect(result.paymentType).toBe('credit');
    expect(result.paymentChannel).toBe('credit');
    expect('paidAmount' in (result as Record<string, unknown>)).toBe(false);
  });
});
