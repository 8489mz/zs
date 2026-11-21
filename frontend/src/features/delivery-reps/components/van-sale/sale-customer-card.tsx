import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { FileTextIcon, MapPinIcon, PhoneIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { CustomerOption } from './van-sale-types';

export interface SaleCustomerCardProps {
  selectedCustomer: CustomerOption;
  handleLoadSuggestedOrder: () => void;
  isLoadingSuggested: boolean;
  onSelectCustomer: (val: number | '') => void;
  setStatementModalOpen: Dispatch<SetStateAction<boolean>>;
}

export function SaleCustomerCard({
  selectedCustomer,
  handleLoadSuggestedOrder,
  isLoadingSuggested,
  onSelectCustomer,
  setStatementModalOpen,
}: SaleCustomerCardProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* Row 1: Customer Name & Code + Quick Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: '13.5px',
              fontWeight: 800,
              color: '#0f172a',
              lineHeight: 1.25,
            }}
          >
            {selectedCustomer.name}
          </span>
          {selectedCustomer.customerCode && (
            <span style={{ fontSize: '10px', color: '#64748b', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
              [{selectedCustomer.customerCode.replace(/^#/, '')}]
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          {selectedCustomer.locationUrl && (
            <a
              href={selectedCustomer.locationUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '10.5px',
                color: '#475569',
                fontWeight: 600,
                textDecoration: 'none',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '2px 6px',
                borderRadius: '5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
              title={t('delivery_reps.van_sale_tab.s7', "فتح الموقع على خرائط جوجل")}
            >
              <MapPinIcon size={11} color="#64748b" />
              <span>{t('delivery_reps.van_sale_tab.s8', "خريطة")}</span>
              <span>↗</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => onSelectCustomer('')}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '5px',
              padding: '2px 7px',
              fontSize: '10.5px',
              fontWeight: 600,
              color: '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('delivery_reps.van_sale_tab.s9', "تغيير العميل")}
          </button>
        </div>
      </div>

      {/* Row 2: Metadata Chips (Debt, Phone, Route, Credit Limit) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#334155', flexWrap: 'wrap' }}>
        <span
          style={{
            backgroundColor: selectedCustomer.balance > 0 ? '#fef2f2' : '#f8fafc',
            color: selectedCustomer.balance > 0 ? '#991b1b' : '#475569',
            border: `1px solid ${selectedCustomer.balance > 0 ? '#fecaca' : '#e2e8f0'}`,
            padding: '2px 7px',
            borderRadius: '5px',
            fontWeight: 700,
            fontSize: '11px',
          }}
        >
          {selectedCustomer.balance > 0 ? t('delivery_reps.van_sale_tab.s10', "المديونية: ") : t('delivery_reps.van_sale_tab.s11', "الحساب: ")}
          <strong>
            {selectedCustomer.balance === 0 ? t('delivery_reps.van_sale_tab.s12', "خالص (0.00)") : selectedCustomer.balance.toFixed(2)}
          </strong> <CurrencySymbol />
        </span>
        {selectedCustomer.phone && (
          <a
            href={`tel:${selectedCustomer.phone}`}
            style={{
              textDecoration: 'none',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '2px 7px',
              borderRadius: '5px',
              fontSize: '11px',
              color: '#0f172a',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <PhoneIcon size={11} color="#64748b" />
            <span dir="ltr">{selectedCustomer.phone}</span>
          </a>
        )}
        {selectedCustomer.route && (
          <span
            style={{
              fontSize: '10.5px',
              color: '#475569',
              backgroundColor: '#f1f5f9',
              border: '1px solid #e2e8f0',
              padding: '2px 7px',
              borderRadius: '5px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <MapPinIcon size={10} color="#64748b" />
            <span>{selectedCustomer.route}</span>
          </span>
        )}
        {selectedCustomer.creditLimit ? (
          <span
            style={{
              fontSize: '10.5px',
              color: '#475569',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '2px 7px',
              borderRadius: '5px',
            }}
          >
            {t('delivery_reps.van_sale_tab.s13', "سقف الائتمان:")} <strong>{selectedCustomer.creditLimit.toFixed(2)}</strong> <CurrencySymbol />
          </span>
        ) : null}
      </div>

      {/* Row 3: Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid #e2e8f0', paddingTop: '7px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleLoadSuggestedOrder}
          disabled={isLoadingSuggested}
          style={{
            flex: 1,
            minWidth: '130px',
            height: '32px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            color: '#1e293b',
            borderRadius: '6px',
            padding: '0 8px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
          title={t('delivery_reps.van_sale_tab.s14', "استدعاء تشكيلة الأصناف والكميات التي يشتريها العميل عادة وتنزيلها بالسلة فوراً")}
        >
          <RefreshCwIcon size={12} color="#170e5e" className={isLoadingSuggested ? 'animate-spin' : undefined} />
          <span>{isLoadingSuggested ? t('delivery_reps.van_sale_tab.s15', "جاري التحميل...") : t('delivery_reps.van_sale_tab.s16', "تكرار الطلب المعتاد")}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatementModalOpen(true)}
          style={{
            flex: 1,
            minWidth: '130px',
            height: '32px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            color: '#1e293b',
            borderRadius: '6px',
            padding: '0 8px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
          title={t('delivery_reps.van_sale_tab.s17', "معاينة كشف حساب العميل وطباعته حرارياً أو إرساله بواتساب")}
        >
          <FileTextIcon size={12} color="#170e5e" />
          <span>{t('delivery_reps.van_sale_tab.s18', "كشف حساب ميداني")}</span>
        </button>
      </div>
    </div>
  );
}
