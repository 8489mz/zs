import React from 'react';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CompactStepper } from './compact-stepper';
import { roundMoney } from '../../utils/van-money.utils';
import type { PreSalesCatalogItem } from '../../api/van-sales.api';
import type { CustomerOption, PreSalesCartLine } from './van-pre-sales-types';

export interface CartPanelProps {
  cart: PreSalesCartLine[];
  catalogProducts: PreSalesCatalogItem[];
  paymentTerms: 'cash' | 'credit';
  handlePaymentTermsChange: (newTerms: 'cash' | 'credit') => void;
  handleCartDelta: (productId: number, unitType: 'carton' | 'piece', delta: number) => void;
  handleUpdateProductUnits: (product: PreSalesCatalogItem, targetCartons: number, targetPieces: number) => void;
  cartGrossSubtotal: number;
  cartNetTotal: number;
  cartDiscountAmount: number;
  totalPieces: number;
  customers: CustomerOption[];
  selectedCustomerId: number | '';
  onSelectCustomer: (val: number | '') => void;
  selectedCustomer: CustomerOption | null;
  deliveryDate: string;
  setDeliveryDate: React.Dispatch<React.SetStateAction<string>>;
  bookingNotes: string;
  setBookingNotes: React.Dispatch<React.SetStateAction<string>>;
  createOrderMutation: UseMutationResult<{ ok: boolean; orderId: number; orderNumber: string; totalAmount: number; status: string }, any, void, unknown>;
  handleConfirmOrder: () => void;
}

