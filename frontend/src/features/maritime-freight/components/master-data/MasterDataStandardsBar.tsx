import { useTranslation } from 'react-i18next';
import { AppIcons, XIcon } from '@/shared/components/icons/AppIcons';

export interface MasterDataStandardsBarProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  standardsSubCategory: 'containers' | 'incoterms' | 'terminals';
  setStandardsSubCategory: (value: 'containers' | 'incoterms' | 'terminals') => void;
  containerCategoryFilter: 'all' | 'dry' | 'reefer' | 'special';
  setContainerCategoryFilter: (value: 'all' | 'dry' | 'reefer' | 'special') => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

export function MasterDataStandardsBar({
  subTab,
  standardsSubCategory,
  setStandardsSubCategory,
  containerCategoryFilter,
  setContainerCategoryFilter,
  searchQuery,
  setSearchQuery,
}: MasterDataStandardsBarProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* شريط البحث وتصنيفات المواصفات القياسية */}
        {subTab === 'standards' && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              minHeight: '58px',
              boxSizing: 'border-box',
            }}
          >
            {/* أزرار التنقل بين الفئات القياسية */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('containers');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'containers' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'containers' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'containers' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Container size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s54', "مواصفات الحاويات (ISO Containers)")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('incoterms');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'incoterms' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'incoterms' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'incoterms' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.FileCheck size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s55', "شروط التجارة الدولية (Incoterms 2020)")}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStandardsSubCategory('terminals');
                  setSearchQuery('');
                }}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: standardsSubCategory === 'terminals' ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: standardsSubCategory === 'terminals' ? '#170e5e' : '#f8fafc',
                  color: standardsSubCategory === 'terminals' ? '#ffffff' : '#334155',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Building size={14} />
                <span>{__t('maritime_freight.maritime_master_data_tab.s56', "محطات الحاويات بالموانئ (Terminals)")}</span>
              </button>
            </div>

            {/* البحث وفلاتر الحاويات */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {standardsSubCategory === 'containers' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {[
                    { id: 'all', label: __t('maritime_freight.maritime_master_data_tab.s57', "الكل") },
                    { id: 'dry', label: __t('maritime_freight.maritime_master_data_tab.s58', "جافة (Dry)") },
                    { id: 'reefer', label: __t('maritime_freight.maritime_master_data_tab.s59', "مبردة (Reefer)") },
                    { id: 'special', label: __t('maritime_freight.maritime_master_data_tab.s60', "خاصة (Special)") },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setContainerCategoryFilter(cat.id as any)}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: containerCategoryFilter === cat.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: containerCategoryFilter === cat.id ? '#170e5e' : '#f8fafc',
                        color: containerCategoryFilter === cat.id ? '#ffffff' : '#475569',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ position: 'relative', width: '240px', maxWidth: '100%' }}>
                <input
                  type="text"
                  role="searchbox"
                  name="search_maritime_standards"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    standardsSubCategory === 'containers'
                      ? __t('maritime_freight.maritime_master_data_tab.s61', "بحث في الحاويات...")
                      : standardsSubCategory === 'incoterms'
                      ? __t('maritime_freight.maritime_master_data_tab.s62', "بحث في الـ Incoterms...")
                      : __t('maritime_freight.maritime_master_data_tab.s63', "بحث في محطات الموانئ...")
                  }
                  style={{
                    width: '100%',
                    height: '32px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: searchQuery ? '0 30px 0 26px' : '0 30px 0 8px',
                    fontSize: '0.78rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ position: 'absolute', right: '8px', top: '8px', color: '#94a3b8', pointerEvents: 'none' }}>
                  <AppIcons.Search size={14} />
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={__t('maritime_freight.maritime_master_data_tab.s64', "مسح البحث")}
                    style={{
                      position: 'absolute',
                      left: '6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px',
                      borderRadius: '50%',
                    }}
                  >
                    <XIcon size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
