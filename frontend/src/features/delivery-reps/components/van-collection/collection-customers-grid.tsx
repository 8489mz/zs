import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CheckCircleIcon, CreditCardIcon, MapPinIcon, PhoneIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { CustomerOption } from './van-collection-types';

export interface CollectionCustomersGridProps {
  activeFilterMode: 'indebted' | 'all';
  collectionSearch: string;
  displayCustomers: CustomerOption[];
  handleSelectCustomerForCollection: (c: CustomerOption) => void;
  indebtedCustomers: CustomerOption[];
  selectedCustomer: CustomerOption | null;
  setFilterMode: Dispatch<SetStateAction<'indebted' | 'all'>>;
}

export function CollectionCustomersGrid({
  activeFilterMode,
  collectionSearch,
  displayCustomers,
  handleSelectCustomerForCollection,
  indebtedCustomers,
  selectedCustomer,
  setFilterMode,
}: CollectionCustomersGridProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
            {activeFilterMode === 'indebted' ? t('delivery_reps.van_collection_tab.s28', "العملاء المطلوب تحصيلهم") : t('delivery_reps.van_collection_tab.s29', "كافة عملاء خط السير")}
          </span>
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 800,
              backgroundColor: '#eef2ff',
              color: '#170e5e',
              padding: '1px 6px',
              borderRadius: '4px',
              border: '1px solid #c7d2fe',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {displayCustomers.length}
          </span>
        </div>
        <span style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {t('delivery_reps.van_collection_tab.s30', "مرتبة بالأعلى مديونية")}
        </span>
      </div>

      {displayCustomers.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '24px 16px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
            <CheckCircleIcon size={32} color="#170e5e" />
          </div>
          <h4 style={{ margin: '0 0 4px', fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
            {collectionSearch
              ? t('delivery_reps.van_collection_tab.s31', "لا توجد نتائج مطابقة لبحثك")
              : activeFilterMode === 'indebted'
              ? t('delivery_reps.van_collection_tab.s32', "لا توجد أي مديونيات مستحقة على عملاء خط السير حالياً")
              : t('delivery_reps.van_collection_tab.s33', "لا يوجد عملاء مسجلين بالخط")}
          </h4>
          <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>
            {activeFilterMode === 'indebted' && indebtedCustomers.length === 0 ? (
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                style={{
                  marginTop: '6px',
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  color: '#170e5e',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_collection_tab.s34', "عرض كل العملاء لتسجيل دفعات نقدية مقدمة")}
              </button>
            ) : collectionSearch ? (
              t('delivery_reps.van_collection_tab.s35', "جرب البحث بكلمة أخرى أو اضغط على إلغاء البحث")
            ) : null}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '10px',
            paddingBottom: '24px',
          }}
        >
          {displayCustomers.map((c, idx) => {
            const isSelected = selectedCustomer?.id === c.id;
            const hasDebt = c.balance > 0;
            const isCredit = c.balance < 0;

            return (
              <div
                key={c.id}
                style={{
                  backgroundColor: '#ffffff',
                  border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  borderRadius: '9px',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  boxShadow: isSelected ? '0 2px 8px rgba(23, 14, 94, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Row 1: [#1] Store Name [Code] on Right, Balance on Left */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        background: hasDebt ? '#fee2e2' : '#f1f5f9',
                        color: hasDebt ? '#991b1b' : '#475569',
                        border: hasDebt ? '1px solid #fecaca' : '1px solid #e2e8f0',
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: '#0f172a',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.25,
                      }}
                      title={c.name}
                    >
                      {c.name}
                    </span>
                    {c.customerCode && (
                      <span style={{ fontSize: '9.5px', color: '#64748b', fontFamily: 'monospace', fontWeight: 700, backgroundColor: '#f8fafc', padding: '1px 4px', borderRadius: '3px', border: '1px solid #e2e8f0', flexShrink: 0 }}>
                        [{c.customerCode.replace(/^#/, '')}]
                      </span>
                    )}
                  </div>

                  {/* Financial Status on Left */}
                  <div style={{ flexShrink: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
                      {hasDebt ? t('delivery_reps.van_collection_tab.s36', "مطلوب:") : isCredit ? t('delivery_reps.van_collection_tab.s37', "دائن:") : t('delivery_reps.van_collection_tab.s38', "خالص:")}
                    </span>
                    <strong style={{ fontSize: '12.5px', color: hasDebt ? '#991b1b' : isCredit ? '#0369a1' : '#0f172a', fontWeight: 900 }}>
                      {hasDebt
                        ? `${c.balance.toFixed(2)} `
                        : isCredit
                        ? `${Math.abs(c.balance).toFixed(2)}- `
                        : '0.00 '}
                      <CurrencySymbol />
                    </strong>
                  </div>
                </div>

                {/* Row 2: Metadata (Route, Phone, Map) on Right, Action Button on Left */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: '1px dashed #f1f5f9', paddingTop: '5px' }}>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', fontSize: '10px', minWidth: 0, flex: 1 }}>
                    {c.route && (
                      <span
                        style={{
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #e2e8f0',
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          maxWidth: '130px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={c.route}
                      >
                        <MapPinIcon size={9} color="#64748b" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.route}</span>
                      </span>
                    )}
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          color: '#475569',
                          textDecoration: 'none',
                          fontSize: '10px',
                          direction: 'ltr',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        <PhoneIcon size={9} color="#64748b" />
                        <span>{c.phone}</span>
                      </a>
                    )}
                    {c.locationUrl && (
                      <a
                        href={c.locationUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          color: '#475569',
                          fontSize: '10px',
                          textDecoration: 'none',
                          fontWeight: 600,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '1px 5px',
                          borderRadius: '4px',
                        }}
                      >
                        <span>{t('delivery_reps.van_collection_tab.s39', "خريطة ↗")}</span>
                      </a>
                    )}
                  </div>

                  {/* Action Button on Left of Row 2 */}
                  <button
                    type="button"
                    onClick={() => handleSelectCustomerForCollection(c)}
                    style={{
                      height: '27px',
                      padding: '0 9px',
                      border: isSelected ? '1.5px solid #170e5e' : !hasDebt ? '1px solid #cbd5e1' : 'none',
                      borderRadius: '6px',
                      backgroundColor: isSelected ? '#eef2ff' : hasDebt ? '#170e5e' : '#f8fafc',
                      color: isSelected ? '#170e5e' : hasDebt ? '#ffffff' : '#170e5e',
                      fontWeight: 700,
                      fontSize: '10.5px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {isSelected ? (
                      <>
                        <CheckCircleIcon size={12} color="#170e5e" />
                        <span>{t('delivery_reps.van_collection_tab.s40', "محدد أعلاه")}</span>
                      </>
                    ) : hasDebt ? (
                      <>
                        <CreditCardIcon size={12} color="#ffffff" />
                        <span>{t('delivery_reps.van_collection_tab.s41', "تحصيل نقدية")}</span>
                      </>
                    ) : (
                      <>
                        <CreditCardIcon size={12} color="#170e5e" />
                        <span>{t('delivery_reps.van_collection_tab.s42', "+ دفعة نقدية")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
