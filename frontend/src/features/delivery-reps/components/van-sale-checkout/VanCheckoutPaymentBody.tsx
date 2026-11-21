import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { CreditCardIcon } from '@/shared/components/icons/AppIcons';
import { roundMoney } from '../../utils/van-money.utils';

export interface VanCheckoutPaymentBodyProps {
  paymentMethod: 'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash';
  t: TFunction;
  cashInput: string;
  setCashInput: Dispatch<SetStateAction<string>>;
  netCashDue: number;
  isActuallySplit: boolean;
  splitCreditDebt: number;
  changeDue: number;
  canGiveDiscount?: boolean;
  canGiveInvoiceDiscount?: boolean;
  discountCapPercent?: number;
  showCashDiscount: boolean;
  cashDiscountAmount: number;
  setShowCashDiscount: Dispatch<SetStateAction<boolean>>;
  cartTotal: number;
  setCashDiscountAmount: Dispatch<SetStateAction<number>>;
  hasCustomer: boolean;
  customer?: { id: number; name: string; phone?: string; balance: number; creditLimit?: number; customerCode?: string; route?: string } | null;
  customerBalanceAfter: number;
}

export function VanCheckoutPaymentBody({
  paymentMethod,
  t,
  cashInput,
  setCashInput,
  netCashDue,
  isActuallySplit,
  splitCreditDebt,
  changeDue,
  canGiveDiscount,
  canGiveInvoiceDiscount,
  discountCapPercent,
  showCashDiscount,
  cashDiscountAmount,
  setShowCashDiscount,
  cartTotal,
  setCashDiscountAmount,
  hasCustomer,
  customer,
  customerBalanceAfter,
}: VanCheckoutPaymentBodyProps) {
  return (
    <>
      {/* Dynamic Payment Body Section */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* 1. CASH / SMART SPLIT PAYMENT MODE */}
        {paymentMethod === 'cash' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#334155', whiteSpace: 'nowrap' }}>
                {t('delivery_reps.van_sale_checkout_modal.s35', "المستلم كاش:")}
              </span>
              <input
                type="number"
                step="0.5"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="0.00"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '38px',
                  borderRadius: '7px',
                  border: '1px solid #cbd5e1',
                  fontSize: '16px',
                  fontWeight: 800,
                  textAlign: 'center',
                  backgroundColor: '#f8fafc',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setCashInput(netCashDue.toFixed(2))}
                style={{
                  height: '38px',
                  padding: '0 12px',
                  borderRadius: '7px',
                  border: '1px solid #a7f3d0',
                  backgroundColor: '#ecfdf5',
                  color: '#065f46',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s36', "المبلغ بالضبط")}
              </button>
            </div>

            {/* Automatic Split Badge if partial cash paid */}
            {isActuallySplit && (
              <div
                style={{
                  backgroundColor: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '11.5px',
                  color: '#5b21b6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{t('delivery_reps.van_sale_checkout_modal.s37', "سداد جزئي (المتبقي آجل على الحساب):")}</span>
                <strong style={{ color: '#b91c1c', fontSize: '12.5px' }}>
                  {splitCreditDebt.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s38', "ج.م")}
                </strong>
              </div>
            )}

            {/* Automatic Change Badge if cash paid is greater than total */}
            {changeDue > 0 && (
              <div
                style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '11.5px',
                  color: '#1d4ed8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{t('delivery_reps.van_sale_checkout_modal.s39', "الباقي للعميل:")}</span>
                <strong style={{ color: '#1d4ed8', fontSize: '12.5px' }}>
                  {changeDue.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s40', "ج.م")}
                </strong>
              </div>
            )}

            {/* Optional Cash Discount Toggle */}
            {/* INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: hidden unless the rep has the invoice-discount permission AND the tenant cap is above zero (cap absent = server default 5). The server still enforces both — this only hides what the rep cannot use. */}
            {canGiveDiscount === true && canGiveInvoiceDiscount === true && (discountCapPercent ?? 5) > 0 && (
            <div>
              {!showCashDiscount && cashDiscountAmount === 0 ? (
                <button
                  type="button"
                  onClick={() => setShowCashDiscount(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {t('delivery_reps.van_sale_checkout_modal.s41', "+ إضافة خصم تسوية نقدي (اختياري)")}
                </button>
              ) : (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>{t('delivery_reps.van_sale_checkout_modal.s42', "خصم نقدي:")}</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={cartTotal}
                    value={cashDiscountAmount || ''}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(cartTotal, Number(e.target.value) || 0));
                      setCashDiscountAmount(val);
                      setCashInput((Math.max(0, cartTotal - val)).toFixed(2));
                    }}
                    placeholder="0.00"
                    style={{
                      width: '70px',
                      height: '26px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '11px',
                      fontWeight: 700,
                      textAlign: 'center',
                      backgroundColor: '#ffffff',
                    }}
                  />
                  {[0.02, 0.05].filter((pct) => pct * 100 <= (discountCapPercent ?? 5)).map((pct) => {
                    const discountVal = roundMoney(cartTotal * pct);
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          setCashDiscountAmount(discountVal);
                          setCashInput((Math.max(0, cartTotal - discountVal)).toFixed(2));
                        }}
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: Math.abs(cashDiscountAmount - discountVal) < 0.01 ? '#ecfdf5' : '#ffffff',
                          color: Math.abs(cashDiscountAmount - discountVal) < 0.01 ? '#065f46' : '#475569',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {pct * 100}% ({discountVal} {t('delivery_reps.van_sale_checkout_modal.s43', "ج)")}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setCashDiscountAmount(0);
                      setShowCashDiscount(false);
                      setCashInput(cartTotal.toFixed(2));
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#dc2626',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginRight: 'auto',
                    }}
                  >
                    {t('delivery_reps.van_sale_checkout_modal.s44', "إلغاء")}
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* 2. FULL CREDIT PAYMENT MODE */}
        {paymentMethod === 'credit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {!hasCustomer ? (
              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 10px', fontSize: '11.5px', color: '#92400e' }}>
                <strong>{t('delivery_reps.van_sale_checkout_modal.s45', "تنبيه:")}</strong> {t('delivery_reps.van_sale_checkout_modal.s46', "لم يتم تحديد عميل. البيع الآجل يتطلب تحديد العميل لتسجيل المديونية.")}
              </div>
            ) : (
              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#166534' }}>{t('delivery_reps.van_sale_checkout_modal.s47', "المديونية السابقة:")}</span>
                  <strong>{(customer?.balance || 0).toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s48', "ج.م")}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #86efac', paddingTop: '3px' }}>
                  <span style={{ color: '#166534', fontWeight: 800 }}>{t('delivery_reps.van_sale_checkout_modal.s49', "الرصيد بعد إضافة الفاتورة:")}</span>
                  <strong style={{ color: '#b91c1c', fontSize: '12.5px' }}>{customerBalanceAfter.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s50', "ج.م")}</strong>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. CARD PAYMENT MODE */}
        {paymentMethod === 'card' && (
          <div style={{ padding: '8px 10px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px dashed #bae6fd', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCardIcon size={20} color="#0284c7" />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0369a1' }}>
                {t('delivery_reps.van_sale_checkout_modal.s51', "الدفع عبر البطاقة البنكية / ماكينة الدفع")}
              </div>
              <div style={{ fontSize: '10.5px', color: '#0284c7' }}>
                {t('delivery_reps.van_sale_checkout_modal.s52', "تسجيل الفاتورة كدفع إلكتروني بقيمة")} {cartTotal.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s53', "ج.م")}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
