import { useTranslation } from 'react-i18next';
import { useEffect, useState, type CSSProperties } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { formatCurrency } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useUpdateSupplierMutation } from '@/features/suppliers/hooks/useSupplierActions';
import { supplierFormSchema, type SupplierFormInput, type SupplierFormOutput } from '@/features/suppliers/schemas/supplier.schema';
import type { Supplier } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { SupplierPaymentForm } from '@/features/accounts';
import { SupplierBillForm } from '@/features/suppliers/components/SupplierBillForm';
import { SupplierBillsList } from '@/features/suppliers/components/SupplierBillsList';
import { SupplierStatementTab } from '@/features/suppliers/components/SupplierStatementTab';
import { resolveEffectiveSupplierPosition } from '@/features/suppliers/lib/supplier-statement-print';
import {
  DollarSignIcon,
  FileTextIcon,
  ReceiptIcon,
  RotateCcwIcon,
  TrashIcon,
  UserIcon,
} from '@/shared/components/icons/AppIcons';

type SupplierTab = 'details' | 'bills' | 'statement';

interface SupplierEditorCardProps {
  supplier?: Supplier;
  onSaved?: () => void;
  canDelete?: boolean;
  onRequestDelete?: () => void;
}

function resolveTabButtonStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '34px',
    padding: '0 13px',
    borderRadius: '8px',
    border: active ? '1px solid #170e5e' : '1px solid #e2e8f0',
    background: active ? '#170e5e' : '#ffffff',
    color: active ? '#ffffff' : '#334155',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'none',
    boxSizing: 'border-box',
  };
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: structured enterprise supplier card
 * hosting all three workflows (details / non-stock bills / statement)
 * inside a compact scroll-free viewport + pay/advance triggers. */
