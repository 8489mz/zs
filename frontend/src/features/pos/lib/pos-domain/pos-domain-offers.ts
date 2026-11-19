import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { Product, ProductOffer } from '@/types/domain';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { getOfferType, normalizeDateOnly, todayLocalIsoDate } from '@/features/pos/lib/pos-domain/pos-domain-helpers';

export function isOfferHappyHourActive(offer: ProductOffer, now = new Date()): boolean {
  // 1. Day of week check
  const days = offer.daysOfWeek || (offer as any).days_of_week;
  if (days && String(days).trim()) {
    const allowedDays = String(days).split(',').map((d) => Number(d.trim())).filter((d) => !Number.isNaN(d));
    if (allowedDays.length > 0) {
      const currentDay = now.getDay(); // 0: Sunday, ..., 5: Friday, 6: Saturday
      if (!allowedDays.includes(currentDay)) {
        return false;
      }
    }
  }

  // 2. Time range check (HH:mm)
  const start = offer.happyHourStart || (offer as any).happy_hour_start;
  const end = offer.happyHourEnd || (offer as any).happy_hour_end;
  if (start && end && String(start).trim() && String(end).trim()) {
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = String(start).split(':').map(Number);
    const [endH, endM] = String(end).split(':').map(Number);
    const startTotalMinutes = (startH || 0) * 60 + (startM || 0);
    const endTotalMinutes = (endH || 0) * 60 + (endM || 0);

    if (startTotalMinutes <= endTotalMinutes) {
      if (currentTotalMinutes < startTotalMinutes || currentTotalMinutes > endTotalMinutes) {
        return false;
      }
    } else {
      // Overnight range
      if (currentTotalMinutes < startTotalMinutes && currentTotalMinutes > endTotalMinutes) {
        return false;
      }
    }
  }

  return true;
}

export function getOfferAppliedPrice(basePrice: number, offer: ProductOffer, qty = 1, digits: MoneyDigits) {
  const type = getOfferType(offer);
  const offerVal = Number(offer.value || 0);
  if (type === 'percent') return roundMoneyValue(Math.max(0, basePrice - ((basePrice * offerVal) / 100)), digits);
  if (type === 'fixed') return roundMoneyValue(Math.max(0, basePrice - offerVal), digits);
  if (type === 'price') return roundMoneyValue(Math.max(0, offerVal), digits);
  if (type === 'bundle') {
    const minQty = getOfferMinQty(offer);
    const normalizedQty = Math.max(1, qty);
    if (normalizedQty < minQty) return roundMoneyValue(basePrice, digits);
    const bundles = Math.floor(normalizedQty / minQty);
    const remainder = normalizedQty % minQty;
    const total = (bundles * offerVal) + (remainder * basePrice);
    return roundMoneyValue(total / normalizedQty, digits);
  }
  if (type === 'bogo') {
    const buyQty = Math.max(1, Number(offer.bogoBuyQty ?? (offer as any).bogo_buy_qty ?? 1));
    const getQty = Math.max(1, Number(offer.bogoGetQty ?? (offer as any).bogo_get_qty ?? 1));
    const discountPercent = Math.min(100, Math.max(0, Number(offer.bogoDiscountPercent ?? (offer as any).bogo_discount_percent ?? (offerVal || 100))));
    const normalizedQty = Math.max(1, qty);
    const cycle = buyQty + getQty;
    if (normalizedQty < cycle) return roundMoneyValue(basePrice, digits);

    const fullCycles = Math.floor(normalizedQty / cycle);
    const remainder = normalizedQty % cycle;
    const discountedUnits = (fullCycles * getQty) + Math.max(0, remainder - buyQty);
    const discountPerUnit = (basePrice * discountPercent) / 100;
    const totalDiscount = discountedUnits * discountPerUnit;
    const totalLinePrice = Math.max(0, (normalizedQty * basePrice) - totalDiscount);
    return roundMoneyValue(totalLinePrice / normalizedQty, digits);
  }
  return roundMoneyValue(basePrice, digits);
}

export function getOfferMinQty(offer: ProductOffer) {
  if (offer.type === 'bogo' || (offer as any).offer_type === 'bogo') {
    const buyQty = Math.max(1, Number(offer.bogoBuyQty ?? (offer as any).bogo_buy_qty ?? 1));
    const getQty = Math.max(1, Number(offer.bogoGetQty ?? (offer as any).bogo_get_qty ?? 1));
    return buyQty + getQty;
  }
  return Math.max(1, Number(offer.minQty ?? (offer as any).min_qty ?? 1));
}

export function getApplicableOffer(product: Product, priceType: PosPriceType, qty = 1, now = new Date(), unitMultiplier = 1, digits: MoneyDigits) {
  // INV-VAN-PRICE-LIST-WIRING: offers apply to retail only. Tier
  // prices (wholesale / half-wholesale / credit) are the authority
  // for their customers and never stack with a public offer — the
  // server enforces the same rule in calculateAllowedSaleUnitPrice.
  if (priceType !== 'retail') return null;
  const today = todayLocalIsoDate();
  const basePrice = Number(product.retailPrice || 0) * unitMultiplier;
  const normalizedQty = Math.max(1, qty);
  const applicableOffers = (product.offers || []).filter((offer) => {
    const from = normalizeDateOnly(offer.from || offer.start_date || '');
    const to = normalizeDateOnly(offer.to || offer.end_date || '');
    const minQty = getOfferMinQty(offer);

    const isDateValid = (!from || from <= today) && (!to || to >= today);
    if (!isDateValid) return false;

    const isQtyValid = normalizedQty >= minQty;
    if (!isQtyValid) return false;

    if (!isOfferHappyHourActive(offer, now)) return false;

    return true;
  });

  if (!applicableOffers.length) return null;

  return [...applicableOffers].sort((left, right) => {
    const leftPrice = getOfferAppliedPrice(basePrice, left, normalizedQty, digits);
    const rightPrice = getOfferAppliedPrice(basePrice, right, normalizedQty, digits);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;

    const leftMinQty = getOfferMinQty(left);
    const rightMinQty = getOfferMinQty(right);
    if (leftMinQty !== rightMinQty) return rightMinQty - leftMinQty;
    return Number(right.value || 0) - Number(left.value || 0);
  })[0] || null;
}
