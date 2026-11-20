import React from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { PlusIcon, ClockIcon } from '@/shared/components/icons/AppIcons';
import type { PreSalesOrderRecord } from '../../api/van-sales.api';
import type { CustomerOption } from './van-pre-sales-types';

export interface SubTabsSelectorProps {
  activeSubTab: 'new-booking' | 'my-orders';
  setActiveSubTab: React.Dispatch<React.SetStateAction<'new-booking' | 'my-orders'>>;
  myOrders: PreSalesOrderRecord[];
}

export interface BookingHeaderProps {
  customers: CustomerOption[];
  selectedCustomerId: number | '';
  onSelectCustomer: (val: number | '') => void;
  paymentTerms: 'cash' | 'credit';
  handlePaymentTermsChange: (newTerms: 'cash' | 'credit') => void;
  selectedCustomer: CustomerOption | null;
}

export const SubTabsSelector: React.FC<SubTabsSelectorProps> = ({ activeSubTab, setActiveSubTab, myOrders }) => {
  const { t } = useTranslation();
  return (
    <>
      {/* SUB-TABS SELECTOR */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#f1f5f9',
          padding: '3px',
          borderRadius: '10px',
          gap: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSubTab('new-booking')}
          style={{
            flex: 1,
            padding: '8px 4px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            border: activeSubTab === 'new-booking' ? '1px solid #170e5e' : '1px solid transparent',
            background: activeSubTab === 'new-booking' ? '#170e5e' : 'transparent',
            color: activeSubTab === 'new-booking' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <PlusIcon size={14} />
          <span>{t('delivery_reps.van_pre_sales_tab.s3', "حجز طلبية جديدة من المخزن")}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('my-orders')}
          style={{
            flex: 1,
            padding: '8px 4px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            border: activeSubTab === 'my-orders' ? '1px solid #170e5e' : '1px solid transparent',
            background: activeSubTab === 'my-orders' ? '#170e5e' : 'transparent',
            color: activeSubTab === 'my-orders' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <ClockIcon size={14} />
          <span>{t('delivery_reps.van_pre_sales_tab.s4', "طلبياتي المحجوزة (")}{myOrders.length})</span>
        </button>
      </div>
    </>
  );
};

export const BookingHeader: React.FC<BookingHeaderProps> = ({ customers, selectedCustomerId, onSelectCustomer, paymentTerms, handlePaymentTermsChange, selectedCustomer }) => {
  const { t } = useTranslation();
  return (
    <>
      {/* CUSTOMER & PAYMENT TERMS CARD */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.van_pre_sales_tab.s5', "العميل وطريقة الدفع:")}</span>
          <div style={{ display: 'flex', gap: '5px' }}>
            <button
              type="button"
              onClick={() => handlePaymentTermsChange('cash')}
              style={{
                padding: '5px 12px',
                borderRadius: '7px',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
                border: paymentTerms === 'cash' ? '1.5px solid #059669' : '1px solid #cbd5e1',
                backgroundColor: paymentTerms === 'cash' ? '#ecfdf5' : '#ffffff',
                color: paymentTerms === 'cash' ? '#065f46' : '#64748b',
                boxShadow: paymentTerms === 'cash' ? '0 1px 3px rgba(5,150,105,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {t('delivery_reps.van_pre_sales_tab.s6', "كاش نقدي")}
            </button>
            <button
              type="button"
              onClick={() => handlePaymentTermsChange('credit')}
              style={{
                padding: '5px 12px',
                borderRadius: '7px',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
                border: paymentTerms === 'credit' ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                backgroundColor: paymentTerms === 'credit' ? '#fffbeb' : '#ffffff',
                color: paymentTerms === 'credit' ? '#92400e' : '#64748b',
                boxShadow: paymentTerms === 'credit' ? '0 1px 3px rgba(217,119,6,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {t('delivery_reps.van_pre_sales_tab.s7', "آجل على الحساب")}
            </button>
          </div>
        </div>

        <select
          value={selectedCustomerId}
          onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : '')}
          style={{
            width: '100%',
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12.5px',
            color: '#0f172a',
            boxSizing: 'border-box',
          }}
        >
          <option value="">{t('delivery_reps.van_pre_sales_tab.s8', "-- اختر العميل لتسجيل الطلبية --")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.phone ? `(${c.phone})` : ''} {t('delivery_reps.van_pre_sales_tab.s9', "- رصيد:")} {Number(c.balance || 0).toFixed(0)}
            </option>
          ))}
        </select>

        {selectedCustomer && (
          <div
            style={{
              fontSize: '11.5px',
              backgroundColor: '#f8fafc',
              padding: '6px 10px',
              borderRadius: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              border: '1px solid #e2e8f0',
            }}
          >
            <span>
              {t('delivery_reps.van_pre_sales_tab.s10', "الرصيد الحالي:")} <strong style={{ color: Number(selectedCustomer.balance) > 0 ? '#b91c1c' : Number(selectedCustomer.balance) < 0 ? '#0369a1' : '#475569' }}>{Number(selectedCustomer.balance || 0) === 0 ? t('delivery_reps.van_pre_sales_tab.s11', "خالص (0.00)") : Number(selectedCustomer.balance).toFixed(2)} <CurrencySymbol /></strong>
            </span>
            <span>
              {t('delivery_reps.van_pre_sales_tab.s12', "سقف الائتمان:")} <strong style={{ color: '#170e5e' }}>{selectedCustomer.creditLimit ? `${Number(selectedCustomer.creditLimit).toFixed(2)}` : t('delivery_reps.van_pre_sales_tab.s13', "غير محدد")}</strong>
            </span>
          </div>
        )}
      </div>
    </>
  );
};
