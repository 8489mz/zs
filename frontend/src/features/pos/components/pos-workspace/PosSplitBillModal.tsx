import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CheckIcon, UsersIcon, ReceiptIcon, PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import { calcCartLineTotal, calcModifiersTotal } from '@/features/pos/lib/pos-modifier-totals';
import { stripSaleItemNameFields } from '@/features/pos/contracts';
import type { PosItem } from '@/features/pos/types/pos.types';

interface PosSplitBillModalProps {
  open: boolean;
  pos: PosWorkspaceState;
  onClose: () => void;
  onSplitCompleted?: () => void;
}

export interface SplitBill {
  id: string;
  name: string;
  items: PosItem[];
  isPaid: boolean;
  paymentMethod?: 'cash' | 'card';
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

interface EvenSplitGuest {
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
 * 140 instead of 120. Returns null for a zero/negative line. */
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
  return parts.map((price, p) => ({
    ...item,
    qty: 1,
    price,
    modifiers: [],
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

export function PosSplitBillModal({ open, pos, onClose, onSplitCompleted }: PosSplitBillModalProps) {
  const { t } = useTranslation();
  const [splitMode, setSplitMode] = useState<'items' | 'even'>('items');

  // Mode 1: Split by Items state
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Mode 2: Split Evenly state
  const [guestCount, setGuestCount] = useState<number>(2);
  const [evenGuests, setEvenGuests] = useState<EvenSplitGuest[]>([]);

  // INV-REST-SPLIT-REAL-TOTALS (I32): the order totals are snapshotted when
  // the modal opens. The bills always price against this snapshot, never
  // against the live workspace totals — paying one bill syncs the remaining
  // items back into the workspace cart and the live totals shrink, which
  // would re-price every unpaid bill mid-split.
  const [orderSnapshot, setOrderSnapshot] = useState<SplitOrderTotals | null>(null);

  // INV-FE1-FRONTEND-BOOK-DIGITS: split shares round at the tenant's
  // book digits; the last guest/bill takes the remainder so shares
  // sum exactly to the total.
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const totalAmount = Number(orderSnapshot?.total ?? pos.totals?.total ?? 0);

  // Initialise once per opening (I32): the old deps [open, pos.cart,
  // pos.totals?.total] re-initialised every bill and every guest — Bill 1 =
  // whole cart, Bill 2 empty, all isPaid false — on ANY cart change, and
  // handlePayBill itself calls pos.setCart(remainingItems), so paying one
  // bill of three collapsed the whole split. The modal's own handlers own
  // the bills/guests after opening; nothing re-initialises them.
  useEffect(() => {
    if (!open) return;
    const snapshot: SplitOrderTotals = {
      subTotal: Number(pos.totals?.subTotal || 0),
      discountValue: Number(pos.totals?.discountValue || 0),
      serviceCharge: Number(pos.totals?.serviceCharge || 0),
      taxRate: Number(pos.totals?.taxRate || 0),
      pricesIncludeTax: Boolean(pos.totals?.pricesIncludeTax),
      tipAmount: Number(pos.totals?.tipAmount || 0),
      deliveryFee: Number(pos.totals?.deliveryFee || 0),
      total: Number(pos.totals?.total || 0),
      // INV-REST-LOYALTY-TRUTH (R6-C): snapshot the loyalty split at
      // open, next to the money snapshot — never re-read live totals
      // at pay time (paying one bill syncs remaining items back into
      // the cart and live totals shrink, I32). manualDiscount is the
      // manual share only (derived hook, pos.discount fallback); the
      // point value / cap percent come from the tenant settings with
      // the same defaults as the derived hook and the backend.
      manualDiscount: Number(pos.totals?.manualDiscount ?? pos.discount ?? 0),
      loyaltyPointsRedeemed: Number(pos.loyaltyPointsRedeemed || 0),
      loyaltyPointRedeemValue: Number(pos.settings?.loyaltyPointRedeemValue ?? 0.1),
      loyaltyMaxDiscountPercentage: Number(pos.settings?.loyaltyMaxDiscountPercentage ?? 100),
    };
    setOrderSnapshot(snapshot);
    // 1. Initialize split bills: Bill 1 gets all current cart items, Bill 2 starts empty
    const initialBills: SplitBill[] = [
      {
        id: 'main',
        name: 'الشيك 1 (الرئيسي)',
        items: (pos.cart || []).map((i) => ({ ...i })),
        isPaid: false,
      },
      {
        id: 'split-2',
        name: 'الشيك 2',
        items: [],
        isPaid: false,
      },
    ];
    setBills(initialBills);

    // 2. Initialize even guests split
    const currentTotal = snapshot.total;
    const perGuest = currentTotal > 0 ? roundMoneyValue(currentTotal / guestCount, bookDigits) : 0;
    const newGuests: EvenSplitGuest[] = [];
    let allocated = 0;
    for (let i = 1; i <= guestCount; i++) {
      const isLast = i === guestCount;
      const amt = isLast ? roundMoneyValue(currentTotal - allocated, bookDigits) : perGuest;
      allocated += amt;
      newGuests.push({
        id: i,
        name: `الضيف ${i}`,
        amount: amt,
        collected: false,
        paid: false,
        method: 'cash',
      });
    }
    setEvenGuests(newGuests);
    setStatusMessage('');
    setIsProcessingPayment(false);
  }, [open]);

  // Re-calculate even splits when guestCount changes
  const handleGuestCountChange = (count: number) => {
    if (count < 2) count = 2;
    if (count > 12) count = 12;
    setGuestCount(count);
    const perGuest = roundMoneyValue(totalAmount / count, bookDigits);
    const newGuests: EvenSplitGuest[] = [];
    let allocated = 0;
    for (let i = 1; i <= count; i++) {
      const isLast = i === count;
      const amt = isLast ? roundMoneyValue(totalAmount - allocated, bookDigits) : perGuest;
      allocated += amt;
      newGuests.push({
        id: i,
        name: `الضيف ${i}`,
        amount: amt,
        collected: false,
        paid: false,
        method: 'cash',
      });
    }
    setEvenGuests(newGuests);
  };

  // Real bill amounts (B10): each bill's share of the order's discount,
  // service charge, tip and delivery fee, plus its own tax by the backend
  // formula — computed from the opening snapshot, never the live totals.
  // INV-REST-LOYALTY-TRUTH (R6-C): the MANUAL discount is allocated by
  // allocateSplitBillAmounts (discountValue = manualDiscount only) and
  // the POINTS by allocateSplitLoyaltyPoints; each bill's loyalty
  // discount is derived from its allocated points. The bill amounts
  // are therefore manual share + discount-from-allocated-points, never
  // the snapshot's combined discountValue — otherwise the posted part
  // totals drift from billAmounts and isSplitPaidSumSettled refuses
  // to close.
  const billAmounts: SplitBillAmounts[] = useMemo(() => {
    if (!orderSnapshot) {
      return bills.map(() => ({
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
      }));
    }
    const subtotals = bills.map((b) => b.items.reduce((s, i) => s + calcCartLineTotal(i), 0));
    const loyaltyPoints = allocateSplitLoyaltyPoints(
      subtotals,
      orderSnapshot.loyaltyPointsRedeemed,
      orderSnapshot.loyaltyPointRedeemValue,
      orderSnapshot.loyaltyMaxDiscountPercentage,
      bookDigits,
    );
    return allocateSplitBillAmounts(
      subtotals,
      { ...orderSnapshot, discountValue: orderSnapshot.manualDiscount },
      bookDigits,
      loyaltyPoints,
    );
  }, [bills, orderSnapshot, bookDigits]);

  // INV-REST-LOYALTY-TRUTH (R6-C repair): the stranded loyalty value for
  // THIS split — the order's redeemed points minus the points the bills
  // actually placed, times the point value (see calcStrandedLoyaltyValue).
  // One value, computed once from the same billAmounts both checks below
  // read, so the close guard and the distributed-sum display can never
  // disagree: the display must not warn while closing is allowed.
  const strandedLoyaltyValue: number = useMemo(() => {
    if (!orderSnapshot) return 0;
    return calcStrandedLoyaltyValue(
      orderSnapshot.loyaltyPointsRedeemed,
      billAmounts.map((a) => a.loyaltyPointsRedeemed),
      orderSnapshot.loyaltyPointRedeemValue,
      bookDigits,
    );
  }, [orderSnapshot, billAmounts, bookDigits]);

  // Add extra split bill
  const handleAddBill = () => {
    const nextIndex = bills.length + 1;
    const newBill: SplitBill = {
      id: `split-${Date.now()}`,
      name: `الشيك ${nextIndex}`,
      items: [],
      isPaid: false,
    };
    setBills((prev) => [...prev, newBill]);
  };

  // Remove empty split bill (if extra)
  const handleRemoveBill = (billId: string) => {
    if (bills.length <= 2) return;
    setBills((prev) => prev.filter((b) => b.id !== billId));
  };

  // Instant 1-Click Split by Seat
  const handleSplitBySeat = () => {
    const seatMap = new Map<number, PosItem[]>();
    for (const item of pos.cart || []) {
      const s = item.seatNumber || 1;
      if (!seatMap.has(s)) seatMap.set(s, []);
      seatMap.get(s)!.push({ ...item });
    }

    const generatedBills: SplitBill[] = [];
    Array.from(seatMap.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([seat, items]) => {
        generatedBills.push({
          id: `seat-${seat}`,
          name: `شيك مقعد ${seat}`,
          items,
          isPaid: false,
        });
      });

    if (generatedBills.length === 0) {
      generatedBills.push({
        id: 'seat-1',
        name: 'شيك مقعد 1',
        items: (pos.cart || []).map((i) => ({ ...i })),
        isPaid: false,
      });
    }

    setBills(generatedBills);
    setSplitMode('items');
    setStatusMessage(`تم توزيع الأصناف تلقائياً على ${generatedBills.length} شيكات حسب أرقام المقاعد.`);
  };

  // Move item from one bill to another (R-I34: match on lineKey only —
  // see moveSplitBillItem above).
  const handleMoveItem = (fromBillId: string, toBillId: string, itemLineKey: string, moveQty?: number) => {
    setBills((prev) => moveSplitBillItem(prev, fromBillId, toBillId, itemLineKey, moveQty));
  };

  // Move all items from one bill to another (R-I34: match on lineKey only —
  // see moveSplitBillItems above).
  const handleMoveAllItems = (fromBillId: string, toBillId: string) => {
    setBills((prev) => moveSplitBillItems(prev, fromBillId, toBillId));
  };

  // Fractional Split: splits single item into N equal parts distributed across bills
  const handleFractionalSplit = (fromBillId: string, itemLineKey: string, partsCount: 2 | 3 | 4) => {
    setBills((prev) => {
      const fromBill = prev.find((b) => b.id === fromBillId);
      if (!fromBill || fromBill.isPaid) return prev;

      const itemIdx = fromBill.items.findIndex((i) => i.lineKey === itemLineKey);
      if (itemIdx === -1) return prev;
      const targetItem = fromBill.items[itemIdx];

      // INV-REST-SPLIT-REAL-TOTALS (B11): the parts are shares of the line's
      // FULL value (price + modifiers) and carry no modifiers — the old code
      // split price-only and copied the full modifier list onto every part.
      const parts = buildFractionalParts(targetItem, partsCount, bookDigits);
      if (!parts) return prev;
      const baseName = String(targetItem.name || '')
        .replace(/\s*\((نصف حصة|حصة)\s*[\d/]+\)/g, '')
        .trim();

      // Ensure we have enough unpaid bills to distribute to
      let currentBills = [...prev];
      while (currentBills.filter((b) => !b.isPaid).length < partsCount) {
        const nextIdx = currentBills.length + 1;
        currentBills.push({
          id: `split-${Date.now()}-${nextIdx}`,
          name: `الشيك ${nextIdx}`,
          items: [],
          isPaid: false,
        });
      }

      // Distribute: Part 0 stays in fromBill (replacing targetItem), others go to other unpaid bills
      const unpaidBills = currentBills.filter((b) => !b.isPaid);
      const otherUnpaidBills = unpaidBills.filter((b) => b.id !== fromBillId);
      const updatedBills = currentBills.map((b) => {
        if (b.id === fromBillId) {
          const newItems = [...b.items];
          newItems[itemIdx] = parts[0];
          return { ...b, items: newItems };
        }
        return b;
      });

      // Distribute remaining parts to other bills
      for (let p = 1; p < partsCount; p++) {
        const targetBill = otherUnpaidBills[p - 1];
        if (targetBill) {
          const bIdx = updatedBills.findIndex((b) => b.id === targetBill.id);
          if (bIdx !== -1) {
            updatedBills[bIdx] = {
              ...updatedBills[bIdx],
              items: [...updatedBills[bIdx].items, parts[p]],
            };
          }
        }
      }

      setStatusMessage(`تمت تجزئة «${baseName}» إلى ${partsCount} حصص متساوية وتوزيعها بنجاح.`);
      return updatedBills;
    });
  };

  // Pay individual split bill
  const handlePayBill = async (billId: string, paymentChannel: 'cash' | 'card') => {
    const billIndex = bills.findIndex((b) => b.id === billId);
    const targetBill = billIndex >= 0 ? bills[billIndex] : undefined;
    if (!targetBill || !targetBill.items.length || targetBill.isPaid) return;

    setIsProcessingPayment(true);
    setStatusMessage('');

    try {
      // INV-REST-SPLIT-REAL-TOTALS (B10): the bill posts its REAL total —
      // real line values plus its allocated share of the order's discount,
      // tax, service charge and tip. The old payload sent discount 0,
      // taxRate 0, no service charge/tip and paid = price x qty only.
      // INV-REST-LOYALTY-TRUTH (R6-C): the payload sends the MANUAL
      // discount only plus this bill's points share. The backend
      // recomputes the loyalty discount per part, capped, and deducts
      // the points once per part. Sending the combined discount AND
      // the points would grant the loyalty discount twice (Trap 1).
      const amounts = billAmounts[billIndex] ?? {
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
      };
      const billTotal = amounts.total;
      await pos.createSale.mutateAsync({
        source: 'pos',
        ...resolveSplitSaleBranch(pos),
        cart: targetBill.items,
        customerId: String(pos.customerId || ''),
        paymentType: 'cash',
        paymentChannel,
        discount: amounts.manualDiscount,
        loyaltyPointsRedeemed: amounts.loyaltyPointsRedeemed,
        deliveryFee: amounts.deliveryFee,
        taxRate: Number(orderSnapshot?.taxRate ?? pos.totals?.taxRate ?? 0),
        pricesIncludeTax: Boolean(orderSnapshot?.pricesIncludeTax ?? pos.totals?.pricesIncludeTax),
        paidAmount: billTotal,
        tenderedAmount: billTotal,
        payments: [{ paymentChannel, amount: billTotal }],
        expectedTotal: billTotal,
        orderType: pos.orderType,
        tableNumber: pos.tableNumber ? `${pos.tableNumber} (مجزأ)` : undefined,
        note: `فاتورة مجزأة من طاولة ${pos.tableNumber || ''} - ${targetBill.name}`,
        serviceCharge: amounts.serviceCharge,
        tipAmount: amounts.tipAmount,
      });

      // Mark this bill as paid
      const updatedBills = bills.map((b) => (b.id === billId ? { ...b, isPaid: true, paymentMethod: paymentChannel } : b));
      setBills(updatedBills);

      setStatusMessage(`تم تحصيل ${targetBill.name} بنجاح بقيمة ${formatCurrency(billTotal)}.`);

      // Check if all bills are now paid
      const remainingUnpaid = updatedBills.filter((b) => !b.isPaid && b.items.length > 0);
      if (remainingUnpaid.length === 0) {
        // Everything settled — but only if the paid bills actually sum to
        // the order total (B10 guard). Beyond rounding tolerance PLUS the
        // stranded loyalty value this means real money is missing
        // (undistributed items, stale snapshot): refuse to close settled
        // and say so. The stranded value is allowed because the bills
        // legitimately sum to orderTotal + stranded value when points
        // strand — the customer keeps the stranded point, worth exactly
        // that value — and the guard accepts exactly that much, no more.
        const paidSum = updatedBills
          .filter((b) => b.isPaid)
          .reduce((s, b) => s + (billAmounts[bills.findIndex((x) => x.id === b.id)]?.total ?? 0), 0);
        const nonEmptyCount = updatedBills.filter((b) => b.items.length > 0).length;
        if (!isSplitPaidSumSettled(paidSum, totalAmount, nonEmptyCount, bookDigits, strandedLoyaltyValue)) {
          setStatusMessage(
            `تحذير: مجموع الشيكات المحصلة (${formatCurrency(paidSum)}) لا يطابق إجمالي الطلب (${formatCurrency(totalAmount)}) — لم يتم إغلاق التقسيم. راجع توزيع الأصناف.`,
          );
          return;
        }
        // Everything settled! Reset the whole workspace draft — the
        // same reset handleSubmit/hold use (INV-REST-SPLIT-RESET-TRUTH):
        // it clears the cart and table AND zeroes the redeemed loyalty
        // points, clears the customer and wipes the persisted draft
        // snapshot, so the redemption cannot survive into the next
        // checkout (or a reload). The old manual setCart([]) +
        // setTableNumber('') left all three behind.
        pos.resetPosDraft();
        if (onSplitCompleted) onSplitCompleted();
        setTimeout(() => onClose(), 1200);
      } else {
        // Sync the remaining unpaid items back to the active cart!
        const remainingItems = remainingUnpaid.flatMap((b) => b.items);
        pos.setCart(remainingItems);
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'تعذر تسجيل تحصيل الشيك المجزأ');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Post the even-split final sale once every guest's share is collected.
  // INV-REST-SPLIT-REAL-TOTALS (I33): the final sale carries the REAL
  // tax/service/delivery/tip of the order and the payment channel of the
  // actual mix — the old sale sent taxRate 0, deliveryFee 0, no service
  // charge/tip and hardcoded 'cash' while the payments were mixed. Only a
  // successful post marks the guests paid; a failed post leaves paid false
  // (the collected flags stay, so the cashier retries posting without
  // re-collecting money that was already taken).
  const finalizeEvenSplit = async (guests: EvenSplitGuest[]): Promise<boolean> => {
    const cashTotal = guests.filter((g) => g.method === 'cash').reduce((s, g) => s + g.amount, 0);
    const cardTotal = guests.filter((g) => g.method === 'card').reduce((s, g) => s + g.amount, 0);
    const transferTotal = guests.filter((g) => g.method === 'transfer').reduce((s, g) => s + g.amount, 0);
    try {
      // INV-REST-LOYALTY-TRUTH (R6-C): the even split posts ONE sale for
      // the whole order, so it sends the MANUAL discount only (the
      // snapshot's discountValue minus the loyalty share) plus the
      // order's FULL redeemed points — one deduction, one log row, on
      // the final sale. Guests collect money only; the points move once.
      await pos.createSale.mutateAsync({
        source: 'pos',
        ...resolveSplitSaleBranch(pos),
        cart: pos.cart,
        customerId: String(pos.customerId || ''),
        paymentType: 'cash',
        paymentChannel: resolveSplitPaymentChannel(cashTotal, cardTotal, transferTotal),
        discount: Number(orderSnapshot?.manualDiscount ?? pos.discount ?? 0),
        loyaltyPointsRedeemed: Number(orderSnapshot?.loyaltyPointsRedeemed || 0),
        deliveryFee: Number(orderSnapshot?.deliveryFee ?? 0),
        taxRate: Number(orderSnapshot?.taxRate ?? pos.totals?.taxRate ?? 0),
        pricesIncludeTax: Boolean(orderSnapshot?.pricesIncludeTax ?? pos.totals?.pricesIncludeTax),
        paidAmount: totalAmount,
        tenderedAmount: totalAmount,
        payments: [
          ...(cashTotal > 0 ? [{ paymentChannel: 'cash' as const, amount: cashTotal }] : []),
          ...(cardTotal > 0 ? [{ paymentChannel: 'card' as const, amount: cardTotal }] : []),
          ...(transferTotal > 0 ? [{ paymentChannel: 'instapay' as const, amount: transferTotal }] : []),
        ],
        expectedTotal: totalAmount,
        orderType: pos.orderType,
        tableNumber: pos.tableNumber,
        note: `سداد مجزأ بالتساوي على ${guestCount} ضيوف`,
        serviceCharge: Number(orderSnapshot?.serviceCharge ?? 0),
        tipAmount: Number(orderSnapshot?.tipAmount ?? 0),
      });

      setEvenGuests(guests.map((g) => ({ ...g, paid: true })));
      // Everything settled — same canonical reset as handlePayBill
      // (INV-REST-SPLIT-RESET-TRUTH): clears cart/table, zeroes the
      // redeemed points, clears the customer and wipes the draft
      // snapshot, so no redemption survives into the next checkout.
      pos.resetPosDraft();
      if (onSplitCompleted) onSplitCompleted();
      setTimeout(() => onClose(), 1200);
      return true;
    } catch (err: any) {
      setStatusMessage(
        `${err?.message || 'تعذر ترحيل البيع المجزأ'} — المبالغ المحصلة من الضيوف محفوظة، أعد محاولة الترحيل من الأسفل.`,
      );
      return false;
    }
  };

  // Even split payment for single guest
  const handlePayGuest = async (guestId: number, method: 'cash' | 'card' | 'transfer') => {
    const guest = evenGuests.find((g) => g.id === guestId);
    if (!guest || guest.paid || guest.collected) return;

    setIsProcessingPayment(true);
    setStatusMessage('');

    try {
      // Record the collection — the money was taken — but the guest is NOT
      // paid yet: no sale exists until every share is collected and the
      // final sale posts (I33). The old code set paid: true here, before
      // any backend call, and the catch never reverted it.
      const updated = evenGuests.map((g) => (g.id === guestId ? { ...g, collected: true, method } : g));
      setEvenGuests(updated);

      setStatusMessage(`تم تحصيل نصيب ${guest.name} بقيمة ${formatCurrency(guest.amount)} — يرحّل البيع عند اكتمال جميع الضيوف.`);

      // If all guests collected, post the final sale now.
      if (updated.every((g) => g.collected)) {
        await finalizeEvenSplit(updated);
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'تعذر تسجيل سداد الضيف');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Save split checks as separate held drafts
  const handleSaveAsSeparateHeldChecks = async () => {
    const validBills = bills.filter((b) => !b.isPaid && b.items.length > 0);
    if (!validBills.length) return;

    setIsProcessingPayment(true);
    setStatusMessage('');

    try {
      // INV-REST-SPLIT-REAL-TOTALS (B12): each bill is saved by calling the
      // held-draft mutation DIRECTLY with that bill's own items and its own
      // table/check label. The old loop did pos.setCart(b.items) +
      // pos.setTableNumber(...) + await pos.holdDraft() per bill — but
      // setCart/setTableNumber are plain useState setters and holdDraft
      // reads the render-captured snapshot params, so the loop never
      // re-rendered between iterations and EVERY draft saved the ORIGINAL
      // full cart under the ORIGINAL table number. No setCart/setTableNumber
      // happens here at all until the end (reset to empty).
      for (let i = 0; i < validBills.length; i++) {
        const b = validBills[i];
        const amounts = billAmounts[bills.findIndex((x) => x.id === b.id)] ?? {
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
        };
        const billTableNumber = pos.tableNumber ? `${pos.tableNumber} - شيك ${i + 1}` : '';
        const sanitizedItems = b.items.map((item) => ({
          productId: Number(item.productId || 0),
          qty: Number(item.qty || 0),
          price: Number(item.price || 0),
          name: String(item.name || '').trim(),
          nameEn: (item as any).nameEn || (item as any).name_en || undefined,
          name_en: (item as any).name_en || (item as any).nameEn || undefined,
          unitName: String(item.unitName || '').trim(),
          unitMultiplier: Number(item.unitMultiplier || 1),
          priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail',
          notes: String(item.notes || '').trim(),
          modifiers: item.modifiers || [],
          seatNumber: item.seatNumber ? Number(item.seatNumber) : undefined,
          course: item.course || undefined,
        }));
        await pos.saveHeldDraftMutation.mutateAsync({
          customerId: pos.customerId || null,
          paymentType: pos.paymentType,
          // INV-REST-HELD-LOYALTY (R7-C): the held check sends the MANUAL
          // discount only plus this bill's allocated points — the backend
          // derives the loyalty discount FROM the points at submit, so
          // sending the combined discount AND the points would grant the
          // loyalty discount twice (Trap 1, same as handlePayBill). The
          // same call also carries the bill's allocated tip share, which
          // it used to drop even though the backend already accepts it.
          discount: amounts.manualDiscount,
          loyaltyPointsRedeemed: amounts.loyaltyPointsRedeemed,
          tipAmount: amounts.tipAmount,
          deliveryFee: amounts.deliveryFee,
          note: pos.note,
          search: pos.search,
          priceType: pos.priceType,
          ...resolveSplitSaleBranch(pos),
          cashAmount: 0,
          cardAmount: 0,
          transferAmount: 0,
          paymentChannel: pos.paymentChannel,
          orderType: pos.orderType,
          tableNumber: billTableNumber,
          ...(pos.deliveryRepId && Number(pos.deliveryRepId) > 0
            ? {
                deliveryRepId: Number(pos.deliveryRepId),
                collectionStatus: pos.collectionStatus || 'cod',
              }
            : {}),
          // HeldSaleItemDto forbids non-whitelisted fields, so strip the
          // name keys from the server payload (same as holdDraft).
          items: stripSaleItemNameFields(sanitizedItems),
        });

        // Kitchen ticket for THIS bill's own items (same condition as
        // holdDraft) — the old loop printed the full original cart once
        // per bill. The cashier name is not exposed on the modal's pos,
        // so split-draft tickets print without it.
        if (pos.settings?.restaurantModuleEnabled && pos.settings?.posAutoPrintKitchenReceipt) {
          try {
            const { printKitchenTicket } = await import('@/lib/pos-printing/kitchen');
            printKitchenTicket(
              {
                tableNumber: billTableNumber,
                orderType: pos.orderType,
                guestCount: pos.guestCount,
                note: pos.note,
                items: sanitizedItems,
                date: new Date().toISOString(),
              } as any,
              pos.settings,
            );
          } catch {
            // Non-blocking print
          }
        }
      }

      // Everything saved as held checks — same canonical reset as
      // handlePayBill / finalizeEvenSplit (INV-REST-SPLIT-RESET-TRUTH,
      // T13-N2): it clears the cart and table AND zeroes the redeemed
      // loyalty points and the tip, clears the customer and wipes the
      // persisted draft snapshot, so no redemption survives into the
      // next checkout (or a reload). The old manual setCart([]) +
      // setTableNumber('') left all of them behind.
      pos.resetPosDraft();
      setStatusMessage('تم حفظ الشيكات المجزأة كطلبات معلقة منفصلة بنجاح.');
      if (onSplitCompleted) onSplitCompleted();
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setStatusMessage(err?.message || 'تعذر حفظ الشيكات كطلبات معلقة');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!open) return null;

  // The distributed sum is the sum of the REAL bill totals (lines +
  // allocated extras), not the price-only sums. It legitimately exceeds
  // the order total by the stranded loyalty value (see
  // calcStrandedLoyaltyValue) — the display allows exactly that much, so
  // it never warns while the close guard allows closing.
  const totalSplitSum = billAmounts.reduce((sum, a) => sum + a.total, 0);
  const nonEmptyBillCount = bills.filter((b) => b.items.length > 0).length;
  const splitSumMismatch =
    Math.abs(totalSplitSum - totalAmount) >
    splitRoundingTolerance(nonEmptyBillCount, bookDigits) + strandedLoyaltyValue + 1e-9;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(1080px, calc(100vw - 32px))"
      zIndex={90}
      ariaLabel={t('pos.pos_workspace.pos_split_bill_modal.s0', "تجزئة وتقسيم الفاتورة والشيكات")}
    >
      <Card
        title={t('pos.pos_workspace.pos_split_bill_modal.s1', "تجزئة وتقسيم الفاتورة والشيكات (Split Bill)")}
        className="dialog-card"
        style={{
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          padding: '16px 20px',
        }}
      >
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Header Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ReceiptIcon size={20} color="#170e5e" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s2', "تقسيم الفاتورة")} {pos.tableNumber ? `(طاولة ${pos.tableNumber})` : ''}
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s3', "إجمالي الطلب:")} <strong style={{ color: '#170e5e' }}>{formatCurrency(totalAmount)}</strong> • {pos.cart.length} {t('pos.pos_workspace.pos_split_bill_modal.s4', "أصناف بالسلة")}
                </span>
              </div>
            </div>

            {/* Mode Switcher */}
            <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={() => setSplitMode('items')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: splitMode === 'items' ? '#170e5e' : 'transparent',
                  color: splitMode === 'items' ? '#ffffff' : '#475569',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t('pos.pos_workspace.pos_split_bill_modal.s5', "تجزئة حسب الأصناف")}
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('even')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: splitMode === 'even' ? '#170e5e' : 'transparent',
                  color: splitMode === 'even' ? '#ffffff' : '#475569',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t('pos.pos_workspace.pos_split_bill_modal.s6', "تقسيم بالتساوي (ضيوف)")}
              </button>
              <button
                type="button"
                onClick={handleSplitBySeat}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: '1px solid #bfdbfe',
                  background: '#eff6ff',
                  color: '#1e40af',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                title={t('pos.pos_workspace.pos_split_bill_modal.s7', "توزيع فوري لأصناف السلة على شيكات مستقلة حسب مقعد كل ضيف")}
              >
                <UsersIcon size={14} color="#1e40af" />
                {t('pos.pos_workspace.pos_split_bill_modal.s8', "توزيع فوري حسب المقاعد (Seat Split)")}
              </button>
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1e40af',
                fontSize: '12.5px',
                fontWeight: 700,
              }}
            >
              {statusMessage}
            </div>
          )}

          {/* MODE 1: SPLIT BY ITEMS */}
          {splitMode === 'items' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12.5px', color: '#475569', fontWeight: 600 }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s9', "وزّع الأصناف والكميات على الشيكات المستقلة بالضغط على أزرار النقل، ثم حصّل كل شيك على حدة:")}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddBill}
                  style={{ fontSize: '12px', minHeight: '30px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <PlusIcon size={14} />
                  <span>{t('pos.pos_workspace.pos_split_bill_modal.s10', "إضافة شيك إضافي")}</span>
                </Button>
              </div>

              {/* Bills Columns Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(Math.max(bills.length, 1), 3)}, minmax(0, 1fr))`,
                  gap: '12px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  paddingBottom: '4px',
                }}
              >
                {bills.map((bill, _billIdx) => {
                  // INV-REST-SPLIT-REAL-TOTALS (B10): the column shows what
                  // the guest actually pays (lines + allocated extras).
                  const billTotal = billAmounts[_billIdx]?.total ?? 0;
                  const otherBills = bills.filter((b) => b.id !== bill.id && !b.isPaid);

                  return (
                    <div
                      key={bill.id}
                      style={{
                        border: bill.isPaid ? '1.5px solid #bbf7d0' : '1px solid #e2e8f0',
                        borderRadius: '10px',
                        background: bill.isPaid ? '#f0fdf4' : '#ffffff',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: '300px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                      }}
                    >
                      <div>
                        {/* Bill Title & Badges */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '13.5px', color: bill.isPaid ? '#166534' : '#0f172a' }}>
                              {bill.name}
                            </strong>
                            <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
                              {bill.items.reduce((s, i) => s + i.qty, 0)} {t('pos.pos_workspace.pos_split_bill_modal.s11', "قطعة")}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {bill.isPaid ? (
                              <span style={{ fontSize: '11px', background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                                {t('pos.pos_workspace.pos_split_bill_modal.s12', "تم السداد (")}{bill.paymentMethod === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s13', "شبكة") : t('pos.pos_workspace.pos_split_bill_modal.s14', "نقد")})
                              </span>
                            ) : (
                              <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
                                {formatCurrency(billTotal)}
                              </span>
                            )}

                            {/* Option to delete extra bill if empty & unpaid */}
                            {!bill.isPaid && bill.items.length === 0 && bills.length > 2 && bill.id !== 'main' && (
                              <button
                                type="button"
                                onClick={() => handleRemoveBill(bill.id)}
                                title={t('pos.pos_workspace.pos_split_bill_modal.s15', "حذف هذا الشيك الفارغ")}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  padding: '2px 4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                              >
                                <TrashIcon size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Quick action: Move all items if available */}
                        {!bill.isPaid && bill.items.length > 0 && otherBills.length === 1 && (
                          <div style={{ marginBottom: '8px', textAlign: 'start' }}>
                            <button
                              type="button"
                              onClick={() => handleMoveAllItems(bill.id, otherBills[0].id)}
                              style={{
                                background: '#f8fafc',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#475569',
                                cursor: 'pointer',
                                width: '100%',
                              }}
                            >
                              {t('pos.pos_workspace.pos_split_bill_modal.s16', "نقل جميع الأصناف إلى")} {otherBills[0].name}
                            </button>
                          </div>
                        )}

                        {/* Items in this bill */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                          {bill.items.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '32px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: '12px' }}>
                              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: '#64748b' }}>{t('pos.pos_workspace.pos_split_bill_modal.s17', "هذا الشيك فارغ")}</p>
                              <span>{t('pos.pos_workspace.pos_split_bill_modal.s18', "اضغط على أزرار النقل بجوار الأصناف في الشيكات الأخرى لنقلها هنا")}</span>
                            </div>
                          ) : (
                            bill.items.map((item) => (
                              <div
                                key={item.lineKey}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  background: bill.isPaid ? '#ffffff' : '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '12px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div style={{ fontWeight: 700, color: '#0f172a', flex: 1, wordBreak: 'break-word' }}>
                                    {item.name}
                                  </div>
                                  <div style={{ fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap', marginInlineStart: '6px' }}>
                                    {formatCurrency(calcCartLineTotal(item))}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ color: '#64748b', fontSize: '11px' }}>
                                    {item.qty} × {formatCurrency(Number(item.price || 0) + calcModifiersTotal(item.modifiers))}
                                  </span>

                                  {/* Item Transfer Buttons */}
                                  {!bill.isPaid && otherBills.length > 0 && (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {otherBills.map((target) => (
                                        <div key={target.id} style={{ display: 'flex', gap: '2px' }}>
                                          {item.qty > 1 ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, 1)}
                                                title={`نقل قطعة واحدة إلى ${target.name}`}
                                                style={{
                                                  background: '#ffffff',
                                                  border: '1px solid #cbd5e1',
                                                  borderRadius: '4px',
                                                  padding: '2px 6px',
                                                  fontSize: '10.5px',
                                                  fontWeight: 700,
                                                  color: '#170e5e',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                {t('pos.pos_workspace.pos_split_bill_modal.s19', "نقل 1")} {otherBills.length > 1 ? `← #${target.name.replace(t('pos.pos_workspace.pos_split_bill_modal.s20', "الشيك "), '')}` : `← ${target.name}`}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, item.qty)}
                                                title={`نقل كل الكمية (${item.qty}) إلى ${target.name}`}
                                                style={{
                                                  background: '#f1f5f9',
                                                  border: '1px solid #cbd5e1',
                                                  borderRadius: '4px',
                                                  padding: '2px 6px',
                                                  fontSize: '10.5px',
                                                  fontWeight: 700,
                                                  color: '#334155',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                {t('pos.pos_workspace.pos_split_bill_modal.s21', "الكل (")}{item.qty})
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, 1)}
                                              title={`نقل إلى ${target.name}`}
                                              style={{
                                                background: '#ffffff',
                                                border: '1px solid #cbd5e1',
                                                borderRadius: '4px',
                                                padding: '2px 8px',
                                                fontSize: '10.5px',
                                                fontWeight: 700,
                                                color: '#170e5e',
                                                cursor: 'pointer',
                                              }}
                                            >
                                              {t('pos.pos_workspace.pos_split_bill_modal.s22', "نقل")} {otherBills.length > 1 ? `← #${target.name.replace(t('pos.pos_workspace.pos_split_bill_modal.s23', "الشيك "), '')}` : `← ${target.name}`}
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Fractional Item Splitting */}
                                  {!bill.isPaid && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' }}>
                                      <span style={{ fontSize: '9.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_split_bill_modal.s24', "تجزئة الصنف:")}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleFractionalSplit(bill.id, item.lineKey, 2)}
                                        title={t('pos.pos_workspace.pos_split_bill_modal.s25', "تجزئة هذا الصنف إلى نصفين (50% / 50%) وتوزيعهما على شيكين")}
                                        style={{
                                          background: '#eff6ff',
                                          border: '1px solid #bfdbfe',
                                          borderRadius: '3px',
                                          padding: '1px 5px',
                                          fontSize: '10px',
                                          fontWeight: 800,
                                          color: '#1d4ed8',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('pos.pos_workspace.pos_split_bill_modal.s26', "½ نصفين")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleFractionalSplit(bill.id, item.lineKey, 3)}
                                        title={t('pos.pos_workspace.pos_split_bill_modal.s27', "تجزئة هذا الصنف إلى 3 أثلاث متساوية وتوزيعها على الشيكات")}
                                        style={{
                                          background: '#eff6ff',
                                          border: '1px solid #bfdbfe',
                                          borderRadius: '3px',
                                          padding: '1px 5px',
                                          fontSize: '10px',
                                          fontWeight: 800,
                                          color: '#1d4ed8',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('pos.pos_workspace.pos_split_bill_modal.s28', "⅓ أثلاث")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleFractionalSplit(bill.id, item.lineKey, 4)}
                                        title={t('pos.pos_workspace.pos_split_bill_modal.s29', "تجزئة هذا الصنف إلى 4 أرباع متساوية وتوزيعها على الشيكات")}
                                        style={{
                                          background: '#eff6ff',
                                          border: '1px solid #bfdbfe',
                                          borderRadius: '3px',
                                          padding: '1px 5px',
                                          fontSize: '10px',
                                          fontWeight: 800,
                                          color: '#1d4ed8',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('pos.pos_workspace.pos_split_bill_modal.s30', "¼ أرباع")}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Bill Actions */}
                      {!bill.isPaid && bill.items.length > 0 && (
                        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px', marginTop: '10px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <Button
                              type="button"
                              variant="primary"
                              disabled={isProcessingPayment}
                              onClick={() => void handlePayBill(bill.id, 'cash')}
                              style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px' }}
                            >
                              {t('pos.pos_workspace.pos_split_bill_modal.s31', "تحصيل نقد")}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={isProcessingPayment}
                              onClick={() => void handlePayBill(bill.id, 'card')}
                              style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px', borderColor: '#170e5e', color: '#170e5e' }}
                            >
                              {t('pos.pos_workspace.pos_split_bill_modal.s32', "تحصيل شبكة")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Bottom bulk action & Summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleSaveAsSeparateHeldChecks()}
                    disabled={isProcessingPayment || bills.filter((b) => !b.isPaid && b.items.length > 0).length < 2}
                    style={{ fontSize: '12px' }}
                  >
                    {t('pos.pos_workspace.pos_split_bill_modal.s33', "حفظ الشيكات كطلبات معلقة منفصلة في الصالة")}
                  </Button>

                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {t('pos.pos_workspace.pos_split_bill_modal.s34', "المجموع الموزع:")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalSplitSum)}</strong> {t('pos.pos_workspace.pos_split_bill_modal.s35', "من أصل")} <strong style={{ color: '#170e5e' }}>{formatCurrency(totalAmount)}</strong>
                  </span>
                  {splitSumMismatch && (
                    <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 800 }}>
                      {t('pos.pos_workspace.pos_split_bill_modal.s50', "تحذير: المجموع الموزع لا يطابق إجمالي الطلب — راجع توزيع الأصناف قبل التحصيل.")}
                    </span>
                  )}
                </div>

                <Button type="button" variant="secondary" onClick={onClose} disabled={isProcessingPayment}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s36', "إغلاق")}
                </Button>
              </div>
            </div>
          )}

          {/* MODE 2: SPLIT EVENLY */}
          {splitMode === 'even' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Guest Count Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UsersIcon size={18} color="#170e5e" />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    {t('pos.pos_workspace.pos_split_bill_modal.s37', "عدد الضيوف للتقسيم:")}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleGuestCountChange(num)}
                      style={{
                        padding: '5px 14px',
                        borderRadius: '6px',
                        border: guestCount === num ? '2px solid #170e5e' : '1px solid #cbd5e1',
                        background: guestCount === num ? '#170e5e' : '#ffffff',
                        color: guestCount === num ? '#ffffff' : '#334155',
                        fontWeight: 800,
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      {num} {t('pos.pos_workspace.pos_split_bill_modal.s38', "ضيوف")}
                    </button>
                  ))}
                </div>
                <div style={{ marginInlineStart: 'auto', fontSize: '13px', color: '#64748b' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s39', "نصيب كل ضيف:")} <strong style={{ color: '#0f172a', fontSize: '14px' }}>{formatCurrency(evenGuests[0]?.amount || 0)}</strong>
                </div>
              </div>

              {/* Guest Shares List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {evenGuests.map((guest) => (
                  <div
                    key={guest.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: guest.paid ? '1.5px solid #bbf7d0' : '1px solid #e2e8f0',
                      background: guest.paid ? '#f0fdf4' : '#ffffff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: guest.paid ? '#16a34a' : '#170e5e',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 800,
                        }}
                      >
                        {guest.id}
                      </span>
                      <div>
                        <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>{guest.name}</strong>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {t('pos.pos_workspace.pos_split_bill_modal.s40', "المبلغ المطلوب:")} <strong style={{ color: '#170e5e' }}>{formatCurrency(guest.amount)}</strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      {guest.paid ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 800, fontSize: '12.5px' }}>
                          <CheckIcon size={16} />
                          <span>{t('pos.pos_workspace.pos_split_bill_modal.s41', "تم السداد (")}{guest.method === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s42', "شبكة") : guest.method === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s44', "نقد")})</span>
                        </div>
                      ) : guest.collected ? (
                        // INV-REST-SPLIT-REAL-TOTALS (I33): the money was
                        // taken but no sale posted yet — collected, not paid.
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#92400e', fontWeight: 800, fontSize: '12.5px' }}>
                          <span>{t('pos.pos_workspace.pos_split_bill_modal.s51', "تم التحصيل — بانتظار ترحيل البيع (")}{guest.method === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s42', "شبكة") : guest.method === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s44', "نقد")})</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'cash')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s45', "سداد نقد")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'card')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px', borderColor: '#170e5e', color: '#170e5e' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s46', "سداد شبكة")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Progress Summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s47', "تم تحصيل:")} <strong style={{ color: '#16a34a' }}>
                    {formatCurrency(evenGuests.filter((g) => g.collected).reduce((s, g) => s + g.amount, 0))}
                  </strong> {t('pos.pos_workspace.pos_split_bill_modal.s48', "من أصل")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalAmount)}</strong>
                </div>

                {/* INV-REST-SPLIT-REAL-TOTALS (I33): every share collected
                    but the final sale failed to post — retry the posting
                    without re-collecting money that was already taken. */}
                {evenGuests.length > 0 && evenGuests.every((g) => g.collected) && !evenGuests.every((g) => g.paid) && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={isProcessingPayment}
                    onClick={() => void finalizeEvenSplit(evenGuests)}
                    style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px' }}
                  >
                    {t('pos.pos_workspace.pos_split_bill_modal.s52', "إعادة محاولة ترحيل البيع")}
                  </Button>
                )}

                <Button type="button" variant="secondary" onClick={onClose} disabled={isProcessingPayment}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s49', "إغلاق")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </DialogShell>
  );
}

