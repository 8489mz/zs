import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { Product, ProductOffer, ProductUnit } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';

function safeUnits(product: Product) {
  return product.units?.length ? product.units : [{
    id: '',
    name: 'قطعة',
    multiplier: 1,
    barcode: product.barcode,
    isBaseUnit: true,
    isSaleUnit: true,
    isPurchaseUnit: true,
  }];
}

function normalizeDateOnly(value: unknown) {
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
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function roundQuantity(value: number) {
  return Number(Number(value || 0).toFixed(3));
}

function getMinimumSaleQuantity(isWeighted?: boolean) {
  return isWeighted ? 0.001 : 1;
}

function normalizeSaleQuantity(value: number, isWeighted?: boolean) {
  const numericValue = Number(value || 0);
  if (isWeighted) {
    return roundQuantity(Math.max(getMinimumSaleQuantity(true), numericValue));
  }
  return Math.max(1, Math.round(numericValue || 1));
}

function getResolvedStockLimit(product: Product, unit: ProductUnit, allowDecimal: boolean) {
  const candidate = Number(unit.multiplier);
  const multiplier = Number.isFinite(candidate) && candidate > 0 ? candidate : 1;
  const rawLimit = Number(product.stock || 0) / multiplier;
  return allowDecimal ? roundQuantity(rawLimit) : Math.floor(rawLimit);
}

function todayLocalIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOfferType(offer: ProductOffer): 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo' {
  if (offer.type === 'bogo' || (offer as any).offer_type === 'bogo') return 'bogo';
  if (offer.type === 'bundle' || (offer as any).offer_type === 'bundle') return 'bundle';
  if (offer.type === 'price' || (offer as any).offer_type === 'price') return 'price';
  if (offer.type === 'fixed' || (offer as any).offer_type === 'fixed') return 'fixed';
  return 'percent';
}

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

function getOfferMinQty(offer: ProductOffer) {
  if (offer.type === 'bogo' || (offer as any).offer_type === 'bogo') {
    const buyQty = Math.max(1, Number(offer.bogoBuyQty ?? (offer as any).bogo_buy_qty ?? 1));
    const getQty = Math.max(1, Number(offer.bogoGetQty ?? (offer as any).bogo_get_qty ?? 1));
    return buyQty + getQty;
  }
  return Math.max(1, Number(offer.minQty ?? (offer as any).min_qty ?? 1));
}

