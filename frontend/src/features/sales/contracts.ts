import type { Sale } from '@/types/domain';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export function buildSaleCancelReason(docNo?: string) {
  return `إلغاء فاتورة البيع ${docNo || ''}`.trim();
}

export function buildSaleUpdatePayload(sale: Sale, payload: {
  paymentType: string;
  paymentChannel: string;
  discount: number;
  note: string;
  paidAmount: number;
  editReason: string;
  managerPin: string;
  items: Array<{ productId: string; qty: number; price: number; unitName: string; unitMultiplier: number; priceType: string }>;
}) {
  // INV-FE1-FRONTEND-BOOK-DIGITS: the sale-EDIT POST payload totals
  // round at the tenant's book digits. Digits resolve here from the
  // global system currency because this flow (dialog -> hook -> API)
  // carries no settings object; the backend remains the posting
  // authority and re-derives these totals on receipt.
  const digits = currencyMoneyDigits(getGlobalSystemCurrency());
  const subTotal = roundMoneyValue(payload.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0), digits);
  const discount = roundMoneyValue(Math.max(0, payload.discount || 0), digits);
  const taxable = Math.max(0, subTotal - discount);
  const taxRate = Number(sale.taxRate || 0);
  const taxAmount = !taxRate ? 0 : sale.pricesIncludeTax
    ? roundMoneyValue(taxable - taxable / (1 + taxRate / 100), digits)
    : roundMoneyValue(taxable * (taxRate / 100), digits);
  const total = sale.pricesIncludeTax ? roundMoneyValue(taxable, digits) : roundMoneyValue(taxable + taxAmount, digits);

  return {
    customerId: sale.customerId ? Number(sale.customerId) : null,
    paymentType: payload.paymentType === 'credit' ? 'credit' : 'cash',
    paymentChannel: payload.paymentType === 'credit'
      ? 'credit'
      : payload.paymentChannel === 'card'
        ? 'card'
        : payload.paymentChannel === 'wallet'
          ? 'wallet'
          : payload.paymentChannel === 'instapay'
            ? 'instapay'
            : 'cash',
    discount,
    note: payload.note || '',
    paidAmount: Number(payload.paidAmount || 0),
    editReason: String(payload.editReason || '').trim(),
    managerPin: String(payload.managerPin || '').trim(),
    storeCreditUsed: 0,
    taxRate,
    pricesIncludeTax: Boolean(sale.pricesIncludeTax),
    branchId: sale.branchId ? Number(sale.branchId) : null,
    locationId: sale.locationId ? Number(sale.locationId) : null,
    items: payload.items.map((item) => ({
      productId: Number(item.productId),
      qty: Number(item.qty),
      unitName: item.unitName,
      unitMultiplier: Number(item.unitMultiplier || 1),
      price: Number(item.price),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail'
    })),
    subTotal,
    taxAmount,
    total
  };
}
