import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { formatCurrency } from '@/lib/format';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { calcCartLineNetTotal } from '@/features/pos/lib/pos-modifier-totals';
import { getPosTerminalCode } from '@/features/pos/lib/pos-offline-sync';
import { stripSaleItemNameFields } from '@/features/pos/contracts';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import {
  moveSplitBillItem,
  moveSplitBillItems,
  splitRoundingTolerance,
  calcStrandedLoyaltyValue,
  isSplitPaidSumSettled,
  allocateSplitLoyaltyPoints,
  allocateSplitBillAmounts,
  buildFractionalParts,
  resolveSplitPaymentChannel,
  resolveSplitSaleBranch,
  type SplitBill,
  type EvenSplitGuest,
  type SplitOrderTotals,
  type SplitBillAmounts,
} from './pos-split-bill.helpers';
import { PosSplitBillHeader } from '@/features/pos/components/pos-workspace/pos-split-bill/PosSplitBillHeader';
import { PosSplitBillItemsMode } from '@/features/pos/components/pos-workspace/pos-split-bill/PosSplitBillItemsMode';
import { PosSplitBillEvenMode } from '@/features/pos/components/pos-workspace/pos-split-bill/PosSplitBillEvenMode';

export {
  moveSplitBillItem,
  moveSplitBillItems,
  splitRoundingTolerance,
  calcStrandedLoyaltyValue,
  isSplitPaidSumSettled,
  allocateSplitLoyaltyPoints,
  allocateSplitBillAmounts,
  buildFractionalParts,
  resolveSplitPaymentChannel,
  resolveSplitSaleBranch,
  type SplitBill,
  type SplitOrderTotals,
  type SplitBillAmounts,
};

interface PosSplitBillModalProps {
  open: boolean;
  pos: PosWorkspaceState;
  initialManagerPin?: string;
  onClose: () => void;
  onSplitCompleted?: () => void;
}