function getApplicableOffer(product: Product, priceType: PosPriceType, qty = 1, now = new Date(), unitMultiplier = 1, digits: MoneyDigits) {
  if (priceType === 'wholesale') return null;
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

export function getSaleUnit(product: Product): ProductUnit {
  return safeUnits(product).find((unit) => unit.isSaleUnit) || safeUnits(product)[0];
}

export function getStockLimit(product: Product, unit: ProductUnit = getSaleUnit(product)) {
  return getResolvedStockLimit(product, unit, false);
}

const UNBOUNDED_STOCK_LIMIT = Number.MAX_SAFE_INTEGER;

export function isNegativeStockSalesAllowed(settings?: { allowNegativeStockSales?: unknown; allowSellingBelowStock?: unknown } | null) {
  return settings?.allowNegativeStockSales === true || settings?.allowSellingBelowStock === true;
}

export function getProductItemCode(product: Product, unit?: ProductUnit) {
  return String(product.styleCode || unit?.barcode || product.barcode || product.id || '').trim();
}

export function getProductPrice(product: Product, priceType: PosPriceType, qty = 1, unitMultiplier = 1, digits: MoneyDigits) {
  const basePrice = Number(priceType === 'wholesale' ? product.wholesalePrice || product.retailPrice || 0 : product.retailPrice || 0) * unitMultiplier;
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

interface AddPosItemOptions {
  priceType: PosPriceType;
  digits: MoneyDigits;
  unitId?: string;
  allowNegativeStockSales?: boolean;
  quantity?: number;
  isWeighted?: boolean;
  sourceBarcode?: string;
  serialNumber?: string;
  /** Appended to the lineKey so the new line never merges into an existing
   * line of the same product (used by combo adds — see applyComboToCart). */
  lineKeySuffix?: string;
}

export function addPosItem(cart: PosItem[], product: Product, options: AddPosItemOptions) {
  const unit = safeUnits(product).find((entry) => entry.id === options.unitId) || getSaleUnit(product);
  const isWeighted = options.isWeighted === true;
  const minQty = getMinimumSaleQuantity(isWeighted);
  const requestedQty = normalizeSaleQuantity(options.quantity ?? 1, isWeighted);
  const isService = product.itemType === 'service' || (product as any).item_type === 'service';
  const stockLimit = (options.allowNegativeStockSales || isService) ? UNBOUNDED_STOCK_LIMIT : getResolvedStockLimit(product, unit, isWeighted);
  if (stockLimit < minQty) {
    const globalStock = Number((product as any).globalStock || 0);
    if (globalStock >= minQty && stockLimit <= 0) {
      throw new Error('الصنف موجود، لكنه غير متاح في مخزون هذا الفرع.');
    }
    throw new Error('الصنف غير متاح للبيع حاليًا.');
  }
  if (requestedQty > stockLimit) {
    throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
  }
  const priceType = options.priceType;
  const baseLineKey = `${product.id}::${unit.id || unit.name}::${priceType}`;
  const lineKey = options.lineKeySuffix ? `${baseLineKey}::${options.lineKeySuffix}` : baseLineKey;
  const existing = cart.find((item) => item.lineKey === lineKey);
  const incomingSerial = options.serialNumber || product.matchedSerialNumber || undefined;
  const isSerialized = Boolean(product.trackSerials || incomingSerial);

  if (existing) {
    const nextQty = roundQuantity(Number(existing.qty || 0) + requestedQty);
    if (nextQty > stockLimit) throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
    const existingSerials = existing.serials || [];
    if (incomingSerial && existingSerials.some((serial) => serial.trim().toLowerCase() === incomingSerial.trim().toLowerCase())) {
      throw new Error('تمت إضافة هذا السيريال إلى السلة بالفعل');
    }
    const nextSerials = incomingSerial && !existingSerials.includes(incomingSerial)
      ? [...existingSerials, incomingSerial]
      : existingSerials;

    return cart.map((item) => item.lineKey === lineKey
      ? repriceCartLine({
          ...item,
          isWeighted: item.isWeighted === true || isWeighted ? true : undefined,
          sourceBarcode: options.sourceBarcode || item.sourceBarcode,
          stockLimit,
          trackSerials: isSerialized || item.trackSerials,
          serials: nextSerials.length > 0 ? nextSerials : undefined,
          quantityChunks: (item.isWeighted === true || isWeighted) && options.sourceBarcode 
            ? [...(item.quantityChunks || [Number(item.qty || 0)]), requestedQty] 
            : item.quantityChunks,
        }, product, nextQty, options.digits)
      : item);
  }
  const newItem: PosItem = {
    lineKey,
    productId: product.id,
    name: product.name,
    nameEn: (product as any).nameEn || (product as any).name_en || undefined,
    name_en: (product as any).name_en || (product as any).nameEn || undefined,
    itemCode: getProductItemCode(product, unit),
    imageUrl: product.imageUrl || (product as any)?.metadata?.imageUrl || undefined,
    icon: product.icon || (product as any)?.metadata?.icon || undefined,
    unitId: unit.id,
    unitName: unit.name,
    unitMultiplier: Number.isFinite(Number(unit.multiplier)) && Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1,
    price: 0,
    costPrice: Number((product as any).costPrice || 0),
    qty: requestedQty,
    stockLimit,
    currentStock: Number(product.stock || 0),
    minStock: Number(product.minStock || 0),
    priceType,
    isWeighted: isWeighted ? true : undefined,
    sourceBarcode: options.sourceBarcode || undefined,
    quantityChunks: isWeighted && options.sourceBarcode ? [requestedQty] : undefined,
    trackSerials: isSerialized ? true : undefined,
    serials: incomingSerial ? [incomingSerial] : undefined,
  };

  return [...cart, repriceCartLine(newItem, product, requestedQty, options.digits)];
}

export function updatePosItemNotes(cart: PosItem[], lineKey: string, notes: string) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, notes };
  });
}

