import type { TFunction } from 'i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { LockIcon, PackageIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';

export interface SettleLedgerProps {
  salesAmount: number;
  cashSales: number;
  creditSales: number;
  collectionsTotal: number;
  returnsAmount: number;
  totalInstapay: number;
  cashRefunds: number;
  creditReturns: number;
  totalTripExpenses: number;
  totalDiscounts: number;
  cashCollected: number;
  isBlindSettlement: boolean;
  t: TFunction;
  onOpenExpenseModal?: () => void;
  onOpenPackagingModal?: () => void;
}

export function SettleLedger({
  salesAmount,
  cashSales,
  creditSales,
  collectionsTotal,
  returnsAmount,
  totalInstapay,
  cashRefunds,
  creditReturns,
  totalTripExpenses,
  totalDiscounts,
  cashCollected,
  isBlindSettlement,
  t,
  onOpenExpenseModal,
  onOpenPackagingModal,
}: SettleLedgerProps) {
  return (
    <>
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
    </>
  );
}
