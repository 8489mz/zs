import { useTranslation } from 'react-i18next';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { FormResetButton } from '@/shared/components/form-reset-button';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useMutationFeedbackReset } from '@/shared/hooks/use-mutation-feedback-reset';
import { useCreateSupplierMutation } from '@/features/suppliers/hooks/useCreateSupplierMutation';
import { supplierFormSchema, type SupplierFormInput, type SupplierFormOutput } from '@/features/suppliers/schemas/supplier.schema';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';

const DEFAULT_VALUES = {
  name: '',
  phone: '',
  address: '',
  balance: 0,
  notes: '',
  metadata: { currency: 'USD', supplierType: 'factory', instapayAddress: '' },
  supplierType: 'supplier' as const,
  overdraftLimit: null as number | null,
};

export function SupplierForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;

  const form = useForm<SupplierFormInput, undefined, SupplierFormOutput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  useUnsavedChangesGuard(
    form.formState.isDirty,
    t('suppliers.modal.new_unsaved_guard', 'لديك بيانات مورد جديد غير محفوظة. هل تريد المغادرة بدون حفظ؟'),
  );

  const mutation = useCreateSupplierMutation(() => {
    form.reset(DEFAULT_VALUES);
    onSuccess?.();
  });

  const watchedValues = useWatch({ control: form.control });
  useMutationFeedbackReset(mutation.isSuccess || mutation.isError, mutation.reset, watchedValues);

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
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
          <Field label="رقم الهاتف" error={form.formState.errors.phone?.message}>
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
            label={`الرصيد الافتتاحي (${getGlobalCurrencySymbol()})`}
            error={form.formState.errors.balance?.message}
          >
            <input
              type="number"
              step="0.01"
              className="no-spin-arrows"
              {...form.register('balance')}
              disabled={mutation.isPending}
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

      <div className="supplier-modal-section-card">
        <Field label="ملاحظات" error={form.formState.errors.notes?.message}>
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
        errorFallback="تعذر إضافة المورد"
        isSuccess={mutation.isSuccess}
        successText="تمت إضافة المورد بنجاح."
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #e2e8f0',
        }}
      >
        <FormResetButton onReset={() => form.reset(DEFAULT_VALUES)} disabled={!form.formState.isDirty || mutation.isPending} />
        <SubmitButton
          isPending={mutation.isPending}
          isSuccess={mutation.isSuccess}
          pendingText="جاري الإضافة..."
          idleText="إضافة المورد"
          style={{ minHeight: '34px', height: '34px', padding: '0 20px', fontSize: '13px', fontWeight: 700 }}
        />
      </div>
    </form>
  );
}