/* Combo meals (R-B9 / INV-REST-COMBO-LINE): the old onAddComboToCart in
 * PosWorkspaceHeader ignored handleAddProduct's boolean return and stamped the
 * combo name/notes/modifiers onto prevCart[prevCart.length - 1] — the wrong
 * line whenever the add failed (out of stock) or merged into a plain line of
 * the same product already in the cart — and it never used combo.price, so an
 * offer-repriced main posted a different total than the modal displayed
 * (totalComboPrice). applyComboToCart is the single pure decision for a combo
 * add: the combo always lands on its own new line (a suffixed lineKey that can
 * never merge), the posted price is the modal's base price, and the stock
 * check counts every unit of the product already in the cart — the suffix
 * breaks addPosItem's merge-based stock check, so without this the combo
 * could oversell the last unit already held as a plain line. */
export interface ComboSelection {
  productId: number | string;
  productName: string;
  /** Modal base price of the main (totalComboPrice minus the modifier deltas). */
  price: number;
  modifiers: Array<{ name: string; price: number }>;
  notes?: string;
}

export interface ApplyComboToCartOptions {
  priceType: PosPriceType;
  digits: MoneyDigits;
  allowNegativeStockSales?: boolean;
  /** Unique id for this combo instance. Defaults to a generated id; pass an
   * explicit id in tests so the resulting lineKey is deterministic. */
  comboLineId?: string;
}

export function buildComboLineKey(product: Product, priceType: PosPriceType, comboLineId: string): string {
  const unit = getSaleUnit(product);
  return `${product.id}::${unit.id || unit.name}::${priceType}::${comboLineId}`;
}

