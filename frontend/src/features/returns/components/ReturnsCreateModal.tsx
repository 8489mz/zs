import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { ReturnsInvoiceItemsTable } from '@/features/returns/components/ReturnsInvoiceItemsTable';
import { formatCurrency, formatCurrencyWithSymbol } from '@/lib/format';
import type { ReturnReliefPreview } from '@/features/returns/api/returns.api';
import type { ReturnFormState } from '@/features/returns/lib/returns-workspace.helpers';
import type { Purchase, PurchaseItem, Sale, SaleItem } from '@/types/domain';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  form: ReturnFormState;
  invoiceRows: Array<Sale | Purchase>;
  selectedInvoice?: Sale | Purchase;
  invoiceItems: Array<SaleItem | PurchaseItem>;
  selectedItems: Record<string, string>;
  selectedSerials: Record<string, string>;
  selectedItemsCount: number;
  selectedQtyTotal: number;
  expectedReturnValue: number;
  reliefPreview?: ReturnReliefPreview | null;
  /** INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the merchant's chosen
   *  refund mode ('original' = recorded net line, 'forfeit' =
   *  header discount forfeited) and the pro-rata goods total the
   *  first mode button shows. Owned by the workspace; the modal
   *  only renders the two mode buttons with their amounts. */
  discountMode?: 'original' | 'forfeit';
  onDiscountModeChange?: (mode: 'original' | 'forfeit') => void;
  originalGoodsTotal?: number;
  /** INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the merchant's
   *  requested final goods refund (computed + goodwill) and its
   *  reason, owned by the workspace; the modal only renders the
   *  forfeit breakdown the backend preview returned. */
  goodwillRefundAmount?: string;
  goodwillReason?: string;
  onGoodwillRefundAmountChange?: (value: string) => void;
  onGoodwillReasonChange?: (value: string) => void;
  isAdminRole?: boolean;
  isReliefPreviewLoading?: boolean;
  // T11-C: a failed relief preview must fail LOUD — the error is
  // shown, the displayed amount is flagged as unverified, and
  // confirm stays blocked until the preview loads or the retry
  // succeeds. Never silently fall back to the lines total.
  isReliefPreviewError?: boolean;
  reliefPreviewError?: string | null;
  onRetryReliefPreview?: () => void;
  canUseCreditSettlement: boolean;
  settlementNeedsRefundMethod: boolean;
  isBusy: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  onFormChange: (updater: (current: ReturnFormState) => ReturnFormState) => void;
  onResetForm: () => void;
  onToggleItem: (productId: string, checked: boolean) => void;
  onSetItemQty: (productId: string, value: string) => void;
  onSetSerials: (itemId: string, value: string) => void;
  onOpenConfirm?: () => void;
  onSubmitReturn?: (params: { reason: string; managerPin?: string }) => void;
  returnReason?: string;
  onReturnReasonChange?: (val: string) => void;
  managerPin?: string;
  onManagerPinChange?: (val: string) => void;
  needsManagerApproval?: boolean;
  managerPinHint?: string;
  returnedQtyByLine?: Record<string, number>;
  blockedProductIds?: string[];
  returnHistoryReady?: boolean;
  returnQuantitiesValid?: boolean;
  canRetryUnresolved?: boolean;
};

