import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import { calcCartLineDiscount, calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { PosItem } from '@/features/pos/types/pos.types';

export interface SplitBill {
  id: string;
  name: string;
  items: PosItem[];
  isPaid: boolean;
  paymentMethod?: 'cash' | 'card' | 'transfer';
}

/* R-I34 / INV-REST-LINE-IDENTITY: split moves used to match target lines on
 * product + unit + price, so a modified line moved onto a bill holding the
 * same product plain collapsed into it — the moved modifiers, notes, seat
 * and course silently vanished. Moves now match on lineKey only. A partial
 * move keeps the source line's full identity on the moved copy; the two
 * halves are the same line split across bills, and the ::split suffix keeps
 * them individually addressable. A full move keeps the original key. */
export function moveSplitBillItem(
  bills: SplitBill[],
  fromBillId: string,
  toBillId: string,
  itemLineKey: string,
  moveQty?: number,
): SplitBill[] {
  const fromBill = bills.find((b) => b.id === fromBillId);
  const toBill = bills.find((b) => b.id === toBillId);
  if (!fromBill || !toBill || fromBill.isPaid || toBill.isPaid) return bills;
  const itemIdx = fromBill.items.findIndex((i) => i.lineKey === itemLineKey);
  if (itemIdx === -1) return bills;

  const item = fromBill.items[itemIdx];
  const actualMoveQty = moveQty === undefined ? item.qty : Math.min(item.qty, moveQty);
  if (actualMoveQty <= 0) return bills;
  const isPartial = item.qty > actualMoveQty;
  const movedKey = isPartial ? `${item.lineKey}::split` : item.lineKey;

  const updatedFromItems = [...fromBill.items];
  if (!isPartial) {
    updatedFromItems.splice(itemIdx, 1);
  } else {
    updatedFromItems[itemIdx] = { ...item, qty: item.qty - actualMoveQty };
  }

  const updatedToItems = [...toBill.items];
  const existingToIdx = updatedToItems.findIndex((i) => i.lineKey === movedKey);
  if (existingToIdx !== -1) {
    updatedToItems[existingToIdx] = {
      ...updatedToItems[existingToIdx],
      qty: updatedToItems[existingToIdx].qty + actualMoveQty,
    };
  } else {
    updatedToItems.push({ ...item, lineKey: movedKey, qty: actualMoveQty });
  }

  return bills.map((b) => {
    if (b.id === fromBillId) return { ...b, items: updatedFromItems };
    if (b.id === toBillId) return { ...b, items: updatedToItems };
    return b;
  });
}

/** Move every item of one bill onto another. Every item moves in full, so
 * each keeps its own lineKey — identical lines merge, differing lines
 * (different modifiers / seat / course) never collapse. */
export function moveSplitBillItems(
  bills: SplitBill[],
  fromBillId: string,
  toBillId: string,
): SplitBill[] {
  const fromBill = bills.find((b) => b.id === fromBillId);
  const toBill = bills.find((b) => b.id === toBillId);
  if (!fromBill || !toBill || fromBill.isPaid || toBill.isPaid || !fromBill.items.length) return bills;
  const updatedToItems = [...toBill.items];
  for (const item of fromBill.items) {
    const existingIdx = updatedToItems.findIndex((i) => i.lineKey === item.lineKey);
    if (existingIdx !== -1) {
      updatedToItems[existingIdx] = {
        ...updatedToItems[existingIdx],
        qty: updatedToItems[existingIdx].qty + item.qty,
      };
    } else {
      updatedToItems.push({ ...item });
    }
  }
  return bills.map((b) => {
    if (b.id === fromBillId) return { ...b, items: [] };
    if (b.id === toBillId) return { ...b, items: updatedToItems };
    return b;
  });
}

export interface EvenSplitGuest {
  id: number;
  name: string;
  amount: number;
  // `collected` = the cashier took this guest's money; `paid` = the final
  // sale actually posted. They are different on purpose (I33): a guest is
  // never shown as paid before any sale exists.
  collected: boolean;
  paid: boolean;
  method: 'cash' | 'card' | 'transfer';
}

/* INV-REST-SPLIT-REAL-TOTALS (R-B10/B11/B12/I32/I33): a split bill totals
 * the REAL line values plus the order's extras, allocated across the
 * bills. The order totals are snapshotted when the modal opens (see the
 * init effect) — the bills always price against that snapshot, never
 * against the live workspace totals, because paying one bill syncs the
 * remaining items back into the workspace cart and the live totals shrink.
 * The backend recomputes tax from the rate (computeInvoiceTotals), so a
 * bill's tax is computed here with the same formula from the bill's own
 * pieces; only the tax rounding can drift, and the settled guard tolerates
 * exactly that provable bound — never a real mismatch. */

export interface SplitOrderTotals {
  /* INV-POS-LINE-DISCOUNT: subTotal is the NET subtotal (gross minus
   * the per-line discounts) — the bill subtotals below are net too,
   * so the pro-rata shares sum to 1 and the header-discount cap
   * (bill discount <= bill subtotal) matches the backend, which
   * stores the subtotal net of line discounts. */
  subTotal: number;
  discountValue: number;
  serviceCharge: number;
  taxRate: number;
  pricesIncludeTax: boolean;
  tipAmount: number;
  deliveryFee: number;
  total: number;
  /* INV-REST-LOYALTY-TRUTH (R6-C): discountValue is the COMBINED
   * discount (manual + loyalty, usePosWorkspaceDerived.ts:180), so the
   * snapshot must carry the split or the modal cannot post a part
   * without double-counting (Trap 1: the backend adds the loyalty
   * discount to the payload discount). manualDiscount is the manual
   * share only; loyaltyPointsRedeemed / loyaltyPointRedeemValue /
   * loyaltyMaxDiscountPercentage are the order's redeemed points and
   * the tenant loyalty settings (defaults 0.1 / 100, same as the
   * derived hook and the backend). */
  manualDiscount: number;
  loyaltyPointsRedeemed: number;
  loyaltyPointRedeemValue: number;
  loyaltyMaxDiscountPercentage: number;
}

export interface SplitBillAmounts {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  taxAmount: number;
  tipAmount: number;
  deliveryFee: number;
  total: number;
  /* INV-REST-LOYALTY-TRUTH (R6-C): discount above is the bill's TOTAL
   * discount (manual + loyalty, as displayed). The two parts are kept
   * separate because the payload must send them separately: discount =
   * manualDiscount only, loyaltyPointsRedeemed = the bill's points
   * share — the backend recomputes the loyalty discount per part and
   * adds it. Sending the combined discount AND the points would grant
   * the loyalty discount twice (Trap 1). */
  manualDiscount: number;
  loyaltyPointsRedeemed: number;
  loyaltyDiscount: number;
}

/** Maximum drift between the sum of bill totals and the order total that
 * per-bill tax rounding alone can explain: half a book-digit unit per bill
 * plus half a unit for the order's own rounding. Anything beyond this is a
 * real mismatch (undistributed items, stale snapshot) and must block settling. */
export function splitRoundingTolerance(billCount: number, bookDigits: MoneyDigits): number {
  return (Math.max(0, billCount) + 1) * 0.5 * Math.pow(10, -bookDigits);
}

/** INV-REST-LOYALTY-TRUTH (R6-C repair): the stranded loyalty value —
 * the exact money value of the order's redeemed points that no bill could
 * place. Each part's points cap is floor(partMaxDiscount / pointValue)
 * (Trap 2: points are never forced past a cap), so when the order's
 * points do not divide across the parts — 201 points over two 10.05
 * bills place only 100 + 100 — the leftover points stay UNREDEEMED
 * with the customer and the bills' loyalty discounts sum to LESS than
 * the order's loyalty discount by exactly (stranded points x pointValue).
 * The bills therefore sum to orderTotal + this value, not to orderTotal:
 * it is bounded (never more than the unplaced points' value), exact
 * (rounded once, at book digits, from integer points), and economically
 * neutral — the customer pays the stranded value extra but keeps a point
 * worth exactly that value, so it is not a hidden charge. The paid-sum
 * guard and the distributed-sum display both allow exactly this much
 * extra, and nothing more. */
export function calcStrandedLoyaltyValue(
  totalPoints: number,
  allocatedPoints: number[],
  pointValue: number,
  bookDigits: MoneyDigits,
): number {
  const strandedPoints =
    Math.max(0, Math.floor(Number(totalPoints || 0))) -
    allocatedPoints.reduce((s, p) => s + Math.max(0, Math.floor(Number(p || 0))), 0);
  const value = Number(pointValue || 0);
  if (strandedPoints <= 0 || !(value > 0)) return 0;
  return Math.max(0, roundMoneyValue(strandedPoints * value, bookDigits));
}

/** The paid-sum guard (B10): the split may close settled only when the paid
 * bills sum to the order total, within the provable rounding tolerance —
 * plus the stranded loyalty value (see calcStrandedLoyaltyValue): bills
 * legitimately sum to orderTotal + stranded value when points strand, so
 * the guard allows exactly that much extra. A genuine shortfall beyond
 * tolerance + stranded value still refuses — the guard's purpose
 * (undistributed items, stale snapshot) is preserved. */
export function isSplitPaidSumSettled(
  paidTotal: number,
  orderTotal: number,
  billCount: number,
  bookDigits: MoneyDigits,
  strandedLoyaltyValue = 0,
): boolean {
  return (
    Math.abs(Number(paidTotal || 0) - Number(orderTotal || 0)) <=
    splitRoundingTolerance(billCount, bookDigits) + Math.max(0, Number(strandedLoyaltyValue || 0)) + 1e-9
  );
}

/** INV-REST-LOYALTY-TRUTH (R6-C): allocate the order's redeemed loyalty
 * points across the bills, pro-rata by real line subtotal — POINTS, not
 * money. The backend recomputes the loyalty discount per part from the
 * points it is sent, so the modal must send points, never a money
 * share of the order's loyalty discount.
 *
 * Trap 2 (cap vs points burned): the backend caps the DISCOUNT but
 * burns ALL sent points, so a part may never be sent more points than
 * its cap allows: floor(partMaxDiscount / pointValue) where
 * partMaxDiscount = roundMoney(partSubtotal x maxPct / 100). Points
 * lost to a cap floor are NOT forced onto the last bill (unlike
 * money): forcing them would exceed that bill's cap and burn points
 * for discount never given. Leftover points cascade only to parts
 * with headroom, in largest-remainder order; points that cannot be
 * placed anywhere stay UNREDEEMED. The flooring remainder goes one
 * point at a time in largest-remainder order (ties to the earlier
 * bill, so 3 points over 2 equal bills is 2+1, never 1.5). */
export function allocateSplitLoyaltyPoints(
  billSubtotals: number[],
  totalPoints: number,
  pointValue: number,
  maxPct: number,
  bookDigits: MoneyDigits,
): number[] {
  const points = Math.max(0, Math.floor(Number(totalPoints || 0)));
  const value = Number(pointValue || 0);
  const pct = Math.max(0, Number(maxPct ?? 100));
  const out = billSubtotals.map(() => 0);
  if (points <= 0 || !(value > 0)) return out;
  const caps = billSubtotals.map((raw) => {
    const subtotal = Math.max(0, Number(raw || 0));
    if (subtotal <= 0) return 0;
    const partMaxDiscount = roundMoneyValue((subtotal * pct) / 100, bookDigits);
    return Math.max(0, Math.floor(partMaxDiscount / value));
  });
  const orderSubtotal = billSubtotals.reduce((s, raw) => s + Math.max(0, Number(raw || 0)), 0);
  if (orderSubtotal <= 0) return out;
  const remainders = billSubtotals.map((raw, i) => {
    const share = (points * Math.max(0, Number(raw || 0))) / orderSubtotal;
    out[i] = Math.min(Math.floor(share), caps[i]);
    return { i, frac: share - Math.floor(share) };
  });
  let remaining = points - out.reduce((s, n) => s + n, 0);
  const order = remainders
    .filter((r) => caps[r.i] > out[r.i])
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  while (remaining > 0) {
    const eligible = order.filter((entry) => out[entry.i] < caps[entry.i]);
    if (eligible.length === 0) break;
    for (const entry of eligible) {
      if (remaining <= 0) break;
      out[entry.i] += 1;
      remaining -= 1;
    }
  }
  return out;
}

/** Split the order's discount / service charge / tip / delivery fee across
 * the bills pro-rata by real line subtotal (qty x (price + modifiers));
 * the last non-empty bill takes each component's remainder so the shares
 * sum exactly. Tax is computed per bill with the same formula the backend
 * uses (taxable = lines - discount + service charge), never allocated.
 * INV-REST-LOYALTY-TRUTH (R6-C): order.discountValue here is the MANUAL
 * discount only — the caller passes {...snapshot, discountValue:
 * snapshot.manualDiscount}. The loyalty share arrives as POINTS
 * (loyaltyPoints, allocated by allocateSplitLoyaltyPoints); each bill's
 * loyalty discount is derived FROM those points (min(points x
 * pointValue, partMaxDiscount)), never from the snapshot's combined
 * discountValue, so the bill amounts, the posted parts and the
 * paid-sum guard agree. */
export function allocateSplitBillAmounts(
  billSubtotals: number[],
  order: SplitOrderTotals,
  bookDigits: MoneyDigits,
  loyaltyPoints?: number[],
): SplitBillAmounts[] {
  const zero = (): SplitBillAmounts => ({
    subtotal: 0,
    discount: 0,
    serviceCharge: 0,
    taxAmount: 0,
    tipAmount: 0,
    deliveryFee: 0,
    total: 0,
    manualDiscount: 0,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscount: 0,
  });
  const orderSubtotal = Math.max(0, Number(order.subTotal || 0));
  let lastIndex = -1;
  billSubtotals.forEach((s, i) => {
    if (Number(s || 0) > 0) lastIndex = i;
  });
  const allocate = (amount: number): number[] => {
    const total = Math.max(0, Number(amount || 0));
    const out = billSubtotals.map(() => 0);
    let allocated = 0;
    billSubtotals.forEach((_s, i) => {
      if (i === lastIndex) return;
      const share = orderSubtotal > 0 ? Math.max(0, Number(billSubtotals[i] || 0)) / orderSubtotal : 0;
      out[i] = roundMoneyValue(total * share, bookDigits);
      allocated += out[i];
    });
    if (lastIndex >= 0) out[lastIndex] = Math.max(0, roundMoneyValue(total - allocated, bookDigits));
    return out;
  };
  const discounts = allocate(order.discountValue);
  const serviceCharges = allocate(order.serviceCharge);
  const tips = allocate(order.tipAmount);
  const deliveryFees = allocate(order.deliveryFee);
  const pointValue = Number(order.loyaltyPointRedeemValue ?? 0.1);
  const maxPct = Math.max(0, Number(order.loyaltyMaxDiscountPercentage ?? 100));
  const loyaltyDiscounts = billSubtotals.map((rawSubtotal, i) => {
    const subtotal = Math.max(0, Number(rawSubtotal || 0));
    const pts = Math.max(0, Math.floor(Number(loyaltyPoints?.[i] || 0)));
    if (subtotal <= 0 || pts <= 0 || !(pointValue > 0)) return 0;
    const partMaxDiscount = roundMoneyValue((subtotal * maxPct) / 100, bookDigits);
    return Math.min(roundMoneyValue(pts * pointValue, bookDigits), partMaxDiscount, subtotal);
  });
  const rate = Math.max(0, Number(order.taxRate || 0));
  return billSubtotals.map((rawSubtotal, i) => {
    const subtotal = Math.max(0, Number(rawSubtotal || 0));
    if (subtotal <= 0) return zero();
    // A bill's discount can never exceed its own lines.
    const loyaltyDiscount = loyaltyDiscounts[i];
    const discount = Math.min(discounts[i] + loyaltyDiscount, subtotal);
    // The manual share actually sent: the combined discount capped at
    // the bill's lines, less the loyalty part the backend recomputes.
    const manualDiscount = Math.max(0, roundMoneyValue(discount - loyaltyDiscount, bookDigits));
    const serviceCharge = serviceCharges[i];
    const tipAmount = tips[i];
    const deliveryFee = deliveryFees[i];
    const taxable = Math.max(0, roundMoneyValue(subtotal - discount + serviceCharge, bookDigits));
    const taxAmount =
      rate > 0
        ? order.pricesIncludeTax
          ? roundMoneyValue(taxable - taxable / (1 + rate / 100), bookDigits)
          : roundMoneyValue((taxable * rate) / 100, bookDigits)
        : 0;
    const total = order.pricesIncludeTax
      ? roundMoneyValue(taxable + deliveryFee + tipAmount, bookDigits)
      : roundMoneyValue(taxable + taxAmount + deliveryFee + tipAmount, bookDigits);
    return {
      subtotal: roundMoneyValue(subtotal, bookDigits),
      discount,
      serviceCharge,
      taxAmount,
      tipAmount,
      deliveryFee,
      total,
      manualDiscount,
      loyaltyPointsRedeemed: Math.max(0, Math.floor(Number(loyaltyPoints?.[i] || 0))),
      loyaltyDiscount,
    };
  });
}

/** Fractional split (B11): split one line into equal parts of its FULL value
 * (qty x (price + modifiers)). A part carries NO modifiers — the modifier
 * value is inside the part price. Copying the full modifier list onto every
 * part double-charges it: burger 100 + cheese 20 split in 2 used to post
 * 140 instead of 120. Returns null for a zero/negative line.
 * INV-POS-LINE-DISCOUNT: the line's discount splits pro-rata with the
 * price (same base/last-remainder pattern), clamped to the part price —
 * copying the FULL discount onto every part would multiply it, and a
 * rounding hair above the part price would fail closed at submit. */
export function buildFractionalParts(
  item: PosItem,
  partsCount: 2 | 3 | 4,
  bookDigits: MoneyDigits,
): PosItem[] | null {
  const fullValue = calcCartLineTotal(item);
  if (!(fullValue > 0)) return null;
  const baseName = String(item.name || '')
    .replace(/\s*\((نصف حصة|حصة)\s*[\d/]+\)/g, '')
    .trim();
  const basePart = roundMoneyValue(fullValue / partsCount, bookDigits);
  const parts: number[] = [];
  let allocated = 0;
  for (let p = 0; p < partsCount; p++) {
    const isLast = p === partsCount - 1;
    const val = isLast ? roundMoneyValue(fullValue - allocated, bookDigits) : basePart;
    allocated += val;
    parts.push(val);
  }
  const lineDiscount = calcCartLineDiscount(item);
  const baseDiscountPart = lineDiscount > 0 ? roundMoneyValue(lineDiscount / partsCount, bookDigits) : 0;
  const discountParts: number[] = [];
  let discountAllocated = 0;
  for (let p = 0; p < partsCount; p++) {
    const isLast = p === partsCount - 1;
    const val = isLast ? roundMoneyValue(lineDiscount - discountAllocated, bookDigits) : baseDiscountPart;
    discountAllocated += val;
    discountParts.push(Math.max(0, Math.min(val, parts[p])));
  }
  return parts.map((price, p) => ({
    ...item,
    qty: 1,
    price,
    modifiers: [],
    /* The spread above would carry the FULL line discount onto every
     * part; the split share replaces it (undefined when the line
     * carries no discount). */
    lineDiscount: discountParts[p] > 0 ? discountParts[p] : undefined,
    name: `${baseName} (حصة ${p + 1}/${partsCount})`,
    lineKey: `${item.productId}::frac${p + 1}::${Date.now()}::${Math.random()}`,
  }));
}

/** The payment channel of a mixed final sale, mirroring handleSubmit: cash
 * plus anything else is 'mixed'; a transfer-only sale is 'instapay' (the
 * modal has no wallet/instapay distinction, same as handleSubmit's default). */
export function resolveSplitPaymentChannel(
  cashTotal: number,
  cardTotal: number,
  transferTotal: number,
): 'cash' | 'card' | 'instapay' | 'mixed' {
  const cash = Number(cashTotal || 0);
  const card = Number(cardTotal || 0);
  const transfer = Number(transferTotal || 0);
  if (cash > 0 && (card > 0 || transfer > 0)) return 'mixed';
  if (transfer > 0) return 'instapay';
  if (card > 0) return 'card';
  return 'cash';
}

/* T10-C (INV-REST-SPLIT-COLLECT-BRANCH): the ONE branch/location
 * resolution for every sale the modal posts. The two collect paths
 * used to omit branchId/locationId entirely, so the backend POS gate
 * refused every collect with POS_BRANCH_REQUIRED 400 — while the
 * held-save path sent them, so saving the checks worked and
 * collecting them failed. All three call sites spread this helper,
 * so they cannot drift apart again. The shape mirrors handleSubmit
 * (createPosWorkspaceAsyncActions): the live branch/location first,
 * falling back to the derived current branch/location. */
export function resolveSplitSaleBranch(pos: {
  branchId?: string | null;
  currentBranch?: { id: string | number; name: string } | null;
  locationId?: string | null;
  currentLocation?: { id: string | number; name: string } | null;
}): { branchId: string | null; locationId: string | null } {
  return {
    branchId: pos.branchId || (pos.currentBranch?.id != null ? String(pos.currentBranch.id) : null),
    locationId: pos.locationId || (pos.currentLocation?.id != null ? String(pos.currentLocation.id) : null),
  };
}