export const CartPanel: React.FC<CartPanelProps> = ({
  cart,
  catalogProducts,
  paymentTerms,
  handlePaymentTermsChange,
  handleCartDelta,
  handleUpdateProductUnits,
  cartGrossSubtotal,
  cartNetTotal,
  cartDiscountAmount,
  totalPieces,
  customers,
  selectedCustomerId,
  onSelectCustomer,
  selectedCustomer,
  deliveryDate,
  setDeliveryDate,
  bookingNotes,
  setBookingNotes,
  createOrderMutation,
  handleConfirmOrder,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* BOOKING CART & STEPPERS (Visible when cart has items) */}
          {cart.length > 0 && (
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}
            >
              {/* Cart Header with Quick Payment Terms Switcher */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_pre_sales_tab.s39', "بنود الحجز (")}{cart.length} {t('delivery_reps.van_pre_sales_tab.s40', "أصناف |")} {totalPieces} {t('delivery_reps.van_pre_sales_tab.s41', "قطعة):")}
                </span>

                <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '7px', padding: '2px', border: '1px solid #cbd5e1' }}>
                  <button
                    type="button"
                    onClick={() => handlePaymentTermsChange('cash')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: paymentTerms === 'cash' ? '#15803d' : 'transparent',
                      color: paymentTerms === 'cash' ? '#ffffff' : '#64748b',
                    }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s42', "كاش نقدي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePaymentTermsChange('credit')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: paymentTerms === 'credit' ? '#b45309' : 'transparent',
                      color: paymentTerms === 'credit' ? '#ffffff' : '#64748b',
                    }}
                  >
                    {t('delivery_reps.van_pre_sales_tab.s43', "آجل على الحساب")}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cart.map((line) => {
                  const lineNetTotal = line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
                    ? line.cartons * line.cartonUnitPrice + line.pieces * line.pieceUnitPrice
                    : line.quantity * line.pieceUnitPrice;

                  const lineGrossTotal = line.cartonMultiplier > 1 && (line.cartons > 0 || line.pieces > 0)
                    ? line.cartons * line.cartonListPrice + line.pieces * line.pieceListPrice
                    : line.quantity * line.pieceListPrice;

                  const lineCashDiscount = Math.max(0, roundMoney(lineGrossTotal - lineNetTotal));

                  return (
                    <div
                      key={line.productId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        paddingBottom: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a' }}>{line.productName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {line.cartonMultiplier > 1 ? (
                              <span>
                                {line.cartons > 0 ? `${line.cartons} ${line.packagingUnitName || t('delivery_reps.van_pre_sales_tab.s44', "كرتونة")}` : ''}
                                {line.cartons > 0 && line.pieces > 0 ? ' + ' : ''}
                                {line.pieces > 0 ? `${line.pieces} قطعة` : ''}
                                {' '}{t('delivery_reps.van_pre_sales_tab.s45', "(إجمالي:")} {line.quantity} {t('delivery_reps.van_pre_sales_tab.s46', "قطعة)")}
                              </span>
                            ) : (
                              <span>{line.quantity} {t('delivery_reps.van_pre_sales_tab.s47', "قطعة")}</span>
                            )}

                            {paymentTerms === 'cash' && lineCashDiscount > 0 && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: '#059669',
                                  backgroundColor: '#dcfce7',
                                  border: '1px solid #86efac',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t('delivery_reps.van_pre_sales_tab.s48', "خصم تعجيل دفع: -")}{lineCashDiscount.toFixed(2)} <CurrencySymbol />
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ textAlign: 'left', flexShrink: 0 }}>
                          {paymentTerms === 'cash' && lineCashDiscount > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#94a3b8', textDecoration: 'line-through', lineHeight: 1.2 }}>
                              {lineGrossTotal.toFixed(2)}
                            </div>
                          )}
                          <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#170e5e' }}>
                            {lineNetTotal.toFixed(2)} <CurrencySymbol />
                          </span>
                        </div>
                      </div>

                      {/* QUICK CONTROLS IN CART */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center' }}>
                        {line.cartonMultiplier > 1 ? (
                          <>
                            <CompactStepper
                              value={line.cartons}
                              unitLabel={line.packagingUnitName || t('delivery_reps.van_pre_sales_tab.s49', "كرتونة")}
                              onIncrement={() => handleCartDelta(line.productId, 'carton', 1)}
                              onDecrement={() => handleCartDelta(line.productId, 'carton', -1)}
                              onChange={(val) => {
                                const prod = catalogProducts.find((p) => p.id === line.productId);
                                if (prod) handleUpdateProductUnits(prod, val, line.pieces);
                              }}
                              disabledDecrement={line.cartons <= 0}
                              height="28px"
                              inputWidth="32px"
                            />
                            <CompactStepper
                              value={line.pieces}
                              unitLabel={t('delivery_reps.van_pre_sales_tab.s50', "قطع")}
                              onIncrement={() => handleCartDelta(line.productId, 'piece', 1)}
                              onDecrement={() => handleCartDelta(line.productId, 'piece', -1)}
                              onChange={(val) => {
                                const prod = catalogProducts.find((p) => p.id === line.productId);
                                if (prod) handleUpdateProductUnits(prod, line.cartons, val);
                              }}
                              disabledDecrement={line.pieces <= 0}
                              height="28px"
                              inputWidth="32px"
                            />
                          </>
                        ) : (
                          <CompactStepper
                            value={line.quantity}
                            unitLabel={t('delivery_reps.van_pre_sales_tab.s51', "قطع")}
                            onIncrement={() => handleCartDelta(line.productId, 'piece', 1)}
                            onDecrement={() => handleCartDelta(line.productId, 'piece', -1)}
                            onChange={(val) => {
                              const prod = catalogProducts.find((p) => p.id === line.productId);
                              if (prod) handleUpdateProductUnits(prod, 0, val);
                            }}
                            disabledDecrement={line.quantity <= 0}
                            height="28px"
                            inputWidth="34px"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* COMMERCIAL SUMMARY STRIP */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '9px',
                  padding: '9px 12px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: '#475569' }}>
                  <span>{t('delivery_reps.van_pre_sales_tab.s52', "إجمالي الطلبية (سعر الآجل الأساسي):")}</span>
                  <span style={{ fontWeight: 700 }}>{cartGrossSubtotal.toFixed(2)} <CurrencySymbol /></span>
                </div>

                {paymentTerms === 'cash' ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: '#059669', fontWeight: 700 }}>
                    <span>{t('delivery_reps.van_pre_sales_tab.s53', "خصم تعجيل دفع (سداد نقدي):")}</span>
                    <span>-{cartDiscountAmount.toFixed(2)} <CurrencySymbol /></span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#b45309' }}>
                    <span>{t('delivery_reps.van_pre_sales_tab.s54', "خصم تعجيل دفع (سداد نقدي):")}</span>
                    <span>0.00 <CurrencySymbol /> {t('delivery_reps.van_pre_sales_tab.s55', "(غير مستحق في البيع الآجل)")}</span>
                  </div>
                )}

                <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '2px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a' }}>
                    {paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s56', "الصافي المطلوب سداده (كاش):") : t('delivery_reps.van_pre_sales_tab.s57', "صافي الحساب على العميل (آجل):")}
                  </span>
                  <span style={{ fontWeight: 900, fontSize: '14.5px', color: paymentTerms === 'cash' ? '#059669' : '#170e5e' }}>
                    {cartNetTotal.toFixed(2)} <CurrencySymbol />
                  </span>
                </div>
              </div>

              {/* IN-CART CUSTOMER SELECTOR */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="cart-customer-select" style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                    {t('delivery_reps.van_pre_sales_tab.s58', "العميل:")}
                  </label>
                  {selectedCustomer && (
                    <button
                      type="button"
                      onClick={() => onSelectCustomer('')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      {t('delivery_reps.van_pre_sales_tab.s59', "تغيير العميل")}
                    </button>
                  )}
                </div>

                <select
                  id="cart-customer-select"
                  value={selectedCustomerId}
                  onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : '')}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">{t('delivery_reps.van_pre_sales_tab.s60', "-- اضغط هنا لاختيار العميل --")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''} {t('delivery_reps.van_pre_sales_tab.s61', "- رصيد:")} {Number(c.balance || 0).toFixed(0)}
                    </option>
                  ))}
                </select>

                {selectedCustomer && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#64748b', padding: '1px 2px' }}>
                    <span>
                      {t('delivery_reps.van_pre_sales_tab.s62', "الرصيد:")} <strong style={{ color: Number(selectedCustomer.balance) > 0 ? '#b91c1c' : '#15803d' }}>{Number(selectedCustomer.balance || 0).toFixed(2)} <CurrencySymbol /></strong>
                    </span>
                    <span>
                      {t('delivery_reps.van_pre_sales_tab.s63', "سقف الائتمان:")} <strong style={{ color: '#170e5e' }}>{selectedCustomer.creditLimit ? `${Number(selectedCustomer.creditLimit).toFixed(2)}` : t('delivery_reps.van_pre_sales_tab.s64', "غير محدد")}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* DETAILS & SUBMIT */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_tab.s65', "تاريخ التسليم المقترح:")}</label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    style={{
                      width: '100%',
                      height: '32px',
                      padding: '0 6px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.van_pre_sales_tab.s66', "ملاحظات التجهيز:")}</label>
                  <input
                    type="text"
                    placeholder={t('delivery_reps.van_pre_sales_tab.s67', "ملاحظات للمخزن...")}
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    style={{
                      width: '100%',
                      height: '32px',
                      padding: '0 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                onClick={handleConfirmOrder}
                disabled={createOrderMutation.isPending}
                style={{
                  height: '40px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  borderRadius: '8px',
                  marginTop: '4px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                <CheckCircleIcon size={16} />
                <span>
                  {createOrderMutation.isPending
                    ? t('delivery_reps.van_pre_sales_tab.s68', "جاري الحجز وتثبيت المخزون...")
                    : !selectedCustomerId
                    ? `اختر العميل لتأكيد الحجز (${cartNetTotal.toFixed(2)})`
                    : `تأكيد حجز الطلبية [${paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s69', "كاش نقدي") : t('delivery_reps.van_pre_sales_tab.s70', "آجل")}] (${cartNetTotal.toFixed(2)})`}
                </span>
              </Button>
            </div>
          )}
    </>
  );
};
