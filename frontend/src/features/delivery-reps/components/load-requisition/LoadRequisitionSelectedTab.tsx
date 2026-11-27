import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { BoxesIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import type { DriverAvailableProduct } from '../../hooks/useDriverLoadRequisition';
import {CompactStepper, type RequisitionLineItem} from './LoadRequisitionTypes';

export interface LoadRequisitionSelectedTabProps {
  activeViewTab: 'catalog' | 'selected';
  setActiveViewTab: Dispatch<SetStateAction<'catalog' | 'selected'>>;
  validLines: RequisitionLineItem[];
  availableProducts: DriverAvailableProduct[];
  selectedWarehouseFilter: string;
  notes: string;
  setNotes: Dispatch<SetStateAction<string>>;
  handleUpdateProductUnits: (
    product: DriverAvailableProduct,
    targetCartons: number,
    targetPieces: number,
  ) => void;
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
  handleRemoveLine: (lineId: string) => void;
  handleChangeLineWarehouse: (lineId: string, warehouseIdStr: string) => void;
}

export function LoadRequisitionSelectedTab({
  activeViewTab,
  setActiveViewTab,
  validLines,
  availableProducts,
  selectedWarehouseFilter,
  notes,
  setNotes,
  handleUpdateProductUnits,
  handleCartonIncrement,
  handleCartonDecrement,
  handlePieceIncrement,
  handlePieceDecrement,
  handleSingleIncrement,
  handleSingleDecrement,
  handleRemoveLine,
  handleChangeLineWarehouse,
}: LoadRequisitionSelectedTabProps) {
  const { t } = useTranslation();
  return (
    <>
        {/* TAB 2: SELECTED ITEMS REVIEW & NOTES */}
        {activeViewTab === 'selected' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {validLines.length === 0 ? (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '36px 16px',
                  textAlign: 'center',
                  color: '#64748b',
                }}
              >
                <BoxesIcon size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700 }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s84', "لم تقم بتحديد أي أصناف للتحميل حتى الآن.")}
                </p>
                <Button
                  variant="primary"
                  onClick={() => setActiveViewTab('catalog')}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '7px 16px',
                  }}
                >
                  {t('delivery_reps.driver_new_load_requisition_view.s85', "تصفح كتالوج المخزن واختيار الأصناف")}
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {validLines.map((line, index) => {
                  const mult = line.packagingUnit?.multiplier || 1;
                  const isCartonItem = Boolean(line.packagingUnit && mult > 1);
                  const lineTotal = line.qty * line.unitPrice;

                  // Product object to read stocks
                  const prod = availableProducts.find((p) => p.id === Number(line.productId));

                  return (
                    <div
                      key={line.id}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '9px',
                        padding: '8px 10px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {/* Top Row: Index, Name, Subtotal, Delete */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', flexShrink: 0 }}>
                            #{index + 1}
                          </span>
                          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {line.productName}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e', backgroundColor: '#ede9fe', padding: '1px 6px', borderRadius: '4px' }}>
                            {lineTotal.toFixed(2)} <CurrencySymbol />
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            style={{
                              backgroundColor: '#fee2e2',
                              border: '1px solid #fecaca',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '3px 6px',
                              borderRadius: '5px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '24px',
                              width: '24px',
                            }}
                            title={t('delivery_reps.driver_new_load_requisition_view.s86', "حذف هذا السطر")}
                          >
                            <Trash2Icon size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Middle: Warehouse picker (if 'all') & Available stock */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                        {selectedWarehouseFilter === 'all' && (line.warehouseStocks || []).filter((w) => w.qty > 0).length > 1 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ color: '#64748b', fontWeight: 700 }}>{t('delivery_reps.driver_new_load_requisition_view.s87', "المخزن:")}</span>
                            <select
                              value={line.sourceWarehouseId ? String(line.sourceWarehouseId) : ''}
                              onChange={(e) => handleChangeLineWarehouse(line.id, e.target.value)}
                              style={{
                                height: '24px',
                                fontSize: '11px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '5px',
                                padding: '0 4px',
                                backgroundColor: '#f8fafc',
                                color: '#0f172a',
                              }}
                            >
                              {(line.warehouseStocks || [])
                                .filter((w) => w.qty > 0)
                                .map((w) => (
                                  <option key={w.warehouseId} value={w.warehouseId}>
                                    {w.warehouseName} {t('delivery_reps.driver_new_load_requisition_view.s88', "(متاح:")} {w.qty})
                                  </option>
                                ))}
                            </select>
                          </div>
                        ) : (
                          <span style={{ color: '#64748b' }}>
                            {t('delivery_reps.driver_new_load_requisition_view.s89', "مخزن:")} {line.sourceWarehouseName || t('delivery_reps.driver_new_load_requisition_view.s90', "المستودع المختار")}
                          </span>
                        )}

                        <span style={{ color: '#15803d', fontWeight: 700 }}>
                          {t('delivery_reps.driver_new_load_requisition_view.s91', "متاح:")} {line.availableInWarehouse} {line.unit}
                        </span>
                      </div>

                      {/* Bottom: Stepper controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.driver_new_load_requisition_view.s92', "إجمالي الكمية:")} {line.qty} {line.unit}
                        </span>

                        {isCartonItem && prod ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CompactStepper
                              value={line.cartons || 0}
                              unitLabel={line.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s93', "كرتونة")}
                              onIncrement={() => handleCartonIncrement(prod, line.cartons || 0, line.pieces || 0)}
                              onDecrement={() => handleCartonDecrement(prod, line.cartons || 0, line.pieces || 0)}
                              onChange={(val) => handleUpdateProductUnits(prod, val, line.pieces || 0)}
                              disabledDecrement={(line.cartons || 0) <= 0}
                              height="26px"
                              inputWidth="30px"
                            />
                            <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                            <CompactStepper
                              value={line.pieces || 0}
                              unitLabel={t('delivery_reps.driver_new_load_requisition_view.s94', "قطع")}
                              onIncrement={() => handlePieceIncrement(prod, line.cartons || 0, line.pieces || 0)}
                              onDecrement={() => handlePieceDecrement(prod, line.cartons || 0, line.pieces || 0)}
                              onChange={(val) => handleUpdateProductUnits(prod, line.cartons || 0, val)}
                              disabledDecrement={(line.pieces || 0) <= 0}
                              height="26px"
                              inputWidth="30px"
                            />
                          </div>
                        ) : prod ? (
                          <CompactStepper
                            value={line.qty}
                            unitLabel={line.unit || t('delivery_reps.driver_new_load_requisition_view.s95', "قطعة")}
                            isDecimal={Boolean(line.isWeight)}
                            step={line.isWeight ? 0.5 : 1}
                            min={0}
                            onIncrement={() => handleSingleIncrement(prod, line.qty)}
                            onDecrement={() => handleSingleDecrement(prod, line.qty)}
                            onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                            height="26px"
                            inputWidth={line.isWeight ? '44px' : '36px'}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* Additional Notes Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '9px',
                    border: '1px solid #cbd5e1',
                    padding: '8px 10px',
                  }}
                >
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s96', "ملاحظات إضافية لمشرف المستودع")}
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={1}
                    placeholder={t('delivery_reps.driver_new_load_requisition_view.s97', "أي ملاحظات إضافية على طلب الشحن...")}
                    style={{
                      width: '100%',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '7px',
                      padding: '6px 8px',
                      fontSize: '11.5px',
                      color: '#0f172a',
                      boxSizing: 'border-box',
                      resize: 'vertical',
                      minHeight: '34px',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
