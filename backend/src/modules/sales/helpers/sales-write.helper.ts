import { AppError } from '../../../common/errors/app-error';
import { NormalizedSalePayload } from '../dto/upsert-sale.dto';
import { type MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

// Book digits are REQUIRED (INV-POS-OFFER-DIGITS): this rounder is
// used for every money amount the sale helper computes, so a silent
// `= 2` default would cut a 3-decimal tenant's lines to cents
// whenever a caller forgot the tenant's digits. Rounding is the
// canonical engine's at the caller's digits
// (INV-CANONICAL-ROUNDING-EVERYWHERE): the former EPSILON half-up
// branch for digits === 2 is gone, so binary half-cents just below
// the half round as the canonical engine rounds them.
function roundCurrency(value: number, digits: MoneyDigits): number {
  return roundMoney(Number(value || 0), digits);
}

export type SaleProductOfferRow = {
  offer_type?: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo' | string | null;
  value?: number | string | null;
  start_date?: string | Date | null;
  end_date?: string | Date | null;
  min_qty?: number | string | null;
  bogo_buy_qty?: number | string | null;
  bogo_get_qty?: number | string | null;
  bogo_discount_percent?: number | string | null;
  happy_hour_start?: string | null;
  happy_hour_end?: string | null;
  days_of_week?: string | null;
};

export type SaleProductRow = {
  id?: number | string | null;
  name?: string | null;
  name_en?: string | null;
  stock_qty?: number | string | null;
  cost_price?: number | string | null;
  retail_price?: number | string | null;
  wholesale_price?: number | string | null;
};

export type PreparedSaleItem = {
  productId: number;
  productName: string;
  productNameEn?: string | null;
  qty: number;
  unitPrice: number;
  originalPrice?: number;
  offerDiscount?: number;
  offerName?: string;
  lineTotal: number;
  unitName: string;
  unitMultiplier: number;
  priceType: 'retail' | 'wholesale';
  costPrice: number;
  requiredQty: number;
  beforeQty: number;
  afterQty: number;
  notes: string;
  modifiers: unknown;
  isService?: boolean;
  serials?: any;
  effectiveAllowedUnitPrice?: number;
};

export function buildPreparedSaleItem(
  product: SaleProductRow,
  item: NormalizedSalePayload['items'][number],
  options: { allowNegativeStockSales?: boolean; moneyDigits: MoneyDigits },
): PreparedSaleItem {
  const productName = String(product.name || '').trim();
  const exactRequiredQty = Number(item.qty || 0) * Number(item.unitMultiplier || 1);
  const requiredQty = Number(exactRequiredQty.toFixed(3));
  if (!Number.isFinite(exactRequiredQty) || exactRequiredQty <= 0 || Math.abs(exactRequiredQty - requiredQty) > 0.00000001) {
    throw new AppError('كمية المخزون يجب أن تكون بدقة ثلاث خانات عشرية كحد أقصى', 'SALE_QUANTITY_PRECISION_INVALID', 400);
  }
  const beforeQty = Number(product.stock_qty || 0);

  if (!options.allowNegativeStockSales && beforeQty < requiredQty) {
    throw new AppError(`Insufficient stock for ${productName || `#${item.productId}`}`, 'INSUFFICIENT_STOCK', 400);
  }

  const modifiersTotal = (item.modifiers || []).reduce((sum: number, mod: any) => sum + (Number(mod.price || 0) * Number(mod.qty || 1)), 0);
  const lineTotal = roundCurrency(Number(item.qty || 0) * (Number(item.price || 0) + modifiersTotal), options.moneyDigits);
  const modifiersCostTotal = (item.modifiers || []).reduce((sum: number, mod: any) => sum + (Number(mod.costPrice || 0) * Number(mod.qty || 1)), 0);

  return {
    productId: Number(product.id || item.productId),
    productName,
    productNameEn: product.name_en ? String(product.name_en).trim() : null,
    qty: Number(item.qty || 0),
    unitPrice: Number(item.price || 0),
    ...(item.originalPrice !== undefined ? { originalPrice: Number(item.originalPrice) } : {}),
    ...(item.offerDiscount !== undefined ? { offerDiscount: Number(item.offerDiscount) } : {}),
    ...(item.offerName !== undefined ? { offerName: item.offerName } : {}),
    lineTotal,
    unitName: String(item.unitName || 'قطعة').trim() || 'قطعة',
    unitMultiplier: Number(item.unitMultiplier || 1) || 1,
    priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail',
    // Stored as cost per sold unit on sale_items (not per base piece) so accounting COGS can use qty * cost_price.
    costPrice: roundCurrency((Number(product.cost_price || 0) * Number(item.unitMultiplier || 1)) + modifiersCostTotal, options.moneyDigits),
    requiredQty,
    beforeQty,
    afterQty: Number((beforeQty - requiredQty).toFixed(3)),
    notes: item.notes || '',
    modifiers: item.modifiers,
    isService: (product as any)?.item_type === 'service',
    ...(item.serials !== undefined ? { serials: item.serials } : {}),
  };
}

/**
 * Frozen sale-line cost preservation (INV-SALE-EDIT-FROZEN-COST).
 *
 * updateSale deletes every old sale_items row and rebuilds the sale, then
 * resolveSaleModifierCosts re-costs each rebuilt line at the CURRENT product
 * WAC. That silently moves COGS between periods for a price/discount/tax-only
 * edit: the physical composition of the line did not change, but its journal
 * COGS (postSaleEdit sums qty * sale_items.cost_price) did.
 *
 * This pure helper restores the ORIGINAL per-unit cost_price for a rebuilt
 * line whose physical composition is unchanged. A line is unchanged when its
 * product, its sold unit (unitMultiplier) and its modifier composition all
 * match exactly one old line. Quantity, selling price, discount and tax are
 * deliberately NOT part of the key: changing only the quantity re-prices the
 * line total (qty * frozen unit cost) without re-costing the unit itself.
 *
 * Modifier composition is the sorted list of
 * componentId|optionId|qty|consumptionQty for every modifier, so a modifier
 * added, removed or re-quantified makes the whole line "changed" and it
 * keeps its freshly resolved cost. The optionId is included so two
 * differently-configured modifiers for the same component cannot collide;
 * for non-restaurant modifiers (which carry no stock cost) a stricter
 * signature can only fail safe to re-costing. When the line matches, each
 * modifier's own costPrice is restored from the matching old modifier too,
 * so the stored modifiers JSON stays consistent with the frozen line cost
 * instead of showing the new WAC alongside the old total.
 *
 * Fail-safe: an unparseable modifiers value, a non-finite or negative old
 * cost, or an ambiguous match (two old lines with the same key) leaves the
 * freshly resolved cost untouched. Nothing here invents a cost; it only
 * re-uses a cost the sale already carried.
 */
function frozenModifierList(modifiers: unknown): Array<Record<string, any>> | null {
  let list: unknown = modifiers;
  if (typeof list === 'string') {
    if (!list.trim()) return [];
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  return list as Array<Record<string, any>>;
}

function frozenModifierKey(modifiers: unknown): string | null {
  const list = frozenModifierList(modifiers);
  if (list === null) return null;
  const parts: string[] = [];
  for (const mod of list) {
    const componentId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0) || 0;
    const optionId = Number(mod.optionId || mod.option_id || 0) || 0;
    const qty = Number(mod.qty ?? 1);
    const consumption = Number(mod.consumptionQty ?? mod.consumption_qty ?? 1);
    if (!Number.isFinite(qty) || !Number.isFinite(consumption) || qty <= 0 || consumption <= 0) return null;
    parts.push(`${componentId}|${optionId}|${qty}|${consumption}`);
  }
  return parts.sort().join(';');
}

function frozenLineKey(line: any): string | null {
  const signature = frozenModifierKey(line.modifiers);
  if (signature === null) return null;
  const productId = Number(line.productId ?? line.product_id ?? 0);
  const unitMultiplier = Number(line.unitMultiplier ?? line.unit_multiplier ?? 1);
  if (!Number.isFinite(productId) || !Number.isFinite(unitMultiplier) || productId <= 0 || unitMultiplier <= 0) return null;
  return `${productId}|${unitMultiplier}|${signature}`;
}

export function restoreFrozenSaleLineCosts(items: any[], oldLines: any[]): void {
  const byKey = new Map<string, any[]>();
  for (const old of oldLines || []) {
    const key = frozenLineKey(old);
    if (key === null) continue;
    const bucket = byKey.get(key) || [];
    bucket.push(old);
    byKey.set(key, bucket);
  }
  for (const item of items || []) {
    const key = frozenLineKey(item);
    if (key === null) continue;
    const candidates = byKey.get(key) || [];
    if (candidates.length !== 1) continue;
    const old = candidates[0];
    const frozenCost = Number(old.costPrice ?? old.cost_price ?? NaN);
    if (!Number.isFinite(frozenCost) || frozenCost < 0) continue;
    item.costPrice = frozenCost;
    const oldMods = frozenModifierList(old.modifiers) || [];
    const newMods = frozenModifierList(item.modifiers);
    if (!newMods) continue;
    for (const mod of newMods) {
      const componentId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0) || 0;
      const optionId = Number(mod.optionId || mod.option_id || 0) || 0;
      const qty = Number(mod.qty ?? 1);
      const consumption = Number(mod.consumptionQty ?? mod.consumption_qty ?? 1);
      const match = oldMods.find((oldMod: any) =>
        (Number(oldMod.productId || oldMod.componentProductId || oldMod.component_product_id || 0) || 0) === componentId &&
        (Number(oldMod.optionId || oldMod.option_id || 0) || 0) === optionId &&
        Number(oldMod.qty ?? 1) === qty &&
        Number(oldMod.consumptionQty ?? oldMod.consumption_qty ?? 1) === consumption);
      const oldModCost = match ? Number(match.costPrice ?? match.cost_price ?? NaN) : NaN;
      if (Number.isFinite(oldModCost) && oldModCost >= 0) mod.costPrice = oldModCost;
    }
  }
}

export function calculateCollectibleTotal(total: number, storeCreditUsed: number, digits: MoneyDigits): number {
  return roundCurrency(Number(total || 0) - Number(storeCreditUsed || 0), digits);
}

/* P1-16 sales-write residuals: every derived money amount the sale
 * writer stores or posts rounds ONCE at the tenant's book digits
 * (INV-SALES-WRITE-RESIDUAL-BOOK-DIGITS). The writer previously
 * re-rounded these residuals with toFixed(2), which truncated a
 * 3-decimal tenant's third decimal on every create/edit/cancel and
 * compounded in the stored store-credit balance. Book digits are
 * REQUIRED here, as in the neighbouring helpers: a silent `= 2`
 * default would reintroduce the truncation this package removes. */
export function calculateStoreCreditBalance(currentBalance: number, signedDelta: number, digits: MoneyDigits): number {
  return roundCurrency(Number(currentBalance || 0) + Number(signedDelta || 0), digits);
}

export function calculateRemainingDebt(collectibleTotal: number, paidAmount: number, digits: MoneyDigits): number {
  return roundCurrency(Math.max(0, Number(collectibleTotal || 0) - Number(paidAmount || 0)), digits);
}

export function roundSaleResidual(value: number, digits: MoneyDigits): number {
  return roundCurrency(Number(value || 0), digits);
}

/*
 * Sale-side invoice totals at book digits (INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND):
 * `computeInvoiceTotals` always rounds to 3 decimals, but the invoice
 * allocation engine fails closed on anything finer than the tenant's
 * book digits — so a 2-decimal tenant's sale whose tax needs a third
 * decimal was rejected outright. The sale writer rounds the totals
 * to book digits at this seam, before allocation, at both the create
 * and the edit call sites. The shared totals util and the allocation
 * engine are untouched, and postSale re-rounds these same book-digits
 * values, so the journal legs are unchanged. Non-finite inputs fail
 * closed through the canonical rounder (never coerced to 0 here, unlike
 * roundCurrency's `Number(value || 0)`); digits are the tenant's book
 * digits from `currencyMoneyDigits`, which only ever returns 2 or 3.
 */
export function roundSaleInvoiceTotals(
  totals: { taxAmount: number; total: number },
  digits: MoneyDigits,
): { taxAmount: number; total: number } {
  return {
    taxAmount: roundMoney(totals.taxAmount, digits),
    total: roundMoney(totals.total, digits),
  };
}

function normalizeDateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function todayLocalIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isOfferActive(offer: SaleProductOfferRow, todayIso: string, now: Date = new Date()): boolean {
  const from = normalizeDateOnly(offer.start_date);
  const to = normalizeDateOnly(offer.end_date);
  if (from && from > todayIso) return false;
  if (to && to < todayIso) return false;

  // Day of week check (e.g. "0,1,2,3,4,5,6" or comma-separated numbers)
  if (offer.days_of_week && typeof offer.days_of_week === 'string' && offer.days_of_week.trim()) {
    const currentDay = now.getDay(); // 0 is Sunday, ..., 6 is Saturday
    const allowedDays = offer.days_of_week.split(',').map((d) => Number(d.trim())).filter((d) => !Number.isNaN(d));
    if (allowedDays.length > 0 && !allowedDays.includes(currentDay)) {
      return false;
    }
  }

  // Happy hour time range check (HH:mm)
  if (offer.happy_hour_start && offer.happy_hour_end && String(offer.happy_hour_start).trim() && String(offer.happy_hour_end).trim()) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = String(offer.happy_hour_start).split(':').map(Number);
    const [endH, endM] = String(offer.happy_hour_end).split(':').map(Number);
    const startMinutes = (startH || 0) * 60 + (startM || 0);
    const endMinutes = (endH || 0) * 60 + (endM || 0);

    if (startMinutes <= endMinutes) {
      if (currentMinutes < startMinutes || currentMinutes > endMinutes) return false;
    } else {
      // Overnight range
      if (currentMinutes < startMinutes && currentMinutes > endMinutes) return false;
    }
  }

  return true;
}

