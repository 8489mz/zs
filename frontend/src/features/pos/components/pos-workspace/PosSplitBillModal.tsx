import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CheckIcon, UsersIcon, PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { calcCartLineDiscount, calcCartLineNetTotal, calcModifiersTotal } from '@/features/pos/lib/pos-modifier-totals';
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
                                {t('pos.pos_workspace.pos_split_bill_modal.s12', "تم السداد (")}{bill.paymentMethod === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s13', "شبكة") : bill.paymentMethod === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s14', "نقد")})
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
                                    {formatCurrency(calcCartLineNetTotal(item))}
                                  </div>
                                </div>

                                {/* INV-POS-LINE-DISCOUNT: the line's own
                                 * discount, so the visible bill items sum
                                 * to the bill subtotal. */}
                                {calcCartLineDiscount(item) > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <span style={{ color: '#065f46', fontSize: '11px', fontWeight: 700 }}>
                                      خصم الصنف: - {formatCurrency(calcCartLineDiscount(item))}
                                    </span>
                                  </div>
                                )}

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
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={isProcessingPayment}
                              onClick={() => void handlePayBill(bill.id, 'transfer')}
                              style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px', borderColor: '#0369a1', color: '#0369a1' }}
                            >
                              {t('pos.pos_workspace.pos_split_bill_modal.s53', "تحصيل تحويل")}
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
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'transfer')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px', borderColor: '#0369a1', color: '#0369a1' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s54', "سداد تحويل")}
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