export function ReturnsCreateModal(props: Props) {
  const { t } = useTranslation();
  const {
    isOpen,
    onClose,
    form,
    invoiceRows,
    selectedInvoice,
    invoiceItems,
    selectedItems,
    selectedSerials,
    selectedItemsCount,
    selectedQtyTotal,
    expectedReturnValue,
    reliefPreview = null,
    discountMode = 'original',
    onDiscountModeChange,
    originalGoodsTotal,
    goodwillRefundAmount = '',
    goodwillReason = '',
    onGoodwillRefundAmountChange,
    onGoodwillReasonChange,
    isAdminRole = false,
    isReliefPreviewLoading = false,
    isReliefPreviewError = false,
    reliefPreviewError = null,
    onRetryReliefPreview,
    canUseCreditSettlement,
    settlementNeedsRefundMethod,
    isBusy,
    isError,
    isSuccess,
    error,
    onFormChange,
    onResetForm,
    onToggleItem,
    onSetItemQty,
    onSetSerials,
    onOpenConfirm,
    onSubmitReturn,
    returnReason: controlledReason,
    onReturnReasonChange,
    managerPin: controlledPin,
    onManagerPinChange,
    needsManagerApproval = false,
    managerPinHint,
    returnedQtyByLine = {},
    blockedProductIds = [],
    returnHistoryReady = false,
    returnQuantitiesValid = false,
    canRetryUnresolved = false,
  } = props;

  const [localReason, setLocalReason] = useState('');
  const [localPin, setLocalPin] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [pinError, setPinError] = useState(false);

  const effectiveReason = controlledReason !== undefined ? controlledReason : localReason;
  const setEffectiveReason = onReturnReasonChange || setLocalReason;

  const effectivePin = controlledPin !== undefined ? controlledPin : localPin;
  const setEffectivePin = onManagerPinChange || setLocalPin;

  if (!isOpen) return null;

  // INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the forfeit breakdown
  // comes from the backend preview only. The merchant picks one of
  // two refund modes per return — the goodwill rules apply to the
  // CHOSEN mode's computed amount, and a goodwill extra above it
  // needs a clear reason before confirm, and the workspace requires
  // the manager PIN for non-admins.
  const forfeit = reliefPreview?.forfeit?.applies ? reliefPreview.forfeit : null;
  const originalAmount = Number(originalGoodsTotal ?? reliefPreview?.originalGoodsTotal ?? reliefPreview?.goodsTotal ?? 0);
  const selectedComputed = discountMode === 'forfeit' && forfeit
    ? Number(forfeit.computedGoodsRefund || 0) : originalAmount;
  const goodwillAmountValue = Number(goodwillRefundAmount || 0);
  const goodwillExceedsComputed = Boolean(
    forfeit && Number.isFinite(goodwillAmountValue) && goodwillAmountValue > 0
    && goodwillAmountValue > selectedComputed,
  );
  const goodwillExtra = goodwillExceedsComputed
    ? Number((goodwillAmountValue - selectedComputed).toFixed(2)) : 0;
  const goodwillReasonMissing = goodwillExceedsComputed && !goodwillReason.trim();

  const handleConfirmClick = () => {
    if (onSubmitReturn) {
      if (!effectiveReason.trim()) {
        setReasonError(true);
        return;
      }
      setReasonError(false);

      if (needsManagerApproval && !effectivePin.trim()) {
        setPinError(true);
        return;
      }
      setPinError(false);

      onSubmitReturn({
        reason: effectiveReason.trim(),
        managerPin: effectivePin.trim() || undefined,
      });
      return;
    }

    onOpenConfirm?.();
  };

  const isConfirmDisabled =
    !selectedInvoice ||
    selectedItemsCount === 0 ||
    isBusy ||
    isReliefPreviewLoading ||
    isReliefPreviewError ||
    (!returnQuantitiesValid && !canRetryUnresolved) ||
    goodwillReasonMissing;

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(1100px, calc(100vw - 32px))"
      height="88vh"
      maxHeight="860px"
      minHeight="min(860px, 88vh)"
      showCloseButton={true}
      ariaLabel={t('returns.create_modal_title', 'تسجيل مرتجع جديد')}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          boxSizing: 'border-box',
          background: '#ffffff',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        {/* Header - Fixed Top */}
        <div
          style={{
            padding: '16px 22px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '4px', height: '18px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
              <h3 className="no-pseudo-bar" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                {t('returns.create_modal_title', 'تسجيل مرتجع جديد')}
                {selectedInvoice ? (
                  <span
                    style={{
                      marginInlineStart: '10px',
                      color: '#170e5e',
                      fontSize: '13px',
                      background: '#f1f5f9',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      fontWeight: 700,
                    }}
                  >
                    ({selectedInvoice.docNo || selectedInvoice.id})
                  </span>
                ) : null}
              </h3>
            </div>
            <p style={{ margin: '3px 0 0 12px', fontSize: '12px', color: '#64748b' }}>
              {t('returns.create_modal_desc', 'حدد الفاتورة والأصناف والكميات المراد إرجاعها واسترداد قيمتها للعميل.')}
            </p>
          </div>
        </div>

        {/* Scrollable Body - 2 Symmetrical Columns */}
        <div
          data-testid="returns-create-modal-body"
          style={{
            padding: '16px 22px',
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(360px, 1fr)',
            gap: '16px',
            alignItems: 'start',
          }}
        >
          {/* Right Column: Options + Items Table + Return Reason */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
            {/* Options Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '8px',
                background: '#f8fafc',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div>
                <Field label={t('returns.field_type', 'نوع المرتجع')}>
                  <CustomSelect
                    value={form.type}
                    onChange={(val) =>
                      onFormChange((current) => ({
                        ...current,
                        type: val as 'sale' | 'purchase',
                        invoiceId: '',
                        settlementMode: 'refund',
                        refundMethod: 'cash',
                      }))
                    }
                    options={[
                      { value: 'sale', label: t('returns.type.sale', 'مرتجع بيع') },
                      { value: 'purchase', label: t('returns.type.purchase', 'مرتجع شراء') },
                    ]}
                  />
                </Field>
              </div>

              <div>
                <Field
                  label={
                    <>
                      {t('returns.field_invoice', 'الفاتورة')}{' '}
                      <span style={{ color: '#ef4444', fontWeight: 800 }}>*</span>
                    </>
                  }
                >
                  <CustomSelect
                    value={form.invoiceId}
                    onChange={(val) => onFormChange((current) => ({ ...current, invoiceId: val }))}
                    options={[
                      { value: '', label: t('returns.select_invoice', 'اختر الفاتورة') },
                      ...invoiceRows.map((inv) => ({ value: inv.id, label: inv.docNo || inv.id })),
                    ]}
                  />
                </Field>
              </div>

              <div>
                <Field label={t('returns.field_settlement', 'آلية التسوية')}>
                  <CustomSelect
                    value={form.settlementMode}
                    onChange={(val) =>
                      onFormChange((current) => ({
                        ...current,
                        settlementMode: val as 'refund' | 'store_credit',
                        refundMethod: val === 'refund' ? current.refundMethod : 'cash',
                      }))
                    }
                    options={[
                      { value: 'refund', label: t('returns.settlement_refund', 'استرجاع المبلغ') },
                      ...(canUseCreditSettlement ? [{ value: 'store_credit', label: t('returns.settlement_credit', 'رصيد متجر') }] : []),
                    ]}
                  />
                </Field>
              </div>

              <div>
                <Field label={t('returns.field_refund_method', 'طريقة الرد')}>
                  <CustomSelect
                    value={form.refundMethod}
                    disabled={!settlementNeedsRefundMethod}
                    onChange={(val) => onFormChange((current) => ({ ...current, refundMethod: val as 'cash' | 'card' }))}
                    options={[
                      { value: 'cash', label: t('returns.method_cash', 'نقدي') },
                      { value: 'card', label: t('returns.method_card', 'بطاقة') },
                    ]}
                  />
                </Field>
              </div>
            </div>

            {/* Items Table Card */}
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px',
                background: '#ffffff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                <span>{t('returns.available_items_label', 'الأصناف المتاحة للإرجاع في هذه الفاتورة:')}</span>
              </div>
              {returnHistoryReady && selectedItemsCount > 0 && !returnQuantitiesValid && !canRetryUnresolved ? (
                <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8, background: '#fef2f2', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                  الكمية المطلوبة تتجاوز المتبقي في أحد بنود الفاتورة؛ عدّل الكمية قبل اعتماد المرتجع.
                </div>
              ) : null}
              {canRetryUnresolved ? (
                <div role="alert" style={{ color: '#9a3412', marginBottom: 8, fontSize: 12, background: '#fffbeb', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fed7aa' }}>
                  طلب المرتجع السابق غير محسوم. إعادة المحاولة تستخدم الطلب ومفتاح منع التكرار الأصليين فقط.
                </div>
              ) : null}
              {!returnHistoryReady && selectedInvoice && !canRetryUnresolved ? (
                <div role="status" style={{ color: '#9a3412', marginBottom: 8, fontSize: 12, background: '#fffbeb', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fed7aa' }}>
                  كميات المرتجعات السابقة لم يتم تأكيدها؛ لا يمكن الاعتماد قبل تحميلها بنجاح.
                </div>
              ) : null}
              <ReturnsInvoiceItemsTable
                invoiceItems={invoiceItems}
                selectedItems={selectedItems}
                selectedSerials={selectedSerials}
                onToggleItem={onToggleItem}
                onSetItemQty={onSetItemQty}
                onSetSerials={onSetSerials}
                returnedQtyByLine={returnedQtyByLine}
                blockedProductIds={blockedProductIds}
                returnHistoryReady={returnHistoryReady}
              />
            </div>

            {/* Return Reason & Additional Note Box */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <Field
                    label={
                      <>
                        {t('returns.reason_label', 'سبب المرتجع')}{' '}
                        <span style={{ color: '#ef4444', fontWeight: 800 }}>*</span>
                      </>
                    }
                  >
                    <input
                      type="text"
                      value={effectiveReason}
                      onChange={(e) => {
                        setEffectiveReason(e.target.value);
                        if (e.target.value.trim()) setReasonError(false);
                      }}
                      placeholder={t('returns.reason_placeholder', 'اكتب سبب المرتجع')}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: reasonError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '12.5px',
                      }}
                    />
                  </Field>
                  {reasonError ? (
                    <div role="alert" style={{ fontSize: '11px', color: '#b91c1c', marginTop: '3px' }}>
                      يرجى كتابة سبب المرتجع قبل التأكيد.
                    </div>
                  ) : null}
                </div>

                <div>
                  <Field label={t('returns.field_note', 'ملاحظة إضافية (اختياري)')}>
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => onFormChange((current) => ({ ...current, note: e.target.value }))}
                      placeholder={t('returns.note_placeholder', 'اكتب أي ملاحظة تظهر في سجل المرتجع...')}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12.5px',
                      }}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <MutationFeedback isError={isError} isSuccess={isSuccess} error={error} successText={t('returns.create_success', 'تم تسجيل المرتجع بنجاح.')} />
          </div>

          {/* Left Column: Financial Summary + Conditional Discount Forfeit + Hero Total */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* Summary Title */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                <span>{t('returns.summary_card_title', 'ملخص الحساب والتسوية')}</span>
              </div>
              {selectedInvoice ? (
                <span style={{ fontSize: '11px', color: '#64748b', background: '#ffffff', padding: '2px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  {form.type === 'sale' ? t('returns.type.sale', 'مرتجع بيع') : t('returns.type.purchase', 'مرتجع شراء')}
                </span>
              ) : null}
            </div>

            {selectedInvoice ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_orig_invoice', 'الفاتورة الأصلية')}:</span>
                  <strong style={{ color: '#0f172a', fontWeight: 700 }}>{selectedInvoice.docNo || selectedInvoice.id}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_party', 'الطرف')}:</span>
                  <strong style={{ color: '#0f172a' }}>
                    {('customerName' in selectedInvoice ? selectedInvoice.customerName : selectedInvoice.supplierName) || t('returns.cash_customer', 'عميل نقدي')}
                  </strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_orig_total', 'إجمالي الفاتورة')}:</span>
                  <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(Number(selectedInvoice.total || 0))}</strong>
                </div>

                <div style={{ borderTop: '1px dashed #cbd5e1', margin: '2px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_selected_items', 'البنود المحددة للإرجاع')}:</span>
                  <strong style={{ color: '#0284c7', fontWeight: 800 }}>{selectedItemsCount} {t('returns.item_unit_item', 'بند')}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_selected_qty', 'إجمالي القطع المسترجعة')}:</span>
                  <strong style={{ color: '#0284c7', fontWeight: 800 }}>{selectedQtyTotal} {t('returns.item_unit_piece', 'قطعة')}</strong>
                </div>

                {/* T10-D: the refund breakdown from the backend relief preview */}
                {reliefPreview ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.relief_goods', 'قيمة البضاعة المرتجعة')}:</span>
                      <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(Number(reliefPreview.goodsTotal || 0))}</strong>
                    </div>
                    {Number(reliefPreview.tipRelief || 0) > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.relief_tip', 'استرداد الإكرامية')}:</span>
                        <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(Number(reliefPreview.tipRelief || 0))}</strong>
                      </div>
                    ) : null}
                    {Number(reliefPreview.courierRelief || 0) > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.relief_courier', 'استرداد رسوم التوصيل')}:</span>
                        <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(Number(reliefPreview.courierRelief || 0))}</strong>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {/* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT:
                    Conditional Discount Forfeit Card inside the financial calculation column */}
                {forfeit ? (
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      marginTop: '2px',
                    }}
                  >
                    <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px' }}>
                      {t('returns.forfeit_title', 'خصم الفاتورة مشروط بكمية الصفقة — اختر طريقة الرد حسب الاتفاق')}
                    </div>

                    {/* Mode Buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <button
                        type="button"
                        aria-pressed={discountMode === 'original'}
                        onClick={() => onDiscountModeChange?.('original')}
                        style={{
                          width: '100%',
                          textAlign: 'start',
                          cursor: 'pointer',
                          background: discountMode === 'original' ? '#f0fdf4' : '#ffffff',
                          border: discountMode === 'original' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: discountMode === 'original' ? '#15803d' : '#0f172a' }}>
                            {t('returns.mode_original', 'إرجاع بالسعر الأصلي')}
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', background: '#f8fafc', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            {formatCurrency(originalAmount)}
                          </span>
                        </div>
                        <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {t('returns.mode_original_hint', 'القطعة ترجع بسعرها اللي في الفاتورة، والخصم يفضل ساري على الباقي')}
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-pressed={discountMode === 'forfeit'}
                        onClick={() => onDiscountModeChange?.('forfeit')}
                        style={{
                          width: '100%',
                          textAlign: 'start',
                          cursor: 'pointer',
                          background: discountMode === 'forfeit' ? '#eff6ff' : '#ffffff',
                          border: discountMode === 'forfeit' ? '2px solid #1d4ed8' : '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: discountMode === 'forfeit' ? '#1d4ed8' : '#0f172a' }}>
                            {t('returns.mode_forfeit', 'إرجاع بإلغاء الخصم')}
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', background: '#f8fafc', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            {formatCurrency(Number(forfeit.computedGoodsRefund || 0))}
                          </span>
                        </div>
                        <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {t('returns.mode_forfeit_hint', 'خصم الفاتورة يتلغي والقطع اللي فضلت تتحسب بسعرها الأصلي قبل الخصم')}
                        </span>
                      </button>
                    </div>

                    {/* Breakdown 2x2 Grid */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '5px 8px',
                        background: '#f8fafc',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        fontSize: '11px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.forfeit_remaining', 'الباقي مع العميل بالسعر الأصلي')}:</span>
                        <strong style={{ color: '#0f172a', fontWeight: 700 }}>{formatCurrency(Number(forfeit.remainingNetAtOriginal || 0))}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.forfeit_discount', 'خصم الفاتورة الملغي')}:</span>
                        <strong style={{ color: '#b91c1c', fontWeight: 700 }}>{formatCurrency(Number(forfeit.forfeitedHeaderDiscount || 0))}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.forfeit_computed', 'المبلغ المسترد المحسوب')}:</span>
                        <strong style={{ color: '#0284c7', fontWeight: 800 }}>{formatCurrency(Number(forfeit.computedGoodsRefund || 0))}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.forfeit_cap', 'أعلى مبلغ يمكن منحه (سعر القطع المرتجعة)')}:</span>
                        <strong style={{ color: '#0f172a', fontWeight: 700 }}>{formatCurrency(Number(forfeit.goodwillCap || 0))}</strong>
                      </div>
                    </div>

                    {/* Goodwill Input */}
                    <Field label={t('returns.goodwill_amount_label', 'المبلغ المسترد المطلوب (اختياري — أعلى من المحسوب تسوية ودية)')}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={goodwillRefundAmount}
                        onChange={(e) => onGoodwillRefundAmountChange?.(e.target.value)}
                        placeholder={formatCurrency(selectedComputed)}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                      />
                    </Field>

                    {goodwillExceedsComputed ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div
                          role="alert"
                          style={{
                            fontSize: '11px',
                            color: isAdminRole ? '#92400e' : '#991b1b',
                            background: isAdminRole ? '#fefce8' : '#fef2f2',
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: isAdminRole ? '1px solid #fef08a' : '1px solid #fecaca',
                          }}
                        >
                          {isAdminRole
                            ? t('returns.goodwill_admin_warning', 'تنبيه: المبلغ أعلى من المحسوب بمقدار {{amount}} — تسوية ودية تُسجَّل بسبب واضح.', { amount: formatCurrency(goodwillExtra) })
                            : t('returns.goodwill_cashier_note', 'الزيادة عن المحسوب ({{amount}}) تتطلب رمز المدير عند التأكيد.', { amount: formatCurrency(goodwillExtra) })}
                        </div>
                        <Field
                          label={
                            <>
                              {t('returns.goodwill_reason_label', 'سبب التسوية الودية')}{' '}
                              <span style={{ color: '#ef4444', fontWeight: 800 }}>*</span>
                            </>
                          }
                        >
                          <input
                            type="text"
                            value={goodwillReason}
                            onChange={(e) => onGoodwillReasonChange?.(e.target.value)}
                            placeholder={t('returns.goodwill_reason_placeholder', 'اكتب سبب الزيادة عن المبلغ المحسوب')}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: goodwillReasonMissing ? '1px solid #ef4444' : '1px solid #cbd5e1',
                              fontSize: '12px',
                            }}
                          />
                        </Field>
                        {goodwillReasonMissing ? (
                          <div role="alert" style={{ fontSize: '11px', color: '#991b1b' }}>
                            {t('returns.goodwill_reason_required', 'اكتب سبب التسوية الودية قبل التأكيد.')}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* T11-C: relief preview error and status */}
                {isReliefPreviewError ? (
                  <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px 10px', fontSize: '11.5px', color: '#991b1b' }}>
                    <div style={{ fontWeight: 800, marginBottom: '2px' }}>تعذّر حساب مبلغ الاسترداد من الخادم — القيمة المعروضة هي قيمة البضاعة فقط ولم تُؤكَّد بعد.</div>
                    {reliefPreviewError ? (
                      <div style={{ color: '#b91c1c', marginBottom: '4px' }}>{reliefPreviewError}</div>
                    ) : null}
                    {onRetryReliefPreview ? (
                      <Button type="button" variant="secondary" onClick={onRetryReliefPreview} style={{ padding: '3px 8px', fontSize: '11.5px' }}>
                        إعادة حساب الاسترداد
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {isReliefPreviewLoading && !isReliefPreviewError ? (
                  <div role="status" style={{ color: '#9a3412', fontSize: '12px' }}>
                    جارٍ حساب مبلغ الاسترداد من الخادم…
                  </div>
                ) : null}

                {/* Hero Total Refund Box */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '2px solid #170e5e',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    textAlign: 'center',
                    marginTop: '2px',
                  }}
                >
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>
                    {form.type === 'sale' ? t('returns.total_refund_customer', 'إجمالي المبلغ المسترد للعميل') : t('returns.total_refund_supplier', 'إجمالي المبلغ المسترد من المورد')}
                  </div>
                  <div style={{ fontSize: '1.65rem', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
                    {selectedItemsCount ? formatCurrency(expectedReturnValue) : formatCurrencyWithSymbol(0)}
                  </div>
                </div>

                {/* Manager PIN Container (if required) */}
                {needsManagerApproval ? (
                  <div style={{ background: '#ffffff', border: '1px dashed #0284c7', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1' }}>
                      {t('returns.manager_pin_label', 'رمز اعتماد المشرف / كلمة المرور')}{' '}
                      <span style={{ color: '#ef4444', fontWeight: 800 }}>*</span>
                    </div>
                    <input
                      type="password"
                      value={effectivePin}
                      onChange={(e) => {
                        setEffectivePin(e.target.value);
                        if (e.target.value.trim()) setPinError(false);
                      }}
                      placeholder="أدخل رمز المدير للموافقة"
                      style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: pinError ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '12px' }}
                    />
                    {managerPinHint ? (
                      <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>{managerPinHint}</div>
                    ) : null}
                    {pinError ? (
                      <div role="alert" style={{ fontSize: '11px', color: '#b91c1c' }}>
                        يرجى إدخال رمز المشرف للاعتماد.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                {t('returns.select_invoice_hint', 'اختر فاتورة لعرض ملخص الحساب')}
              </div>
            )}
          </div>
        </div>

        {/* Footer - Dedicated Bottom Action Bar */}
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            padding: '12px 22px',
            background: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          {/* Action Buttons on the Left (in RTL) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmClick}
              disabled={isConfirmDisabled}
              style={{
                padding: '9px 24px',
                fontWeight: 800,
                fontSize: '13.5px',
                backgroundColor: '#170e5e',
                borderColor: '#170e5e',
                color: '#ffffff',
                minWidth: '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>{form.type === 'sale' ? t('returns.btn_confirm_sale', 'تسجيل وتأكيد مرتجع البيع') : t('returns.btn_confirm_purchase', 'تسجيل وتأكيد مرتجع الشراء')}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onResetForm}
              disabled={isBusy}
              style={{ padding: '8px 14px', fontSize: '12.5px' }}
            >
              {t('common.clear', 'تفريغ')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isBusy}
              style={{ padding: '8px 14px', fontSize: '12.5px' }}
            >
              {t('common.close_esc', 'إغلاق (Esc)')}
            </Button>
          </div>

          {/* Quick Summary Pill on the Right (in RTL) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#64748b' }}>
            {selectedInvoice ? (
              <>
                <span>الفاتورة: <strong style={{ color: '#0f172a' }}>{selectedInvoice.docNo || selectedInvoice.id}</strong></span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>البنود: <strong style={{ color: '#0284c7', fontWeight: 700 }}>{selectedItemsCount} بند ({selectedQtyTotal} قطعة)</strong></span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>المسترد: <strong style={{ color: '#170e5e', fontWeight: 800, fontSize: '13.5px' }}>{formatCurrency(expectedReturnValue)}</strong></span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
