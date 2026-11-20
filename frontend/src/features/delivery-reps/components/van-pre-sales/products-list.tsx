import React from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { PlusIcon } from '@/shared/components/icons/AppIcons';
import { CompactStepper } from './compact-stepper';
import { calculateItemPrice } from './calculate-item-price';
import type { PreSalesCatalogItem } from '../../api/van-sales.api';
import type { PreSalesCartLine } from './van-pre-sales-types';

/**
 * Helper function to render a list of products with dual Carton & Piece steppers.
 */
export interface ProductsListProps {
  products: PreSalesCatalogItem[];
  cart: PreSalesCartLine[];
  paymentTerms: 'cash' | 'credit';
  selectedCompany: string | null;
  isCatalogLoading: boolean;
  handleUpdateProductUnits: (
    product: PreSalesCatalogItem,
    targetCartons: number,
    targetPieces: number,
  ) => void;
}

export const ProductsList: React.FC<ProductsListProps> = ({
  products,
  cart,
  paymentTerms,
  selectedCompany,
  isCatalogLoading,
  handleUpdateProductUnits,
}) => {
  const { t } = useTranslation();
  if (isCatalogLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        {t('delivery_reps.van_pre_sales_tab.s95', "جاري جلب رصيد المخزن الرئيسي والأسعار...")}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        {t('delivery_reps.van_pre_sales_tab.s96', "لا توجد أصناف مطابقة في هذا القسم بالمخزن الرئيسي")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {products.map((prod) => {
        const isOutOfStock = prod.warehouseAvailable <= 0;
        const pricing = calculateItemPrice(prod, paymentTerms, 1, 1);
        const mult = prod.packagingUnit?.multiplier || 1;
        const isCartonItem = Boolean(prod.packagingUnit && mult > 1);

        // Get current selected quantities from cart
        const cartItem = cart.find((l) => l.productId === prod.id);
        const currentCartons = cartItem?.cartons || 0;
        const currentPieces = isCartonItem ? (cartItem?.pieces || 0) : (cartItem?.quantity || 0);
        const totalChosen = cartItem?.quantity || 0;

        // Available in cartons breakdown
        const availCartons = isCartonItem ? Math.floor(prod.warehouseAvailable / mult) : 0;
        const availPieces = isCartonItem ? prod.warehouseAvailable % mult : prod.warehouseAvailable;

        const lineTotal = isCartonItem
          ? currentCartons * (pricing.effectivePrice * mult) + currentPieces * pricing.effectivePrice
          : totalChosen * pricing.effectivePrice;

        return (
          <div
            key={prod.id}
            style={{
              border: totalChosen > 0 ? '1.5px solid #a5b4fc' : '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '8px 10px',
              backgroundColor: isOutOfStock && totalChosen === 0 ? '#f8fafc' : totalChosen > 0 ? '#fafbff' : '#ffffff',
              opacity: isOutOfStock && totalChosen === 0 ? 0.65 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              boxShadow: totalChosen > 0 ? '0 1px 4px rgba(99, 102, 241, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            {/* Row 1: Product Name, Pack Unit Pill, Barcode */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: '12px', color: '#0f172a', lineHeight: 1.3 }}>
                    {prod.name}
                  </span>
                  {isCartonItem && (
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: '#3730a3',
                        backgroundColor: '#eef2ff',
                        border: '1px solid #c7d2fe',
                        padding: '0.5px 5px',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s97', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s98', "ق)")}
                    </span>
                  )}
                </div>

                {/* Subtitle: Supplier & Category in a tight single line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#64748b' }}>
                  {selectedCompany === '__ALL__' && prod.supplierName && (
                    <>
                      <span style={{ whiteSpace: 'nowrap' }}>{prod.supplierName}</span>
                      <span>•</span>
                    </>
                  )}
                  {prod.categoryName && <span style={{ whiteSpace: 'nowrap' }}>{prod.categoryName}</span>}
                </div>
              </div>

              {prod.barcode ? (
                <span
                  style={{
                    fontSize: '9.5px',
                    color: '#64748b',
                    fontFamily: 'monospace',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {prod.barcode}
                </span>
              ) : null}
            </div>

            {/* Row 2: Price & Available Stock (Single Balanced Row) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
              {/* Price block */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                <span style={{ color: '#170e5e', fontWeight: 900, fontSize: '12.5px' }}>
                  {pricing.effectivePrice.toFixed(2)} <CurrencySymbol />
                  <span style={{ fontSize: '10px', fontWeight: 500, color: '#64748b' }}> {t('delivery_reps.van_pre_sales_tab.s99', "/ ق")}</span>
                </span>

                {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                  <span style={{ fontSize: '10px', color: '#94a3b8', textDecoration: 'line-through' }}>
                    {pricing.listPrice.toFixed(2)}
                  </span>
                )}

                {paymentTerms === 'cash' && pricing.cashDiscountPerUnit > 0 && (
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      color: '#059669',
                      backgroundColor: '#dcfce7',
                      border: '1px solid #86efac',
                      padding: '0.5px 5px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s100', "وفر")} {pricing.cashDiscountPerUnit.toFixed(2)} {t('delivery_reps.van_pre_sales_tab.s101', "كاش")}
                  </span>
                )}

                {paymentTerms === 'credit' && (
                  <span style={{ color: '#b45309', fontSize: '9.5px', fontWeight: 700, backgroundColor: '#fef3c7', padding: '1px 5px', borderRadius: '4px' }}>
                    {t('delivery_reps.van_pre_sales_tab.s102', "(سعر الآجل)")}
                  </span>
                )}

                {isCartonItem && (
                  <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '1px 5px', borderRadius: '4px' }}>
                    {(pricing.effectivePrice * mult).toFixed(2)} / {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s103', "ك")}
                  </span>
                )}

                {pricing.consumerPrice ? (
                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                    {t('delivery_reps.van_pre_sales_tab.s104', "(مستهلك:")} {pricing.consumerPrice.toFixed(2)})
                  </span>
                ) : null}
              </div>

              {/* Stock badge */}
              <div style={{ flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: isOutOfStock ? '#b91c1c' : '#047857',
                    backgroundColor: isOutOfStock ? '#fee2e2' : '#f0fdf4',
                    border: `1px solid ${isOutOfStock ? '#fca5a5' : '#bbf7d0'}`,
                    padding: '1.5px 6px',
                    borderRadius: '5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: isOutOfStock ? '#ef4444' : '#10b981', display: 'inline-block' }} />
                  {isOutOfStock ? (
                    t('delivery_reps.van_pre_sales_tab.s105', "نفد من المخزن")
                  ) : isCartonItem ? (
                    `متاح: ${availCartons} ك ${availPieces > 0 ? `+ ${availPieces} ق` : ''} (${prod.warehouseAvailable} ق)`
                  ) : (
                    `متاح: ${prod.warehouseAvailable} قطعة`
                  )}
                </span>
              </div>
            </div>

            {/* Row 3: Actions / Steppers (Height 28px - 30px) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '3px',
                borderTop: '1px dashed #f1f5f9',
                gap: '6px',
              }}
            >
              {isOutOfStock && totalChosen === 0 ? (
                <span style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_tab.s106', "الصنف غير متوفر بالمخزن")}</span>
              ) : isCartonItem ? (
                totalChosen === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 1, 0)}
                      style={{
                        flex: 1,
                        height: '28px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                      }}
                    >
                      <PlusIcon size={12} color="#ffffff" />
                      <span>{t('delivery_reps.van_pre_sales_tab.s107', "+ حجز")} {prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s108', "كرتونة")} ({mult}{t('delivery_reps.van_pre_sales_tab.s109', "ق)")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        color: '#334155',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <PlusIcon size={11} color="#64748b" />
                      <span>{t('delivery_reps.van_pre_sales_tab.s110', "+ بالقطعة")}</span>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CompactStepper
                        value={currentCartons}
                        unitLabel={prod.packagingUnit?.name || t('delivery_reps.van_pre_sales_tab.s111', "كرتونة")}
                        onIncrement={() => handleUpdateProductUnits(prod, currentCartons + 1, currentPieces)}
                        onDecrement={() => handleUpdateProductUnits(prod, Math.max(0, currentCartons - 1), currentPieces)}
                        onChange={(val) => handleUpdateProductUnits(prod, val, currentPieces)}
                        disabledDecrement={currentCartons <= 0}
                        height="27px"
                        inputWidth="30px"
                      />
                      <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                      <CompactStepper
                        value={currentPieces}
                        unitLabel={t('delivery_reps.van_pre_sales_tab.s112', "قطع")}
                        onIncrement={() => handleUpdateProductUnits(prod, currentCartons, currentPieces + 1)}
                        onDecrement={() => handleUpdateProductUnits(prod, currentCartons, Math.max(0, currentPieces - 1))}
                        onChange={(val) => handleUpdateProductUnits(prod, currentCartons, val)}
                        disabledDecrement={currentPieces <= 0}
                        height="27px"
                        inputWidth="30px"
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                      <span style={{ fontWeight: 700, color: '#64748b' }}>
                        ({totalChosen} {t('delivery_reps.van_pre_sales_tab.s113', "ق)")}
                      </span>
                      <span style={{ fontWeight: 800, color: '#170e5e' }}>
                        {lineTotal.toFixed(2)} <CurrencySymbol />
                      </span>
                    </div>
                  </div>
                )
              ) : (
                totalChosen === 0 ? (
                  <button
                    type="button"
                    onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                    style={{
                      width: '100%',
                      height: '28px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#170e5e',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    <PlusIcon size={12} color="#ffffff" />
                    <span>{t('delivery_reps.van_pre_sales_tab.s114', "+ إضافة للطلبية")}</span>
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                      {t('delivery_reps.van_pre_sales_tab.s115', "القيمة:")} {lineTotal.toFixed(2)} <CurrencySymbol />
                    </span>
                    <CompactStepper
                      value={currentPieces}
                      unitLabel={t('delivery_reps.van_pre_sales_tab.s116', "قطع")}
                      onIncrement={() => handleUpdateProductUnits(prod, 0, currentPieces + 1)}
                      onDecrement={() => handleUpdateProductUnits(prod, 0, Math.max(0, currentPieces - 1))}
                      onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                      disabledDecrement={currentPieces <= 0}
                      height="27px"
                      inputWidth="34px"
                    />
                  </div>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
