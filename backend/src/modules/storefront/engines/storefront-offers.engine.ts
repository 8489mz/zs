import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import { normalizePgDateOnly } from '../../../common/utils/tenant-timezone.util';

/**
 * Storefront Offers & Promotions Calculation Engine
 *
 * Invariant: All offer pricing calculations are strictly pure, deterministic,
 * and shared between catalog projection and checkout order validation.
 *
 * Book digits are REQUIRED (INV-STOREFRONT-PRICING-DIGITS): every price
 * this engine returns is shown to the shopper or charged at checkout,
 * so rounding at an assumed 2 decimals would silently cut a 3-decimal
 * tenant's offer prices. The old file-private 2-decimal rounder is
 * gone; rounding goes through the canonical engine at the caller's
 * digits. Discount PERCENTS stay plain integers (Math.round) — they
 * are not money.
 */

export interface RawStorefrontOffer {
  id?: number | string;
  product_id?: number | string;
  offer_type: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo' | string;
  value?: number | string | null;
  start_date?: string | Date | null;
  end_date?: string | Date | null;
  min_qty?: number | string | null;
  is_active?: boolean | null;
  bogo_buy_qty?: number | string | null;
  bogo_get_qty?: number | string | null;
  bogo_discount_percent?: number | string | null;
  happy_hour_start?: string | null;
  happy_hour_end?: string | null;
  days_of_week?: string | null;
}

export interface StorefrontOfferResult {
  hasDiscount: boolean;
  price: number;
  originalPrice: number;
  discountPercent: number;
  offerBadge?: string;
  offerType?: string;
  offerValue?: number;
  offerId?: number;
}

export function normalizeDateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    // UTC-midnight Dates built from DTO date-only strings: the UTC
    // slice IS the written day. NEVER pass a pg DATE row here --
    // node-postgres returns DATE columns as host-local-midnight
    // Dates, so this slice renders the previous day on any host
    // east of UTC; stored days go through normalizePgDateOnly.
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

export function todayLocalIsoDate(timezone = 'Africa/Cairo', now = new Date()): string {
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  try {
    return format(timezone);
  } catch {
    return format('Africa/Cairo');
  }
}

export function isOfferActiveNow(
  offer: RawStorefrontOffer,
  todayIso: string | undefined = undefined,
  now: Date = new Date(),
  timezone = 'Africa/Cairo',
): boolean {
  if (offer.is_active === false) return false;

  const activeDate = todayIso ?? todayLocalIsoDate(timezone, now);

  // Offer bounds are STORED pg DATEs (node-postgres local-midnight
  // Dates) -- they key through normalizePgDateOnly, never through
  // the UTC slice: an offer ending today must stay active today.
  // (The service loaders cast start/end to ::text, so production
  // rows arrive as strings and take the same branch either way;
  // the Date branch must still be right for any direct row.)
  const from = normalizePgDateOnly(offer.start_date);
  const to = normalizePgDateOnly(offer.end_date);
  if (from && from > activeDate) return false;
  if (to && to < activeDate) return false;

  // Day of week check (e.g. "0,1,2,3,4,5,6" or "sun,mon,...")
  if (offer.days_of_week && typeof offer.days_of_week === 'string' && offer.days_of_week.trim()) {
    const localDay = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
      .format(now)
      .toLowerCase();
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayNum = String(dayNames.indexOf(localDay)); // 0 is Sunday
    const daysAllowed = offer.days_of_week
      .toLowerCase()
      .split(',')
      .map((d) => d.trim());
    const currentName = localDay;
    if (!daysAllowed.includes(dayNum) && !daysAllowed.includes(currentName)) {
      return false;
    }
  }

  // Happy hour time range check (format "HH:MM")
  if (offer.happy_hour_start && offer.happy_hour_end) {
    const currentTimeStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const start = offer.happy_hour_start.slice(0, 5);
    const end = offer.happy_hour_end.slice(0, 5);
    const inWindow =
      start <= end
        ? currentTimeStr >= start && currentTimeStr <= end
        : currentTimeStr >= start || currentTimeStr <= end;
    if (!inWindow) {
      return false;
    }
  }

  return true;
}

