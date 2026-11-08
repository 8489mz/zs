import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import {
  RefreshCwIcon,
  ScaleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PrinterIcon,
  CreditCardIcon,
  BuildingIcon,
  TruckIcon,
  UsersIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  LayersIcon,
} from '@/shared/components/icons/AppIcons';
import { printCashDrawerShiftReceipt } from '@/features/cash-drawer/utils/cash-drawer-receipt';
import { formatCurrency, formatDate } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import type { CashierShift } from '@/types/domain';
import {
  type ComparisonRow,
  differenceLabel,
  formatCount,
  formatMoney,
  formatSignedCount,
  formatTimeOnly,
  toCount,
  toDisplayCount,
  toMoney,
} from '@/features/cash-drawer/components/cashDrawerReview.helpers';

interface CashDrawerReviewDialogProps {
  open: boolean;
  shift: CashierShift | null;
  managerNote: string;
  onManagerNoteChange: (value: string) => void;
  onApprove: () => void;
  onClose: () => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

interface MovementGroup {
  kind: string;
  label: string;
  total: number;
  isCredit: boolean; // true = +, false = -
  items: Array<{
    id: string;
    amount: number;
    note: string;
    createdAt: string;
  }>;
}

export function CashDrawerReviewDialog(props: CashDrawerReviewDialogProps) {
  const { t } = useTranslation();
  // INV-FE1-FRONTEND-BOOK-DIGITS: all drawer review money rounds at
  // the tenant's book digits (global system currency).
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const shift = props.shift;
  const [expandedKinds, setExpandedKinds] = useState<Record<string, boolean>>({});
  const [showMovements, setShowMovements] = useState(false);
  const [compactView, setCompactView] = useState(false);

  const toggleGroup = (kind: string) => {
    setExpandedKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };

  const expected = useMemo(() => {
    const rawCashSales = toMoney((shift?.cashSalesTotal || 0) + (shift?.serviceCashTotal || 0), bookDigits);
    const expectedCard = toMoney((shift?.cardSalesTotal || 0) + (shift?.serviceCardTotal || 0) - (shift?.saleReturnCardRefundTotal || 0), bookDigits);
    const expectedWallet = toMoney(shift?.walletSalesTotal || 0, bookDigits);
    const expectedInstapay = toMoney(shift?.instapaySalesTotal || 0, bookDigits);
    const expectedCredit = toMoney(shift?.creditSalesTotal || 0, bookDigits);
    const expectedDelivery = toMoney(shift?.deliverySalesTotal || 0, bookDigits);
    return { rawCashSales, expectedCard, expectedWallet, expectedInstapay, expectedCredit, expectedDelivery };
  }, [shift]);

  const declared = useMemo(() => ({
    cash: toMoney(shift?.declaredCash ?? shift?.countedCash ?? 0, bookDigits),
    card: toMoney(shift?.declaredCardTotal || 0, bookDigits),
    wallet: toMoney(shift?.declaredWalletTotal || 0, bookDigits),
    instapay: toMoney(shift?.declaredInstapayTotal || 0, bookDigits),
  }), [shift]);

  const statusLabel = shift?.status === 'pending_review' ? 'في انتظار مراجعة المشرف' : (shift?.status || '—');

  const totalDeductions = shift ? (
    Number(shift.cashDrawerCashOutTotal || 0) +
    Number(shift.expensesTotal || 0) +
    Number(shift.supplierPaymentsTotal || 0) +
    Number(shift.saleReturnCashRefundTotal || 0)
  ) : 0;

  const deliveryCashIn = shift ? Number(shift.cashDrawerDeliveryCashInTotal || 0) : 0;
  const manualCashIn = shift ? Number(shift.cashDrawerManualCashInTotal || 0) : 0;

  const dynamicExpectedCash = shift ? (
    Number(shift.openingCash || 0) +
    Number(shift.cashSalesTotal || 0) +
    Number(shift.serviceCashTotal || 0) +
    manualCashIn +
    deliveryCashIn -
    totalDeductions
  ) : 0;

  const dynamicVariance = shift ? (
    (shift.declaredCash ?? shift.countedCash) != null ? Number(shift.declaredCash ?? shift.countedCash) - dynamicExpectedCash : Number(shift.variance || 0)
  ) : 0;

  const electronicDiff = toMoney(
    (declared.card - expected.expectedCard) +
    (declared.wallet - expected.expectedWallet) +
    (declared.instapay - expected.expectedInstapay)
  , bookDigits);

  const totalShiftDiscrepancy = toMoney(dynamicVariance + electronicDiff, bookDigits);

  const isKwd = getGlobalSystemCurrency() === 'KWD';

  const comparison = useMemo(() => {
    const rows: ComparisonRow[] = [
      {
        key: 'card',
        label: isKwd ? 'مبيعات بطاقات (كي نت K-NET / فيزا)' : 'مبيعات بطاقات (فيزا / ماستركارد)',
        systemAmount: expected.expectedCard,
        declaredAmount: declared.card,
        amountDiff: toMoney(declared.card - expected.expectedCard, bookDigits),
        systemCount: toCount(shift?.cardOperationCount || 0),
        declaredCount: toCount(shift?.declaredCardCount || 0),
        countDiff: toCount(shift?.declaredCardCount || 0) - toCount(shift?.cardOperationCount || 0)
      },
      {
        key: 'wallet',
        label: isKwd ? 'محافظ وروابط رقمية (Apple Pay / روابط)' : 'محافظ إلكترونية (فودافون/اتصالات/أورنج/وي)',
        systemAmount: expected.expectedWallet,
        declaredAmount: declared.wallet,
        amountDiff: toMoney(declared.wallet - expected.expectedWallet, bookDigits),
        systemCount: toCount(shift?.walletOperationCount || 0),
        declaredCount: toCount(shift?.declaredWalletCount || 0),
        countDiff: toCount(shift?.declaredWalletCount || 0) - toCount(shift?.walletOperationCount || 0)
      },
      {
        key: 'instapay',
        label: isKwd ? 'عمليات كي نت / روابط دفع (K-NET)' : 'تحويلات إنستاباي (InstaPay)',
        systemAmount: expected.expectedInstapay,
        declaredAmount: declared.instapay,
        amountDiff: toMoney(declared.instapay - expected.expectedInstapay, bookDigits),
        systemCount: toCount(shift?.instapayOperationCount || 0),
        declaredCount: toCount(shift?.declaredInstapayCount || 0),
        countDiff: toCount(shift?.declaredInstapayCount || 0) - toCount(shift?.instapayOperationCount || 0)
      },
    ];

    if (expected.expectedCredit > 0) {
      rows.push({
        key: 'credit',
        label: 'مبيعات آجلة (ذمم عملاء)',
        systemAmount: expected.expectedCredit,
        declaredAmount: 0,
        amountDiff: 0,
        systemCount: null,
        declaredCount: null,
        countDiff: null
      });
    }

    if (expected.expectedDelivery > 0) {
      rows.push({
        key: 'delivery',
        label: 'مبيعات دليفري (تحصيل مناديب)',
        systemAmount: expected.expectedDelivery,
        declaredAmount: 0,
        amountDiff: 0,
        systemCount: null,
        declaredCount: null,
        countDiff: null
      });
    }

    const electronicRows = rows.filter(r => r.key !== 'credit' && r.key !== 'delivery');
    const systemAmountTotal = electronicRows.reduce((sum, row) => sum + toMoney(row.systemAmount, bookDigits), 0);
    const declaredAmountTotal = electronicRows.reduce((sum, row) => sum + toMoney(row.declaredAmount, bookDigits), 0);
    const amountDiffTotal = electronicDiff;
    const systemOpsTotal = rows.reduce((sum, row) => sum + (row.systemCount == null ? 0 : row.systemCount), 0);
    const declaredOpsTotal = rows.reduce((sum, row) => sum + (row.declaredCount == null ? 0 : row.declaredCount), 0);
    const opsDiffTotal = declaredOpsTotal - systemOpsTotal;
    const allInvoicesSystemTotal = toMoney(expected.rawCashSales + rows.reduce((sum, row) => sum + toMoney(row.systemAmount), 0), bookDigits);

    return {
      rows,
      systemAmountTotal,
      declaredAmountTotal,
      amountDiffTotal,
      systemOpsTotal,
      declaredOpsTotal,
      opsDiffTotal,
      allInvoicesSystemTotal
    };
  }, [
    declared.card,
    declared.instapay,
    declared.wallet,
    electronicDiff,
    expected.expectedCard,
    expected.expectedCredit,
    expected.expectedDelivery,
    expected.expectedInstapay,
    expected.expectedWallet,
    expected.rawCashSales,
    shift?.cardOperationCount,
    shift?.declaredCardCount,
    shift?.declaredInstapayCount,
    shift?.declaredWalletCount,
    shift?.instapayOperationCount,
    shift?.walletOperationCount
  ]);

  const reviewMatched = Math.abs(totalShiftDiscrepancy) <= 0.009 && comparison.opsDiffTotal === 0;

  // Grouped drawer movements
  const movementGroups = useMemo(() => {
    const rawItems = shift?.movementItems || [];
    const groupsMap: Record<string, MovementGroup> = {
      cash_in: { kind: 'cash_in', label: 'إيداع نقدي بالدرج (يدوياً)', total: Number(shift?.cashDrawerManualCashInTotal || 0), isCredit: true, items: [] },
      delivery: { kind: 'delivery', label: 'تحصيلات وتسويات مناديب دليفري', total: Number(shift?.cashDrawerDeliveryCashInTotal || 0), isCredit: true, items: [] },
      cash_out: { kind: 'cash_out', label: 'مسحوبات نقدية من الدرج', total: Number(shift?.cashDrawerCashOutTotal || 0), isCredit: false, items: [] },
      expense: { kind: 'expense', label: 'مصروفات تشغيلية ونثرية', total: Number(shift?.expensesTotal || 0), isCredit: false, items: [] },
      supplier_payment: { kind: 'supplier_payment', label: 'سداد دفعات موردين', total: Number(shift?.supplierPaymentsTotal || 0), isCredit: false, items: [] },
      sale_return: { kind: 'sale_return', label: 'مرتجع مبيعات نقدي', total: Number(shift?.saleReturnCashRefundTotal || 0), isCredit: false, items: [] },
    };

    for (const item of rawItems) {
      if (groupsMap[item.kind]) {
        groupsMap[item.kind].items.push(item);
      } else if (item.kind === 'return') {
        groupsMap.sale_return.items.push(item);
      } else {
        groupsMap.cash_in.items.push(item);
      }
    }

    return Object.values(groupsMap).filter((g) => g.total > 0 || g.items.length > 0);
  }, [shift]);

  const cleanCloseNote = shift?.closeNote && !shift.closeNote.startsWith('BLIND_CLOSE:')
    ? shift.closeNote
    : (!shift?.closeNoteRaw?.startsWith('BLIND_CLOSE:') && shift?.closeNoteRaw ? shift.closeNoteRaw : '');

  return (
    <DialogShell open={props.open} onClose={props.onClose} width="min(1140px, 96vw)" ariaLabel={t('cash_drawer.cash_drawer_review_dialog.s0', "مراجعة واعتماد إغلاق الوردية")}>
      <div style={{
        background: '#ffffff',
        borderRadius: '12px',
        padding: compactView ? '10px 14px' : '16px 20px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: compactView ? '8px' : '14px'
      }}>
        {shift ? (
          <>
            {/* 1. Header Bar with Mode Toggle Switch */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px 14px',
              borderBottom: '1px solid #f1f5f9',
              paddingBottom: compactView ? '6px' : '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ width: '4px', height: compactView ? '16px' : '22px', background: '#0284c7', borderRadius: '2px', flexShrink: 0 }} />
                <h3 style={{ margin: 0, fontSize: compactView ? '1.02rem' : '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  {t('cash_drawer.cash_drawer_review_dialog.s1', "مراجعة واعتماد إغلاق الوردية")}
                </h3>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px' }}>
                  {t('cash_drawer.cash_drawer_review_dialog.s2', "كاشير:")} <strong style={{ color: '#0f172a' }}>{shift.openedByName || '—'}</strong> {t('cash_drawer.cash_drawer_review_dialog.s3', "| وردية:")} <strong style={{ color: '#0284c7' }}>#{shift.id || shift.docNo}</strong>
                </span>

                <button
                  type="button"
                  onClick={() => setCompactView(!compactView)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: compactView ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${compactView ? '#86efac' : '#cbd5e1'}`,
                    borderRadius: '6px',
                    padding: compactView ? '3px 8px' : '5px 12px',
                    fontSize: compactView ? '0.75rem' : '0.8rem',
                    fontWeight: 700,
                    color: compactView ? '#16a34a' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                  }}
                  title={compactView ? t('cash_drawer.cash_drawer_review_dialog.s4', "التبديل إلى الوضع المريح الطبيعي") : t('cash_drawer.cash_drawer_review_dialog.s5', "التبديل إلى الوضع المضغوط للشاشات الصغيرة")}
                >
                  <LayersIcon size={14} color={compactView ? '#16a34a' : '#64748b'} />
                  <span>{compactView ? t('cash_drawer.cash_drawer_review_dialog.s6', "الوضع المريح") : t('cash_drawer.cash_drawer_review_dialog.s7', "الوضع المضغوط")}</span>
                </button>

                <span className={shift.status === 'pending_review' ? 'badge badge-warning' : 'badge'} style={{ padding: '3px 9px', fontSize: '0.76rem' }}>{statusLabel}</span>
              </div>
            </div>

            {/* 1.1 Metadata Bar (In comfortable mode, shown as clean separated row) */}
            {!compactView && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px 16px',
                background: '#f8fafc',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                fontSize: '0.84rem'
              }}>
                <div><strong>{t('cash_drawer.cash_drawer_review_dialog.s8', "الحالة:")}</strong> <span className={shift.status === 'pending_review' ? 'badge badge-warning' : 'badge'}>{statusLabel}</span></div>
                <div><strong>{t('cash_drawer.cash_drawer_review_dialog.s9', "الفرع / المخزن:")}</strong> <span>{shift.branchName || '—'} / {shift.locationName || '—'}</span></div>
                <div><strong>{t('cash_drawer.cash_drawer_review_dialog.s10', "التوقيت:")}</strong> <span>{t('cash_drawer.cash_drawer_review_dialog.s11', "من")} {formatTimeOnly(shift.createdAt)} {t('cash_drawer.cash_drawer_review_dialog.s12', "إلى")} {formatTimeOnly(shift.closedAt)}</span></div>
                {shift.closedByName && shift.openedByName && shift.closedByName.trim().toLowerCase() !== shift.openedByName.trim().toLowerCase() ? (
                  <div><strong>{t('cash_drawer.cash_drawer_review_dialog.s13', "أُغلقت إدارياً بواسطة:")}</strong> <strong style={{ color: '#b45309' }}>{shift.closedByName}</strong></div>
                ) : null}
              </div>
            )}

            {/* 2. Discrepancy Verdict Banner */}
            <div
              style={{
                padding: compactView ? '6px 12px' : '10px 16px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '4px 12px',
                fontSize: compactView ? '0.8rem' : '0.85rem',
                background: reviewMatched ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${reviewMatched ? '#bbf7d0' : '#fca5a5'}`,
                color: reviewMatched ? '#166534' : '#991b1b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                {reviewMatched ? <CheckCircleIcon size={17} color="#16a34a" /> : <AlertTriangleIcon size={17} color="#dc2626" />}
                <span>{reviewMatched ? t('cash_drawer.cash_drawer_review_dialog.s14', "الوردية متطابقة بالكامل مع إقرار الكاشير.") : t('cash_drawer.cash_drawer_review_dialog.s15', "تنبيه: يوجد عجز / فارق في إقرار الكاشير مقارنة بالنظام.")}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', color: reviewMatched ? '#166534' : '#991b1b' }}>
                <span><strong>{t('cash_drawer.cash_drawer_review_dialog.s16', "إجمالي الفارق:")}</strong> <strong style={{ color: totalShiftDiscrepancy < 0 ? '#dc2626' : '#16a34a', fontSize: compactView ? '0.86rem' : '0.92rem' }}>{differenceLabel(totalShiftDiscrepancy, bookDigits)}</strong></span>
                <span style={{ color: reviewMatched ? '#86efac' : '#fca5a5' }}>|</span>
                <span><strong>{t('cash_drawer.cash_drawer_review_dialog.s17', "فارق نقدية الدرج:")}</strong> <strong style={{ color: dynamicVariance < 0 ? '#dc2626' : '#16a34a' }}>{differenceLabel(dynamicVariance, bookDigits)}</strong></span>
                <span style={{ color: reviewMatched ? '#86efac' : '#fca5a5' }}>|</span>
                <span><strong>{t('cash_drawer.cash_drawer_review_dialog.s18', "فارق المدفوعات الإلكترونية:")}</strong> <strong style={{ color: electronicDiff < 0 ? '#dc2626' : '#16a34a' }}>{differenceLabel(electronicDiff, bookDigits)}</strong></span>
                <span style={{ color: reviewMatched ? '#86efac' : '#fca5a5' }}>|</span>
                <span><strong>{t('cash_drawer.cash_drawer_review_dialog.s19', "فرق العمليات:")}</strong> {formatSignedCount(comparison.opsDiffTotal)}</span>
              </div>
            </div>

            {/* 3. SECTION 1: Cash Drawer Reconciliation (جرد ومطابقة نقدية الدرج - الكاش الفعلي) */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
            }}>
              {/* Section 1 Header */}
              <div style={{
                background: '#f8fafc',
                padding: compactView ? '6px 12px' : '9px 16px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: '#0f172a', fontSize: compactView ? '0.85rem' : '0.92rem' }}>
                  <ScaleIcon size={compactView ? 16 : 18} color="#475569" />
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s20', "1. جرد ومطابقة نقدية الدرج (الكاش الفعلي بالدرج)")}</span>
                </div>
                <span style={{ fontSize: compactView ? '0.74rem' : '0.78rem', color: '#64748b' }}>
                  {t('cash_drawer.cash_drawer_review_dialog.s21', "حساب النقدية الفعلية داخل الدرج = العهدة + مبيعات الكاش + الإيداعات - المنصرفات")}
                </span>
              </div>

              {/* Arithmetic 4-Box Step Flow */}
              <div style={{
                padding: compactView ? '8px 10px' : '12px 14px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: compactView ? '6px' : '10px',
                background: '#fbfcfd'
              }}>
                {/* 1. العهدة الافتتاحية */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: compactView ? '6px 10px' : '9px 12px' }}>
                  <div style={{ fontSize: compactView ? '0.72rem' : '0.76rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s22', "[1] العهدة الافتتاحية")}</div>
                  <div style={{ fontSize: compactView ? '0.98rem' : '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    {formatCurrency(shift.openingCash)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '1px' }}>{t('cash_drawer.cash_drawer_review_dialog.s23', "رصيد بداية الوردية")}</div>
                </div>

                {/* 2. (+) مبيعات كاش */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: compactView ? '6px 10px' : '9px 12px' }}>
                  <div style={{ fontSize: compactView ? '0.72rem' : '0.76rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s24', "[2] (+) مبيعات كاش النظام")}</div>
                  <div style={{ fontSize: compactView ? '0.98rem' : '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    +{formatCurrency(expected.rawCashSales)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '1px' }}>{t('cash_drawer.cash_drawer_review_dialog.s25', "فواتير البيع النقدية")}</div>
                </div>

                {/* 3. (+) إيداعات نقدية */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: compactView ? '6px 10px' : '9px 12px' }}>
                  <div style={{ fontSize: compactView ? '0.72rem' : '0.76rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s26', "[3] (+) إيداعات نقدية للدرج")}</div>
                  <div style={{ fontSize: compactView ? '0.98rem' : '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    +{formatCurrency(manualCashIn + deliveryCashIn)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '1px' }}>{t('cash_drawer.cash_drawer_review_dialog.s27', "إيداعات + تسوية مناديب")}</div>
                </div>

                {/* 4. (-) منصرفات ومسحوبات */}
                <div style={{ background: '#fffbfb', border: '1px solid #fecaca', borderRadius: '8px', padding: compactView ? '6px 10px' : '9px 12px' }}>
                  <div style={{ fontSize: compactView ? '0.72rem' : '0.76rem', color: '#dc2626', fontWeight: 700 }}>{t('cash_drawer.cash_drawer_review_dialog.s28', "[4] (-) منصرفات ومسحوبات")}</div>
                  <div style={{ fontSize: compactView ? '0.98rem' : '1.1rem', fontWeight: 800, color: '#dc2626', marginTop: '2px' }}>
                    -{formatCurrency(totalDeductions)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '1px' }}>{t('cash_drawer.cash_drawer_review_dialog.s29', "مصروفات وسداد موردين ومرتجع")}</div>
                </div>
              </div>

              {/* Drawer Balance Summary Panel (Adaptive Multi-Row Layout) */}
              <div style={{
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {/* 1. Arithmetic Formula Ribbon */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: '4px 6px',
                  direction: 'rtl',
                  fontWeight: 700,
                  color: '#1e293b',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                  lineHeight: '1.4'
                }}>
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s30', "العهدة (")}{formatMoney(shift.openingCash, bookDigits)})</span>
                  <span style={{ color: '#94a3b8' }}>+</span>
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s31', "مبيعات (")}{formatMoney(expected.rawCashSales, bookDigits)})</span>
                  <span style={{ color: '#94a3b8' }}>+</span>
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s32', "إيداعات (")}{formatMoney(manualCashIn + deliveryCashIn, bookDigits)})</span>
                  <span style={{ color: '#dc2626' }}>-</span>
                  <span style={{ color: '#dc2626' }}>{t('cash_drawer.cash_drawer_review_dialog.s33', "منصرفات (")}{formatMoney(totalDeductions, bookDigits)})</span>
                  <span style={{ color: '#475569' }}>=</span>
                  <strong style={{ color: '#0f172a', background: '#ffffff', padding: '1px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}>
                    {formatMoney(dynamicExpectedCash, bookDigits)}
                  </strong>
                </div>

                {/* 2. Three Result Metrics (Responsive Grid) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
                  gap: '8px',
                  textAlign: 'center',
                }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s34', "صافي المتوقع")}</div>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', display: 'block', marginTop: '2px' }}>{formatCurrency(dynamicExpectedCash)}</strong>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s35', "المعدود الفعلي")}</div>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', display: 'block', marginTop: '2px' }}>{formatCurrency(declared.cash)}</strong>
                  </div>
                  <div style={{
                    background: dynamicVariance < 0 ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${dynamicVariance < 0 ? '#fecaca' : '#bbf7d0'}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                  }}>
                    <div style={{ fontSize: '0.72rem', color: dynamicVariance < 0 ? '#dc2626' : '#15803d', fontWeight: 700 }}>{t('cash_drawer.cash_drawer_review_dialog.s36', "فارق نقدية الدرج")}</div>
                    <strong style={{ fontSize: '0.88rem', color: dynamicVariance < 0 ? '#dc2626' : '#15803d', display: 'block', marginTop: '2px' }}>
                      {differenceLabel(dynamicVariance, bookDigits)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. SECTION 2: Electronic Payments Matching (مطابقة قنوات الدفع الإلكتروني) */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              marginTop: '0'
            }}>
              {/* Section 2 Header */}
              <div style={{
                background: '#f8fafc',
                padding: compactView ? '6px 12px' : '9px 16px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: '#0f172a', fontSize: compactView ? '0.85rem' : '0.92rem' }}>
                  <CreditCardIcon size={compactView ? 16 : 18} color="#475569" />
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s37', "2. مطابقة قنوات الدفع الإلكتروني والآجل (إيصالات POS والمحافظ)")}</span>
                </div>
                <span style={{ fontSize: compactView ? '0.74rem' : '0.78rem', color: '#64748b' }}>
                  {t('cash_drawer.cash_drawer_review_dialog.s38', "مقارنة مباشرة 1 إلى 1 بين مبيعات النظام وإقرار الكاشير")}
                </span>
              </div>

              <div className="table-wrap" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: 0 }}>
                <table className="cash-drawer-review-table" style={{ width: '100%', minWidth: '650px', fontSize: compactView ? '0.82rem' : '0.86rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'right' }}>{t('cash_drawer.cash_drawer_review_dialog.s39', "طريقة الدفع / القناة")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s40', "مبيعات النظام")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s41', "إقرار الكاشير (إيصالات)")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s42', "فرق المبلغ")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s43', "عمليات النظام")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s44', "عمليات الكاشير")}</th>
                      <th style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s45', "فرق العدد")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row) => (
                      <tr key={row.key}>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'right' }}><strong>{row.label}</strong></td>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{formatMoney(row.systemAmount, bookDigits)}</td>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>
                          {row.key === 'credit' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px', background: '#f1f5f9', color: '#475569', padding: compactView ? '1px 6px' : '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              <UsersIcon size={12} color="#64748b" /> {t('cash_drawer.cash_drawer_review_dialog.s46', "ذمة عميل (آجل)")}
                            </span>
                          ) : row.key === 'delivery' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px', background: '#f1f5f9', color: '#475569', padding: compactView ? '1px 6px' : '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              <TruckIcon size={12} color="#64748b" /> {t('cash_drawer.cash_drawer_review_dialog.s47', "مع المناديب (دليفري)")}
                            </span>
                          ) : (
                            formatMoney(row.declaredAmount, bookDigits)
                          )}
                        </td>
                        <td style={{ fontWeight: 600, padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>
                          {row.key === 'credit' || row.key === 'delivery' ? (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          ) : Math.abs(row.amountDiff) <= 0.009 ? (
                            <span style={{ color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 8px', borderRadius: '4px', fontSize: '0.76rem', fontWeight: 700 }}>{formatMoney(0, bookDigits)} {t('cash_drawer.cash_drawer_review_dialog.s48', "(مطابق)")}</span>
                          ) : row.amountDiff < 0 ? (
                            <span style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', padding: '1px 8px', borderRadius: '4px', fontSize: '0.76rem', fontWeight: 800 }}>{differenceLabel(row.amountDiff, bookDigits)} {t('cash_drawer.cash_drawer_review_dialog.s49', "(عجز)")}</span>
                          ) : (
                            <span style={{ color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 8px', borderRadius: '4px', fontSize: '0.76rem', fontWeight: 700 }}>{differenceLabel(row.amountDiff, bookDigits)}</span>
                          )}
                        </td>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{toDisplayCount(row.systemCount)}</td>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{toDisplayCount(row.declaredCount)}</td>
                        <td style={{ padding: compactView ? '5px 8px' : '8px 12px', textAlign: 'center' }}>{row.countDiff == null ? '—' : formatSignedCount(row.countDiff)}</td>
                      </tr>
                    ))}
                    <tr className="cash-drawer-review-total-row" style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1' }}>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'right' }}><strong>{t('cash_drawer.cash_drawer_review_dialog.s50', "إجمالي المدفوعات الإلكترونية")}</strong></td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}><strong style={{ color: '#0f172a' }}>{formatMoney(comparison.systemAmountTotal, bookDigits)}</strong></td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}><strong>{formatMoney(comparison.declaredAmountTotal, bookDigits)}</strong></td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}>
                        {comparison.amountDiffTotal === 0 ? (
                          <strong style={{ color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '4px' }}>{formatMoney(0, bookDigits)} {t('cash_drawer.cash_drawer_review_dialog.s51', "(مطابق)")}</strong>
                        ) : comparison.amountDiffTotal < 0 ? (
                          <span style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>{differenceLabel(comparison.amountDiffTotal, bookDigits)} {t('cash_drawer.cash_drawer_review_dialog.s52', "(عجز)")}</span>
                        ) : (
                          <strong style={{ color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '4px' }}>{differenceLabel(comparison.amountDiffTotal, bookDigits)}</strong>
                        )}
                      </td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}><strong>{formatCount(comparison.systemOpsTotal)}</strong></td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}><strong>{formatCount(comparison.declaredOpsTotal)}</strong></td>
                      <td style={{ padding: compactView ? '6px 8px' : '9px 12px', textAlign: 'center' }}><strong>{formatSignedCount(comparison.opsDiffTotal)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5. Collapsible Drawer Movements (حركات ومنصرفات الدرج القابلة للطي) */}
            <div className="cash-drawer-review-block" style={{ marginTop: '0' }}>
              <div
                onClick={() => setShowMovements(!showMovements)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: compactView ? '5px 10px' : '8px 14px',
                  cursor: 'pointer',
                  fontSize: compactView ? '0.8rem' : '0.84rem',
                  fontWeight: 600,
                  color: '#475569',
                  userSelect: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RefreshCwIcon size={compactView ? 13 : 15} color="#64748b" />
                  <span>{t('cash_drawer.cash_drawer_review_dialog.s53', "حركات ومنصرفات الدرج التفصيلية (")}{shift.movementItems?.length || 0} {t('cash_drawer.cash_drawer_review_dialog.s54', "عملية)")}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: '#0284c7' }}>
                  <span>{showMovements ? t('cash_drawer.cash_drawer_review_dialog.s55', "إخفاء التفاصيل") : t('cash_drawer.cash_drawer_review_dialog.s56', "عرض التفاصيل")}</span>
                  {showMovements ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                </div>
              </div>

              {showMovements && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                  {movementGroups.map((group) => {
                    const isExpanded = !!expandedKinds[group.kind];
                    const hasItems = group.items.length > 0;

                    return (
                      <div
                        key={group.kind}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          background: '#fff',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Group Summary Row */}
                        <div
                          onClick={() => hasItems && toggleGroup(group.kind)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            background: isExpanded ? '#f1f5f9' : '#f8fafc',
                            cursor: hasItems ? 'pointer' : 'default',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#1e293b' }}>
                              {group.label}
                            </span>
                            <span className="badge" style={{ fontSize: '0.7rem', background: '#e2e8f0', color: '#475569', padding: '1px 5px' }}>
                              {group.items.length} {group.items.length === 1 ? t('cash_drawer.cash_drawer_review_dialog.s57', "عملية") : t('cash_drawer.cash_drawer_review_dialog.s58', "عمليات")}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '0.82rem', color: group.isCredit ? '#16a34a' : '#dc2626' }}>
                              {group.isCredit ? '+' : '-'}{formatCurrency(group.total)}
                            </strong>
                            {hasItems ? (
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '1px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  color: '#64748b'
                                }}
                              >
                                {isExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Expandable Itemized Details */}
                        {isExpanded && hasItems ? (
                          <div style={{ borderTop: '1px solid #e2e8f0', background: '#ffffff', padding: '4px 8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                              <thead>
                                <tr style={{ color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                                  <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>{t('cash_drawer.cash_drawer_review_dialog.s59', "البيان / السبب")}</th>
                                  <th style={{ padding: '4px 6px', fontWeight: 600, width: '110px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s60', "المبلغ")}</th>
                                  <th style={{ padding: '4px 6px', fontWeight: 600, width: '130px', textAlign: 'center' }}>{t('cash_drawer.cash_drawer_review_dialog.s61', "التوقيت")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item) => (
                                  <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                                    <td style={{ padding: '4px 6px', color: '#1e293b', fontWeight: 500, textAlign: 'right' }}>
                                      {item.note.replace(/^وردية\s*#?[A-Z0-9_-]+:\s*/i, '').trim() || item.note}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                      <strong style={{ color: group.isCredit ? '#16a34a' : '#dc2626' }}>
                                        {group.isCredit ? '+' : '-'}{formatCurrency(item.amount)}
                                      </strong>
                                    </td>
                                    <td style={{ padding: '4px 6px', color: '#64748b', fontSize: '0.74rem', textAlign: 'center' }}>
                                      {item.createdAt ? formatDate(item.createdAt) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 6. Executive Decision & Cash Handover Summary */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: compactView ? '8px' : '12px',
            }}>
              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderTop: '2.5px solid #16a34a',
                borderRadius: '8px',
                padding: compactView ? '8px 12px' : '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}>
                <div>
                  <div style={{ fontSize: compactView ? '0.74rem' : '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s62', "النقدية المستلمة للخزينة:")}</div>
                  <div style={{ fontSize: compactView ? '1.15rem' : '1.25rem', fontWeight: 800, color: '#15803d', marginTop: '1px' }}>
                    {formatCurrency(shift.declaredCash ?? shift.countedCash ?? 0)}
                  </div>
                </div>
                <div style={{ background: '#f0fdf4', padding: compactView ? '7px' : '10px', borderRadius: '7px', color: '#16a34a', display: 'flex' }}>
                  <BuildingIcon size={compactView ? 18 : 22} />
                </div>
              </div>

              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderTop: `2.5px solid ${dynamicVariance < 0 ? '#dc2626' : '#16a34a'}`,
                borderRadius: '8px',
                padding: compactView ? '8px 12px' : '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}>
                <div>
                  <div style={{ fontSize: compactView ? '0.74rem' : '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s63', "فارق نقدية الدرج:")}</div>
                  <div style={{ fontSize: compactView ? '1.15rem' : '1.25rem', fontWeight: 800, color: dynamicVariance < 0 ? '#dc2626' : '#15803d', marginTop: '1px' }}>
                    {formatCurrency(dynamicVariance)} <span style={{ fontSize: '0.74rem', fontWeight: 700, color: dynamicVariance < 0 ? '#dc2626' : '#15803d' }}>{dynamicVariance < 0 ? t('cash_drawer.cash_drawer_review_dialog.s64', "(عجز)") : dynamicVariance > 0 ? t('cash_drawer.cash_drawer_review_dialog.s65', "(زيادة)") : t('cash_drawer.cash_drawer_review_dialog.s66', "(مطابق)")}</span>
                  </div>
                </div>
                <div style={{ background: dynamicVariance < 0 ? '#fef2f2' : '#f0fdf4', padding: compactView ? '7px' : '10px', borderRadius: '7px', color: dynamicVariance < 0 ? '#dc2626' : '#16a34a', display: 'flex' }}>
                  <ScaleIcon size={compactView ? 18 : 22} />
                </div>
              </div>

              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderTop: `2.5px solid ${electronicDiff < 0 ? '#dc2626' : '#16a34a'}`,
                borderRadius: '8px',
                padding: compactView ? '8px 12px' : '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}>
                <div>
                  <div style={{ fontSize: compactView ? '0.74rem' : '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('cash_drawer.cash_drawer_review_dialog.s67', "فارق المدفوعات الإلكترونية:")}</div>
                  <div style={{ fontSize: compactView ? '1.15rem' : '1.25rem', fontWeight: 800, color: electronicDiff < 0 ? '#dc2626' : '#15803d', marginTop: '1px' }}>
                    {formatCurrency(electronicDiff)} <span style={{ fontSize: '0.74rem', fontWeight: 700, color: electronicDiff < 0 ? '#dc2626' : '#15803d' }}>{electronicDiff < 0 ? t('cash_drawer.cash_drawer_review_dialog.s68', "(عجز)") : electronicDiff > 0 ? t('cash_drawer.cash_drawer_review_dialog.s69', "(زيادة)") : t('cash_drawer.cash_drawer_review_dialog.s70', "(مطابق)")}</span>
                  </div>
                </div>
                <div style={{ background: electronicDiff < 0 ? '#fef2f2' : '#f0fdf4', padding: compactView ? '7px' : '10px', borderRadius: '7px', color: electronicDiff < 0 ? '#dc2626' : '#16a34a', display: 'flex' }}>
                  <CreditCardIcon size={compactView ? 18 : 22} />
                </div>
              </div>
            </div>

            {/* 7. Notes & Manager Approval */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '8px',
              background: '#f8fafc',
              padding: compactView ? '8px 12px' : '12px 16px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <div>
                <div style={{ fontSize: '0.76rem', color: '#64748b', marginBottom: '2px' }}>
                  <strong>{t('cash_drawer.cash_drawer_review_dialog.s71', "ملاحظة الافتتاح:")}</strong> {shift.openingNote || '—'}
                </div>
                <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                  <strong>{t('cash_drawer.cash_drawer_review_dialog.s72', "ملاحظة الإغلاق:")}</strong> {cleanCloseNote || '—'}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Field label={t('cash_drawer.cash_drawer_review_dialog.s73', "ملاحظة المشرف للاعتماد (اختياري)")}>
                  <input
                    type="text"
                    value={props.managerNote}
                    onChange={(event) => props.onManagerNoteChange(event.target.value)}
                    placeholder={t('cash_drawer.cash_drawer_review_dialog.s74', "اكتب ملاحظة قصيرة للمراجعة...")}
                    disabled={props.isPending}
                    style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                  />
                </Field>
              </div>
            </div>

            <MutationFeedback
              isError={props.isError}
              isSuccess={false}
              error={props.error}
              errorFallback={t('cash_drawer.cash_drawer_review_dialog.s75', "تعذر اعتماد إغلاق الوردية")}
            />

            {/* Action Buttons */}
            <div className="actions compact-actions" style={{ justifyContent: 'space-between', marginTop: '2px' }}>
              <Button
                variant="secondary"
                type="button"
                onClick={() => shift && printCashDrawerShiftReceipt(shift)}
                disabled={props.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: compactView ? '5px 12px' : '7px 16px', fontSize: '0.82rem' }}
              >
                <PrinterIcon size={15} /> {t('cash_drawer.cash_drawer_review_dialog.s76', "طباعة تقرير Z (Z-Report)")}
              </Button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="secondary" onClick={props.onClose} disabled={props.isPending} style={{ padding: compactView ? '5px 14px' : '7px 18px', fontSize: '0.82rem' }}>
                  {t('cash_drawer.cash_drawer_review_dialog.s77', "إلغاء")}
                </Button>
                <Button variant="primary" onClick={props.onApprove} disabled={props.isPending} style={{ padding: '5px 16px', fontSize: '0.82rem' }}>
                  {props.isPending ? t('cash_drawer.cash_drawer_review_dialog.s78', "جاري اعتماد الإغلاق...") : t('cash_drawer.cash_drawer_review_dialog.s79', "اعتماد الإغلاق النهائي")}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}
