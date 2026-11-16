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
  editReason: string;
  managerPin: string;
  items: Array<{ productId: string; qty: number; price: number; unitName: string; unitMultiplier: number; priceType: string }>;
}) {
  // INV-SALE-EDIT-NO-PAIDAMOUNT: this payload must contain ONLY fields
  // UpsertSaleDto declares. The global requestValidationPipe runs with
  // whitelist + forbidNonWhitelisted, so ANY extra key is a 400 before
  // the service runs. The builder used to emit paidAmount (always 0),
  // subTotal, taxAmount and total — none of them is a DTO field, so
  // EVERY invoice edit was rejected with "paidAmount غير مسموح إرساله",
  // not just payment-channel changes.
  // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the backend never reads the
  // payment fields for the legs anymore — updateSale derives paidAmount
  // from the STORED sale_payments rows and leaves them byte-identical,
  // and recomputes the totals server-side. paymentType/paymentChannel
  // still travel in the payload (the dialog sends the sale's stored
  // values verbatim) but they change nothing; a money correction goes
  // through POST /api/sales/:id/payment-adjustment instead.
  // The discount still rounds at the tenant's book digits (global
  // system currency; this flow carries no settings object).
  const digits = currencyMoneyDigits(getGlobalSystemCurrency());
  const discount = roundMoneyValue(Math.max(0, payload.discount || 0), digits);
  const taxRate = Number(sale.taxRate || 0);

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
    }))
  };
}