export function applyComboToCart(
  cart: PosItem[],
  product: Product,
  combo: ComboSelection,
  options: ApplyComboToCartOptions,
): { cart: PosItem[]; lineKey: string } {
  const comboLineId = options.comboLineId || `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineKey = buildComboLineKey(product, options.priceType, comboLineId);
  const isService = product.itemType === 'service' || (product as any).item_type === 'service';
  if (!options.allowNegativeStockSales && !isService) {
    const saleUnit = getSaleUnit(product);
    const comboBaseQty = Number.isFinite(Number(saleUnit.multiplier)) && Number(saleUnit.multiplier) > 0
      ? Number(saleUnit.multiplier)
      : 1;
    const reservedBaseQty = cart
      .filter((item) => String(item.productId) === String(product.id))
      .reduce((sum, item) => sum + Number(item.qty || 0) * (Number(item.unitMultiplier) || 1), 0);
    // Only the already-reserved units need this check: with nothing reserved,
    // addPosItem's own stock error surfaces (same message as a plain add).
    if (reservedBaseQty > 0 && reservedBaseQty + comboBaseQty > Number(product.stock || 0)) {
      throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
    }
  }
  const withMain = addPosItem(cart, product, {
    priceType: options.priceType,
    digits: options.digits,
    allowNegativeStockSales: options.allowNegativeStockSales,
    lineKeySuffix: comboLineId,
  });
  const comboLine = withMain.find((item) => item.lineKey === lineKey);
  if (!comboLine) throw new Error('تعذّر إضافة الوجبة إلى السلة.');
  const comboPrice = roundMoneyValue(Number(combo.price || 0), options.digits);
  return {
    cart: withMain.map((item) => (item.lineKey === lineKey
      ? {
          ...item,
          name: combo.productName,
          notes: combo.notes,
          modifiers: combo.modifiers,
          // The modal's displayed total is the contract with the customer:
          // post the modal's base price, not the repriced catalog price, so
          // qty * (price + modifier deltas) equals totalComboPrice even when
          // an offer would otherwise reprice the main.
          price: comboPrice,
          originalPrice: comboPrice,
          offerDiscount: 0,
          offerName: undefined,
        }
      : item)),
    lineKey,
  };
}

export function updatePosItemModifiers(cart: PosItem[], lineKey: string, modifiers: any[]) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, modifiers };
  });
}

export function updatePosItemSeat(cart: PosItem[], lineKey: string, seatNumber?: number) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, seatNumber: seatNumber ? Number(seatNumber) : undefined };
  });
}

/* Serial entry on a cart line (LF-P3): before this fix a serial-tracked line
 * added by tile/tap/search carried no serials and the cart offered no way to
 * enter one, so the cashier hit a dead end at confirm (validatePosSaleInput
 * demands one unique serial per piece). These pure helpers are the cart-side
 * half of the entry path: the live stock/ownership check against
 * productSerialsApi.lookup happens in the entry UI, these helpers only
 * enforce the cart-side rules (dedup, capacity, count == qty). */
export function normalizeSerialNumber(serial: string): string {
  return String(serial || '').trim().toLowerCase();
}

/** How many serials a line needs: one per piece (qty x unit multiplier). */
export function getRequiredSerialCount(item: PosItem): number {
  const count = Number(item.qty || 0) * Number(item.unitMultiplier || 1);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function getSerialEntryState(item: PosItem) {
  const required = getRequiredSerialCount(item);
  const entered = (item.serials || []).length;
  return {
    required,
    entered,
    missing: Math.max(0, required - entered),
    complete: required > 0 && entered === required,
  };
}

/* When the quantity drops below the serials already entered, keep the first
 * serials up to the new required count (the last-entered one goes). A
 * non-integer required count leaves serials untouched — that line can never
 * pass validation anyway, and silently dropping its serials would hide data. */
function trimSerialsToRequiredCount(serials: string[] | undefined, item: PosItem, qty: number): string[] | undefined {
  const count = Number(qty || 0) * Number(item.unitMultiplier || 1);
  if (!Number.isInteger(count) || count <= 0) return serials;
  if (!serials || serials.length <= count) return serials;
  const kept = serials.slice(0, count);
  return kept.length > 0 ? kept : undefined;
}

export function addSerialToPosLine(cart: PosItem[], lineKey: string, serial: string): PosItem[] {
  const clean = normalizeSerialNumber(serial);
  const line = cart.find((item) => item.lineKey === lineKey);
  if (!line) throw new Error('تعذّر العثور على سطر السلة لإضافة السيريال.');
  if (!line.trackSerials) throw new Error(`الصنف ${line.name} لا يتطلب سيريالاً.`);
  if (!clean) throw new Error('أدخل رقم السيريال أولاً.');
  const existing = line.serials || [];
  if (existing.some((entry) => normalizeSerialNumber(entry) === clean)) {
    throw new Error(`السيريال ${serial.trim()} مضاف بالفعل إلى ${line.name}.`);
  }
  if (cart.some((item) => item.lineKey !== lineKey && (item.serials || []).some((entry) => normalizeSerialNumber(entry) === clean))) {
    throw new Error(`السيريال ${serial.trim()} مضاف بالفعل إلى سطر آخر في السلة.`);
  }
  const required = getRequiredSerialCount(line);
  if (required > 0 && existing.length >= required) {
    throw new Error(`اكتملت سيريالات ${line.name} (${existing.length} من ${required}) — احذف سيريالاً قبل إضافة آخر.`);
  }
  return cart.map((item) => (item.lineKey === lineKey
    ? { ...item, serials: [...existing, serial.trim()] }
    : item));
}

export function removeSerialFromPosLine(cart: PosItem[], lineKey: string, serial: string): PosItem[] {
  const clean = normalizeSerialNumber(serial);
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    const kept = (item.serials || []).filter((entry) => normalizeSerialNumber(entry) !== clean);
    return { ...item, serials: kept.length > 0 ? kept : undefined };
  });
}

/** Live-lookup verdict for a typed/scanned serial: a specific error naming
 * the serial and the reason, or null when the serial may be added. */
export interface SerialLookupEntry {
  productId: string;
  status: string;
  productName?: string | null;
}

const SERIAL_STATUS_LABELS: Record<string, string> = {
  sold: 'مباع',
  returned: 'مرتجع',
  transferred: 'منقول',
  damaged: 'تالف',
};

export function getSerialLookupError(serial: string, entry: SerialLookupEntry | null, productId: string, productName: string): string | null {
  const display = String(serial || '').trim();
  if (!entry) return `السيريال ${display} غير مسجّل في النظام.`;
  if (String(entry.productId) !== String(productId)) {
    return `السيريال ${display} مسجّل لصنف آخر${entry.productName ? ` (${entry.productName})` : ''} وليس ${productName}.`;
  }
  if (entry.status !== 'in_stock') {
    const label = SERIAL_STATUS_LABELS[entry.status] || entry.status;
    return `السيريال ${display} غير متاح للبيع — حالته: ${label}.`;
  }
  return null;
}

export function updatePosItemQtyWithOptions(
  cart: PosItem[],
  lineKey: string,
  qty: number,
  products: Product[],
  options: { allowNegativeStockSales?: boolean; quantityChunks?: number[] | null; digits: MoneyDigits },
) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    const isWeighted = item.isWeighted === true;
    const normalizedQty = normalizeSaleQuantity(qty, isWeighted);
    const product = products.find((entry) => String(entry.id) === String(item.productId));
    const resolvedChunks = options.quantityChunks === null ? undefined : (options.quantityChunks || item.quantityChunks);
    if (!product) {
      const nextQty = options.allowNegativeStockSales ? normalizedQty : Math.min(normalizedQty, item.stockLimit);
      return { ...item, qty: nextQty, quantityChunks: resolvedChunks, serials: trimSerialsToRequiredCount(item.serials, item, nextQty) };
    }
    const stockLimit = options.allowNegativeStockSales || !!product.hasBom ? UNBOUNDED_STOCK_LIMIT : item.stockLimit;
    const finalQty = options.allowNegativeStockSales || !!product.hasBom ? normalizedQty : Math.min(normalizedQty, stockLimit);
    return repriceCartLine({ ...item, quantityChunks: resolvedChunks }, product, finalQty, options.digits);
  });
}

export function removePosItem(cart: PosItem[], lineKey: string) {
  return cart.filter((row) => row.lineKey !== lineKey);
}

export function syncPosCartStock(cart: PosItem[], products: Product[], options: { allowNegativeStockSales?: boolean; digits: MoneyDigits }) {
  let changed = false;
  let removedCount = 0;
  let clampedCount = 0;
  let heldUnavailableCount = 0;

  const nextCart = cart.flatMap((item) => {
    const product = products.find((entry) => String(entry.id) === String(item.productId));
    if (!product) return [item];
    const unit = safeUnits(product).find((entry) => String(entry.id || '') === String(item.unitId || '') || String(entry.name || '') === String(item.unitName || '')) || getSaleUnit(product);
    const isWeighted = item.isWeighted === true;
    const minQty = getMinimumSaleQuantity(isWeighted);
    const stockLimit = (options.allowNegativeStockSales || !!product.hasBom) ? UNBOUNDED_STOCK_LIMIT : getResolvedStockLimit(product, unit, isWeighted);
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a held price is the agreed
     * price. A line restored from a hold (priceHeldAt) is never
     * repriced and never silently deleted: a stock-out held line is
     * KEPT and flagged so the cashier decides (remove or replace);
     * submit still enforces stock. Only the stock figures refresh. */
    if (item.priceHeldAt != null) {
      const heldUnavailable = stockLimit < minQty;
      if (heldUnavailable) heldUnavailableCount += 1;
      if (
        heldUnavailable !== Boolean(item.heldUnavailable)
        || Number(stockLimit) !== Number(item.stockLimit)
        || Number(product.stock || 0) !== Number(item.currentStock)
      ) {
        changed = true;
        return [{ ...item, stockLimit, currentStock: Number(product.stock || 0), heldUnavailable }];
      }
      return [item];
    }
    if (stockLimit < minQty) {
      changed = true;
      removedCount += 1;
      return [];
    }

    const normalizedQty = normalizeSaleQuantity(Number(item.qty || minQty), isWeighted);
    const nextQty = Math.min(normalizedQty, stockLimit);
    const nextItem = {
      ...item,
      name: product.name || item.name,
      unitId: String(unit.id || item.unitId || ''),
      unitName: unit.name || item.unitName,
      itemCode: getProductItemCode(product, unit) || item.itemCode,
      unitMultiplier: Number.isFinite(Number(unit.multiplier)) && Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1,
      stockLimit,
      currentStock: Number(product.stock || 0),
      minStock: Number(product.minStock || 0),
      price: getProductPrice(product, item.priceType, nextQty, Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1, options.digits),
      qty: nextQty,
      quantityChunks: nextQty === Number(item.qty || 0) ? item.quantityChunks : undefined,
      serials: trimSerialsToRequiredCount(item.serials, item, nextQty),
    };

    if (nextQty !== item.qty) {
      changed = true;
      clampedCount += 1;
    }

    if (
      String(nextItem.name || '') !== String(item.name || '')
      || Number(nextItem.stockLimit) !== Number(item.stockLimit)
      || Number(nextItem.currentStock) !== Number(item.currentStock)
      || Number(nextItem.minStock) !== Number(item.minStock)
      || Number(nextItem.unitMultiplier) !== Number(item.unitMultiplier)
      || Number(nextItem.price) !== Number(item.price)
      || String(nextItem.unitId || '') !== String(item.unitId || '')
      || String(nextItem.unitName || '') !== String(item.unitName || '')
    ) {
      changed = true;
    }

    return [nextItem];
  });

  return {
    cart: changed ? nextCart : cart,
    removedCount,
    clampedCount,
    heldUnavailableCount,
  };
}

export function normalizeUnitName(rawUnit?: string): string {
  const trimmed = String(rawUnit || '').trim();
  if (!trimmed) return 'قطعة';

  const lower = trimmed.toLowerCase();

  // Keep kg and g in English as short abbreviations
  if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام') return 'kg';
  if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'جرام') return 'g';

  // English words to Arabic & normalizations
  if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه'].includes(lower)) return 'قطعة';
  if (['box', 'boxes', 'carton', 'cartons', 'كرتونه'].includes(lower)) return 'كرتونة';
  if (['packet', 'pack', 'packs'].includes(lower)) return 'باكت';
  if (['bottle', 'bottles'].includes(lower)) return 'زجاجة';
  if (['can', 'cans'].includes(lower)) return 'علبة';
  if (['liter', 'liters', 'ltr', 'l'].includes(lower)) return 'لتر';
  if (['meter', 'meters', 'm'].includes(lower)) return 'متر';
  if (['service', 'services', 'خدمه'].includes(lower)) return 'خدمة';

  return trimmed;
}

export function summarizeCartQuantities(cart: Array<{ unitName?: string; qty: number }>): string[] {
  const map = new Map<string, number>();
  for (const item of cart) {
    const unit = normalizeUnitName(item.unitName);
    map.set(unit, (map.get(unit) || 0) + Number(item.qty || 0));
  }
  return Array.from(map.entries()).map(([unit, qty]) => `${qty.toLocaleString('ar-EG', { maximumFractionDigits: 3 })} ${unit}`);
}