export function SupplierEditorCard({ supplier, onSaved, canDelete = false, onRequestDelete }: SupplierEditorCardProps) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;
  const [tab, setTab] = useState<SupplierTab>('details');
  const [paymentMode, setPaymentMode] = useState<'pay' | 'advance' | null>(null);
  const [openAdvanceBalance, setOpenAdvanceBalance] = useState(0);

  useEffect(() => {
    setOpenAdvanceBalance(0);
  }, [supplier?.id]);

  const form = useForm<SupplierFormInput, undefined, SupplierFormOutput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      balance: 0,
      notes: '',
      metadata: { currency: 'USD', supplierType: 'factory', instapayAddress: '' },
      supplierType: 'supplier',
      overdraftLimit: null,
    },
  });

  useUnsavedChangesGuard(
    form.formState.isDirty,
    t('suppliers.modal.unsaved_guard', 'لديك تعديلات غير محفوظة على بيانات المورد. هل تريد المغادرة بدون حفظ؟'),
  );

  useEffect(() => {
    form.reset({
      name: supplier?.name || '',
      phone: supplier?.phone || '',
      address: supplier?.address || '',
      balance: Number(supplier?.balance || 0),
      notes: supplier?.notes || '',
      metadata: {
        currency: String(supplier?.metadata?.currency || 'USD'),
        supplierType: String(supplier?.metadata?.supplierType || 'factory'),
        instapayAddress: String(supplier?.metadata?.instapayAddress || ''),
      },
      supplierType: supplier?.supplierType === 'freelancer' ? 'freelancer' : 'supplier',
      overdraftLimit: supplier?.overdraftLimit ?? null,
    });
  }, [supplier, form]);

  const mutation = useUpdateSupplierMutation(supplier ? String(supplier.id) : undefined, onSaved);

  if (!supplier) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b', fontSize: '13px' }}>
        {t('suppliers.modal.empty_selection', 'اختر موردًا من السجل لعرض التفاصيل والتعديل.')}
      </div>
    );
  }

  const liveBalance = Number(supplier.balance || 0);
  const effectivePosition = resolveEffectiveSupplierPosition(liveBalance, openAdvanceBalance);
  const badgeText = effectivePosition.netBalance === 0
    ? `الرصيد: ${formatCurrency(0)}`
    : `${effectivePosition.label}: ${formatCurrency(effectivePosition.absAmount)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Unified Header Bar: Tabs (RTL Start) + Operational Quick Strip (RTL End) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '7px 10px',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <div role="tablist" aria-label="أقسام بطاقة المورد" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'details'}
            style={resolveTabButtonStyle(tab === 'details')}
            onClick={() => setTab('details')}
          >
            <UserIcon size={14} />
            <span>{t('suppliers.modal.tab_details', 'البيانات الأساسية')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bills'}
            style={resolveTabButtonStyle(tab === 'bills')}
            onClick={() => setTab('bills')}
          >
            <FileTextIcon size={14} />
            <span>{t('suppliers.modal.tab_bills', 'فواتير بدون مخزون')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'statement'}
            style={resolveTabButtonStyle(tab === 'statement')}
            onClick={() => setTab('statement')}
          >
            <ReceiptIcon size={14} />
            <span>{t('suppliers.modal.tab_statement', 'كشف الحساب')}</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '999px',
              background: effectivePosition.bg,
              border: `1px solid ${effectivePosition.border}`,
              color: effectivePosition.color,
              fontSize: '11.5px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {badgeText}
          </span>

          <Button
            type="button"
            variant="primary"
            onClick={() => setPaymentMode('pay')}
            style={{ minHeight: '34px', height: '34px', padding: '0 12px', fontSize: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <DollarSignIcon size={13} />
            <span>{t('suppliers.modal.action_pay', 'دفع')}</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPaymentMode('advance')}
            style={{ minHeight: '34px', height: '34px', padding: '0 12px', fontSize: '12px', fontWeight: 700 }}
          >
            {t('suppliers.modal.action_advance', 'سحبة')}
          </Button>
          {onRequestDelete && (
            <Button
              type="button"
              variant="danger"
              onClick={onRequestDelete}
              disabled={!canDelete}
              style={{ minHeight: '34px', height: '34px', padding: '0 10px', fontSize: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <TrashIcon size={13} />
              <span>{t('suppliers.modal.action_delete', 'حذف المورد')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Fixed-Height Tab Body Pane — spacious enough for Tab 1 with zero scrollbar */}
      <div
        className="thin-scrollbar"
        style={{
          height: 'min(480px, 68vh)',
          minHeight: '420px',
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingInlineEnd: '2px',
          boxSizing: 'border-box',
        }}
      >
        {/* Tab 1: Structured Details Form */}
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          style={{
            display: tab === 'details' ? 'flex' : 'none',
            flexDirection: 'column',
            gap: '8px',
            minHeight: '100%',
          }}
        >
          {/* Card 1: Basic Identity & Contact */}
          <div className="supplier-modal-section-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
              <span style={{ width: '3px', height: '13px', borderRadius: '2px', background: '#170e5e', display: 'inline-block' }} />
              <strong style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>بيانات الهوية والتواصل</strong>
            </div>
            <div className="supplier-modal-fields-3col">
              <Field
                label="اسم المورد *"
                error={form.formState.errors.name?.message}
                className="supplier-modal-span-2"
              >
                <input
                  {...form.register('name')}
                  disabled={mutation.isPending}
                />
              </Field>
              <Field
                label="رقم الهاتف"
                error={form.formState.errors.phone?.message}
              >
                <input
                  {...form.register('phone')}
                  disabled={mutation.isPending}
                />
              </Field>
              <Field
                label="العنوان / المقر"
                error={form.formState.errors.address?.message}
                className="supplier-modal-span-2"
              >
                <input
                  {...form.register('address')}
                  disabled={mutation.isPending}
                />
              </Field>
              <Field label="حساب إنستاباي (IPA)">
                <input
                  {...form.register('metadata.instapayAddress')}
                  disabled={mutation.isPending}
                  dir="ltr"
                />
              </Field>
            </div>
          </div>

          {/* Card 2: Financial & Overdraft Controls */}
          <div className="supplier-modal-section-card supplier-modal-section-card--subtle">
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
              <span style={{ width: '3px', height: '13px', borderRadius: '2px', background: '#170e5e', display: 'inline-block' }} />
              <strong style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>الإعدادات المالية والائتمانية</strong>
            </div>
            <div className="supplier-modal-fields-3col">
              <Field label="نوع المورد">
                <Controller
                  name="supplierType"
                  control={form.control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value || 'supplier'}
                      onChange={(value) => field.onChange(value as 'supplier' | 'freelancer')}
                      options={[
                        { value: 'supplier', label: 'عادي (مورد بضاعة وخدمات)' },
                        { value: 'freelancer', label: 'فري لانس / مستقل' },
                      ]}
                      disabled={mutation.isPending}
                    />
                  )}
                />
              </Field>
              <Field
                label={`الرصيد المسجل (${getGlobalCurrencySymbol()})`}
                error={form.formState.errors.balance?.message}
              >
                <input
                  type="number"
                  step="0.01"
                  {...form.register('balance')}
                  readOnly
                  style={{ background: '#e2e8f0', color: '#334155', cursor: 'not-allowed', fontWeight: 700 }}
                />
              </Field>
              <Field
                label={`حد السحب على المكشوف (${getGlobalCurrencySymbol()})`}
                error={form.formState.errors.overdraftLimit?.message}
              >
                <Controller
                  name="overdraftLimit"
                  control={form.control}
                  render={({ field }) => (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="no-spin-arrows"
                      value={field.value ?? ''}
                      onChange={(event) => {
                        const raw = event.target.value;
                        field.onChange(raw === '' ? null : Number(raw));
                      }}
                      placeholder="بدون حد"
                      disabled={mutation.isPending}
                    />
                  )}
                />
              </Field>
            </div>
          </div>

          {importModuleEnabled && (
            <div className="supplier-modal-section-card supplier-modal-section-card--subtle">
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
                <span style={{ width: '3px', height: '13px', borderRadius: '2px', background: '#170e5e', display: 'inline-block' }} />
                <strong style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>إعدادات الاستيراد والشحن الدولي</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 10px' }}>
                <Field label="العملة الافتراضية">
                  <Controller
                    name="metadata.currency"
                    control={form.control}
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || 'USD'}
                        onChange={field.onChange}
                        options={[
                          { value: 'USD', label: 'دولار أمريكي (USD)' },
                          { value: 'EUR', label: 'يورو (EUR)' },
                          { value: 'RMB', label: 'يوان صيني (RMB)' },
                          { value: 'GBP', label: 'جنيه استرليني (GBP)' },
                          { value: 'SAR', label: 'ريال سعودي (SAR)' },
                          { value: 'AED', label: 'درهم إماراتي (AED)' },
                          { value: 'EGP', label: 'جنيه مصري (EGP)' },
                        ]}
                        placeholder="اختر العملة"
                        disabled={mutation.isPending}
                      />
                    )}
                  />
                </Field>
                <Field label="تصنيف المورد الدولي">
                  <Controller
                    name="metadata.supplierType"
                    control={form.control}
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || 'factory'}
                        onChange={field.onChange}
                        options={[
                          { value: 'factory', label: 'مصنع / مورد رئيسي (Factory)' },
                          { value: 'shipping', label: 'وكيل شحن دولي (Freight)' },
                          { value: 'customs', label: 'مخلص جمركي (Broker)' },
                          { value: 'local', label: 'تخليص ونقل داخلي (Local)' },
                        ]}
                        placeholder="اختر التصنيف"
                        disabled={mutation.isPending}
                      />
                    )}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* Card 3: Compact Notes */}
          <div className="supplier-modal-section-card">
            <Field label="ملاحظات إضافية" error={form.formState.errors.notes?.message}>
              <input
                type="text"
                {...form.register('notes')}
                disabled={mutation.isPending}
                style={{ height: '34px', fontSize: '12.5px' }}
              />
            </Field>
          </div>

          <DraftStateNotice visible={form.formState.isDirty} />
          <MutationFeedback
            isError={mutation.isError}
            error={mutation.error}
            errorFallback="تعذر تحديث بيانات المورد"
            isSuccess={mutation.isSuccess}
            successText="تم تحديث بيانات المورد بنجاح."
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              paddingTop: '8px',
              borderTop: '1px solid #e2e8f0',
              marginTop: 'auto',
            }}
          >
            <Button
              type="button"
              variant="secondary"
              disabled={!form.formState.isDirty || mutation.isPending}
              onClick={() => form.reset()}
              style={{ minHeight: '34px', height: '34px', fontSize: '12.5px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <RotateCcwIcon size={13} />
              <span>إعادة القيم</span>
            </Button>
            <SubmitButton
              isPending={mutation.isPending}
              isSuccess={mutation.isSuccess}
              pendingText="جاري التحديث..."
              idleText="حفظ التعديل"
              style={{ minHeight: '34px', height: '34px', padding: '0 20px', fontSize: '13px', fontWeight: 700 }}
            />
          </div>
        </form>

        {/* Tab 2: Non-Stock Bills (side-by-side balanced workspace) */}
        {tab === 'bills' && (
          <div className="supplier-bills-split">
            <SupplierBillForm
              supplierId={String(supplier.id)}
              supplierType={supplier.supplierType === 'freelancer' ? 'freelancer' : 'supplier'}
            />
            <SupplierBillsList supplierId={String(supplier.id)} />
          </div>
        )}

        {/* Tab 3: Supplier Statement */}
        {tab === 'statement' && (
          <SupplierStatementTab
            supplier={supplier}
            onOpenAdvanceLoaded={setOpenAdvanceBalance}
          />
        )}
      </div>

      {/* Nested Pay / Advance Dialog */}
      <StandardDialog
        open={paymentMode !== null}
        onClose={() => setPaymentMode(null)}
        compact
        title={paymentMode === 'advance'
          ? `سحبة / دفعة مقدمة — ${supplier.name}`
          : `دفع للمورد — ${supplier.name}`}
        width="min(560px, 94vw)"
        minHeight="auto"
      >
        {paymentMode && (
          <SupplierPaymentForm
            suppliers={[supplier]}
            activeSupplierId={String(supplier.id)}
            defaultIsAdvance={paymentMode === 'advance'}
            onSuccess={() => setPaymentMode(null)}
          />
        )}
      </StandardDialog>
    </div>
  );
}