export function getOfferEffectiveMinQty(offer: SaleProductOfferRow): number {
  if (offer.offer_type === 'bogo') {
    const buyQ = Math.max(1, Number(offer.bogo_buy_qty || 1));
    const getQ = Math.max(1, Number(offer.bogo_get_qty || 1));
    return buyQ + getQ;
  }
  return Math.max(1, Number(offer.min_qty || 1));
}

export const getOfferMinQty = getOfferEffectiveMinQty;

export function calculateOfferAdjustedPrice(basePrice: number, offer: SaleProductOfferRow, qty: number = 1, digits: MoneyDigits): number {
  const offerValue = Number(offer.value || 0);
  if (!(offerValue > 0) && offer.offer_type !== 'price' && offer.offer_type !== 'bundle' && offer.offer_type !== 'bogo') {
    return roundCurrency(basePrice, digits);
  }
  if (offer.offer_type === 'percent') return roundCurrency(Math.max(0, basePrice - ((basePrice * offerValue) / 100)), digits);
  if (offer.offer_type === 'fixed') return roundCurrency(Math.max(0, basePrice - offerValue), digits);
  if (offer.offer_type === 'price') return roundCurrency(Math.max(0, offerValue), digits);
  if (offer.offer_type === 'bundle') {
    const minQty = Math.max(1, Number(offer.min_qty || 1));
    const normalizedQty = Math.max(1, Number(qty || 1));
    if (normalizedQty < minQty) return roundCurrency(basePrice, digits);
    const bundles = Math.floor(normalizedQty / minQty);
    const remainder = normalizedQty % minQty;
    const total = (bundles * offerValue) + (remainder * basePrice);
    return roundCurrency(total / normalizedQty, digits);
  }
  if (offer.offer_type === 'bogo') {
    const buyQ = Math.max(1, Number(offer.bogo_buy_qty || 1));
    const getQ = Math.max(1, Number(offer.bogo_get_qty || 1));
    const discPct = Math.min(100, Math.max(0, Number(offer.bogo_discount_percent ?? (offerValue || 100))));
    const normalizedQty = Math.max(1, Number(qty || 1));
    const cycle = buyQ + getQ;
    if (normalizedQty < cycle) return roundCurrency(basePrice, digits);

    const fullCycles = Math.floor(normalizedQty / cycle);
    const remainder = normalizedQty % cycle;
    const discountedUnits = (fullCycles * getQ) + Math.max(0, remainder - buyQ);
    const discountPerUnit = (basePrice * discPct) / 100;
    const totalDiscount = discountedUnits * discountPerUnit;
    const totalLinePrice = Math.max(0, (normalizedQty * basePrice) - totalDiscount);
    return roundCurrency(totalLinePrice / normalizedQty, digits);
  }
  return roundCurrency(basePrice, digits);
}

