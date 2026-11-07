import type { Product, Purchase } from '@/types/domain';
import type { PurchaseHeaderOutput } from '@/features/purchases/schemas/purchase.schema';

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

export function buildPurchaseDraftItem(product: Product, qty: number, cost: number): PurchaseDraftItem {
  const purchaseUnit = product.units?.find((unit) => unit.isPurchaseUnit) || product.units?.[0];
  const safeQty = Number(qty || 0);
  const safeCost = Number(cost || 0);
  return {
    productId: String(product.id),
    name: product.name,
    qty: safeQty,
    cost: safeCost,
    total: Number((safeQty * safeCost).toFixed(2)),
    unitName: purchaseUnit?.name || 'وحدة',
    unitMultiplier: Number(purchaseUnit?.multiplier || 1)
  };
}

export function upsertPurchaseDraftItem(items: PurchaseDraftItem[], incoming: PurchaseDraftItem) {
  const index = items.findIndex((item) => item.productId === incoming.productId && item.unitName === incoming.unitName);
  if (index === -1) return [...items, incoming];
  const next = items.slice();
  const mergedQty = Number((next[index].qty + incoming.qty).toFixed(3));
  next[index] = {
    ...next[index],
    qty: mergedQty,
    cost: incoming.cost,
    total: Number((mergedQty * incoming.cost).toFixed(2))
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
  attachments?: any[],
) {
  const discount = Number(Math.max(0, Number(values.discount || 0)).toFixed(2));
  // INV-LANDED-COST-ALLOCATION: freight entered on the invoice is sent as
  // landedCosts (single 'freight' cost, vendor = the invoice supplier,
  // which the backend requires) so it is allocated to item cost at
  // posting. No freight means no landedCosts key at all — the backend
  // then posts exactly as before.
  const freight = Number(Math.max(0, Number(values.freight || 0)).toFixed(2));
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
}) {
  const discount = Number(Math.max(0, payload.discount || 0).toFixed(2));
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
