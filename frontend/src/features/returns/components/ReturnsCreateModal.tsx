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
  onOpenConfirm: () => void;
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
    returnedQtyByLine = {},
    blockedProductIds = [],
    returnHistoryReady = false,
    returnQuantitiesValid = false,
    canRetryUnresolved = false,
  } = props;

  if (!isOpen) return null;

  // INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the forfeit breakdown
  // comes from the backend preview only. The merchant picks one of
  // two refund modes per return — the goodwill rules apply to the
  // CHOSEN mode's computed amount, and a goodwill extra above it
  // needs a clear reason before confirm, and the workspace requires
  // the manager PIN for non-admins.
  const forfeit = reliefPreview?.forfeit?.applies ? reliefPreview.forfeit : null;
  const originalAmount = Number(originalGoodsTotal ?? reliefPreview?.goodsTotal ?? 0);
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

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(1060px, calc(100vw - 32px))"
      showCloseButton={true}
      ariaLabel={t('returns.create_modal_title', 'تسجيل مرتجع جديد')}
    >
      <div
        style={{
          padding: '24px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxHeight: '88vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '12px',
            paddingInlineEnd: '36px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                {t('returns.create_modal_title', 'تسجيل مرتجع جديد')}
                {selectedInvoice ? (
                  <span style={{ marginInlineStart: '10px', color: 'var(--primary-color, #0284c7)', fontFamily: 'monospace' }}>
                    ({selectedInvoice.docNo || selectedInvoice.id})
                  </span>
                ) : null}
              </h3>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {t('returns.create_modal_desc', 'حدد الفاتورة والأصناف والكميات المراد إرجاعها واسترداد قيمتها للعميل.')}
            </p>
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.75fr) minmax(280px, 1fr)',
            gap: '18px',
            alignItems: 'start',
          }}
        >
          {/* Right Column: Options + Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            {/* Options Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '10px',
                background: '#f8fafc',
                padding: '12px 14px',
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
                <Field label={t('returns.field_invoice', 'الفاتورة')}>
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

            {/* Items Table */}
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px',
                background: '#fff',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                {t('returns.available_items_label', 'الأصناف المتاحة للإرجاع في هذه الفاتورة:')}
              </div>
              {returnHistoryReady && selectedItemsCount > 0 && !returnQuantitiesValid && !canRetryUnresolved ? (
                <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>
                  الكمية المطلوبة تتجاوز المتبقي في أحد بنود الفاتورة؛ عدّل الكمية قبل اعتماد المرتجع.
                </div>
              ) : null}
              {canRetryUnresolved ? (
                <div role="alert" style={{ color: '#9a3412', marginBottom: 8, fontSize: 12 }}>
                  طلب المرتجع السابق غير محسوم. إعادة المحاولة تستخدم الطلب ومفتاح منع التكرار الأصليين فقط.
                </div>
              ) : null}
              {!returnHistoryReady && selectedInvoice && !canRetryUnresolved ? (
                <div role="status" style={{ color: '#9a3412', marginBottom: 8, fontSize: 12 }}>
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

            {/* Note Field */}
            <div>
              <Field label={t('returns.field_note', 'ملاحظة إضافية (اختياري)')}>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => onFormChange((current) => ({ ...current, note: e.target.value }))}
                  placeholder={t('returns.note_placeholder', 'اكتب أي ملاحظة تظهر في سجل المرتجع...')}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </Field>
            </div>

            <MutationFeedback isError={isError} isSuccess={isSuccess} error={error} successText={t('returns.create_success', 'تم تسجيل المرتجع بنجاح.')} />
          </div>

          {/* Left Column: Summary Card & Actions */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              position: 'sticky',
              top: 0,
            }}
          >
            <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              {t('returns.summary_card_title', 'ملخص الحساب والتسوية')}
            </div>

            {selectedInvoice ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_orig_invoice', 'الفاتورة الأصلية')}:</span>
                  <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{selectedInvoice.docNo || selectedInvoice.id}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_party', 'الطرف')}:</span>
                  <strong style={{ color: '#0f172a' }}>
                    {('customerName' in selectedInvoice ? selectedInvoice.customerName : selectedInvoice.supplierName) || t('returns.cash_customer', 'عميل نقدي')}
                  </strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_orig_total', 'إجمالي الفاتورة')}:</span>
                  <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(selectedInvoice.total || 0))}</strong>
                </div>

                <div style={{ borderTop: '1px dashed #cbd5e1', margin: '4px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_selected_items', 'البنود المحددة للإرجاع')}:</span>
                  <strong style={{ color: '#0284c7' }}>{selectedItemsCount} {t('returns.item_unit_item', 'بند')}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>{t('returns.summary_selected_qty', 'إجمالي القطع المسترجعة')}:</span>
                  <strong style={{ color: '#0284c7' }}>{selectedQtyTotal} {t('returns.item_unit_piece', 'قطعة')}</strong>
                </div>

                {/* T10-D: the refund breakdown from the backend relief
                    preview — goods + tip relief + courier relief. The
                    hero total below is the preview refundTotal, i.e.
                    what the backend will actually pay. */}
                {reliefPreview ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.relief_goods', 'قيمة البضاعة المرتجعة')}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(reliefPreview.goodsTotal || 0))}</strong>
                    </div>
                    {Number(reliefPreview.tipRelief || 0) > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.relief_tip', 'استرداد الإكرامية')}:</span>
                        <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(reliefPreview.tipRelief || 0))}</strong>
                      </div>
                    ) : null}
                    {Number(reliefPreview.courierRelief || 0) > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>{t('returns.relief_courier', 'استرداد رسوم التوصيل')}:</span>
                        <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(reliefPreview.courierRelief || 0))}</strong>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {/* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the
                    header discount is conditional on the deal
                    quantity, so a partial return forfeits it
                    entirely and the kept pieces reprice at original
                    price. Every number here comes from the backend
                    preview — the dialog never computes money. */}
                {forfeit ? (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#92400e' }}>
                      {t('returns.forfeit_title', 'خصم الفاتورة مشروط بكمية الصفقة — اختر طريقة الرد حسب الاتفاق')}
                    </div>
                    {/* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the
                        two merchant-chosen refund modes. Each button
                        shows its own computed amount before the
                        merchant presses it; the chosen mode is stored
                        on the return document. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        type="button"
                        aria-pressed={discountMode === 'original'}
                        onClick={() => onDiscountModeChange?.('original')}
                        style={{
                          width: '100%', textAlign: 'start', cursor: 'pointer',
                          background: discountMode === 'original' ? '#eff6ff' : '#fff',
                          border: discountMode === 'original' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                          borderRadius: '10px', padding: '10px 12px',
                          display: 'flex', flexDirection: 'column', gap: '2px',
                        }}
                      >
                        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                          <span>{t('returns.mode_original', 'إرجاع بالسعر الأصلي')}</span>
                          <span style={{ fontFamily: 'monospace' }}>{formatCurrency(originalAmount)}</span>
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {t('returns.mode_original_hint', 'القطعة ترجع بسعرها اللي في الفاتورة، والخصم يفضل ساري على الباقي')}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={discountMode === 'forfeit'}
                        onClick={() => onDiscountModeChange?.('forfeit')}
                        style={{
                          width: '100%', textAlign: 'start', cursor: 'pointer',
                          background: discountMode === 'forfeit' ? '#eff6ff' : '#fff',
                          border: discountMode === 'forfeit' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                          borderRadius: '10px', padding: '10px 12px',
                          display: 'flex', flexDirection: 'column', gap: '2px',
                        }}
                      >
                        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                          <span>{t('returns.mode_forfeit', 'إرجاع بإلغاء الخصم')}</span>
                          <span style={{ fontFamily: 'monospace' }}>{formatCurrency(Number(forfeit.computedGoodsRefund || 0))}</span>
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {t('returns.mode_forfeit_hint', 'خصم الفاتورة يتلغي والقطع اللي فضلت تتحسب بسعرها الأصلي قبل الخصم')}
                        </span>
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.forfeit_remaining', 'الباقي مع العميل بالسعر الأصلي')}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(forfeit.remainingNetAtOriginal || 0))}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.forfeit_discount', 'خصم الفاتورة الملغي')}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(forfeit.forfeitedHeaderDiscount || 0))}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.forfeit_computed', 'المبلغ المسترد المحسوب')}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(forfeit.computedGoodsRefund || 0))}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>{t('returns.forfeit_cap', 'أعلى مبلغ يمكن منحه (سعر القطع المرتجعة)')}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatCurrency(Number(forfeit.goodwillCap || 0))}</strong>
                    </div>
                    <Field label={t('returns.goodwill_amount_label', 'المبلغ المسترد المطلوب (اختياري — أعلى من المحسوب تسوية ودية)')}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={goodwillRefundAmount}
                        onChange={(e) => onGoodwillRefundAmountChange?.(e.target.value)}
                        placeholder={formatCurrency(selectedComputed)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      />
                    </Field>
                    {goodwillExceedsComputed ? (
                      <>
                        <div role="alert" style={{ fontSize: '12.5px', color: isAdminRole ? '#92400e' : '#991b1b' }}>
                          {isAdminRole
                            ? t('returns.goodwill_admin_warning', 'تنبيه: المبلغ أعلى من المحسوب بمقدار {{amount}} — تسوية ودية تُسجَّل بسبب واضح.', { amount: formatCurrency(goodwillExtra) })
                            : t('returns.goodwill_cashier_note', 'الزيادة عن المحسوب ({{amount}}) تتطلب رمز المدير عند التأكيد.', { amount: formatCurrency(goodwillExtra) })}
                        </div>
                        <Field label={t('returns.goodwill_reason_label', 'سبب التسوية الودية (إلزامي)')}>
                          <input
                            type="text"
                            value={goodwillReason}
                            onChange={(e) => onGoodwillReasonChange?.(e.target.value)}
                            placeholder={t('returns.goodwill_reason_placeholder', 'اكتب سبب الزيادة عن المبلغ المحسوب')}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                          />
                        </Field>
                        {goodwillReasonMissing ? (
                          <div role="alert" style={{ fontSize: '12.5px', color: '#991b1b' }}>
                            {t('returns.goodwill_reason_required', 'اكتب سبب التسوية الودية قبل التأكيد.')}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}

                {/* T11-C: a failed preview fails LOUD — the error is
                    shown with a retry, the amount below is flagged
                    as unverified, and confirm stays blocked. */}
                {isReliefPreviewError ? (
                  <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 14px', fontSize: '12.5px', color: '#991b1b' }}>
                    <div style={{ fontWeight: 800, marginBottom: '4px' }}>تعذّر حساب مبلغ الاسترداد من الخادم — القيمة المعروضة هي قيمة البضاعة فقط ولم تُؤكَّد بعد.</div>
                    {reliefPreviewError ? (
                      <div style={{ color: '#b91c1c', marginBottom: '8px' }}>{reliefPreviewError}</div>
                    ) : null}
                    {onRetryReliefPreview ? (
                      <Button type="button" variant="secondary" onClick={onRetryReliefPreview} style={{ padding: '6px 12px', fontSize: '12.5px' }}>
                        إعادة حساب الاسترداد
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {isReliefPreviewLoading && !isReliefPreviewError ? (
                  <div role="status" style={{ color: '#9a3412', fontSize: '12.5px' }}>
                    جارٍ حساب مبلغ الاسترداد من الخادم…
                  </div>
                ) : null}

                {/* Hero Total Refund Box */}
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    padding: '14px',
                    textAlign: 'center',
                    marginTop: '6px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e40af' }}>
                    {form.type === 'sale' ? t('returns.total_refund_customer', 'إجمالي المبلغ المسترد للعميل') : t('returns.total_refund_supplier', 'إجمالي المبلغ المسترد من المورد')}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1d4ed8', marginTop: '4px' }}>
                    {selectedItemsCount ? formatCurrency(expectedReturnValue) : formatCurrencyWithSymbol(0)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                {t('returns.select_invoice_hint', 'اختر فاتورة لعرض ملخص الحساب')}
              </div>
            )}

            {/* Actions in Summary Card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
              <Button
                type="button"
                variant="primary"
                onClick={onOpenConfirm}
                disabled={!selectedInvoice || selectedItemsCount === 0 || isBusy || isReliefPreviewLoading || isReliefPreviewError || (!returnQuantitiesValid && !canRetryUnresolved) || goodwillReasonMissing}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontWeight: 700,
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span>{form.type === 'sale' ? t('returns.btn_confirm_sale', 'تسجيل وتأكيد مرتجع البيع') : t('returns.btn_confirm_purchase', 'تسجيل وتأكيد مرتجع الشراء')}</span>
              </Button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onResetForm}
                  disabled={isBusy}
                  style={{ flex: 1, padding: '8px', fontSize: '12.5px' }}
                >
                  {t('common.clear', 'تفريغ')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  disabled={isBusy}
                  style={{ flex: 1, padding: '8px', fontSize: '12.5px' }}
                >
                  {t('common.close_esc', 'إغلاق (Esc)')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