export function pickBestApplicableOffer(offers: SaleProductOfferRow[], todayIso: string, qty: number, basePrice: number, now: Date = new Date(), digits: MoneyDigits): SaleProductOfferRow | null {
  const normalizedQty = Math.max(1, Number(qty || 1));
  const applicableOffers = offers.filter((offer) => isOfferActive(offer, todayIso, now) && normalizedQty >= getOfferEffectiveMinQty(offer));
  if (!applicableOffers.length) return null;

  return [...applicableOffers].sort((left, right) => {
    const leftPrice = calculateOfferAdjustedPrice(basePrice, left, normalizedQty, digits);
    const rightPrice = calculateOfferAdjustedPrice(basePrice, right, normalizedQty, digits);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;

    // Compare actual savings first; minimum quantity is only a tie-breaker.
    const leftMinQty = getOfferEffectiveMinQty(left);
    const rightMinQty = getOfferEffectiveMinQty(right);
    if (leftMinQty !== rightMinQty) return rightMinQty - leftMinQty;
    return Number(right.value || 0) - Number(left.value || 0);
  })[0] || null;
}

export function calculateAllowedSaleUnitPrice(params: {
  retailPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  priceType: 'retail' | 'wholesale';
  offers?: SaleProductOfferRow[];
  qty?: number;
  unitMultiplier?: number;
  todayIso?: string;
  now?: Date;
  moneyDigits: MoneyDigits;
}): number {
  const multiplier = Number(params.unitMultiplier || 1) > 0 ? Number(params.unitMultiplier || 1) : 1;
  if (params.priceType === 'wholesale') {
    return roundCurrency(Number(params.wholesalePrice || params.retailPrice || 0) * multiplier, params.moneyDigits);
  }
  const basePrice = roundCurrency(Number(params.retailPrice || 0) * multiplier, params.moneyDigits);
  const todayIso = normalizeDateOnly(params.todayIso) || todayLocalIsoDate();
  const qty = Number(params.qty || 1);
  const activeOffer = pickBestApplicableOffer(params.offers || [], todayIso, qty, basePrice, params.now || new Date(), params.moneyDigits);

  if (!activeOffer) {
    return roundCurrency(basePrice, params.moneyDigits);
  }

  return calculateOfferAdjustedPrice(basePrice, activeOffer, qty, params.moneyDigits);
}

