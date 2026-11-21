import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CreditCardIcon,
  SendIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';
import type { VanRepFinancialLedgerResponse } from '../../api/van-sales.api';

export interface LedgerKpiCardsProps {
  summary: VanRepFinancialLedgerResponse['summary'];
}

export function LedgerKpiCards({ summary }: LedgerKpiCardsProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '10px',
        width: '100%',
      }}
    >
      {/* Card 1: Pending Shortages */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s0', "إجمالي العجوزات المعلقة")}
          </span>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangleIcon size={15} color="#475569" />
          </div>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: summary.totalPendingShortages > 0 ? '#b91c1c' : '#0f172a', fontFamily: 'monospace' }}>
          {summary.totalPendingShortages.toFixed(2)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
        </div>
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_financial_ledger_admin_tab.s1', "مطالب بها المناديب ولم تسدد")}
        </div>
      </div>

      {/* Card 2: Settled in Drawer */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s2', "مسدد نقداً بالخزينة")}
          </span>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckCircleIcon size={15} color="#475569" />
          </div>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
          {summary.totalSettledShortages.toFixed(2)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
        </div>
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_financial_ledger_admin_tab.s3', "تم توريدها بموجب سندات قبض")}
        </div>
      </div>

      {/* Card 3: Pushed to Payroll */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s4', "مرحل لمسير الرواتب")}
          </span>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SendIcon size={15} color="#475569" />
          </div>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
          {summary.totalPushedToPayroll.toFixed(2)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
        </div>
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_financial_ledger_admin_tab.s5', "استقطاعات معتمدة بمسير الشهور")}
        </div>
      </div>

      {/* Card 4: Total Commissions & Bonuses */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s6', "العمولات والمكافآت")}
          </span>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CreditCardIcon size={15} color="#475569" />
          </div>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
          {summary.totalCommissions.toFixed(2)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
        </div>
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_financial_ledger_admin_tab.s7', "بونص تارجت وعمولات مبيعات")}
        </div>
      </div>

      {/* Card 5: Net Balance */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 700 }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s8', "صافي رصيد العهد المعلقة")}
          </span>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              backgroundColor: '#f8fafc',
              border: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SlidersIcon size={15} color="#475569" />
          </div>
        </div>
        <div
          style={{
            fontSize: '20px',
            fontWeight: 800,
            color: summary.netRepBalance < 0 ? '#b91c1c' : '#0f172a',
            fontFamily: 'monospace',
          }}
        >
          {summary.netRepBalance.toFixed(2)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
        </div>
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
          {summary.netRepBalance < 0 ? t('delivery_reps.van_financial_ledger_admin_tab.s9', "صافي مطلوب من المناديب") : t('delivery_reps.van_financial_ledger_admin_tab.s10', "صافي مستحق للمناديب")}
        </div>
      </div>
    </div>
  );
}
