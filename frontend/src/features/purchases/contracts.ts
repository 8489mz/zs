import type { Product, Purchase } from '@/types/domain';
import type { PurchaseHeaderOutput } from '@/features/purchases/schemas/purchase.schema';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';

export interface PurchaseDraftItem {
  productId: string;
  name: string;
  qty: number;
  cost: number;
  total: number;
  unitName: string;
  unitMultiplier: number;
  locationId?: string | number;
  categoryId?: string | number;
}

/* INV-FE2-FRONTEND-BOOK-DIGITS (U6 FE2): computed purchase money rounds
 * at the tenant's book digits through the canonical helper, not hardcoded
 * 2dp. `digits` is a required trailing param (FE1 convention): the caller
 * resolves it from the document currency, falling back to the tenant base
 * currency — a pure function must never guess it. */
export function buildPurchaseDraftItem(product: Product, qty: number, cost: number, digits: MoneyDigits): PurchaseDraftItem {
  const purchaseUnit = product.units?.find((unit) => unit.isPurchaseUnit) || product.units?.[0];
  const safeQty = Number(qty || 0);
  const safeCost = Number(cost || 0);
  return {
    productId: String(product.id),
    name: product.name,
    qty: safeQty,
    cost: safeCost,
    total: roundMoneyValue(safeQty * safeCost, digits),
    unitName: purchaseUnit?.name || 'وحدة',
    unitMultiplier: Number(purchaseUnit?.multiplier || 1)
  };
}

export function upsertPurchaseDraftItem(items: PurchaseDraftItem[], incoming: PurchaseDraftItem, digits: MoneyDigits) {
  const index = items.findIndex((item) => item.productId === incoming.productId && item.unitName === incoming.unitName);
  if (index === -1) return [...items, incoming];
  const next = items.slice();
  const mergedQty = Number((next[index].qty + incoming.qty).toFixed(3));
  next[index] = {
    ...next[index],
    qty: mergedQty,
    cost: incoming.cost,
    total: roundMoneyValue(mergedQty * incoming.cost, digits)
  };
  return next;
}

export function buildPurchasePayload(
  values: PurchaseHeaderOutput & {
    confirmedDuplicateWarning?: boolean;
    allowDuplicateOverride?: boolean;
    duplicateOverrideReason?: string;
  },
  items: PurchaseDraftItem[],
  taxRate: number,
  pricesIncludeTax: boolean,
  digits: MoneyDigits,
  attachments?: any[],
) {
  // The discount/freight are in the document currency; the caller passes
  // its digits (document currency, tenant base as fallback). The param is
  // required on purpose: an optional digits with a silent 2 default would
  // reintroduce the KWD bug for any caller that forgets the argument.
  const discount = roundMoneyValue(Math.max(0, Number(values.discount || 0)), digits);
  // INV-LANDED-COST-ALLOCATION: freight entered on the invoice is sent as
  // landedCosts (single 'freight' cost, vendor = the invoice supplier,
  // which the backend requires) so it is allocated to item cost at
  // posting. No freight means no landedCosts key at all — the backend
  // then posts exactly as before.
  const freight = roundMoneyValue(Math.max(0, Number(values.freight || 0)), digits);
  return {
    supplierId: Number(values.supplierId),
    ...(freight > 0
      ? {
          landedCosts: {
            allocationMethod: 'value' as const,
            costs: [
              {
                costType: 'freight' as const,
                description: 'شحن',
                amount: freight,
                vendorId: Number(values.supplierId),
              },
            ],
          },
        }
      : {}),
    supplierInvoiceNo: values.supplierInvoiceNo ? String(values.supplierInvoiceNo).trim() : undefined,
    confirmedDuplicateWarning: Boolean(values.confirmedDuplicateWarning),
    allowDuplicateOverride: Boolean(values.allowDuplicateOverride),
    duplicateOverrideReason: values.duplicateOverrideReason ? String(values.duplicateOverrideReason).trim() : undefined,
    paymentType: values.paymentType,
    discount,
    branchId: values.branchId ? Number(values.branchId) : null,
    locationId: values.locationId ? Number(values.locationId) : null,
    note: values.note || '',
    taxRate: Number(taxRate || 0),
    pricesIncludeTax: Boolean(pricesIncludeTax),
    requiredDate: values.requiredDate ? new Date(values.requiredDate).toISOString() : null,
    currency: values.currency || '',
    companyName: values.companyName || '',
    contactId: values.contactId ? Number(values.contactId) : null,
    shippingAddressId: values.shippingAddressId ? Number(values.shippingAddressId) : null,
    costCenterId: values.costCenterId ? Number(values.costCenterId) : null,
    projectId: values.projectId ? Number(values.projectId) : null,
    termsTemplate: values.termsTemplate || '',
    attachments,
    items: items.map((item) => ({
      productId: Number(item.productId),
      qty: Number(item.qty),
      cost: Number(item.cost),
      unitName: item.unitName,
      unitMultiplier: Number(item.unitMultiplier || 1),
      locationId: item.locationId ? Number(item.locationId) : undefined,
      categoryId: item.categoryId ? Number(item.categoryId) : undefined
    }))
  };
}

export function buildPurchaseCancelReason(docNo?: string) {
  return `إلغاء فاتورة الشراء ${docNo || ''}`.trim();
}

export function buildPurchaseUpdatePayload(purchase: Purchase, payload: {
  paymentType: string;
  discount: number;
  note: string;
  editReason: string;
  managerPin: string;
  items: Array<{ productId: string; qty: number; cost: number; unitName: string; unitMultiplier: number; locationId?: string | number; categoryId?: string | number }>;
}, digits: MoneyDigits) {
  const discount = roundMoneyValue(Math.max(0, payload.discount || 0), digits);
  const taxRate = Number(purchase.taxRate || 0);

  return {
    supplierId: purchase.supplierId ? Number(purchase.supplierId) : null,
    paymentType: payload.paymentType === 'credit' ? 'credit' : 'cash',
    discount,
    note: payload.note || '',
    editReason: String(payload.editReason || '').trim(),
    managerPin: String(payload.managerPin || '').trim(),
    taxRate,
    pricesIncludeTax: Boolean(purchase.pricesIncludeTax),
    branchId: purchase.branchId ? Number(purchase.branchId) : null,
    locationId: purchase.locationId ? Number(purchase.locationId) : null,
    items: payload.items.map((item) => ({
      productId: Number(item.productId),
      qty: Number(item.qty),
      cost: Number(item.cost),
      unitName: item.unitName,
      unitMultiplier: Number(item.unitMultiplier || 1),
      locationId: item.locationId ? Number(item.locationId) : undefined,
      categoryId: item.categoryId ? Number(item.categoryId) : undefined
    }))
  };
}