export function resolveSalePayments(
  paymentType: 'cash' | 'credit',
  payments: NormalizedSalePayload['payments'],
  collectibleTotal: number,
  fallbackPaymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit' = 'cash',
): Array<{ paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay'; amount: number }> {
  const collectibleCents = Math.round(collectibleTotal * 100);
  if (!Number.isSafeInteger(collectibleCents) || collectibleCents < 0) {
    throw new AppError('Invalid invoice collection amount', 'INVALID_PAID_AMOUNT', 400);
  }
  // Tendered cash/change is represented separately. A payment line is the amount actually
  // applied to the invoice; silently clipping it loses a card/wallet charge or cash receipt.
  let declaredCents = 0;
  for (const payment of payments) {
    const cents = Math.round(Number(payment.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 ||
        Math.abs(Number(payment.amount) * 100 - cents) > 0.001) {
      throw new AppError('Payment amounts must be positive to the cent', 'INVALID_PAID_AMOUNT', 400);
    }
    declaredCents += cents;
  }
  if (declaredCents > collectibleCents) {
    throw new AppError('Payment lines exceed invoice total', 'INVALID_PAID_AMOUNT', 400);
  }
  let validPayments = payments;
  if (!validPayments.length && collectibleTotal > 0 && paymentType !== 'credit') {
    validPayments = [{
      paymentChannel: fallbackPaymentChannel === 'card'
        ? 'card'
        : fallbackPaymentChannel === 'wallet'
          ? 'wallet'
          : fallbackPaymentChannel === 'instapay'
            ? 'instapay'
            : 'cash',
      amount: collectibleTotal,
    }];
  }

  const result: Array<{ paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay'; amount: number }> = [];
  let remainingTotal = collectibleCents;

  // Process non-cash first
  for (const p of validPayments.filter(p => p.paymentChannel !== 'cash')) {
    const amountToApply = Math.round(Number(p.amount) * 100);
    if (amountToApply > 0) {
      result.push({ paymentChannel: p.paymentChannel, amount: amountToApply / 100 });
      remainingTotal -= amountToApply;
    }
  }

  // Process cash
  for (const p of validPayments.filter(p => p.paymentChannel === 'cash')) {
    if (remainingTotal <= 0) break;
    const amountToApply = Math.round(Number(p.amount) * 100);
    if (amountToApply > 0) {
      result.push({ paymentChannel: p.paymentChannel, amount: amountToApply / 100 });
      remainingTotal -= amountToApply;
    }
  }

  return result;
}

// Digits are required for consistency with the rest of this file,
// even though this helper has no live callers today (only the infra
// spec drives it): a future caller must name the tenant's digits
// instead of silently summing at cents.
export function calculatePaidAmount(payments: Array<{ amount: number }>, digits: MoneyDigits): number {
  return roundCurrency(payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0), digits);
}

// Sale-edit guard: the header paid_amount must not exceed the sum of the
// recorded sale_payments rows, compared at the tenant's book digits.
// Comparing in cents falsely blocks a legitimate edit on a 3-decimal
// tenant (two 0.004 payments record 0 cents while a 0.008 header rounds
// to 1 cent). Digits are required, never a silent cents default. Each
// leg is rounded once to minor units: stored amounts are at book digits,
// so rounding is the identity on legitimate data and only guards float
// noise. A non-finite leg blocks the edit (fail closed) instead of
// being skipped, because an unmeasurable collection must never be
// treated as reconciled.
export function paidAmountExceedsRecordedPayments(
  payments: Array<{ amount: number | string | null | undefined }>,
  paidAmount: number | string | null | undefined,
  digits: MoneyDigits,
): boolean {
  const factor = 10 ** digits;
  const toMinorUnits = (value: number | string | null | undefined): number => {
    // Nullish means "no amount" and counts as zero; NaN/Infinity must
    // survive coercion (Number(NaN || 0) would silently become 0) so
    // the non-finite check below can block the edit fail-closed.
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) return Number.NaN;
    return Math.round(amount * factor);
  };
  const recorded = payments.reduce((sum, payment) => sum + toMinorUnits(payment.amount), 0);
  const paid = toMinorUnits(paidAmount);
  if (!Number.isFinite(recorded) || !Number.isFinite(paid)) return true;
  return paid > recorded;
}

export function resolvePostedSalePaymentChannel(
  paymentType: 'cash' | 'credit',
  payments: Array<{ paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' }>,
): 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit' {
  if (paymentType === 'credit') {
    if (payments.length === 0) return 'credit';
    if (payments.length > 1) return 'mixed';
    return payments[0]?.paymentChannel || 'credit';
  }
  if (payments.length > 1) return 'mixed';
  return payments[0]?.paymentChannel || 'cash';
}

export function calculateRestoredStockQuantity(currentStockQty: number | string | null | undefined, itemQty: number | string | null | undefined, unitMultiplier: number | string | null | undefined) {
  const restoreQty = Number((Number(itemQty || 0) * Number(unitMultiplier || 1)).toFixed(3));
  const beforeQty = Number(currentStockQty || 0);
  const afterQty = Number((beforeQty + restoreQty).toFixed(3));
  return { restoreQty, beforeQty, afterQty };
}
