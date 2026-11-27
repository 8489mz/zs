import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { PlusIcon } from '@/shared/components/icons/AppIcons';
import type { DriverAvailableProduct } from '../../hooks/useDriverLoadRequisition';
import {CompactStepper, type RequisitionLineItem} from './LoadRequisitionTypes';

export interface LoadRequisitionProductListProps {
  items: DriverAvailableProduct[];
  lines: RequisitionLineItem[];
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
  isMobile: boolean;
  outOfStockCount: number;
  showOutOfStock: boolean;
  setShowOutOfStock: Dispatch<SetStateAction<boolean>>;
}

export function LoadRequisitionProductList({
  items,
  lines,
  handleUpdateProductUnits,
  handleCatalogAdd,
  handleCartonIncrement,
  handleCartonDecrement,
  handlePieceIncrement,
  handlePieceDecrement,
  handleSingleIncrement,
  handleSingleDecrement,
  isMobile,
  outOfStockCount,
  showOutOfStock,
  setShowOutOfStock,
}: LoadRequisitionProductListProps) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '30px 14px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '12px',
        }}
      >
        <span>{t('delivery_reps.driver_new_load_requisition_view.s9', "لا توجد أصناف متوفرة حالياً بالبحث أو القسم المحدد بالمخزن.")}</span>
        {outOfStockCount > 0 && !showOutOfStock && (
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              onClick={() => setShowOutOfStock(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#170e5e',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {t('delivery_reps.driver_new_load_requisition_view.s10', "عرض الأصناف غير المتوفرة (")}{outOfStockCount})
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))',
        gap: '8px',
      }}
    >
      {items.map((prod) => {
        const availQty = prod.availableQty ?? prod.totalStock;
        const isOutOfStock = availQty <= 0;
        const mult = prod.packagingUnit?.multiplier || 1;
        const isCartonItem = Boolean(prod.packagingUnit && mult > 1);

        // Current chosen quantity in lines
        const lineItem = lines.find((l) => Number(l.productId) === prod.id);
        const totalChosen = lineItem ? lineItem.qty : 0;
        const currentCartons = lineItem?.cartons ?? (isCartonItem ? Math.floor(totalChosen / mult) : 0);
        const currentPieces = lineItem?.pieces ?? (isCartonItem ? totalChosen % mult : totalChosen);

        // Stock breakdown in cartons
        const availCartons = isCartonItem ? Math.floor(availQty / mult) : 0;
        const availPieces = isCartonItem ? availQty % mult : availQty;

        return (
          <div
            key={prod.id}
            style={{
              border: `1px solid ${totalChosen > 0 ? '#c7d2fe' : '#e2e8f0'}`,
              borderRadius: '9px',
              padding: '8px 10px',
              backgroundColor: totalChosen > 0 ? '#f5f3ff' : isOutOfStock ? '#f8fafc' : '#ffffff',
              opacity: isOutOfStock && totalChosen === 0 ? 0.65 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              transition: 'border-color 0.15s ease',
            }}
          >
            {/* Row 1: Name & Badges */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
              <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a', lineHeight: 1.3 }}>
                {prod.name}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  backgroundColor: '#eef2ff',
                  color: '#3730a3',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {prod.supplierName || t('delivery_reps.driver_new_load_requisition_view.s11', "الشركة العامة")}
              </span>
            </div>

            {/* Row 2: Price, FEFO Expiry & Warehouse Stock */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', flexWrap: 'wrap', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ color: '#170e5e', fontWeight: 800 }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s12', "سعر:")} {prod.retailPrice.toFixed(2)} <CurrencySymbol />
                </span>
                {prod.expiryStatus === 'expired' && (
                  <span style={{ fontSize: '9.5px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s13', "منتهي الصلاحية (")}{prod.earliestExpiryDate})
                  </span>
                )}
                {prod.expiryStatus === 'near_expiry' && (
                  <span style={{ fontSize: '9.5px', backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s14', "FEFO قريب الانتهاء (")}{prod.daysToExpiry} {t('delivery_reps.driver_new_load_requisition_view.s15', "يوم)")}
                  </span>
                )}
                {prod.expiryStatus === 'valid' && prod.earliestExpiryDate && (
                  <span style={{ fontSize: '9.5px', backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s16', "صلاحية:")} {prod.earliestExpiryDate}
                  </span>
                )}
              </div>

              <span
                style={{
                  fontWeight: 700,
                  color: !isOutOfStock ? '#15803d' : '#dc2626',
                  backgroundColor: !isOutOfStock ? '#ecfdf5' : '#fef2f2',
                  border: `1px solid ${!isOutOfStock ? '#bbf7d0' : '#fecaca'}`,
                  padding: '1px 6px',
                  borderRadius: '5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {!isOutOfStock ? (
                  isCartonItem ? (
                    <>
                      {availCartons} {prod.packagingUnit?.name} {availPieces > 0 ? `+ ${availPieces}ق` : ''} ({availQty}{t('delivery_reps.driver_new_load_requisition_view.s17', "ق)")}
                    </>
                  ) : (
                    `متاح: ${availQty} ${prod.unit}`
                  )
                ) : (
                  t('delivery_reps.driver_new_load_requisition_view.s18', "نافد من المخزن")
                )}
              </span>
            </div>

            {prod.pendingHolds && prod.pendingHolds.length > 0 && (
              <div style={{ fontSize: '10.5px', color: '#92400e' }}>
                {t('delivery_reps.driver_new_load_requisition_view.s19', "طلبات تحميل معلقة على نفس المخزون:")} {prod.pendingHolds.map((h) => `#${h.docNo} (${h.qty})`).join('، ')}
              </div>
            )}

            {/* Row 3: Action / Steppers */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '2px', borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
              {totalChosen === 0 ? (
                isCartonItem ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 1, 0)}
                      disabled={isOutOfStock}
                      style={{
                        flex: 1,
                        backgroundColor: !isOutOfStock ? '#170e5e' : '#f1f5f9',
                        color: !isOutOfStock ? '#ffffff' : '#94a3b8',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        height: '28px',
                      }}
                    >
                      <PlusIcon size={12} />
                      <span>{t('delivery_reps.driver_new_load_requisition_view.s19', "+ حجز")} {prod.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s20', "كرتونة")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateProductUnits(prod, 0, 1)}
                      disabled={isOutOfStock}
                      style={{
                        backgroundColor: '#f8fafc',
                        color: '#334155',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        height: '28px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <PlusIcon size={11} color="#64748b" />
                      <span>{t('delivery_reps.driver_new_load_requisition_view.s21', "+ بالقطعة")}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCatalogAdd(prod)}
                    disabled={isOutOfStock}
                    style={{
                      backgroundColor: !isOutOfStock ? '#170e5e' : '#f1f5f9',
                      color: !isOutOfStock ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '11.5px',
                      fontWeight: 800,
                      cursor: !isOutOfStock ? 'pointer' : 'not-allowed',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      height: '28px',
                      width: '100%',
                    }}
                  >
                    <PlusIcon size={12} />
                    <span>{t('delivery_reps.driver_new_load_requisition_view.s22', "إضافة للتحميل")}</span>
                  </button>
                )
              ) : isCartonItem ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s23', "المطلوب:")} {totalChosen} {t('delivery_reps.driver_new_load_requisition_view.s24', "قطعة")}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CompactStepper
                      value={currentCartons}
                      unitLabel={prod.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s25', "كرتونة")}
                      onIncrement={() => handleCartonIncrement(prod, currentCartons, currentPieces)}
                      onDecrement={() => handleCartonDecrement(prod, currentCartons, currentPieces)}
                      onChange={(val) => handleUpdateProductUnits(prod, val, currentPieces)}
                      disabledDecrement={currentCartons <= 0}
                      height="28px"
                      inputWidth="32px"
                    />
                    <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                    <CompactStepper
                      value={currentPieces}
                      unitLabel={t('delivery_reps.driver_new_load_requisition_view.s26', "قطع")}
                      onIncrement={() => handlePieceIncrement(prod, currentCartons, currentPieces)}
                      onDecrement={() => handlePieceDecrement(prod, currentCartons, currentPieces)}
                      onChange={(val) => handleUpdateProductUnits(prod, currentCartons, val)}
                      disabledDecrement={currentPieces <= 0}
                      height="28px"
                      inputWidth="32px"
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s27', "القيمة:")} {(totalChosen * prod.retailPrice).toFixed(2)} <CurrencySymbol />
                  </span>
                  <CompactStepper
                    value={totalChosen}
                    unitLabel={prod.unit || t('delivery_reps.driver_new_load_requisition_view.s28', "قطعة")}
                    isDecimal={Boolean(prod.isWeight)}
                    step={prod.isWeight ? 0.5 : 1}
                    min={0}
                    onIncrement={() => handleSingleIncrement(prod, totalChosen)}
                    onDecrement={() => handleSingleDecrement(prod, totalChosen)}
                    onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                    disabledDecrement={totalChosen <= 0}
                    height="28px"
                    inputWidth={prod.isWeight ? '44px' : '36px'}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
