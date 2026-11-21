import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { CustomerOption } from './van-collection-types';

export interface CollectionHeaderProps {
  activeFilterMode: 'indebted' | 'all';
  collectionSearch: string;
  customers: CustomerOption[];
  indebtedCustomers: CustomerOption[];
  setCollectionSearch: Dispatch<SetStateAction<string>>;
  setFilterMode: Dispatch<SetStateAction<'indebted' | 'all'>>;
  totalIndebtedAmount: number;
}

export function CollectionHeader({
  activeFilterMode,
  collectionSearch,
  customers,
  indebtedCustomers,
  setCollectionSearch,
  setFilterMode,
  totalIndebtedAmount,
}: CollectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        borderBottom: '1px solid #f1f5f9',
        paddingBottom: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_collection_tab.s2', "تحصيل مديونيات العملاء")}
          </h3>
        </div>
      </div>

      {/* Compact 1-Row KPI Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '5px 8px',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ flex: '1 1 0', borderInlineEnd: '1px solid #e2e8f0', padding: '1px 4px' }}>
          <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s3', "إجمالي المديونيات")}</span>
          <strong style={{ fontSize: '12px', color: '#0f172a', fontWeight: 900 }}>
            {totalIndebtedAmount.toFixed(0)} <CurrencySymbol />
          </strong>
        </div>
        <div style={{ flex: '1 1 0', borderInlineEnd: '1px solid #e2e8f0', padding: '1px 4px' }}>
          <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s4', "عملاء مدينين")}</span>
          <strong style={{ fontSize: '12px', color: '#170e5e', fontWeight: 900 }}>
            {indebtedCustomers.length} {indebtedCustomers.length === 1 ? t('delivery_reps.van_collection_tab.s5', "عميل") : indebtedCustomers.length === 2 ? t('delivery_reps.van_collection_tab.s6', "عميلان") : indebtedCustomers.length <= 10 ? t('delivery_reps.van_collection_tab.s7', "عملاء") : t('delivery_reps.van_collection_tab.s8', "عميل")}
          </strong>
        </div>
        <div style={{ flex: '1 1 0', padding: '1px 4px' }}>
          <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>{t('delivery_reps.van_collection_tab.s9', "إجمالي الخط")}</span>
          <strong style={{ fontSize: '12px', color: '#0f172a', fontWeight: 900 }}>
            {customers.length} {customers.length === 1 ? t('delivery_reps.van_collection_tab.s10', "عميل") : customers.length === 2 ? t('delivery_reps.van_collection_tab.s11', "عميلان") : customers.length <= 10 ? t('delivery_reps.van_collection_tab.s12', "عملاء") : t('delivery_reps.van_collection_tab.s13', "عميل")}
          </strong>
        </div>
      </div>

      {/* Instant Search Bar */}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          type="text"
          value={collectionSearch}
          onChange={(e) => setCollectionSearch(e.target.value)}
          placeholder={t('delivery_reps.van_collection_tab.s14', "بحث باسم العميل، الكود، الحي، أو الهاتف...")}
          style={{
            width: '100%',
            height: '32px',
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '0 28px 0 8px',
            fontSize: '11.5px',
            fontWeight: 600,
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: '8px',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <SearchIcon size={13} />
        </div>
        {collectionSearch && (
          <button
            type="button"
            onClick={() => setCollectionSearch('')}
            style={{
              position: 'absolute',
              top: '50%',
              left: '8px',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <XIcon size={13} />
          </button>
        )}
      </div>

      {/* Smart Filter Pills */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setFilterMode('indebted')}
          style={{
            flex: 1,
            height: '28px',
            padding: '0 8px',
            borderRadius: '6px',
            border: activeFilterMode === 'indebted' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
            backgroundColor: activeFilterMode === 'indebted' ? '#170e5e' : '#f8fafc',
            color: activeFilterMode === 'indebted' ? '#ffffff' : '#475569',
            fontSize: '11px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          <span>{t('delivery_reps.van_collection_tab.s15', "المدينين فقط (")}{indebtedCustomers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode('all')}
          style={{
            flex: 1,
            height: '28px',
            padding: '0 8px',
            borderRadius: '6px',
            border: activeFilterMode === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
            backgroundColor: activeFilterMode === 'all' ? '#170e5e' : '#f8fafc',
            color: activeFilterMode === 'all' ? '#ffffff' : '#475569',
            fontSize: '11px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          <span>{t('delivery_reps.van_collection_tab.s16', "كل العملاء (")}{customers.length})</span>
        </button>
      </div>
    </div>
  );
}
