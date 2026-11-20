import { useTranslation } from 'react-i18next';
import React, { useMemo, useRef } from 'react';
import {
  ArrowRightIcon,
  BoxesIcon,
  BuildingIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';
import {
  PreSalesCatalogItem,
} from '../../api/van-sales.api';
import type { PreSalesCartLine } from './van-pre-sales-types';

export interface PreSalesCompanyCategory {
  id: number | null;
  name: string;
  count: number;
}

export interface PreSalesCompany {
  name: string;
  totalProducts: number;
  availableProducts: number;
  categories: PreSalesCompanyCategory[];
}

export interface SearchResultsProps {
  searchCatalogQuery: string;
  setSearchCatalogQuery: React.Dispatch<React.SetStateAction<string>>;
  showOutOfStock: boolean;
  setShowOutOfStock: React.Dispatch<React.SetStateAction<boolean>>;
  hideOutOfStockCompanies: boolean;
  setHideOutOfStockCompanies: React.Dispatch<React.SetStateAction<boolean>>;
  selectedCompany: string | null;
  setSelectedCompany: React.Dispatch<React.SetStateAction<string | null>>;
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  setAllCategoriesModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCategoryModalSearch: React.Dispatch<React.SetStateAction<string>>;
  cart: PreSalesCartLine[];
  catalogProducts: PreSalesCatalogItem[];
  companies: PreSalesCompany[];
  companyCategories: PreSalesCompanyCategory[];
  renderProductsList: (products: PreSalesCatalogItem[]) => React.ReactNode;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  searchCatalogQuery,
  setSearchCatalogQuery,
  showOutOfStock,
  setShowOutOfStock,
  hideOutOfStockCompanies,
  setHideOutOfStockCompanies,
  selectedCompany,
  setSelectedCompany,
  selectedCategory,
  setSelectedCategory,
  setAllCategoriesModalOpen,
  setCategoryModalSearch,
  cart,
  catalogProducts,
  companies,
  companyCategories,
  renderProductsList,
}) => {
  const { t } = useTranslation();

  // Horizontal categories drag-to-scroll & mouse wheel ref
  const categoriesScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingCatRef = useRef(false);
  const startXCatRef = useRef(0);
  const scrollLeftCatRef = useRef(0);

  const handleCatMouseDown = (e: React.MouseEvent) => {
    if (!categoriesScrollRef.current) return;
    isDraggingCatRef.current = true;
    startXCatRef.current = e.pageX - categoriesScrollRef.current.offsetLeft;
    scrollLeftCatRef.current = categoriesScrollRef.current.scrollLeft;
  };

  const handleCatMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingCatRef.current || !categoriesScrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - categoriesScrollRef.current.offsetLeft;
    const walk = (x - startXCatRef.current) * 1.5;
    categoriesScrollRef.current.scrollLeft = scrollLeftCatRef.current - walk;
  };

  const handleCatMouseUpOrLeave = () => {
    isDraggingCatRef.current = false;
  };

  // Filtered companies based on hideOutOfStockCompanies
  const displayedCompanies = useMemo(() => {
    if (!hideOutOfStockCompanies) return companies;
    return companies.filter((c) => c.availableProducts > 0);
  }, [companies, hideOutOfStockCompanies]);

  // Map of company name -> distinct items count in cart
  const cartCompanyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      const prod = catalogProducts.find((p) => p.id === item.productId);
      const comp = (prod?.supplierName || '').trim() || 'الشركة العامة';
      map.set(comp, (map.get(comp) || 0) + 1);
    }
    return map;
  }, [cart, catalogProducts]);

  // Filter Catalog
  const displayedProducts = useMemo(() => {
    return catalogProducts.filter((p) => {
      // Out of stock filter
      if (!showOutOfStock && p.warehouseAvailable <= 0) return false;

      // If user typed in search bar: search takes priority
      if (searchCatalogQuery.trim()) {
        const q = searchCatalogQuery.toLowerCase().trim();
        const matchName = (p.name || '').toLowerCase().includes(q);
        const matchBarcode = (p.barcode || '').toLowerCase().includes(q);
        const matchCompany = (p.supplierName || '').toLowerCase().includes(q);
        return matchName || matchBarcode || matchCompany;
      }

      // If user is inside a company: filter by company & category
      if (selectedCompany) {
        if (selectedCompany !== '__ALL__') {
          const compName = (p.supplierName || '').trim() || 'الشركة العامة';
          if (compName !== selectedCompany) return false;
        }

        if (selectedCategory !== 'all') {
          const catName = (p.categoryName || '').trim() || 'عام';
          if (catName !== selectedCategory) return false;
        }
        return true;
      }

      return true;
    });
  }, [catalogProducts, searchCatalogQuery, selectedCompany, selectedCategory, showOutOfStock]);

  const availableItemsCount = useMemo(() => {
    return catalogProducts.filter((p) => p.warehouseAvailable > 0).length;
  }, [catalogProducts]);

  const outOfStockCount = useMemo(() => {
    return catalogProducts.length - availableItemsCount;
  }, [catalogProducts, availableItemsCount]);

  return (
    <>
          {/* COMPANY / CATALOG WORKFLOW */}
          {searchCatalogQuery.trim() ? (
            /* SEARCH RESULTS VIEW */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', fontSize: '11.5px' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>
                  {t('delivery_reps.van_pre_sales_tab.s16', "نتائج البحث: (")}{displayedProducts.length} {t('delivery_reps.van_pre_sales_tab.s17', "صنف)")}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {outOfStockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowOutOfStock((prev) => !prev)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: showOutOfStock ? '#170e5e' : '#64748b',
                        fontWeight: 700,
                        fontSize: '11px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {showOutOfStock ? t('delivery_reps.van_pre_sales_tab.s18', "إخفاء غير المتوفر") : `غير المتوفر (${outOfStockCount})`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchCatalogQuery('')}
                    style={{ background: 'none', border: 'none', color: '#170e5e', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s19', "العودة لتصفح الشركات")}
                  </button>
                </div>
              </div>

              {renderProductsList(displayedProducts)}
            </div>
          ) : !selectedCompany ? (
            /* COMPANIES GRID VIEW (DEFAULT) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                    {t('delivery_reps.van_pre_sales_tab.s20', "شركات وموردي البضاعة (")}{companies.length})
                  </span>
                </div>
                {companies.some((c) => c.availableProducts === 0) && (
                  <button
                    type="button"
                    onClick={() => setHideOutOfStockCompanies((prev) => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: hideOutOfStockCompanies ? '#170e5e' : '#64748b',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {hideOutOfStockCompanies ? t('delivery_reps.van_pre_sales_tab.s21', "عرض كل الشركات") : t('delivery_reps.van_pre_sales_tab.s22', "المتوفر فقط")}
                  </button>
                )}
              </div>

              {displayedCompanies.length === 0 ? (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  {t('delivery_reps.van_pre_sales_tab.s23', "لا توجد شركات مطابقة بالمخزن حالياً")}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {/* ALL PRODUCTS MASTER CARD */}
                  <div
                    onClick={() => {
                      setSelectedCompany('__ALL__');
                      setSelectedCategory('all');
                    }}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1.5px solid #170e5e',
                      borderRadius: '12px',
                      padding: '9px 8px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: '0 1px 3px rgba(23,14,94,0.06)',
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '9px',
                        backgroundColor: '#170e5e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                      }}
                    >
                      <BoxesIcon size={16} />
                    </div>

                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: '11.5px',
                        color: '#170e5e',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={t('delivery_reps.van_pre_sales_tab.s24', "كافة أصناف المخزن")}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s25', "كافة الأصناف")}
                    </span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: availableItemsCount > 0 ? '#047857' : '#94a3b8',
                          backgroundColor: availableItemsCount > 0 ? '#ecfdf5' : '#f1f5f9',
                          border: `1px solid ${availableItemsCount > 0 ? '#a7f3d0' : '#e2e8f0'}`,
                          padding: '1px 7px',
                          borderRadius: '10px',
                        }}
                      >
                        {availableItemsCount > 0 ? `${availableItemsCount} صنف متاح` : `${catalogProducts.length} صنف`}
                      </span>
                      {cart.length > 0 && (
                        <span
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 800,
                            color: '#170e5e',
                            backgroundColor: '#e0e7ff',
                            border: '1px solid #c7d2fe',
                            padding: '1px 5px',
                            borderRadius: '10px',
                          }}
                        >
                          {cart.length} {t('delivery_reps.van_pre_sales_tab.s26', "بالسلة")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* INDIVIDUAL COMPANY CARDS */}
                  {displayedCompanies.map((comp) => {
                    const inCartCount = cartCompanyCounts.get(comp.name) || 0;
                    return (
                      <div
                        key={comp.name}
                        onClick={() => {
                          setSelectedCompany(comp.name);
                          setSelectedCategory('all');
                        }}
                        style={{
                          backgroundColor: inCartCount > 0 ? '#fbfbfe' : '#ffffff',
                          border: inCartCount > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '9px 8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '9px',
                            backgroundColor: '#eef2ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#170e5e',
                          }}
                        >
                          <BuildingIcon size={16} />
                        </div>

                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: '11.5px',
                            color: '#0f172a',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={comp.name}
                        >
                          {comp.name}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: comp.availableProducts > 0 ? '#047857' : '#94a3b8',
                              backgroundColor: comp.availableProducts > 0 ? '#ecfdf5' : '#f1f5f9',
                              border: `1px solid ${comp.availableProducts > 0 ? '#a7f3d0' : '#e2e8f0'}`,
                              padding: '1px 7px',
                              borderRadius: '10px',
                            }}
                          >
                            {comp.availableProducts > 0 ? `${comp.availableProducts} صنف متاح` : t('delivery_reps.van_pre_sales_tab.s27', "نفد الرصيد")}
                          </span>
                          {inCartCount > 0 && (
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 800,
                                color: '#170e5e',
                                backgroundColor: '#e0e7ff',
                                border: '1px solid #c7d2fe',
                                padding: '1px 5px',
                                borderRadius: '10px',
                              }}
                            >
                              {inCartCount} {t('delivery_reps.van_pre_sales_tab.s28', "بالسلة")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* SELECTED COMPANY VIEW: HORIZONTAL CATEGORIES BAR & PRODUCTS */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* COMPANY HEADER WITH BACK BUTTON */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '7px 10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCompany(null);
                      setSelectedCategory('all');
                    }}
                    style={{
                      height: '28px',
                      padding: '0 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f8fafc',
                      color: '#170e5e',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    title={t('delivery_reps.van_pre_sales_tab.s29', "الرجوع لقائمة الشركات")}
                  >
                    <ArrowRightIcon size={13} />
                    <span>{t('delivery_reps.van_pre_sales_tab.s30', "الشركات")}</span>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 800,
                        color: '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s31', "كافة أصناف المخزن") : selectedCompany || ''}
                    >
                      {selectedCompany === '__ALL__' ? t('delivery_reps.van_pre_sales_tab.s32', "كافة أصناف المخزن") : selectedCompany}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#170e5e',
                        fontWeight: 700,
                        backgroundColor: '#eef2ff',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {displayedProducts.length} {t('delivery_reps.van_pre_sales_tab.s33', "صنف")}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {outOfStockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowOutOfStock((prev) => !prev)}
                      style={{
                        height: '26px',
                        padding: '0 8px',
                        borderRadius: '6px',
                        border: showOutOfStock ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
                        backgroundColor: showOutOfStock ? '#e0e7ff' : '#f8fafc',
                        color: showOutOfStock ? '#170e5e' : '#64748b',
                        fontWeight: 700,
                        fontSize: '10.5px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      {showOutOfStock ? t('delivery_reps.van_pre_sales_tab.s34', "إخفاء غير المتوفر") : `غير المتوفر (${outOfStockCount})`}
                    </button>
                  )}
                </div>
              </div>

              {/* HORIZONTAL CATEGORIES BAR - HYBRID SWIPEABLE & MODAL ACCESS */}
              <div
                ref={categoriesScrollRef}
                onMouseDown={handleCatMouseDown}
                onMouseMove={handleCatMouseMove}
                onMouseUp={handleCatMouseUpOrLeave}
                onMouseLeave={handleCatMouseUpOrLeave}
                onWheel={(e) => {
                  if (e.deltaY !== 0 && categoriesScrollRef.current) {
                    categoriesScrollRef.current.scrollLeft += e.deltaY;
                  }
                }}
                style={{
                  display: 'flex',
                  gap: '6px',
                  overflowX: 'auto',
                  padding: '2px 0 6px',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                  cursor: isDraggingCatRef.current ? 'grabbing' : 'grab',
                  userSelect: 'none',
                }}
              >
                {/* 1. All Categories Button */}
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    borderRadius: '14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    border: selectedCategory === 'all' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    backgroundColor: selectedCategory === 'all' ? '#170e5e' : '#ffffff',
                    color: selectedCategory === 'all' ? '#ffffff' : '#475569',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: 0,
                  }}
                >
                  <span>{t('delivery_reps.van_pre_sales_tab.s35', "الكل")}</span>
                  <span style={{ opacity: selectedCategory === 'all' ? 0.9 : 0.7, fontSize: '10px' }}>
                    ({selectedCompany === '__ALL__' ? catalogProducts.length : catalogProducts.filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.van_pre_sales_tab.s36', "الشركة العامة")) === selectedCompany).length})
                  </span>
                </button>

                {/* 2. Show All Categories Modal Trigger Button */}
                {companyCategories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryModalSearch('');
                      setAllCategoriesModalOpen(true);
                    }}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: '1px solid #c7d2fe',
                      backgroundColor: '#eef2ff',
                      color: '#170e5e',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      flexShrink: 0,
                    }}
                    title={t('delivery_reps.van_pre_sales_tab.s37', "فتح نافذة تصفح كافة الأقسام")}
                  >
                    <SlidersIcon size={12} color="#170e5e" />
                    <span>{t('delivery_reps.van_pre_sales_tab.s38', "كافة الأقسام (")}{companyCategories.length})</span>
                  </button>
                )}

                {/* 3. Horizontal Category Pills */}
                {companyCategories.map((cat) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setSelectedCategory(cat.name)}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: selectedCategory === cat.name ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: selectedCategory === cat.name ? '#170e5e' : '#ffffff',
                      color: selectedCategory === cat.name ? '#ffffff' : '#475569',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                    }}
                  >
                    <bdi>{cat.name}</bdi>
                    <span style={{ opacity: selectedCategory === cat.name ? 0.9 : 0.7, fontSize: '10px' }}>
                      ({cat.count})
                    </span>
                  </button>
                ))}
              </div>

              {/* PRODUCTS LIST */}
              {renderProductsList(displayedProducts)}
            </div>
          )}
    </>
  );
};
