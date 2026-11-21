import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import type { CustomerOption } from './van-collection-types';

export interface CollectionActiveBoxProps {
  colAmount: string;
  collectionFormRef: RefObject<HTMLDivElement | null>;
  isSubmitting: boolean;
  onColAmountChange: (val: string) => void;
  onColCustomerChange: (val: number | '') => void;
  onSubmitCollection: () => void;
  selectedCustomer: CustomerOption;
}

export function CollectionActiveBox({
  colAmount,
  collectionFormRef,
  isSubmitting,
  onColAmountChange,
  onColCustomerChange,
  onSubmitCollection,
  selectedCustomer,
}: CollectionActiveBoxProps) {
  const { t } = useTranslation();
  return (
    <div
      ref={collectionFormRef}
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #c7d2fe',
        borderTop: '3px solid #170e5e',
        borderRadius: '12px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 2px 10px rgba(23, 14, 94, 0.06)',
      }}
    >
      {/* Row 1: Customer Info on Right & Debt Card on Left */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: '2px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>
              {selectedCustomer.name}
            </h4>
            <span style={{ fontSize: '10px', color: '#475569', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700 }}>
              [{selectedCustomer.customerCode?.replace(/^#/, '') || `C-${String(selectedCustomer.id).padStart(4, '0')}`}]
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            {selectedCustomer.district || selectedCustomer.route || t('delivery_reps.van_collection_tab.s17', "الخط العام")}
            {selectedCustomer.phone ? ` • ${selectedCustomer.phone}` : ''}
          </div>
        </div>

        {/* Current Debt Box */}
        <div
          style={{
            backgroundColor: selectedCustomer.balance > 0 ? '#fef2f2' : selectedCustomer.balance < 0 ? '#eff6ff' : '#f0fdf4',
            border: `1px solid ${selectedCustomer.balance > 0 ? '#fecaca' : selectedCustomer.balance < 0 ? '#bfdbfe' : '#bbf7d0'}`,
            borderRadius: '6px',
            padding: '4px 8px',
            textAlign: 'left',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: '9px', color: selectedCustomer.balance > 0 ? '#991b1b' : selectedCustomer.balance < 0 ? '#1e40af' : '#166534', fontWeight: 700, marginBottom: '1px' }}>
            {selectedCustomer.balance > 0 ? t('delivery_reps.van_collection_tab.s18', "المديونية الحالية:") : selectedCustomer.balance < 0 ? t('delivery_reps.van_collection_tab.s19', "رصيد دائن:") : t('delivery_reps.van_collection_tab.s20', "حساب خالص:")}
          </div>
          <div style={{ fontSize: '13.5px', fontWeight: 900, color: selectedCustomer.balance > 0 ? '#991b1b' : selectedCustomer.balance < 0 ? '#1d4ed8' : '#15803d', whiteSpace: 'nowrap' }}>
            {selectedCustomer.balance > 0
              ? `${selectedCustomer.balance.toFixed(2)} `
              : selectedCustomer.balance < 0
              ? `${Math.abs(selectedCustomer.balance).toFixed(2)}- `
              : '0.00 '}
            <CurrencySymbol />
          </div>
        </div>
      </div>

      {/* Row 2: Quick Amount Presets (Side by Side strictly 50%/50%) */}
      {selectedCustomer.balance > 0 ? (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => onColAmountChange(String(selectedCustomer.balance))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: '32px',
              backgroundColor: colAmount === String(selectedCustomer.balance) ? '#eef2ff' : '#f8fafc',
              border: colAmount === String(selectedCustomer.balance) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '0 6px',
              fontSize: '11px',
              fontWeight: 800,
              color: colAmount === String(selectedCustomer.balance) ? '#170e5e' : '#1e293b',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{t('delivery_reps.van_collection_tab.s21', "سداد كامل")}</span>
            <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>
              ({selectedCustomer.balance % 1 === 0 ? selectedCustomer.balance.toFixed(0) : selectedCustomer.balance.toFixed(2)})
            </span>
          </button>

          <button
            type="button"
            onClick={() => onColAmountChange(String((selectedCustomer.balance / 2).toFixed(2)))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: '32px',
              backgroundColor: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '#eef2ff' : '#f8fafc',
              border: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '0 6px',
              fontSize: '11px',
              fontWeight: 800,
              color: colAmount === String((selectedCustomer.balance / 2).toFixed(2)) ? '#170e5e' : '#1e293b',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{t('delivery_reps.van_collection_tab.s22', "نصف المبلغ")}</span>
            <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>
              ({(selectedCustomer.balance / 2) % 1 === 0 ? (selectedCustomer.balance / 2).toFixed(0) : (selectedCustomer.balance / 2).toFixed(2)})
            </span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[100, 200, 500, 1000].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => onColAmountChange(String(amt))}
              style={{
                flex: 1,
                minWidth: '60px',
                height: '30px',
                backgroundColor: colAmount === String(amt) ? '#eef2ff' : '#f8fafc',
                border: colAmount === String(amt) ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                color: colAmount === String(amt) ? '#170e5e' : '#334155',
                cursor: 'pointer',
              }}
            >
              {amt} {t('delivery_reps.van_collection_tab.s23', "ج.م")}
            </button>
          ))}
        </div>
      )}

      {/* Row 3: Collection Input */}
      <div>
        <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
          {t('delivery_reps.van_collection_tab.s24', "المبلغ المحصل نقداً الآن (")}{getGlobalCurrencySymbol()}):
        </label>
        <input
          type="number"
          step="0.01"
          value={colAmount}
          onChange={(e) => onColAmountChange(e.target.value)}
          placeholder="0.00"
          style={{
            width: '100%',
            height: '36px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '0 10px',
            fontSize: '14px',
            fontWeight: 800,
            color: '#0f172a',
            boxSizing: 'border-box',
            outlineColor: '#170e5e',
          }}
        />
      </div>

      {/* Row 4: Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
        <Button
          variant="primary"
          onClick={onSubmitCollection}
          disabled={isSubmitting || !Number(colAmount)}
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: '#170e5e',
            color: '#ffffff',
            height: '36px',
            fontSize: '12.5px',
            fontWeight: 800,
            padding: '0 12px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            border: 'none',
            borderRadius: '6px',
          }}
        >
          {isSubmitting ? t('delivery_reps.van_collection_tab.s25', "جاري قيد السند...") : t('delivery_reps.van_collection_tab.s26', "إثبات تحصيل النقدية")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onColCustomerChange('');
            onColAmountChange('');
          }}
          style={{
            height: '36px',
            padding: '0 14px',
            fontSize: '11.5px',
            fontWeight: 700,
            flexShrink: 0,
            backgroundColor: '#f1f5f9',
            border: '1px solid #cbd5e1',
            color: '#475569',
            borderRadius: '6px',
          }}
        >
          {t('delivery_reps.van_collection_tab.s27', "إلغاء")}
        </Button>
      </div>
    </div>
  );
}
