import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Button } from '@/shared/ui/button';
import {
  CheckIcon,
  AlertTriangleIcon,
  ReceiptIcon,
  FileTextIcon,
  PackageIcon,
  DollarSignIcon,
  ClockIcon,
  ShieldCheckIcon,
  LockIcon,
} from '@/shared/components/icons/AppIcons';
import { VanActiveTripResponse, VanStockItem } from '../api/van-sales.api';

interface VanSettleTabProps {
  tripData: VanActiveTripResponse['trip'];
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  sales?: {
    id: number;
    docNo: string;
    total: number;
    subtotal?: number;
    discount?: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
  }[];
  collections?: {
    id: number;
    amount: number;
    createdAt: string;
    customerName: string;
    note?: string;
    gpsLat?: number;
    gpsLng?: number;
  }[];
  returns?: {
    id: number;
    docNo: string;
    totalAmount: number;
    returnReason: string;
    refundMethod?: 'credit' | 'cash';
    status: string;
    createdAt: string;
    customerName?: string;
  }[];
  expenses?: {
    id: number;
    expenseType: string;
    amount: number;
    description?: string;
    createdAt: string;
  }[];
  packagingMovements?: {
    id: number;
    packagingType: string;
    qtyOut: number;
    qtyIn: number;
    customerName?: string;
    createdAt: string;
    notes?: string;
  }[];
  onOpenExpenseModal?: () => void;
  onOpenPackagingModal?: () => void;
  inventory?: VanStockItem[];
  countedCash: string;
  onCountedCashChange: (val: string) => void;
  unloadRemaining: boolean;
  onUnloadRemainingChange: (val: boolean) => void;
  // INV-VAN-SELF-SETTLE-PIN-REQUIRED: no charge/waive argument — the
  // rep's phone never sends that decision; a shortage stays pending
  // until a supervisor decides from the admin side. nightStockApproved
  // is the supervisor's explicit approval (authorized by the PIN) to
  // keep remaining stock in the van overnight instead of unloading it.
  onSubmitSettle: (
    supervisorPin?: string,
    countedStock?: { productId: number; countedQty: number }[],
    nightStockApproved?: boolean,
  ) => void;
  isSubmitting: boolean;
  requireSupervisorPin?: boolean;
  isBlindSettlement?: boolean;
}

