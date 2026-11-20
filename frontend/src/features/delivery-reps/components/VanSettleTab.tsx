import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { ClockIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import type { VanSettleTabProps } from './van-settle/van-settle-types';
import { useSettleMoney } from './van-settle/use-settle-money';
import { useStockAudit } from './van-settle/use-stock-audit';
import { formatTime, getPaymentMethodBadge, getReturnStatusBadge } from './van-settle/settle-helpers';
import { SettleLedger } from './van-settle/settle-ledger';
import { CashCounting } from './van-settle/cash-counting';
import { StockAudit } from './van-settle/stock-audit';
import { SettleSubmit } from './van-settle/settle-submit';
import { ActivityShell } from './van-settle/activity-shell';

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
  perDayDue,
  perDayCash,
  onPerDayCashChange,
  onFillPerDayWithDue,
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

  const money = useSettleMoney({
    tripData,
    sales,
    collections,
    returns,
    expenses,
    packagingMovements,
    perDayDue,
    countedCash,
  });
  const audit = useStockAudit({ inventory });

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
          {t('delivery_reps.van_settle_tab.s1', "حركة وسجل اليوم (")}{money.totalActivities})
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

        <SettleLedger
          salesAmount={money.salesAmount}
          cashSales={money.cashSales}
          creditSales={money.creditSales}
          collectionsTotal={money.collectionsTotal}
          returnsAmount={money.returnsAmount}
          totalInstapay={money.totalInstapay}
          cashRefunds={money.cashRefunds}
          creditReturns={money.creditReturns}
          totalTripExpenses={money.totalTripExpenses}
          totalDiscounts={money.totalDiscounts}
          cashCollected={money.cashCollected}
          isBlindSettlement={isBlindSettlement}
          t={t}
          onOpenExpenseModal={onOpenExpenseModal}
          onOpenPackagingModal={onOpenPackagingModal}
        />

        <CashCounting
          countedCash={countedCash}
          onCountedCashChange={onCountedCashChange}
          perDayDue={perDayDue}
          perDayCash={perDayCash}
          onPerDayCashChange={onPerDayCashChange}
          onFillPerDayWithDue={onFillPerDayWithDue}
          perDayMode={money.perDayMode}
          cashCollected={money.cashCollected}
          countedNum={money.countedNum}
          isBlindSettlement={isBlindSettlement}
          t={t}
        />

        <StockAudit audit={audit} inventory={inventory} t={t} />

        <SettleSubmit
          unloadRemaining={unloadRemaining}
          onUnloadRemainingChange={onUnloadRemainingChange}
          nightStockApproved={audit.nightStockApproved}
          setNightStockApproved={audit.setNightStockApproved}
          requireSupervisorPin={requireSupervisorPin}
          supervisorPin={supervisorPin}
          setSupervisorPin={setSupervisorPin}
          pinError={pinError}
          setPinError={setPinError}
          onSubmitSettle={onSubmitSettle}
          isSubmitting={isSubmitting}
          countedStockMap={audit.countedStockMap}
          inventory={inventory}
          t={t}
        />
      </div>
      ) : (
      /* SECTION 2: TRIP ACTIVITY & MOVEMENT EXPLORER */
      <ActivityShell
        activeSubTab={activeSubTab}
        setActiveSubTab={setActiveSubTab}
        sales={sales}
        collections={collections}
        returns={returns}
        safeExpenses={money.safeExpenses}
        safePackaging={money.safePackaging}
        inventory={inventory}
        formatTime={formatTime}
        getPaymentMethodBadge={getPaymentMethodBadge}
        getReturnStatusBadge={getReturnStatusBadge}
        t={t}
      />
      )}
    </div>
  );
};
