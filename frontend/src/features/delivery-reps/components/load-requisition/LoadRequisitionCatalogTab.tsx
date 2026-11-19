import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowRightIcon, BoxesIcon, BuildingIcon, SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import type { DriverAvailableProduct } from '../../hooks/useDriverLoadRequisition';
import type { RequisitionLineItem } from './LoadRequisitionTypes';
import { LoadRequisitionProductList } from './LoadRequisitionProductList';

export interface LoadRequisitionCategorySummary {
  id: number | null;
  name: string;
  count: number;
}

export interface LoadRequisitionCompanySummary {
  name: string;
  totalProducts: number;
  availableProducts: number;
  categories: LoadRequisitionCategorySummary[];
}

export interface LoadRequisitionCatalogTabProps {
  activeViewTab: 'catalog' | 'selected';
  catalogSearchQuery: string;
  setCatalogSearchQuery: Dispatch<SetStateAction<string>>;
  selectedCompany: string | null;
  setSelectedCompany: Dispatch<SetStateAction<string | null>>;
  selectedCategory: string;
  setSelectedCategory: Dispatch<SetStateAction<string>>;
  showOutOfStock: boolean;
  setShowOutOfStock: Dispatch<SetStateAction<boolean>>;
  hideOutOfStockCompanies: boolean;
  setHideOutOfStockCompanies: Dispatch<SetStateAction<boolean>>;
  companies: LoadRequisitionCompanySummary[];
  displayedCompanies: LoadRequisitionCompanySummary[];
  companyCategories: LoadRequisitionCategorySummary[];
  linesCompanyCounts: Map<string, number>;
  totalAvailableItemsCount: number;
  outOfStockCount: number;
  distinctItemsCount: number;
  availableProducts: DriverAvailableProduct[];
  displayedProducts: DriverAvailableProduct[];
  lines: RequisitionLineItem[];
  isMobile: boolean;
  handleUpdateProductUnits: (
    product: DriverAvailableProduct,
    targetCartons: number,
    targetPieces: number,
  ) => void;
  handleCatalogAdd: (product: DriverAvailableProduct) => void;
  handleCartonIncrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handleCartonDecrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handlePieceIncrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handlePieceDecrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handleSingleIncrement: (product: DriverAvailableProduct, currentQty: number) => void;
  handleSingleDecrement: (product: DriverAvailableProduct, currentQty: number) => void;
}

