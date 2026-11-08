import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CheckIcon, UsersIcon, ReceiptIcon, PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type { PosItem } from '@/features/pos/types/pos.types';

interface PosSplitBillModalProps {
  open: boolean;
  pos: PosWorkspaceState;
  onClose: () => void;
  onSplitCompleted?: () => void;
}

interface SplitBill {
  id: string;
  name: string;
  items: PosItem[];
  isPaid: boolean;
  paymentMethod?: 'cash' | 'card';
}

interface EvenSplitGuest {
  id: number;
  name: string;
  amount: number;
  paid: boolean;
  method: 'cash' | 'card' | 'transfer';
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

  // INV-FE1-FRONTEND-BOOK-DIGITS: split shares round at the tenant's
  // book digits; the last guest/bill takes the remainder so shares
  // sum exactly to the total.
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const totalAmount = Number(pos.totals?.total || 0);

  // Sync state whenever modal opens or cart changes
  useEffect(() => {
    if (open) {
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
      const currentTotal = Number(pos.totals?.total || 0);
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
          paid: false,
          method: 'cash',
        });
      }
      setEvenGuests(newGuests);
      setStatusMessage('');
      setIsProcessingPayment(false);
    }
  }, [open, pos.cart, pos.totals?.total]);

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
        paid: false,
        method: 'cash',
      });
    }
    setEvenGuests(newGuests);
  };

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

  // Move item from one bill to another
  const handleMoveItem = (fromBillId: string, toBillId: string, itemLineKey: string, moveQty?: number) => {
    setBills((prev) => {
      const fromBill = prev.find((b) => b.id === fromBillId);
      const toBill = prev.find((b) => b.id === toBillId);
      if (!fromBill || !toBill || fromBill.isPaid || toBill.isPaid) return prev;

      const itemIdx = fromBill.items.findIndex((i) => i.lineKey === itemLineKey);
      if (itemIdx === -1) return prev;
      const item = fromBill.items[itemIdx];

      const actualMoveQty = moveQty === undefined ? item.qty : Math.min(item.qty, moveQty);
      if (actualMoveQty <= 0) return prev;

      const updatedFromItems = [...fromBill.items];
      if (item.qty <= actualMoveQty) {
        // remove completely
        updatedFromItems.splice(itemIdx, 1);
      } else {
        // decrement
        updatedFromItems[itemIdx] = {
          ...item,
          qty: item.qty - actualMoveQty,
        };
      }

      // Add to toBill
      const existingToIdx = toBill.items.findIndex((i) => i.productId === item.productId && i.unitId === item.unitId && i.price === item.price);
      let updatedToItems = [...toBill.items];
      if (existingToIdx !== -1) {
        updatedToItems[existingToIdx] = {
          ...updatedToItems[existingToIdx],
          qty: updatedToItems[existingToIdx].qty + actualMoveQty,
        };
      } else {
        updatedToItems.push({
          ...item,
          lineKey: `${item.productId}::${item.unitId}::split::${Date.now()}::${Math.random()}`,
          qty: actualMoveQty,
        });
      }

      return prev.map((b) => {
        if (b.id === fromBillId) return { ...b, items: updatedFromItems };
        if (b.id === toBillId) return { ...b, items: updatedToItems };
        return b;
      });
    });
  };

  // Move all items from one bill to another
  const handleMoveAllItems = (fromBillId: string, toBillId: string) => {
    setBills((prev) => {
      const fromBill = prev.find((b) => b.id === fromBillId);
      const toBill = prev.find((b) => b.id === toBillId);
      if (!fromBill || !toBill || fromBill.isPaid || toBill.isPaid || !fromBill.items.length) return prev;

      const updatedToItems = [...toBill.items];
      for (const item of fromBill.items) {
        const existingIdx = updatedToItems.findIndex((i) => i.productId === item.productId && i.unitId === item.unitId && i.price === item.price);
        if (existingIdx !== -1) {
          updatedToItems[existingIdx] = {
            ...updatedToItems[existingIdx],
            qty: updatedToItems[existingIdx].qty + item.qty,
          };
        } else {
          updatedToItems.push({
            ...item,
            lineKey: `${item.productId}::${item.unitId}::split::${Date.now()}::${Math.random()}`,
          });
        }
      }

      return prev.map((b) => {
        if (b.id === fromBillId) return { ...b, items: [] };
        if (b.id === toBillId) return { ...b, items: updatedToItems };
        return b;
      });
    });
  };

  // Fractional Split: splits single item into N equal parts distributed across bills
  const handleFractionalSplit = (fromBillId: string, itemLineKey: string, partsCount: 2 | 3 | 4) => {
    setBills((prev) => {
      const fromBill = prev.find((b) => b.id === fromBillId);
      if (!fromBill || fromBill.isPaid) return prev;

      const itemIdx = fromBill.items.findIndex((i) => i.lineKey === itemLineKey);
      if (itemIdx === -1) return prev;
      const targetItem = fromBill.items[itemIdx];

      const totalItemVal = Number(targetItem.price || 0) * Number(targetItem.qty || 1);
      if (totalItemVal <= 0) return prev;

      // Clean base name if already fractionally split
      const baseName = targetItem.name.replace(/\s*\((نصف حصة|حصة)\s*[\d/]+\)/g, '').trim();

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

      // Calculate parts with penny-accurate rounding
      const unpaidBills = currentBills.filter((b) => !b.isPaid);
      const basePartVal = roundMoneyValue(totalItemVal / partsCount, bookDigits);
      let allocated = 0;
      const parts: number[] = [];

      for (let p = 0; p < partsCount; p++) {
        const isLast = p === partsCount - 1;
        const val = isLast ? roundMoneyValue(totalItemVal - allocated, bookDigits) : basePartVal;
        allocated += val;
        parts.push(val);
      }

      // Distribute: Part 0 stays in fromBill (replacing targetItem), others go to other unpaid bills
      const otherUnpaidBills = unpaidBills.filter((b) => b.id !== fromBillId);
      const updatedBills = currentBills.map((b) => {
        if (b.id === fromBillId) {
          const newItems = [...b.items];
          newItems[itemIdx] = {
            ...targetItem,
            qty: 1,
            price: parts[0],
            name: `${baseName} (حصة 1/${partsCount})`,
            lineKey: `${targetItem.productId}::frac1::${Date.now()}::${Math.random()}`,
          };
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
              items: [
                ...updatedBills[bIdx].items,
                {
                  ...targetItem,
                  qty: 1,
                  price: parts[p],
                  name: `${baseName} (حصة ${p + 1}/${partsCount})`,
                  lineKey: `${targetItem.productId}::frac${p + 1}::${Date.now()}::${Math.random()}`,
                },
              ],
            };
          }
        }
      }

      setStatusMessage(`تمت تجزئة «${baseName}» إلى ${partsCount} حصص متساوية وتوزيعها بنجاح.`);
      return updatedBills;
    });
  };

  // Compute total for each bill
  const getBillTotal = (items: PosItem[]) => {
    return items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.qty || 0)), 0);
  };

  // Pay individual split bill
  const handlePayBill = async (billId: string, paymentChannel: 'cash' | 'card') => {
    const targetBill = bills.find((b) => b.id === billId);
    if (!targetBill || !targetBill.items.length || targetBill.isPaid) return;

    setIsProcessingPayment(true);
    setStatusMessage('');

    try {
      const billSum = getBillTotal(targetBill.items);
      await pos.createSale.mutateAsync({
        source: 'pos',
        cart: targetBill.items,
        customerId: String(pos.customerId || ''),
        paymentType: 'cash',
        paymentChannel,
        discount: 0,
        deliveryFee: 0,
        taxRate: 0,
        pricesIncludeTax: false,
        paidAmount: billSum,
        tenderedAmount: billSum,
        payments: [{ paymentChannel, amount: billSum }],
        expectedTotal: billSum,
        orderType: pos.orderType,
        tableNumber: pos.tableNumber ? `${pos.tableNumber} (مجزأ)` : undefined,
        note: `فاتورة مجزأة من طاولة ${pos.tableNumber || ''} - ${targetBill.name}`,
      });

      // Mark this bill as paid
      const updatedBills = bills.map((b) => (b.id === billId ? { ...b, isPaid: true, paymentMethod: paymentChannel } : b));
      setBills(updatedBills);

      setStatusMessage(`تم تحصيل ${targetBill.name} بنجاح بقيمة ${formatCurrency(billSum)}.`);

      // Check if all bills are now paid
      const remainingUnpaid = updatedBills.filter((b) => !b.isPaid && b.items.length > 0);
      if (remainingUnpaid.length === 0) {
        // Everything settled! Clear active cart
        pos.setCart([]);
        pos.setTableNumber('');
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

  // Even split payment for single guest
  const handlePayGuest = async (guestId: number, method: 'cash' | 'card' | 'transfer') => {
    const guest = evenGuests.find((g) => g.id === guestId);
    if (!guest || guest.paid) return;

    setIsProcessingPayment(true);
    setStatusMessage('');

    try {
      // Record payment for this share
      setEvenGuests((prev) =>
        prev.map((g) => (g.id === guestId ? { ...g, paid: true, method } : g))
      );

      setStatusMessage(`تم سداد نصيب ${guest.name} بقيمة ${formatCurrency(guest.amount)} بنجاح.`);

      // If all guests paid, finalize full sale!
      const updated = evenGuests.map((g) => (g.id === guestId ? { ...g, paid: true, method } : g));
      const allPaid = updated.every((g) => g.paid);

      if (allPaid) {
        const cashTotal = updated.filter((g) => g.method === 'cash').reduce((s, g) => s + g.amount, 0);
        const cardTotal = updated.filter((g) => g.method === 'card').reduce((s, g) => s + g.amount, 0);
        const transferTotal = updated.filter((g) => g.method === 'transfer').reduce((s, g) => s + g.amount, 0);

        await pos.createSale.mutateAsync({
          source: 'pos',
          cart: pos.cart,
          customerId: String(pos.customerId || ''),
          paymentType: 'cash',
          paymentChannel: 'cash',
          discount: Number(pos.discount || 0),
          deliveryFee: 0,
          taxRate: 0,
          pricesIncludeTax: false,
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
        });

        pos.setCart([]);
        pos.setTableNumber('');
        if (onSplitCompleted) onSplitCompleted();
        setTimeout(() => onClose(), 1200);
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
      for (let i = 0; i < validBills.length; i++) {
        const b = validBills[i];
        pos.setCart(b.items);
        if (pos.tableNumber) {
          pos.setTableNumber(`${pos.tableNumber} - شيك ${i + 1}`);
        }
        await pos.holdDraft();
      }

      pos.setCart([]);
      pos.setTableNumber('');
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

  const totalSplitSum = bills.reduce((sum, b) => sum + getBillTotal(b.items), 0);

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
                  const billTotal = getBillTotal(bill.items);
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
                                    {formatCurrency(item.qty * item.price)}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ color: '#64748b', fontSize: '11px' }}>
                                    {item.qty} × {formatCurrency(item.price)}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s47', "تم تحصيل:")} <strong style={{ color: '#16a34a' }}>
                    {formatCurrency(evenGuests.filter((g) => g.paid).reduce((s, g) => s + g.amount, 0))}
                  </strong> {t('pos.pos_workspace.pos_split_bill_modal.s48', "من أصل")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalAmount)}</strong>
                </div>

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

