// Close branch — counted cash, electronic methods (row elements passed in
// as ReactNode props), password + notes, expected-cash breakdown, variance
// and manager approvals. Pure move; the panel keeps all state.

import { useTranslation } from 'react-i18next';
import { Field } from '@/shared/ui/field';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { formatCurrency } from '@/lib/format';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { Button } from '@/shared/ui/button';
import { printZReport } from '@/features/cash-drawer/utils/cash-drawer-receipt';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import { SubmitButton } from '@/shared/components/submit-button';
import { CashIcon } from './cash-drawer-form-icons';
import type { CashierShift } from '@/types/domain';
import type { CloseShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import type { MutationLike } from './CashDrawerOpenForm';
import type { ReactNode } from 'react';

interface CashDrawerCloseFormProps {
  closeForm: UseFormReturn<CloseShiftValues>;
  closeMutation: MutationLike;
  onCloseSubmit: () => void;
  onCloseForm: () => void;
  isManager?: boolean;
  myOpenShift?: CashierShift | null;
  openOptions: CashierShift[];
  selectedCloseShift: CashierShift | null;
  closeOpeningCash: number;
  closeCashSalesTotal: number;
  closeCardSalesTotal: number;
  closeDeliverySalesTotal: number;
  closeServiceCashTotal: number;
  closeCreditSalesTotal: number;
  closeSaleReturnCashRefundTotal: number;
  closeCashDrawerMovementTotal: number;
  closeExpensesTotal: number;
  closeSupplierPaymentsTotal: number;
  closeCustomerCollectionsTotal: number;
  closeCancelledSaleCashTotal: number;
  closeShiftSalesTotal: number;
  isBlindCloseMode?: boolean;
  closeExpectedCash: number;
  closeVariancePreview: number;
  closeNoteValue: string;
  showOpenTablesOverride: boolean;
  offlinePendingCount: number;
  cardRow: ReactNode;
  walletRow: ReactNode;
  instapayRow: ReactNode;
}

export function CashDrawerCloseForm({
  closeForm,
  closeMutation,
  onCloseSubmit,
  onCloseForm,
  isManager,
  myOpenShift,
  openOptions,
  selectedCloseShift,
  closeOpeningCash,
  closeCashSalesTotal,
  closeCardSalesTotal,
  closeDeliverySalesTotal,
  closeServiceCashTotal,
  closeCreditSalesTotal,
  closeSaleReturnCashRefundTotal,
  closeCashDrawerMovementTotal,
  closeExpensesTotal,
  closeSupplierPaymentsTotal,
  closeCustomerCollectionsTotal,
  closeCancelledSaleCashTotal,
  closeShiftSalesTotal,
  isBlindCloseMode,
  closeExpectedCash,
  closeVariancePreview,
  closeNoteValue,
  showOpenTablesOverride,
  offlinePendingCount,
  cardRow,
  walletRow,
  instapayRow,
}: CashDrawerCloseFormProps) {
  const { t } = useTranslation();
  return (
    <>
          <form className="form-grid" onSubmit={onCloseSubmit}>
            {isManager && openOptions.length > 1 ? (
              <Field label={t('cash_drawer.cash_drawer_forms_panel.s51', "وردية نقطة البيع المفتوحة")}>
                <Controller
                  name="shiftId"
                  control={closeForm.control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={closeMutation.isPending}
                      options={[
                        { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s52', "اختر وردية نقطة البيع") },
                        ...openOptions.map((shift) => ({
                          value: shift.id,
                          label: `${shift.openedByName || t('cash_drawer.cash_drawer_forms_panel.s53', "وردية نقطة بيع")}${shift.docNo ? ` — ${shift.docNo}` : ''}${String(shift.id) === String(myOpenShift?.id) ? t('cash_drawer.cash_drawer_forms_panel.s54', " (ورديتي الحالية)") : ''}`,
                        })),
                      ]}
                    />
                  )}
                />
              </Field>
            ) : null}

            {isBlindCloseMode ? (
              <>
                {/* 1. Cash Section */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    background: '#f0fdf4',
                    border: '1.5px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #86efac',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CashIcon size={20} color="#16a34a" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#14532d' }}>{t('cash_drawer.cash_drawer_forms_panel.s55', "النقدية المعدودة في درج النقدية")}</div>
                      <div style={{ fontSize: '0.75rem', color: '#15803d' }}>{t('cash_drawer.cash_drawer_forms_panel.s56', "المبلغ النقدي (الكاش) الفعلي الموجود داخل الدرج")}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>{t('cash_drawer.cash_drawer_forms_panel.s57', "المبلغ الفعلي:")}</span>
                    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="no-spin-arrows"
                        {...closeForm.register('countedCash', { valueAsNumber: true })}
                        disabled={closeMutation.isPending}
                        onFocus={(e) => e.target.select()}
                        style={{
                          width: '140px',
                          padding: '7px 30px 7px 12px',
                          fontSize: '1rem',
                          fontWeight: 800,
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: '1.5px solid #86efac',
                          background: '#ffffff',
                          color: '#14532d',
                          MozAppearance: 'textfield',
                        }}
                      />
                      <span style={{ position: 'absolute', left: '8px', fontSize: '0.75rem', color: '#16a34a', pointerEvents: 'none' }}><CurrencySymbol /></span>
                    </div>
                  </div>
                </div>

                {/* 2. Electronic Payment Methods Section */}
                <div style={{ gridColumn: '1 / -1', marginTop: '6px', marginBottom: '4px' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
                    {t('cash_drawer.cash_drawer_forms_panel.s58', "المدفوعات الإلكترونية وماكينات الدفع")}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Card / Visa / K-NET */}
                    {cardRow}

                    {/* Wallets */}
                    {walletRow}

                    {/* InstaPay / K-NET Electronic Links */}
                    {instapayRow}
                  </div>
                </div>

                {/* 3. Password & Optional Notes in Responsive Row */}
                <div className="close-shift-auth-row">
                  <div className="close-shift-note-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s71', "ملاحظات الإغلاق (اختياري)")}>
                      <input
                        type="text"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s72', "أية ملاحظات خاصة بوردية اليوم...")}
                        {...closeForm.register('note')}
                        disabled={closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>

                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s73', "كلمة مرور المستخدم الحالي (تأكيد الإغلاق)")}>
                      <input
                        type="text"
                        className="secure-password-field"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s74', "أدخل كلمة المرور لتأكيد الإغلاق")}
                        required
                        {...closeForm.register('managerPin')}
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>

                <div className="muted small" style={{ gridColumn: '1 / -1' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s75', "سيتم تسجيل الإقرار وإرسال وردية نقطة البيع في انتظار مراجعة واعتماد الإدارة.")}
                </div>
              </>
            ) : (
              <>
                <Field label={t('cash_drawer.cash_drawer_forms_panel.s76', "النقدية المتوقعة")}><input value={formatCurrency(closeExpectedCash)} disabled readOnly /></Field>
                {selectedCloseShift ? (
                  <div className="close-shift-financial-card">
                    <div className="close-shift-financial-grid">
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s116', "رصيد الفتح")}</span>
                        <strong className="close-shift-fin-value">{formatCurrency(closeOpeningCash)}</strong>
                      </div>
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s77', "مبيعات نقدي")}</span>
                        <strong className="close-shift-fin-value tone-green">{formatCurrency(closeCashSalesTotal)}</strong>
                      </div>
                      <div className="close-shift-fin-item">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s78', "مبيعات فيزا")}</span>
                        <strong className="close-shift-fin-value tone-blue">{formatCurrency(closeCardSalesTotal)}</strong>
                      </div>
                      {closeDeliverySalesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s79', "مبيعات دليفري")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeDeliverySalesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeServiceCashTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s80', "خدمات نقدي")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeServiceCashTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCreditSalesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s81', "مبيعات آجل")}</span>
                          <strong className="close-shift-fin-value">{formatCurrency(closeCreditSalesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeSaleReturnCashRefundTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s82', "مرتجعات نقدي")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeSaleReturnCashRefundTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCashDrawerMovementTotal !== 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s83', "حركات درج النقدية")}</span>
                          <strong className={`close-shift-fin-value ${closeCashDrawerMovementTotal < 0 ? 'tone-red' : 'tone-green'}`}>
                            {formatCurrency(closeCashDrawerMovementTotal)}
                          </strong>
                        </div>
                      ) : null}
                      {closeExpensesTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s84', "مصروفات مسجلة")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeExpensesTotal)}</strong>
                        </div>
                      ) : null}
                      {closeSupplierPaymentsTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s85', "دفعات موردين")}</span>
                          <strong className="close-shift-fin-value tone-red">-{formatCurrency(closeSupplierPaymentsTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCustomerCollectionsTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s117', "تحصيلات عملاء نقدي")}</span>
                          <strong className="close-shift-fin-value tone-green">+{formatCurrency(closeCustomerCollectionsTotal)}</strong>
                        </div>
                      ) : null}
                      {closeCancelledSaleCashTotal > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s118', "نقدية فواتير ملغاة")}</span>
                          <strong className="close-shift-fin-value tone-green">+{formatCurrency(closeCancelledSaleCashTotal)}</strong>
                        </div>
                      ) : null}
                      <div className="close-shift-fin-item close-shift-fin-highlight">
                        <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s86', "إجمالي مبيعات الفواتير")}</span>
                        <strong className="close-shift-fin-value tone-primary">{formatCurrency(closeShiftSalesTotal)}</strong>
                      </div>
                      {Number(selectedCloseShift.freelanceDeliveryFeeTotal || 0) > 0 ? (
                        <>
                          <div className="close-shift-fin-item">
                            <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s87', "(-) رسوم طيارين")}</span>
                            <strong className="close-shift-fin-value tone-red">-{formatCurrency(selectedCloseShift.freelanceDeliveryFeeTotal || 0)}</strong>
                          </div>
                          <div className="close-shift-fin-item close-shift-fin-highlight">
                            <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s88', "صافي مبيعات المتجر")}</span>
                            <strong className="close-shift-fin-value tone-green">{formatCurrency(closeShiftSalesTotal - Number(selectedCloseShift.freelanceDeliveryFeeTotal || 0))}</strong>
                          </div>
                        </>
                      ) : null}
                      {Number(selectedCloseShift.tipSalesTotal || 0) > 0 ? (
                        <div className="close-shift-fin-item">
                          <span className="close-shift-fin-label">{t('cash_drawer.cash_drawer_forms_panel.s89', "إكراميات مستحقة للعمالة (Tips)")}</span>
                          <strong className="close-shift-fin-value tone-primary">{formatCurrency(selectedCloseShift.tipSalesTotal || 0)}</strong>
                        </div>
                      ) : null}
                    </div>
                    <div className="close-shift-fin-footnote">
                      {t('cash_drawer.cash_drawer_forms_panel.s90', "النقدية المتوقعة = رصيد الفتح + مبيعات وخدمات النقدي + تحصيلات العملاء + نقدية الفواتير الملغاة - مرتجعات النقدي + حركات الدرج - المصروفات - دفعات الموردين.")}
                    </div>
                  </div>
                ) : null}
                <Field label={t('cash_drawer.cash_drawer_forms_panel.s91', "المبلغ المعدود")}><input type="number" min="0" step="0.01" className="no-spin-arrows" {...closeForm.register('countedCash', { valueAsNumber: true })} disabled={closeMutation.isPending} onFocus={(e) => e.target.select()} /></Field>

                <div className="close-shift-auth-row">
                  <div className="close-shift-note-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s92', "ملاحظة الإغلاق")}>
                      <input
                        type="text"
                        placeholder={closeVariancePreview !== 0 ? t('cash_drawer.cash_drawer_forms_panel.s93', "اشرح سبب الفرق قبل إغلاق الوردية") : t('cash_drawer.cash_drawer_forms_panel.s94', "اختياري عند عدم وجود فرق")}
                        {...closeForm.register('note')}
                        disabled={closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>

                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s95', "كلمة مرور المستخدم الحالي (تأكيد الإغلاق)")}>
                      <input
                        type="text"
                        className="secure-password-field"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s96', "أدخل كلمة المرور لتأكيد الإغلاق")}
                        required
                        {...closeForm.register('managerPin')}
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>

                <div className={closeVariancePreview !== 0 ? 'warning-box' : 'muted small'} style={{ gridColumn: '1 / -1' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s97', "الفرق المتوقع بعد الإغلاق:")} <strong>{formatCurrency(closeVariancePreview)}</strong>
                  {closeVariancePreview !== 0 ? t('cash_drawer.cash_drawer_forms_panel.s98', " — يلزم كتابة ملاحظة قبل إغلاق وردية نقطة البيع مع وجود فرق.") : ''}
                </div>

              </>
            )}

            {showOpenTablesOverride ? (
              <div style={{ gridColumn: '1 / -1', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontWeight: 800, color: '#92400e', marginBottom: '8px' }}>
                  {t('cash_drawer.cash_drawer_forms_panel.s122', "توجد طاولات مفتوحة أو فواتير مسودة في هذه الوردية. للإغلاق رغم ذلك اكتب سبب التجاوز (10 أحرف على الأقل).")}
                </div>
                <div className="close-shift-auth-row">
                  <div className="close-shift-pin-col">
                    <Field label={t('cash_drawer.cash_drawer_forms_panel.s125', "سبب التجاوز (10 أحرف على الأقل)")}>
                      <input
                        type="text"
                        placeholder={t('cash_drawer.cash_drawer_forms_panel.s126', "مثال: الطاولة ستنتقل إلى وردية المساء")}
                        {...closeForm.register('openTablesOverrideReason')}
                        disabled={closeMutation.isPending}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ) : null}

            <MutationFeedback isError={closeMutation.isError} isSuccess={closeMutation.isSuccess} error={closeMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s99', "تعذر إغلاق وردية نقطة البيع")} successText={t('cash_drawer.cash_drawer_forms_panel.s100', "تم إغلاق وردية نقطة البيع بنجاح.")} />
            {closeMutation.isSuccess && selectedCloseShift ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => printZReport(selectedCloseShift)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  margin: '8px 0',
                  width: '100%',
                  justifyContent: 'center',
                  fontWeight: 700,
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                }}
              >
                <PrinterIcon size={16} color="#170e5e" />
                <span>{t('cash_drawer.cash_drawer_forms_panel.s101', "طباعة تقرير Z النهائي (Z-Report)")}</span>
              </Button>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', width: '100%' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={onCloseForm}
                style={{ minHeight: '42px', padding: '0 16px', fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {t('common.cancel', 'إلغاء')}
              </Button>
              <SubmitButton
                type="submit"
                isPending={closeMutation.isPending}
                disabled={offlinePendingCount !== 0 || !closeForm.watch('shiftId') || (!isBlindCloseMode && closeVariancePreview !== 0 && !closeNoteValue) || !closeForm.watch('managerPin')}
                idleText={isBlindCloseMode ? t('cash_drawer.cash_drawer_forms_panel.s102', "إرسال إقرار الإغلاق") : t('cash_drawer.cash_drawer_forms_panel.s103', "إغلاق وردية نقطة البيع")}
                pendingText={t('cash_drawer.cash_drawer_forms_panel.s104', "جارٍ الإغلاق...")}
                style={{ flex: 1, minHeight: '42px', fontSize: '0.95rem', fontWeight: 800 }}
              />
            </div>
          </form>
    </>
  );
}
