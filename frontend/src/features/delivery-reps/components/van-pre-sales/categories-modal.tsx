import React from 'react';
import { useTranslation } from 'react-i18next';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CheckCircleIcon, SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import type { PreSalesCatalogItem } from '../../api/van-sales.api';

export interface PreSalesCompanyCategory {
  id: number | null;
  name: string;
  count: number;
}

export interface CategoriesModalProps {
  allCategoriesModalOpen: boolean;
  setAllCategoriesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  categoryModalSearch: string;
  setCategoryModalSearch: React.Dispatch<React.SetStateAction<string>>;
  selectedCompany: string | null;
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  companyCategories: PreSalesCompanyCategory[];
  catalogProducts: PreSalesCatalogItem[];
}

export const CategoriesModal: React.FC<CategoriesModalProps> = ({
  allCategoriesModalOpen,
  setAllCategoriesModalOpen,
  categoryModalSearch,
  setCategoryModalSearch,
  selectedCompany,
  selectedCategory,
  setSelectedCategory,
  companyCategories,
  catalogProducts,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {/* 5. ALL CATEGORIES MODAL (BottomSheet Dialog) */}
      {allCategoriesModalOpen && (
        <StandardDialog
          open={allCategoriesModalOpen}
          onClose={() => setAllCategoriesModalOpen(false)}
          title={t('delivery_reps.van_pre_sales_tab.s81', "اختيار قسم المنتجات")}
          subtitle={`أقسام (${selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s82', "كافة الشركات") : selectedCompany}) • انقر لاختيار القسم وتصفية الأصناف فوراً`}
          badge={`${companyCategories.length} قسم`}
          width="min(520px, 95vw)"
          compact={true}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Search Input for categories if more than 5 */}
            {companyCategories.length > 5 && (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={categoryModalSearch}
                  onChange={(e) => setCategoryModalSearch(e.target.value)}
                  placeholder={t('delivery_reps.van_pre_sales_tab.s83', "ابحث عن قسم...")}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 32px 0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <div style={{ position: 'absolute', right: '9px', top: '9px', pointerEvents: 'none', color: '#94a3b8' }}>
                  <SearchIcon size={14} />
                </div>
                {categoryModalSearch && (
                  <button
                    type="button"
                    onClick={() => setCategoryModalSearch('')}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '8px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: 0,
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Grid of categories */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
                gap: '8px',
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '2px',
              }}
            >
              {/* Option: All Categories */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setAllCategoriesModalOpen(false);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: '3px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: selectedCategory === 'all' ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  backgroundColor: selectedCategory === 'all' ? '#eef2ff' : '#ffffff',
                  color: selectedCategory === 'all' ? '#170e5e' : '#0f172a',
                  cursor: 'pointer',
                  textAlign: 'right',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>{t('delivery_reps.van_pre_sales_tab.s84', "كافة الأقسام")}</span>
                  {selectedCategory === 'all' && <CheckCircleIcon size={13} color="#170e5e" />}
                </div>
                <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                  {selectedCompany === '__ALL__' ? catalogProducts.length : catalogProducts.filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.van_pre_sales_tab.s85', "الشركة العامة")) === selectedCompany).length} {t('delivery_reps.van_pre_sales_tab.s86', "صنف")}
                </span>
              </button>

              {/* Company Categories */}
              {companyCategories
                .filter((cat) => !categoryModalSearch.trim() || cat.name.toLowerCase().includes(categoryModalSearch.trim().toLowerCase()))
                .map((cat) => {
                  const isSelected = selectedCategory === cat.name;
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.name);
                        setAllCategoriesModalOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        gap: '3px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                        color: isSelected ? '#170e5e' : '#0f172a',
                        cursor: 'pointer',
                        textAlign: 'right',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontSize: '12px', fontWeight: isSelected ? 800 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cat.name}
                        </span>
                        {isSelected && <CheckCircleIcon size={13} color="#170e5e" />}
                      </div>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                        {cat.count} {t('delivery_reps.van_pre_sales_tab.s87', "صنف")}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
};