export const VanSettleTab: React.FC<VanSettleTabProps> = ({
  tripData,
  activeVisit,
  sales = [],
  collections = [],
  returns = [],
  expenses = [],
  packagingMovements = [],
  onOpenExpenseModal,
  onOpenPackagingModal,
  inventory = [],
  countedCash,
  onCountedCashChange,
  unloadRemaining,
  onUnloadRemainingChange,
  onSubmitSettle,
  isSubmitting,
  requireSupervisorPin = false,
  isBlindSettlement = false,
}) => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<'settle' | 'activity'>('settle');
  const [activeSubTab, setActiveSubTab] = useState<'sales' | 'collections' | 'returns' | 'expenses' | 'packaging' | 'inventory'>('sales');
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showStockAudit, setShowStockAudit] = useState<boolean>(false);
  const [countedStockMap, setCountedStockMap] = useState<Record<number, string>>({});
  const [stockAuditSearch, setStockAuditSearch] = useState<string>('');
  // INV-VAN-SELF-SETTLE-PIN-REQUIRED: explicit supervisor approval to
  // keep remaining stock in the van overnight. Defaults off; the
  // supervisor authorizes it with the PIN at settle time. Merely not
  // unloading never approves it.
  const [nightStockApproved, setNightStockApproved] = useState<boolean>(false);

  const handleMatchAllStock = () => {
    const nextMap: Record<number, string> = {};
    for (const item of inventory) {
      nextMap[item.productId] = String(item.qty);
    }
    setCountedStockMap(nextMap);
  };

  const handleSetItemCount = (productId: number, val: string) => {
    setCountedStockMap((prev) => ({ ...prev, [productId]: val }));
  };

  const filteredAuditInventory = useMemo(() => {
    if (!stockAuditSearch.trim()) return inventory;
    const q = stockAuditSearch.trim().toLowerCase();
    return inventory.filter(
      (it) => it.productName.toLowerCase().includes(q) || (it.barcode && it.barcode.toLowerCase().includes(q)),
    );
  }, [inventory, stockAuditSearch]);

  const stockAuditSummary = useMemo(() => {
    let totalShortageQty = 0;
    let totalShortageCost = 0;
    let shortageCount = 0;
    let countedCount = 0;

    for (const it of inventory) {
      const inputVal = countedStockMap[it.productId];
      if (inputVal !== undefined && inputVal !== '') {
        countedCount++;
        const counted = Number(inputVal);
        const sys = Number(it.qty);
        if (counted < sys) {
          const diff = sys - counted;
          totalShortageQty += diff;
          totalShortageCost += diff * Number(it.costPrice || 0);
          shortageCount++;
        }
      }
    }

    return { totalShortageQty, totalShortageCost, shortageCount, countedCount };
  }, [inventory, countedStockMap]);

  const safeExpenses = useMemo(() => {
    if (!expenses) return [];
    if (Array.isArray(expenses)) return expenses;
    return (expenses as any).expenses || [];
  }, [expenses]);

  const safePackaging = useMemo(() => {
    if (!packagingMovements) return [];
    if (Array.isArray(packagingMovements)) return packagingMovements;
    return (packagingMovements as any).movements || [];
  }, [packagingMovements]);

  const salesAmount = Number(tripData?.salesAmount || 0);
  const creditSales = Number(tripData?.creditSales || 0);
  const cashSales = Math.max(0, salesAmount - creditSales);
  const collectionsTotal = collections.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const returnsAmount = Number(tripData?.returnsAmount || 0);
  const cashRefunds = Number(tripData?.cashRefunds || 0);
  const creditReturns = Math.max(0, returnsAmount - cashRefunds);
  const totalTripExpenses = (safeExpenses && safeExpenses.length > 0)
    ? safeExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
    : Number((tripData as any)?.tripExpenses || 0);
  const netExpectedCash = Math.max(0, (cashSales + collectionsTotal - cashRefunds) - totalTripExpenses);
  const cashCollected = Number((tripData as any)?.expectedCashToRemit ?? tripData?.cashCollected ?? netExpectedCash);
  const instapaySales = Number((tripData as any)?.totalInstapaySales ?? 0);
  const instapayCollections = Number((tripData as any)?.totalInstapayCollections ?? 0);
  const totalInstapay = instapaySales + instapayCollections;
  const countedNum = Number(countedCash);
  const totalActivities = sales.length + collections.length + returns.length + safeExpenses.length + safePackaging.length;
  const totalDiscounts = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0);

  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const getPaymentMethodBadge = (method: string) => {
    switch (method) {
      case 'cash':
        return { label: 'نقدي (كاش)', bg: '#dcfce7', color: '#15803d' };
      case 'credit':
        return { label: 'آجل (ذمم)', bg: '#fef3c7', color: '#b45309' };
      case 'split':
        return { label: 'مجزأ (كاش + آجل)', bg: '#e0e7ff', color: '#3730a3' };
      case 'card':
        return { label: 'بطاقة / بنكي', bg: '#f1f5f9', color: '#334155' };
      case 'instapay':
        return { label: 'إنستاباي (بنكي فوري)', bg: '#f5f3ff', color: '#7c3aed' };
      case 'vodafone_cash':
        return { label: 'محفظة إلكترونية (فودافون كاش)', bg: '#fff1f2', color: '#e11d48' };
      default:
        return { label: method, bg: '#f1f5f9', color: '#475569' };
    }
  };

  const getReturnStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return { label: 'معتمد ومضاف للسيارة', bg: '#dcfce7', color: '#15803d' };
      case 'pending':
        return { label: 'قيد مراجعة الإدارة', bg: '#fef3c7', color: '#b45309' };
      case 'rejected':
        return { label: 'مرفوض', bg: '#fee2e2', color: '#b91c1c' };
      default:
        return { label: status, bg: '#f1f5f9', color: '#475569' };
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
      }}
      dir="rtl"
    >
      {/* Top Segmented Sub-Tabs: Settle vs Activity */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#f1f5f9',
          padding: '4px',
          borderRadius: '10px',
          gap: '6px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSection('settle')}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            padding: '8px 6px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: activeSection === 'settle' ? '#ffffff' : 'transparent',
            color: activeSection === 'settle' ? '#170e5e' : '#64748b',
            fontWeight: 800,
            fontSize: '12.5px',
            boxShadow: activeSection === 'settle' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {t('delivery_reps.van_settle_tab.s0', "تصفية ومطابقة العهدة")}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('activity')}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            padding: '8px 6px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: activeSection === 'activity' ? '#ffffff' : 'transparent',
            color: activeSection === 'activity' ? '#170e5e' : '#64748b',
            fontWeight: 800,
            fontSize: '12.5px',
            boxShadow: activeSection === 'activity' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {t('delivery_reps.van_settle_tab.s1', "حركة وسجل اليوم (")}{totalActivities})
        </button>
      </div>

      {activeSection === 'settle' ? (
        /* SECTION 1: FINANCIAL SETTLEMENT LEDGER & COUNTING */
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* Card Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
            <div style={{ width: '34px', height: '34px', backgroundColor: '#eef2ff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ReceiptIcon size={18} color="#170e5e" strokeWidth={2} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                {t('delivery_reps.van_settle_tab.s2', "تصفية اليومية ومطابقة العهدة النقدية")}
              </h3>
              <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#64748b' }}>
                {t('delivery_reps.van_settle_tab.s3', "بيان تسليم النقدية ومطابقة مبيعات وتحصيلات ومرتجعات السيارة")}
              </p>
            </div>
          </div>

          {/* Active Visit Auto-Close Notice */}
          {activeVisit && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '11.5px',
                color: '#1e40af',
                fontWeight: 600,
              }}
            >
              <ClockIcon size={16} color="#2563eb" />
              <span>
                {t('delivery_reps.van_settle_tab.s4', "توجد زيارة جارية للعميل")} <strong>"{activeVisit.customerName}"</strong>{t('delivery_reps.van_settle_tab.s5', ". سيتم إنهاء وتوثيق الزيارة تلقائياً فور تأكيد تصفية اليومية.")}
              </span>
            </div>
          )}

        {/* Detailed Financial Ledger - Compact 2-Column Statement */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '10px 12px',
            border: '1px solid #e2e8f0',
            fontSize: '11.5px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* Header Row: Total Gross Sales */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '6px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <span style={{ color: '#475569', fontWeight: 700, fontSize: '12px' }}>
              {t('delivery_reps.van_settle_tab.s6', "إجمالي مبيعات اليوم المحققة:")}
            </span>
            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
              {salesAmount.toFixed(2)} <CurrencySymbol />
            </span>
          </div>

          {/* 2-Column Statement Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px' }}>
            {/* Right: Cash Sales */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                padding: '6px 8px',
                border: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <span style={{ color: '#15803d', fontWeight: 700, fontSize: 'clamp(10px, 2.7vw, 11px)', whiteSpace: 'nowrap' }}>
                {t('delivery_reps.van_settle_tab.s7', "• كاش:")}
              </span>
              <span style={{ fontWeight: 800, color: isBlindSettlement ? '#64748b' : '#15803d', fontSize: 'clamp(10.5px, 2.9vw, 12px)', whiteSpace: 'nowrap' }}>
                {isBlindSettlement ? t('delivery_reps.van_settle_tab.s8', "محجوب (عمياني)") : `+${cashSales.toFixed(2)}`} {!isBlindSettlement && <CurrencySymbol />}
              </span>
            </div>

            {/* Left: Credit Sales */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                padding: '6px 8px',
                border: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <span style={{ color: '#b45309', fontWeight: 700, fontSize: 'clamp(10px, 2.7vw, 11px)', whiteSpace: 'nowrap' }}>
                {t('delivery_reps.van_settle_tab.s9', "• آجل:")}
              </span>
              <span style={{ fontWeight: 800, color: '#b45309', fontSize: 'clamp(10.5px, 2.9vw, 12px)', whiteSpace: 'nowrap' }}>
                {creditSales.toFixed(2)} <CurrencySymbol />
              </span>
            </div>

            {/* Right: Collections */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                padding: '6px 8px',
                border: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <span style={{ color: '#0284c7', fontWeight: 700, fontSize: 'clamp(10px, 2.7vw, 11px)', whiteSpace: 'nowrap' }}>
                {t('delivery_reps.van_settle_tab.s10', "• تحصيلات:")}
              </span>
              <span style={{ fontWeight: 800, color: isBlindSettlement ? '#64748b' : '#0284c7', fontSize: 'clamp(10.5px, 2.9vw, 12px)', whiteSpace: 'nowrap' }}>
                {isBlindSettlement ? t('delivery_reps.van_settle_tab.s11', "محجوب (عمياني)") : `+${collectionsTotal.toFixed(2)}`} {!isBlindSettlement && <CurrencySymbol />}
              </span>
            </div>

            {/* Left: Field Returns */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                padding: '6px 8px',
                border: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <span style={{ color: '#64748b', fontWeight: 700, fontSize: 'clamp(10px, 2.7vw, 11px)', whiteSpace: 'nowrap' }}>
                {t('delivery_reps.van_settle_tab.s12', "• مرتجعات:")}
              </span>
              <span style={{ fontWeight: 800, color: returnsAmount > 0 ? '#dc2626' : '#64748b', fontSize: 'clamp(10.5px, 2.9vw, 12px)', whiteSpace: 'nowrap' }}>
                {returnsAmount > 0 ? `-${returnsAmount.toFixed(2)}` : '0.00'} <CurrencySymbol />
              </span>
            </div>

            {/* Full Width: InstaPay & Mobile Wallets Segregated Ledger */}
            {totalInstapay > 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  backgroundColor: '#f5f3ff',
                  borderRadius: '8px',
                  padding: '7px 10px',
                  border: '1px solid #ddd6fe',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#6d28d9', fontWeight: 700, fontSize: '11px' }}>
                    {t('delivery_reps.van_settle_tab.s13', "• تحويلات إنستاباي ومحافظ (معزولة عن كاش المندوب للبنك):")}
                  </span>
                </div>
                <span style={{ fontWeight: 800, color: '#7c3aed', fontSize: '11.5px' }}>
                  {totalInstapay.toFixed(2)} <CurrencySymbol />
                </span>
              </div>
            )}
          </div>

          {/* Conditional Sub-lines: Cash Refunds & Trip Expenses & Discounts */}
          {(cashRefunds > 0 || totalTripExpenses > 0 || totalDiscounts > 0 || creditReturns > 0) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px 14px',
                paddingTop: '4px',
                borderTop: '1px dashed #e2e8f0',
                fontSize: '10.5px',
              }}
            >
              {cashRefunds > 0 && (
                <div style={{ color: '#dc2626', fontWeight: 600 }}>
                  {t('delivery_reps.van_settle_tab.s14', "مرتجع كاش سُدد:")} <strong>{isBlindSettlement ? t('delivery_reps.van_settle_tab.s15', "محجوب رقابياً") : `-${cashRefunds.toFixed(2)}`}</strong> {!isBlindSettlement && <CurrencySymbol />}
                </div>
              )}
              {creditReturns > 0 && (
                <div style={{ color: '#64748b', fontWeight: 600 }}>
                  {t('delivery_reps.van_settle_tab.s16', "مرتجع آجل:")} <strong>{creditReturns.toFixed(2)}</strong> <CurrencySymbol />
                </div>
              )}
              {totalTripExpenses > 0 && (
                <div style={{ color: '#b91c1c', fontWeight: 600 }}>
                  {t('delivery_reps.van_settle_tab.s17', "مصروفات رحلة:")} <strong>-{totalTripExpenses.toFixed(2)}</strong> <CurrencySymbol />
                </div>
              )}
              {totalDiscounts > 0 && (
                <div style={{ color: '#64748b', fontWeight: 600 }}>
                  {t('delivery_reps.van_settle_tab.s18', "خصومات ممنوحة:")} <strong>{totalDiscounts.toFixed(2)}</strong> <CurrencySymbol />
                </div>
              )}
            </div>
          )}

          {/* Net Cash Required / Blind Settlement Notice */}
          {!isBlindSettlement ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#f0fdf4',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #bbf7d0',
              }}
            >
              <div>
                <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#166534', display: 'block' }}>
                  {t('delivery_reps.van_settle_tab.s19', "صافي النقدية المتوقع تسليمها (كاش الدرج):")}
                </span>
                <span style={{ fontSize: '10px', color: '#15803d' }}>
                  {t('delivery_reps.van_settle_tab.s20', "= كاش المبيعات (")}{cashSales.toFixed(0)}{t('delivery_reps.van_settle_tab.s21', ") + التحصيلات (")}{collectionsTotal.toFixed(0)}{t('delivery_reps.van_settle_tab.s22', ") - المنصرف (")}{(cashRefunds + totalTripExpenses).toFixed(0)})
                </span>
              </div>
              <span style={{ fontSize: '15px', fontWeight: 900, color: '#166534' }}>
                {cashCollected.toFixed(2)} <CurrencySymbol />
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: '#f8fafc',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#eef2ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LockIcon size={16} color="#170e5e" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#170e5e', display: 'block' }}>
                  {t('delivery_reps.van_settle_tab.s23', "نظام التوريد والجرد العمياني (Blind Cash Settlement)")}
                </span>
                <span style={{ fontSize: '10px', color: '#64748b', display: 'block', marginTop: '2px', lineHeight: 1.4 }}>
                  {t('delivery_reps.van_settle_tab.s24', "تم حجب صافي النقدية المتوقعة رقابياً. يرجى عدّ كامل النقدية الفعلية الموجودة بالدرج وتوريدها بدقة.")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Action Buttons: Expenses & Packaging (Strict Side-by-Side Flex 50%/50%) */}
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: '8px', width: '100%' }}>
          {onOpenExpenseModal && (
            <button
              type="button"
              onClick={onOpenExpenseModal}
              style={{
                flex: '1 1 0',
                width: '50%',
                minWidth: 0,
                height: '35px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#170e5e',
                fontSize: 'clamp(10.5px, 2.9vw, 12px)',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '0 6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                boxSizing: 'border-box',
              }}
            >
              <ReceiptIcon size={14} color="#170e5e" style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('delivery_reps.van_settle_tab.s25', "تسجيل مصروف")}</span>
            </button>
          )}
          {onOpenPackagingModal && (
            <button
              type="button"
              onClick={onOpenPackagingModal}
              style={{
                flex: '1 1 0',
                width: '50%',
                minWidth: 0,
                height: '35px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#047857',
                fontSize: 'clamp(10.5px, 2.9vw, 12px)',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '0 6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                boxSizing: 'border-box',
              }}
            >
              <PackageIcon size={14} color="#047857" style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('delivery_reps.van_settle_tab.s26', "حركة فوارغ")}</span>
            </button>
          )}
        </div>

        {/* Cash Counting Input - Strict Single Line Header */}
        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'nowrap',
              gap: '6px',
              marginBottom: '5px',
            }}
          >
            <label
              htmlFor="counted_physical_cash_input"
              style={{
                fontSize: 'clamp(11px, 3.2vw, 12.5px)',
                fontWeight: 700,
                color: '#1e293b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <span>{t('delivery_reps.van_settle_tab.s27', "الكاش الفعلي للتوريد")}</span>
              <span style={{ color: '#64748b', fontWeight: 600, fontSize: '0.9em' }}>
                ({getGlobalCurrencySymbol()}):
              </span>
            </label>
            {!isBlindSettlement ? (
              <button
                type="button"
                onClick={() => onCountedCashChange(String(cashCollected))}
                style={{
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: 'clamp(10px, 2.8vw, 11px)',
                  fontWeight: 700,
                  color: '#170e5e',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                {t('delivery_reps.van_settle_tab.s28', "مطابقة (")}{cashCollected.toFixed(2)})
              </button>
            ) : (
              <span
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '2px 7px',
                  fontSize: 'clamp(9.5px, 2.7vw, 10.5px)',
                  fontWeight: 700,
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <LockIcon size={11} color="#64748b" />
                <span>{t('delivery_reps.van_settle_tab.s29', "جرد إلزامي")}</span>
              </span>
            )}
          </div>
          <input
            id="counted_physical_cash_input"
            name="counted_physical_cash_amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            value={countedCash}
            onChange={(e) => onCountedCashChange(e.target.value)}
            placeholder={
              isBlindSettlement
                ? t('delivery_reps.van_settle_tab.s30', "قم بعدّ الأوراق النقدية وأدخل المبلغ الفعلي للتوريد...")
                : t('delivery_reps.van_settle_tab.s31', "أدخل المبلغ بعد العد الفعلي للأوراق النقدية...")
            }
            style={{
              width: '100%',
              height: '38px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              padding: '0 10px',
              fontSize: '14px',
              fontWeight: 800,
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {/* Reconciliation Match Indicator */}
          {countedCash !== '' && !isNaN(countedNum) && (
            <div
              style={{
                marginTop: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor:
                  countedNum === cashCollected
                    ? '#dcfce7'
                    : countedNum < cashCollected
                    ? '#fee2e2'
                    : '#e0f2fe',
                color:
                  countedNum === cashCollected
                    ? '#15803d'
                    : countedNum < cashCollected
                    ? '#b91c1c'
                    : '#0369a1',
                border: `1px solid ${
                  countedNum === cashCollected
                    ? '#86efac'
                    : countedNum < cashCollected
                    ? '#fca5a5'
                    : '#7dd3fc'
                }`,
              }}
            >
              {countedNum === cashCollected ? (
                <>
                  <CheckIcon size={14} color="#15803d" strokeWidth={2.5} />
                  <span>{t('delivery_reps.van_settle_tab.s32', "الكاش مطابق تماماً للعهدة النقدية بنسبة 100% (لا يوجد عجز).")}</span>
                </>
              ) : countedNum < cashCollected ? (
                <>
                  <AlertTriangleIcon size={14} color="#b91c1c" strokeWidth={2} />
                  <span>
                    {t('delivery_reps.van_settle_tab.s33', "يوجد عجز نقدي بقيمة")} {(cashCollected - countedNum).toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_settle_tab.s34', "(سيتم تقييده على عهدة المندوب).")}
                  </span>
                </>
              ) : (
                <>
                  <CheckIcon size={14} color="#0369a1" strokeWidth={2} />
                  <span>
                    {t('delivery_reps.van_settle_tab.s35', "يوجد فائض نقدي بقيمة")} {(countedNum - cashCollected).toFixed(2)} <CurrencySymbol /> {t('delivery_reps.van_settle_tab.s36', "(سيتم توريده لحساب المنشأة).")}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Interactive Physical Stock Audit Section */}
        {inventory && inventory.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <PackageIcon size={16} color="#170e5e" />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_settle_tab.s37', "جرد وتدقيق بضاعة السيارة المتبقية (")}{inventory.length} {t('delivery_reps.van_settle_tab.s38', "صنف)")}
                </span>
                {stockAuditSummary.shortageCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#fee2e2',
                      color: '#b91c1c',
                      fontSize: '10.5px',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      border: '1px solid #fca5a5',
                    }}
                  >
                    {t('delivery_reps.van_settle_tab.s39', "عجز")} {stockAuditSummary.shortageCount} {t('delivery_reps.van_settle_tab.s40', "صنف (-")}{stockAuditSummary.totalShortageCost.toFixed(2)} {t('delivery_reps.van_settle_tab.s41', "ج.م)")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowStockAudit(!showStockAudit)}
                style={{
                  background: 'none',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#170e5e',
                  cursor: 'pointer',
                }}
              >
                {showStockAudit ? t('delivery_reps.van_settle_tab.s42', "إخفاء الجرد") : t('delivery_reps.van_settle_tab.s43', "بدء الجرد الفعلي")}
              </button>
            </div>

            {showStockAudit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={stockAuditSearch}
                    onChange={(e) => setStockAuditSearch(e.target.value)}
                    placeholder={t('delivery_reps.van_settle_tab.s44', "بحث باسم الصنف أو الباركود...")}
                    style={{
                      flex: 1,
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      padding: '0 8px',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleMatchAllStock}
                    style={{
                      height: '32px',
                      padding: '0 8px',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: '#170e5e',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('delivery_reps.van_settle_tab.s45', "مطابقة الكل دفترياً")}
                  </button>
                </div>

                {/* Items Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }} className="thin-scrollbar">
                  {filteredAuditInventory.map((item) => {
                    const enteredStr = countedStockMap[item.productId];
                    const hasEntered = enteredStr !== undefined && enteredStr !== '';
                    const countedNum = hasEntered ? Number(enteredStr) : Number(item.qty);
                    const sysQty = Number(item.qty);
                    const isShort = hasEntered && countedNum < sysQty;
                    const isOver = hasEntered && countedNum > sysQty;
                    const isExact = hasEntered && countedNum === sysQty;

                    return (
                      <div
                        key={item.productId}
                        style={{
                          backgroundColor: isShort ? '#fff5f5' : isOver ? '#f0f9ff' : '#f8fafc',
                          border: `1px solid ${isShort ? '#fecaca' : isOver ? '#bae6fd' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          padding: '6px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.productName}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span>{t('delivery_reps.van_settle_tab.s46', "دفتري بالسيارة:")} <b>{sysQty}</b></span>
                            {item.barcode && <span>• {item.barcode}</span>}
                          </div>
                        </div>

                        {/* Stepper with strict RTL Standard: [+] on right, [-] on left */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              const cur = hasEntered ? Number(enteredStr) : sysQty;
                              handleSetItemCount(item.productId, String(cur + 1));
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              fontWeight: 900,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            +
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={enteredStr !== undefined ? enteredStr : ''}
                            placeholder={String(sysQty)}
                            onChange={(e) => handleSetItemCount(item.productId, e.target.value)}
                            style={{
                              width: '46px',
                              height: '26px',
                              borderRadius: '4px',
                              border: `1px solid ${isShort ? '#ef4444' : '#cbd5e1'}`,
                              textAlign: 'center',
                              fontSize: '12px',
                              fontWeight: 800,
                              boxSizing: 'border-box',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const cur = hasEntered ? Number(enteredStr) : sysQty;
                              handleSetItemCount(item.productId, String(Math.max(0, cur - 1)));
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              fontWeight: 900,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            -
                          </button>
                        </div>

                        {/* Status Badge */}
                        <div style={{ width: '60px', textAlign: 'center', flexShrink: 0 }}>
                          {isShort ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#b91c1c', backgroundColor: '#fee2e2', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              {t('delivery_reps.van_settle_tab.s47', "عجز")} {sysQty - countedNum}
                            </span>
                          ) : isOver ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#0369a1', backgroundColor: '#e0f2fe', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              +{countedNum - sysQty}
                            </span>
                          ) : isExact ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#15803d', backgroundColor: '#dcfce7', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              {t('delivery_reps.van_settle_tab.s48', "مطابق")}
                            </span>
                          ) : (
                            <span style={{ fontSize: '9.5px', color: '#94a3b8' }}>{t('delivery_reps.van_settle_tab.s49', "دفتري")}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep-side
                charge/waive checkbox is removed — the rep never decides
                whether his own stock shortage is charged to him or
                waived. A shortage now stays pending on the rep until a
                supervisor settles or waives it from the admin side. */}
              </div>
            )}
          </div>
        )}

        {/* Unload Remaining Inventory Checkbox */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
          }}
        >
          <input
            type="checkbox"
            id="unloadCheck"
            checked={unloadRemaining}
            onChange={(e) => onUnloadRemainingChange(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#170e5e' }}
          />
          <label htmlFor="unloadCheck" style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
            {t('delivery_reps.van_settle_tab.s52', "تفريغ البضاعة المتبقية في السيارة (")}{inventory.length} {t('delivery_reps.van_settle_tab.s53', "صنف) وإعادتها للمستودع تلقائياً")}
          </label>
        </div>

        {/* INV-VAN-SELF-SETTLE-PIN-REQUIRED: explicit supervisor approval
        to keep remaining stock in the van overnight. Shown only when
        stock would stay in the van (not unloading). Defaults off — the
        supervisor ticks it and authorizes it with the PIN; without it
        the settlement is refused (NIGHT_STOCK_UNAPPROVED). */}
        {!unloadRemaining && inventory.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              backgroundColor: '#fffbeb',
              borderRadius: '8px',
              border: '1px solid #fde68a',
            }}
          >
            <input
              type="checkbox"
              id="nightStockCheck"
              checked={nightStockApproved}
              onChange={(e) => setNightStockApproved(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#170e5e' }}
            />
            <label htmlFor="nightStockCheck" style={{ fontSize: '11.5px', fontWeight: 700, color: '#92400e', cursor: 'pointer' }}>
              {t('delivery_reps.van_settle_tab.s59', "إبقاء البضاعة المتبقية في السيارة لليوم التالي بموافقة صريحة من المشرف (يُعتمد برمز PIN المشرف)")}
            </label>
          </div>
        )}

        {/* Maker-Checker Supervisor PIN Authorization for Final Settlement */}
        {requireSupervisorPin && (
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#eef2ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShieldCheckIcon size={16} color="#170e5e" strokeWidth={2} />
              </div>
              <div>
                <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#170e5e' }}>
                  {t('delivery_reps.van_settle_tab.s54', "رمز اعتماد المشرف أو أمين الخزينة (Supervisor PIN):")}
                </div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>
                  {t('delivery_reps.van_settle_tab.s55', "إلزامي لإبراء العهدة واستلام الكاش طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)")}
                </div>
              </div>
            </div>
            <input
              id="supervisor_pin_input"
              name="supervisor_authorization_pin"
              type="password"
              autoComplete="new-password"
              data-lpignore="true"
              data-form-type="other"
              maxLength={6}
              value={supervisorPin}
              onChange={(e) => {
                setSupervisorPin(e.target.value);
                if (pinError) setPinError('');
              }}
              placeholder={t('delivery_reps.van_settle_tab.s56', "PIN المشرف")}
              style={{
                width: '120px',
                height: '36px',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                fontSize: '14px',
                fontWeight: 800,
                textAlign: 'center',
                letterSpacing: '2px',
                backgroundColor: '#ffffff',
                color: '#0f172a',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
        )}

        {pinError && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
            }}
          >
            {pinError}
          </div>
        )}

        {/* Submit Settle Action */}
        <Button
          variant="primary"
          onClick={() => {
            if (requireSupervisorPin && !supervisorPin.trim()) {
              setPinError(t('delivery_reps.van_settle_tab.s57', "يرجى إدخال الرمز السري للمشرف أو أمين الخزينة (PIN) لاعتماد تصفية اليومية واستلام الكاش"));
              return;
            }
            setPinError('');

            const countedStockArray = Object.keys(countedStockMap).length > 0
              ? inventory.map((inv) => ({
                  productId: inv.productId,
                  countedQty: countedStockMap[inv.productId] !== undefined && countedStockMap[inv.productId] !== ''
                    ? Number(countedStockMap[inv.productId])
                    : Number(inv.qty),
                }))
              : undefined;

            onSubmitSettle(supervisorPin.trim() || undefined, countedStockArray, !unloadRemaining && nightStockApproved);
          }}
          disabled={isSubmitting}
          style={{
            backgroundColor: '#170e5e',
            color: '#ffffff',
            height: '42px',
            fontSize: '13px',
            fontWeight: 800,
            borderRadius: '8px',
          }}
        >
          {isSubmitting
            ? t('delivery_reps.van_settle_tab.s58', "جاري التصفية والتوريد...")
            : requireSupervisorPin
            ? t('delivery_reps.van_settle_tab.s59', "تأكيد التصفية واعتماد الـ PIN وتوريد الكاش")
            : t('delivery_reps.van_settle_tab.s60', "تأكيد التصفية وإغلاق اليومية وتوريد الكاش")}
        </Button>
      </div>
      ) : (
      /* SECTION 2: TRIP ACTIVITY & MOVEMENT EXPLORER */
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
          <div style={{ width: '34px', height: '34px', backgroundColor: '#f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileTextIcon size={18} color="#170e5e" strokeWidth={2} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_settle_tab.s61', "حركة رحلة اليوم وسجل العمليات")}
            </h3>
            <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#64748b' }}>
              {t('delivery_reps.van_settle_tab.s62', "مراجعة الفواتير والتحصيلات والمرتجعات ومخزون السيارة")}
            </p>
          </div>
        </div>

        {/* Subtab Navigation Bar (2 balanced rows of 3 tabs on mobile, 6 on desktop, 100% visible) */}
        <style>{`
          .van-settle-subtabs {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 6px !important;
          }
          @media (min-width: 640px) {
            .van-settle-subtabs {
              grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
            }
          }
        `}</style>
        <div
          className="van-settle-subtabs keep-grid-row"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            padding: '5px',
            borderRadius: '12px',
            gap: '6px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {[
            { key: 'sales', label: t('delivery_reps.van_settle_tab.s63', "فواتير"), count: sales.length },
            { key: 'collections', label: t('delivery_reps.van_settle_tab.s64', "تحصيلات"), count: collections.length },
            { key: 'returns', label: t('delivery_reps.van_settle_tab.s65', "مرتجعات"), count: returns.length },
            { key: 'expenses', label: t('delivery_reps.van_settle_tab.s66', "مصروفات"), count: safeExpenses.length },
            { key: 'packaging', label: t('delivery_reps.van_settle_tab.s67', "فوارغ"), count: safePackaging.length },
            { key: 'inventory', label: t('delivery_reps.van_settle_tab.s68', "المخزون"), count: inventory.length },
          ].map((tab) => {
            const isActive = activeSubTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSubTab(tab.key as typeof activeSubTab)}
                style={{
                  padding: '7px 4px',
                  borderRadius: '8px',
                  border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  cursor: 'pointer',
                  backgroundColor: isActive ? '#170e5e' : '#ffffff',
                  color: isActive ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  minWidth: 0,
                  boxShadow: isActive ? '0 1px 3px rgba(23, 14, 94, 0.2)' : '0 1px 2px rgba(0, 0, 0, 0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.25)' : '#f1f5f9',
                    color: isActive ? '#ffffff' : '#64748b',
                    borderRadius: '10px',
                    padding: '1px 5px',
                    fontSize: '10px',
                    fontWeight: 700,
                    lineHeight: '13px',
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Subtab Contents Container (Bounded with Slim Scroll) */}
        <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
          {/* 1. SALES INVOICES */}
          {activeSubTab === 'sales' && (
            sales.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <ReceiptIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s69', "لم تصدر أي فواتير بيع في هذه الرحلة حتى الآن")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sales.map((sale) => {
                  const badge = getPaymentMethodBadge(sale.paymentMethod);
                  return (
                    <div
                      key={sale.id}
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.van_settle_tab.s70', "فاتورة #")}{sale.docNo}
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                          {Number(sale.total || 0).toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11.5px' }}>
                        <span style={{ color: '#334155', fontWeight: 700 }}>
                          {t('delivery_reps.van_settle_tab.s71', "العميل:")} {sale.customerName || t('delivery_reps.van_settle_tab.s72', "عميل نقدي سريع")}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              backgroundColor: badge.bg,
                              color: badge.color,
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '10.5px',
                            }}
                          >
                            {badge.label}
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <ClockIcon size={12} color="#94a3b8" />
                            {formatTime(sale.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* 2. CASH COLLECTIONS */}
          {activeSubTab === 'collections' && (
            collections.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <DollarSignIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s73', "لا توجد سندات قبض أو تحصيلات نقدية مسجلة")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {collections.map((col) => (
                  <div
                    key={col.id}
                    style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                        {col.customerName}
                      </span>
                      <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0284c7' }}>
                        +{Number(col.amount).toFixed(2)} <CurrencySymbol />
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                      <span>{t('delivery_reps.van_settle_tab.s74', "سند قبض نقدي من مديونية عميل")}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <ClockIcon size={12} color="#94a3b8" />
                        {formatTime(col.createdAt)}
                      </span>
                    </div>
                    {col.note && (
                      <div style={{ fontSize: '10.5px', color: '#475569', backgroundColor: '#ffffff', padding: '4px 8px', borderRadius: '4px', border: '1px dashed #cbd5e1' }}>
                        {t('delivery_reps.van_settle_tab.s75', "ملاحظة:")} {col.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* 3. FIELD RETURNS */}
          {activeSubTab === 'returns' && (
            returns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s76', "لا توجد أذونات مرتجعات بضاعة مسجلة اليوم")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {returns.map((ret) => {
                  const statusBadge = getReturnStatusBadge(ret.status);
                  const isCashRefund = ret.refundMethod === 'cash';
                  return (
                    <div
                      key={ret.id}
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.van_settle_tab.s77', "إذن مرتجع #")}{ret.docNo}
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#dc2626' }}>
                          {Number(ret.totalAmount).toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11.5px' }}>
                        <span style={{ color: '#334155', fontWeight: 700 }}>
                          {t('delivery_reps.van_settle_tab.s78', "العميل:")} {ret.customerName || t('delivery_reps.van_settle_tab.s79', "عميل مباشر")}
                        </span>
                        <span
                          style={{
                            backgroundColor: isCashRefund ? '#fee2e2' : '#fef3c7',
                            color: isCashRefund ? '#b91c1c' : '#b45309',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '10.5px',
                          }}
                        >
                          {isCashRefund ? t('delivery_reps.van_settle_tab.s80', "دفع نقدي كاش من السيارة") : t('delivery_reps.van_settle_tab.s81', "خصم من رصيد العميل (آجل)")}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                        <span>{t('delivery_reps.van_settle_tab.s82', "السبب:")} {ret.returnReason || t('delivery_reps.van_settle_tab.s83', "بضاعة راكدة / استبدال")}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              backgroundColor: statusBadge.bg,
                              color: statusBadge.color,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              fontSize: '10px',
                            }}
                          >
                            {statusBadge.label}
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                            {formatTime(ret.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* 4. TRIP OPERATIONAL EXPENSES */}
          {activeSubTab === 'expenses' && (
            safeExpenses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <ReceiptIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s84', "لا توجد مصروفات مسجلة لهذه الرحلة")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {safeExpenses.map((exp: any) => (
                  <div
                    key={exp.id}
                    style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                          {exp.expenseType === 'fuel' ? t('delivery_reps.van_settle_tab.s85', "وقود وبنزين") :
                           exp.expenseType === 'toll' ? t('delivery_reps.van_settle_tab.s86', "كارتات وبوابات") :
                           exp.expenseType === 'maintenance' ? t('delivery_reps.van_settle_tab.s87', "صيانة طارئة") :
                           exp.expenseType === 'food_allowance' ? t('delivery_reps.van_settle_tab.s88', "بدل وجبة") : t('delivery_reps.van_settle_tab.s89', "مصروف نثري")}
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <ClockIcon size={12} color="#94a3b8" />
                          {formatTime(exp.createdAt)}
                        </span>
                      </div>
                      {(exp.notes || exp.description) && (
                        <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                          {exp.notes || exp.description}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: 900, color: '#b91c1c' }}>
                      -{Number(exp.amount).toFixed(2)} <CurrencySymbol />
                    </span>
                  </div>
                ))}
              </div>
            )
          )}

          {/* 5. RETURNABLE PACKAGING & EMPTIES MOVEMENTS */}
          {activeSubTab === 'packaging' && (
            safePackaging.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s90', "لا توجد حركات فوارغ أو صناديق مسجلة في هذه الرحلة")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {safePackaging.map((pkg: any) => {
                  const pType = pkg.packageType || pkg.packagingType;
                  const delivered = pkg.deliveredQty ?? pkg.qtyOut ?? 0;
                  const returned = pkg.returnedQty ?? pkg.qtyIn ?? 0;
                  return (
                    <div
                      key={pkg.id}
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                            {pType === 'crate_plastic' || pType === 'plastic_crate' ? t('delivery_reps.van_settle_tab.s91', "صناديق بلاستيك") :
                             pType === 'wooden_pallet' || pType === 'pallet' || pType === 'box_wooden' ? t('delivery_reps.van_settle_tab.s92', "طبالي خشبية (بالتات)") :
                             pType === 'cylinder_gas' || pType === 'gas_cylinder' ? t('delivery_reps.van_settle_tab.s93', "أسطوانات غاز") : t('delivery_reps.van_settle_tab.s94', "فوارغ أخرى")}
                          </span>
                          {pkg.customerName && (
                            <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                              ({pkg.customerName})
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                          <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <ClockIcon size={12} color="#94a3b8" />
                            {formatTime(pkg.createdAt)}
                          </span>
                          {pkg.notes && (
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              • {pkg.notes}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800 }}>
                        {delivered > 0 && (
                          <span style={{ color: '#c2410c', backgroundColor: '#fff7ed', padding: '2px 6px', borderRadius: '4px' }}>
                            {t('delivery_reps.van_settle_tab.s95', "صادر:")} {delivered}
                          </span>
                        )}
                        {returned > 0 && (
                          <span style={{ color: '#15803d', backgroundColor: '#f0fdf4', padding: '2px 6px', borderRadius: '4px' }}>
                            {t('delivery_reps.van_settle_tab.s96', "وارد:")} {returned}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* 6. REMAINING VAN INVENTORY */}
          {activeSubTab === 'inventory' && (
            inventory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s97', "السيارة فارغة حالياً (تم بيع أو تفريغ كافة البضاعة)")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {inventory.map((item) => {
                  const lineTotal = Number(item.qty || 0) * Number(item.retailPrice || 0);
                  return (
                    <div
                      key={item.productId}
                      style={{
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', display: 'block' }}>
                          {item.productName}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {t('delivery_reps.van_settle_tab.s98', "كود:")} {item.barcode || '—'} {item.unitName && `• ${item.unitName}`}
                        </span>
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: 900,
                            color: '#170e5e',
                            backgroundColor: '#eef2ff',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            display: 'inline-block',
                          }}
                        >
                          {item.qty} {item.unitName || t('delivery_reps.van_settle_tab.s99', "قطعة")}
                        </span>
                        <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                          {t('delivery_reps.van_settle_tab.s100', "بقيمة")} {lineTotal.toFixed(2)} <CurrencySymbol />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
      )}
    </div>
  );
};