export function PosSplitBillModal({ open, pos, initialManagerPin, onClose, onSplitCompleted }: PosSplitBillModalProps) {
  const { t } = useTranslation();
  const [splitMode, setSplitMode] = useState<'items' | 'even'>('items');
  const resolvedManagerPin = initialManagerPin || (pos as { discountApprovalSecret?: string }).discountApprovalSecret || undefined;

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
      /* INV-POS-LINE-DISCOUNT: the snapshot subtotal is the NET
       * subtotal — the bill subtotals below are net too, so the
       * pro-rata shares sum to 1. */
      subTotal: Number((pos.totals?.netSubTotal ?? pos.totals?.subTotal) || 0),
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
    /* INV-POS-LINE-DISCOUNT: bill subtotals are NET of the per-line
     * discounts — a bill's header discount is capped at its own
     * subtotal, and the backend caps it at the net subtotal, so
     * gross bill subtotals could 400 at submit. */
    const subtotals = bills.map((b) => b.items.reduce((s, i) => s + calcCartLineNetTotal(i), 0));
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
      const currentBills = [...prev];
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
  const handlePayBill = async (billId: string, paymentChannel: 'cash' | 'card' | 'transfer') => {
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
      const apiChannel = paymentChannel === 'transfer' ? 'instapay' : paymentChannel;
      await pos.createSale.mutateAsync({
        source: 'pos',
        ...resolveSplitSaleBranch(pos),
        cart: targetBill.items,
        customerId: String(pos.customerId || ''),
        paymentType: 'cash',
        paymentChannel: apiChannel,
        discount: amounts.manualDiscount,
        loyaltyPointsRedeemed: amounts.loyaltyPointsRedeemed,
        deliveryFee: amounts.deliveryFee,
        taxRate: Number(orderSnapshot?.taxRate ?? pos.totals?.taxRate ?? 0),
        pricesIncludeTax: Boolean(orderSnapshot?.pricesIncludeTax ?? pos.totals?.pricesIncludeTax),
        paidAmount: billTotal,
        tenderedAmount: billTotal,
        payments: [{ paymentChannel: apiChannel, amount: billTotal }],
        expectedTotal: billTotal,
        managerPin: resolvedManagerPin,
        terminalCode: getPosTerminalCode(),
        orderType: pos.orderType,
        tableNumber: pos.tableNumber ? `${pos.tableNumber} (مجزأ)` : undefined,
        note: pos.tableNumber ? `فاتورة مجزأة من طاولة ${pos.tableNumber} - ${targetBill.name}` : `فاتورة مجزأة - ${targetBill.name}`,
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
        // Sync remaining items AND their remaining discount/tip/points/delivery share back to the workspace!
        const remainingItems = remainingUnpaid.flatMap((b) => b.items);
        pos.setCart(remainingItems);
        const remainingTotals = remainingUnpaid.reduce(
          (acc, b) => {
            const idx = updatedBills.findIndex((x) => x.id === b.id);
            const a = billAmounts[idx];
            if (!a) return acc;
            return {
              discount: acc.discount + a.manualDiscount,
              tipAmount: acc.tipAmount + a.tipAmount,
              loyaltyPoints: acc.loyaltyPoints + a.loyaltyPointsRedeemed,
              deliveryFee: acc.deliveryFee + a.deliveryFee,
            };
          },
          { discount: 0, tipAmount: 0, loyaltyPoints: 0, deliveryFee: 0 },
        );
        const setDiscount = (pos as { setDiscount?: (value: number) => void }).setDiscount;
        const setTipAmount = (pos as { setTipAmount?: (value: number) => void }).setTipAmount;
        const setLoyaltyPoints = (pos as { setLoyaltyPointsRedeemed?: (value: number) => void }).setLoyaltyPointsRedeemed;
        const setDeliveryFee = (pos as { setDeliveryFee?: (value: number) => void }).setDeliveryFee;
        setDiscount?.(roundMoneyValue(remainingTotals.discount, bookDigits));
        setTipAmount?.(roundMoneyValue(remainingTotals.tipAmount, bookDigits));
        setLoyaltyPoints?.(remainingTotals.loyaltyPoints);
        setDeliveryFee?.(roundMoneyValue(remainingTotals.deliveryFee, bookDigits));
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
        managerPin: resolvedManagerPin,
        terminalCode: getPosTerminalCode(),
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
        const billTableNumber = pos.tableNumber ? `${pos.tableNumber} - شيك ${i + 1}` : (b.name || `شيك ${i + 1}`);
        const sanitizedItems = b.items.map((item) => ({
          productId: Number(item.productId || 0),
          qty: Number(item.qty || 0),
          price: Number(item.price || 0),
          name: String(item.name || '').trim(),
          nameEn: (item as any).nameEn || (item as any).name_en || undefined,
          name_en: (item as any).name_en || (item as any).nameEn || undefined,
          unitName: String(item.unitName || '').trim(),
          unitMultiplier: Number(item.unitMultiplier || 1),
          priceType: (['retail', 'wholesale', 'half_wholesale', 'credit'].includes(item.priceType as string) ? item.priceType : 'retail') as PosPriceType,
          notes: String(item.notes || '').trim(),
          modifiers: item.modifiers || [],
          /* INV-POS-LINE-DISCOUNT: the held check keeps the line's own
           * discount — HeldSaleItemDto whitelists it and the held
           * recall maps it back, so a split bill saved as a held
           * check does not lose the discount. */
          lineDiscount: Number(item.lineDiscount || 0) > 0 ? Number(item.lineDiscount) : undefined,
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
          <PosSplitBillHeader
            pos={pos}
            totalAmount={totalAmount}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            handleSplitBySeat={handleSplitBySeat}
            statusMessage={statusMessage}
          />

          {splitMode === 'items' && (
            <PosSplitBillItemsMode
              bills={bills}
              billAmounts={billAmounts}
              handleAddBill={handleAddBill}
              handleRemoveBill={handleRemoveBill}
              handleMoveAllItems={handleMoveAllItems}
              handleMoveItem={handleMoveItem}
              handleFractionalSplit={handleFractionalSplit}
              isProcessingPayment={isProcessingPayment}
              handlePayBill={handlePayBill}
              handleSaveAsSeparateHeldChecks={handleSaveAsSeparateHeldChecks}
              totalSplitSum={totalSplitSum}
              totalAmount={totalAmount}
              splitSumMismatch={splitSumMismatch}
              onClose={onClose}
            />
          )}

          {/* MODE 2: SPLIT EVENLY */}
          {splitMode === 'even' && (
            <PosSplitBillEvenMode
              guestCount={guestCount}
              handleGuestCountChange={handleGuestCountChange}
              evenGuests={evenGuests}
              isProcessingPayment={isProcessingPayment}
              handlePayGuest={handlePayGuest}
              totalAmount={totalAmount}
              finalizeEvenSplit={finalizeEvenSplit}
              onClose={onClose}
            />
          )}
        </div>
      </Card>
    </DialogShell>
  );
}