export function LoadRequisitionCatalogTab({
  activeViewTab,
  catalogSearchQuery,
  setCatalogSearchQuery,
  selectedCompany,
  setSelectedCompany,
  selectedCategory,
  setSelectedCategory,
  showOutOfStock,
  setShowOutOfStock,
  hideOutOfStockCompanies,
  setHideOutOfStockCompanies,
  companies,
  displayedCompanies,
  companyCategories,
  linesCompanyCounts,
  totalAvailableItemsCount,
  outOfStockCount,
  distinctItemsCount,
  availableProducts,
  displayedProducts,
  lines,
  isMobile,
  handleUpdateProductUnits,
  handleCatalogAdd,
  handleCartonIncrement,
  handleCartonDecrement,
  handlePieceIncrement,
  handlePieceDecrement,
  handleSingleIncrement,
  handleSingleDecrement,
}: LoadRequisitionCatalogTabProps) {
  const { t } = useTranslation();

  return (
    <>
        {/* TAB 1: CATALOG VIEW (Orders-style Browsing & Instant Steppers) */}
        {activeViewTab === 'catalog' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* SEARCH INPUT */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder={t('delivery_reps.driver_new_load_requisition_view.s61', "ابحث بالاسم أو الباركود في كافة المخزن...")}
                value={catalogSearchQuery}
                onChange={(e) => setCatalogSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: '38px',
                  padding: catalogSearchQuery ? '0 32px 0 32px' : '0 32px 0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  boxSizing: 'border-box',
                  backgroundColor: '#ffffff',
                  outline: 'none',
                }}
              />
              <SearchIcon
                size={15}
                color="#94a3b8"
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
              />
              {catalogSearchQuery && (
                <button
                  type="button"
                  onClick={() => setCatalogSearchQuery('')}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748b',
                    padding: 0,
                  }}
                  title={t('delivery_reps.driver_new_load_requisition_view.s62', "مسح البحث")}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* CATALOG WORKFLOW */}
            {catalogSearchQuery.trim() ? (
              /* SEARCH RESULTS VIEW */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', fontSize: '11.5px' }}>
                  <span style={{ color: '#475569', fontWeight: 700 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s63', "نتائج البحث: (")}{displayedProducts.length} {t('delivery_reps.driver_new_load_requisition_view.s64', "صنف)")}
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
                        {showOutOfStock ? t('delivery_reps.driver_new_load_requisition_view.s65', "إخفاء غير المتوفر") : `عرض غير المتوفر (${outOfStockCount})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCatalogSearchQuery('')}
                      style={{ background: 'none', border: 'none', color: '#170e5e', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      {t('delivery_reps.driver_new_load_requisition_view.s66', "العودة لتصفح الشركات")}
                    </button>
                  </div>
                </div>

                <LoadRequisitionProductList
                  items={displayedProducts}
                  lines={lines}
                  handleUpdateProductUnits={handleUpdateProductUnits}
                  handleCatalogAdd={handleCatalogAdd}
                  handleCartonIncrement={handleCartonIncrement}
                  handleCartonDecrement={handleCartonDecrement}
                  handlePieceIncrement={handlePieceIncrement}
                  handlePieceDecrement={handlePieceDecrement}
                  handleSingleIncrement={handleSingleIncrement}
                  handleSingleDecrement={handleSingleDecrement}
                  isMobile={isMobile}
                  outOfStockCount={outOfStockCount}
                  showOutOfStock={showOutOfStock}
                  setShowOutOfStock={setShowOutOfStock}
                />
              </div>
            ) : !selectedCompany ? (
              /* COMPANIES GRID VIEW (DEFAULT) */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      {t('delivery_reps.driver_new_load_requisition_view.s67', "شركات وموردي البضاعة (")}{companies.length})
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
                      {hideOutOfStockCompanies ? t('delivery_reps.driver_new_load_requisition_view.s68', "عرض كل الشركات") : t('delivery_reps.driver_new_load_requisition_view.s69', "المتوفر فقط")}
                    </button>
                  )}
                </div>

                {displayedCompanies.length === 0 ? (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s70', "لا توجد شركات مطابقة بالمخزن حالياً")}
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
                        title={t('delivery_reps.driver_new_load_requisition_view.s71', "كافة أصناف المخزن")}
                      >
                        {t('delivery_reps.driver_new_load_requisition_view.s72', "كافة الأصناف")}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: totalAvailableItemsCount > 0 ? '#15803d' : '#94a3b8',
                            backgroundColor: totalAvailableItemsCount > 0 ? '#ecfdf5' : '#f1f5f9',
                            border: `1px solid ${totalAvailableItemsCount > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                            padding: '1px 6px',
                            borderRadius: '10px',
                          }}
                        >
                          {totalAvailableItemsCount > 0 ? `${totalAvailableItemsCount} صنف متاح` : `${(availableProducts || []).length} صنف`}
                        </span>
                        {distinctItemsCount > 0 && (
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
                            {distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s73', "بالطلب")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* INDIVIDUAL COMPANY CARDS */}
                    {displayedCompanies.map((comp) => {
                      const inReqCount = linesCompanyCounts.get(comp.name) || 0;
                      return (
                        <div
                          key={comp.name}
                          onClick={() => {
                            setSelectedCompany(comp.name);
                            setSelectedCategory('all');
                          }}
                          style={{
                            backgroundColor: inReqCount > 0 ? '#fbfbfe' : '#ffffff',
                            border: inReqCount > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
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
                                backgroundColor: comp.availableProducts > 0 ? '#f0fdf4' : '#f1f5f9',
                                border: `1px solid ${comp.availableProducts > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                                padding: '1px 6px',
                                borderRadius: '10px',
                              }}
                            >
                              {comp.availableProducts > 0 ? `${comp.availableProducts} صنف متاح` : t('delivery_reps.driver_new_load_requisition_view.s74', "نفد الرصيد")}
                            </span>
                            {inReqCount > 0 && (
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
                                {inReqCount} {t('delivery_reps.driver_new_load_requisition_view.s75', "بالطلب")}
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
                      title={t('delivery_reps.driver_new_load_requisition_view.s76', "الرجوع لقائمة الشركات")}
                    >
                      <ArrowRightIcon size={13} />
                      <span>{t('delivery_reps.driver_new_load_requisition_view.s77', "الشركات")}</span>
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
                        title={selectedCompany === '__ALL__' ? t('delivery_reps.driver_new_load_requisition_view.s78', "كافة أصناف المخزن") : selectedCompany || ''}
                      >
                        {selectedCompany === '__ALL__' ? t('delivery_reps.driver_new_load_requisition_view.s79', "كافة أصناف المخزن") : selectedCompany}
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
                        {displayedProducts.length} {t('delivery_reps.driver_new_load_requisition_view.s80', "صنف")}
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
                          border: showOutOfStock ? '1px solid #c7d2fe' : '1px solid #cbd5e1',
                          backgroundColor: showOutOfStock ? '#e0e7ff' : '#f8fafc',
                          color: showOutOfStock ? '#170e5e' : '#475569',
                          fontWeight: 700,
                          fontSize: '10.5px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        {showOutOfStock ? t('delivery_reps.driver_new_load_requisition_view.s81', "إخفاء غير المتوفر") : `عرض غير المتوفر (${outOfStockCount})`}
                      </button>
                    )}
                  </div>
                </div>

                {/* HORIZONTAL CATEGORIES BAR (DEFAULT IS 'all') */}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    overflowX: 'auto',
                    padding: '1px 0 4px',
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
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
                    <span>{t('delivery_reps.driver_new_load_requisition_view.s82', "الكل")}</span>
                    <span style={{ opacity: selectedCategory === 'all' ? 0.9 : 0.7, fontSize: '10px' }}>
                      ({selectedCompany === '__ALL__' ? (availableProducts || []).length : (availableProducts || []).filter((p) => ((p.supplierName || '').trim() || t('delivery_reps.driver_new_load_requisition_view.s83', "الشركة العامة")) === selectedCompany).length})
                    </span>
                  </button>

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
                <LoadRequisitionProductList
                  items={displayedProducts}
                  lines={lines}
                  handleUpdateProductUnits={handleUpdateProductUnits}
                  handleCatalogAdd={handleCatalogAdd}
                  handleCartonIncrement={handleCartonIncrement}
                  handleCartonDecrement={handleCartonDecrement}
                  handlePieceIncrement={handlePieceIncrement}
                  handlePieceDecrement={handlePieceDecrement}
                  handleSingleIncrement={handleSingleIncrement}
                  handleSingleDecrement={handleSingleDecrement}
                  isMobile={isMobile}
                  outOfStockCount={outOfStockCount}
                  showOutOfStock={showOutOfStock}
                  setShowOutOfStock={setShowOutOfStock}
                />
              </div>
            )}
          </div>
        )}

    </>
  );
}