export function calculateOfferAdjustedPrice(
  basePrice: number,
  offer: RawStorefrontOffer,
  qty: number = 1,
  digits: MoneyDigits,
): number {
  const offerValue = Number(offer.value || 0);
  const type = offer.offer_type;

  if (type === 'percent') {
    if (offerValue <= 0) return basePrice;
    const discount = (basePrice * offerValue) / 100;
    return roundBookMoney(Math.max(0, basePrice - discount), digits);
  }

  if (type === 'fixed') {
    if (offerValue <= 0) return basePrice;
    return roundBookMoney(Math.max(0, basePrice - offerValue), digits);
  }

  if (type === 'price') {
    if (offerValue <= 0) return basePrice;
    return roundBookMoney(Math.max(0, Math.min(basePrice, offerValue)), digits);
  }

  if (type === 'bundle') {
    const minQty = Math.max(1, Number(offer.min_qty || 1));
    const normalizedQty = Math.max(1, Number(qty || 1));
    if (normalizedQty < minQty) return roundBookMoney(basePrice, digits);
    const bundles = Math.floor(normalizedQty / minQty);
    const remainder = normalizedQty % minQty;
    const total = bundles * offerValue + remainder * basePrice;
    return roundBookMoney(total / normalizedQty, digits);
  }

  if (type === 'bogo') {
    const buyQ = Math.max(1, Number(offer.bogo_buy_qty || 1));
    const getQ = Math.max(1, Number(offer.bogo_get_qty || 1));
    const discPct = Math.min(100, Math.max(0, Number(offer.bogo_discount_percent ?? 100)));
    const normalizedQty = Math.max(1, Math.trunc(Number(qty || 1)));
    const freeUnits = Math.floor(normalizedQty / (buyQ + getQ)) * getQ;
    if (!freeUnits) return roundBookMoney(basePrice, digits);
    const total = normalizedQty * basePrice - (freeUnits * basePrice * discPct) / 100;
    return roundBookMoney(Math.max(0, total) / normalizedQty, digits);
  }

  return roundBookMoney(basePrice, digits);
}

export function resolveBestStorefrontOffer(
  basePrice: number,
  offers: RawStorefrontOffer[] | undefined,
  qty: number = 1,
  // Defaulted (not `?`) so the required `digits` may follow it: a
  // required parameter cannot follow an optional one (TS1016).
  todayIso: string | undefined = undefined,
  now: Date = new Date(),
  timezone = 'Africa/Cairo',
  digits: MoneyDigits,
): StorefrontOfferResult {
  const roundedBase = roundBookMoney(basePrice, digits);
  if (!offers || offers.length === 0 || roundedBase <= 0) {
    return {
      hasDiscount: false,
      price: roundedBase,
      originalPrice: roundedBase,
      discountPercent: 0,
    };
  }

  const activeOffers = offers.filter((off) =>
    isOfferActiveNow(off, todayIso ?? todayLocalIsoDate(timezone, now), now, timezone),
  );
  if (activeOffers.length === 0) {
    return {
      hasDiscount: false,
      price: roundedBase,
      originalPrice: roundedBase,
      discountPercent: 0,
    };
  }

  let bestResult: StorefrontOfferResult = {
    hasDiscount: false,
    price: roundedBase,
    originalPrice: roundedBase,
    discountPercent: 0,
  };

  for (const offer of activeOffers) {
    // If bundle/min_qty specified, verify qty
    const minQty = Math.max(1, Number(offer.min_qty || 1));
    if (qty < minQty) {
      continue;
    }

    if (offer.offer_type === 'bogo' && qty < Number(offer.bogo_buy_qty || 1) + Number(offer.bogo_get_qty || 1)) {
      // Show the promotion without lowering a single item's price before it qualifies.
      if (!bestResult.offerBadge) {
        bestResult.offerBadge = `اشتري ${offer.bogo_buy_qty || 1} واكسب ${offer.bogo_get_qty || 1}`;
        bestResult.offerType = 'bogo';
      }
      continue;
    }

    const discountedPrice = calculateOfferAdjustedPrice(roundedBase, offer, qty, digits);
    if (discountedPrice < roundedBase) {
      const discountAmount = roundedBase - discountedPrice;
      const discountPercent = Math.round((discountAmount / roundedBase) * 100);

      // We want the offer that gives the shopper the best saving (lowest price)
      if (!bestResult.hasDiscount || discountedPrice < bestResult.price) {
        let badge = `خصم ${discountPercent}%`;
        if (offer.offer_type === 'bundle') {
          badge = `عرض باقة (${offer.min_qty || 1} قطع)`;
        } else if (offer.offer_type === 'bogo') {
          const buyQ = Number(offer.bogo_buy_qty || 1);
          const getQ = Number(offer.bogo_get_qty || 1);
          const discPct = Number(offer.bogo_discount_percent ?? 100);
          badge = discPct === 100 ? `اشتري ${buyQ} واكسب ${getQ}` : `اشتري ${buyQ} و${getQ} بخصم ${discPct}%`;
        } else if (offer.offer_type === 'fixed') {
          badge = `وفر ${roundBookMoney(Number(offer.value), digits)} ج`;
        } else if (offer.offer_type === 'price') {
          badge = `سعر خاص`;
        }

        bestResult = {
          hasDiscount: true,
          price: discountedPrice,
          originalPrice: roundedBase,
          discountPercent,
          offerBadge: badge,
          offerType: offer.offer_type,
          offerValue: Number(offer.value || 0),
          offerId: offer.id ? Number(offer.id) : undefined,
        };
      }
    }
  }

  return bestResult;
}
