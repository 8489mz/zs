import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { Product, ProductOffer, ProductUnit } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { safeUnits, getResolvedStockLimit, getOfferType } from '@/features/pos/lib/pos-domain/pos-domain-helpers';
import { getApplicableOffer, getOfferAppliedPrice, getOfferMinQty } from '@/features/pos/lib/pos-domain/pos-domain-offers';
import { trimSerialsToRequiredCount } from '@/features/pos/lib/pos-domain/pos-domain-serials';

export function getSaleUnit(product: Product): ProductUnit {
  return safeUnits(product).find((unit) => unit.isSaleUnit) || safeUnits(product)[0];
}

export function getStockLimit(product: Product, unit: ProductUnit = getSaleUnit(product)) {
  return getResolvedStockLimit(product, unit, false);
}

export const UNBOUNDED_STOCK_LIMIT = Number.MAX_SAFE_INTEGER;

export function isNegativeStockSalesAllowed(settings?: { allowNegativeStockSales?: unknown; allowSellingBelowStock?: unknown } | null) {
  return settings?.allowNegativeStockSales === true || settings?.allowSellingBelowStock === true;
}

export function getProductItemCode(product: Product, unit?: ProductUnit) {
  return String(product.styleCode || unit?.barcode || product.barcode || product.id || '').trim();
}

export function getProductPrice(product: Product, priceType: PosPriceType, qty = 1, unitMultiplier = 1, digits: MoneyDigits) {
  // INV-VAN-PRICE-LIST-WIRING: the 4-tier base. half_wholesale falls
  // back to wholesale (then retail) when NULL; credit falls back to
  // retail. Mirrors the server's calculateAllowedSaleUnitPrice tier
  // base so the displayed price is the price that posts.
  const basePrice = Number(
    priceType === 'wholesale' ? (product.wholesalePrice || product.retailPrice || 0)
    : priceType === 'half_wholesale' ? (product.halfWholesalePrice || product.wholesalePrice || product.retailPrice || 0)
    : priceType === 'credit' ? (product.creditPrice || product.retailPrice || 0)
    : (product.retailPrice || 0),
  ) * unitMultiplier;
  const offer = getApplicableOffer(product, priceType, qty, new Date(), unitMultiplier, digits);
  return offer ? getOfferAppliedPrice(basePrice, offer, qty, digits) : roundMoneyValue(basePrice, digits);
}

export function getOfferDisplayName(offer: ProductOffer) {
  const type = getOfferType(offer);
  const minQty = getOfferMinQty(offer);
  const qtyText = minQty > 1 ? ` عند شراء ${minQty} أو أكثر` : '';
  const val = Number(offer.value || 0);

  if (type === 'percent') return `تم تفعيل عرض: خصم ${val}%${qtyText}`;
  if (type === 'fixed') return `تم تفعيل عرض: خصم ${val} ثابت${qtyText}`;
  if (type === 'price') return `تم تفعيل عرض: سعر خاص ${val}${qtyText}`;
  if (type === 'bundle') return `تم تفعيل عرض باقة: ${minQty} قطع بسعر ${val} ${getGlobalCurrencySymbol()}`;
  return 'تم تفعيل عرض خاص';
}

export function repriceCartLine(item: PosItem, product: Product, qty: number, digits: MoneyDigits) {
  const unitMultiplier = Number.isFinite(item.unitMultiplier) && item.unitMultiplier > 0 ? item.unitMultiplier : 1;
  const basePrice = Number(item.priceType === 'wholesale' ? product.wholesalePrice || product.retailPrice || 0 : product.retailPrice || 0) * unitMultiplier;
  const offer = getApplicableOffer(product, item.priceType, qty, new Date(), unitMultiplier, digits);
  const effectivePrice = offer ? getOfferAppliedPrice(basePrice, offer, qty, digits) : roundMoneyValue(basePrice, digits);

  let origPrice = basePrice;
  let offerDiscount = 0;
  let offerName = offer ? getOfferDisplayName(offer) : undefined;

  if (offer) {
    offerDiscount = roundMoneyValue(Math.max(0, basePrice - effectivePrice), digits);
  } else if (item.priceType !== 'wholesale' && product.comboOriginalPrice && Number(product.comboOriginalPrice) > effectivePrice) {
    origPrice = Number(product.comboOriginalPrice);
    offerDiscount = roundMoneyValue(Math.max(0, origPrice - effectivePrice), digits);
    offerName = product.comboComponentsSummary
      ? `عرض مجمع (${product.comboComponentsSummary})`
      : 'عرض مجمع';
  }

  return {
    ...item,
    qty,
    price: effectivePrice,
    originalPrice: origPrice,
    offerDiscount,
    offerName,
    serials: trimSerialsToRequiredCount(item.serials, item, qty),
  };
}

export function getAvailableSaleProducts(products: Product[], search: string, filter = 'all') {
  const q = search.trim().toLowerCase();
  return products.filter((product) => {
    const type = product.itemType || (product as any).item_type;

    if (filter === 'raw_materials') {
      if (type !== 'raw_material') return false;
    } else if (filter === 'services') {
      if (type !== 'service') return false;
    } else {
      if (type === 'raw_material') return false;
    }

    // Always include the product in the catalog regardless of stock level.
    // Stock-zero products remain visible so the cashier can see them and get a
    // meaningful "out of stock" message when trying to add them.  The actual
    // stock enforcement happens inside addPosItem / handleAddProduct.
    if (!q) return true;
    const unitMatches = safeUnits(product).some((unit) => [unit.name, unit.barcode].some((value) => String(value || '').toLowerCase().includes(q)));
    return [product.name, product.barcode].some((value) => String(value || '').toLowerCase().includes(q)) || unitMatches;
  });
}
