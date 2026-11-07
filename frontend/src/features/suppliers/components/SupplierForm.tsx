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

const DEFAULT_VALUES = { name: '', phone: '', address: '', balance: 0, notes: '', metadata: { currency: 'USD', supplierType: 'factory', instapayAddress: '' } };

export function SupplierForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;

  const form = useForm<SupplierFormInput, undefined, SupplierFormOutput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: DEFAULT_VALUES
  });
  const canNavigateAway = useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful && !form.formState.isSubmitting);
  const mutation = useCreateSupplierMutation(() => {
    form.reset(DEFAULT_VALUES);
    onSuccess?.();
  });
  const watchedValues = useWatch({ control: form.control });

  const feedbackResetKey = JSON.stringify(watchedValues);

  useMutationFeedbackReset(
    mutation.isSuccess || mutation.isError,
    mutation.reset,
    feedbackResetKey,
  );

  function handleReset() {
    if (!form.formState.isDirty) return;
    if (!canNavigateAway()) return;
    mutation.reset();
    form.reset(DEFAULT_VALUES);
  }

  return (
    <form className="form-grid supplier-form-grid" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <DraftStateNotice visible={form.formState.isDirty && !mutation.isPending} title={t('suppliers.supplier_form.s0', "بيانات المورد الجديدة لم تُحفظ بعد")} hint={t('suppliers.supplier_form.s1', "يمكنك الحفظ أو تفريغ الحقول قبل بدء مورد جديد.")} />
      
      <Field label={t('suppliers.supplier_form.s2', "اسم المورد *")} error={form.formState.errors.name?.message} className="field-full-span">
        <input 
          {...form.register('name')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_form.s3', "مثال: شركة التوحيد للتوريدات / أحمد حسن")}
          data-autofocus
        />
      </Field>

      <Field label={t('suppliers.supplier_form.s4', "رقم الهاتف")} error={form.formState.errors.phone?.message}>
        <input 
          type="tel"
          {...form.register('phone')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_form.s5', "مثال: 010xxxxxxxx")}
        />
      </Field>

      {/* INV-INSTAPAY-FIELD-MISSING: the supplier's own InstaPay
        account number. It is saved on the supplier record
        (metadata.instapayAddress) and the payment forms prefill from
        it when InstaPay is picked. */}
      <Field
        label={t('suppliers.supplier_form.s27', "رقم حساب إنستاباي (IPA)")}
        hint={t('suppliers.supplier_form.s28', "حساب إنستاباي الذي تُرسَل إليه دفعات هذا المورد")}
      >
        <input
          type="text"
          {...form.register('metadata.instapayAddress')}
          disabled={mutation.isPending}
          placeholder={t('suppliers.supplier_form.s29', "مثال: name@instapay")}
        />
      </Field>

      <Field 
        label={`الرصيد الافتتاحي (${getGlobalCurrencySymbol()})`} 
        hint={t('suppliers.supplier_form.s6', "المبلغ المستحق للمورد عند بداية التسجيل (إن وجد)")}
        error={form.formState.errors.balance?.message}
      >
        <input 
          type="number" 
          step="0.01" 
          {...form.register('balance')} 
          disabled={mutation.isPending} 
          placeholder="0.00"
        />
      </Field>

      <Field label={t('suppliers.supplier_form.s7', "العنوان / المقر")} className="field-full-span">
        <input 
          {...form.register('address')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_form.s8', "المدينة، المنطقة، العنوان التفصيلي...")}
        />
      </Field>

      <Field 
        label={t('suppliers.supplier_form.s9', "ملاحظات إضافية")} 
        className="field-full-span"
        hint={t('suppliers.supplier_form.s10', "ملاحظات اختيارية أو شروط سداد خاصة بالمورد")}
      >
        <textarea 
          rows={3} 
          {...form.register('notes')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_form.s11', "أي شروط دفع، أرقام تواصل بديلة، أو تفاصيل خاصة بالمورد...")}
        />
      </Field>
      
      {importModuleEnabled && (
        <fieldset style={{ padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <legend style={{ padding: '0 8px', fontWeight: 700, color: '#170e5e', fontSize: '0.82rem' }}>{t('suppliers.supplier_form.s12', "إعدادات الاستيراد")}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <Field label={t('suppliers.supplier_form.s13', "عملة التعامل")}>
              <Controller
                name="metadata.currency"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'USD', label: t('suppliers.supplier_form.s14', "USD (دولار أمريكي)") },
                      { value: 'EUR', label: t('suppliers.supplier_form.s15', "EUR (يورو)") },
                      { value: 'CNY', label: t('suppliers.supplier_form.s16', "CNY (يوان صيني)") },
                      { value: 'EGP', label: t('suppliers.supplier_form.s17', "EGP (جنيه مصري)") },
                    ]}
                  />
                )}
              />
            </Field>
            <Field label={t('suppliers.supplier_form.s18', "تصنيف المورد")}>
              <Controller
                name="metadata.supplierType"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'factory', label: t('suppliers.supplier_form.s19', "مصنع خارجي") },
                      { value: 'shipping', label: t('suppliers.supplier_form.s20', "شركة شحن") },
                      { value: 'customs', label: t('suppliers.supplier_form.s21', "مخلص جمركي") },
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={t('suppliers.supplier_form.s22', "تعذر حفظ المورد")} successText={t('suppliers.supplier_form.s23', "تم حفظ المورد بنجاح.")} />
      <div className="actions sticky-form-actions">
        <FormResetButton onReset={handleReset} disabled={mutation.isPending || !form.formState.isDirty}>{t('suppliers.supplier_form.s24', "تفريغ النموذج")}</FormResetButton>
        <SubmitButton type="submit" isPending={mutation.isPending} idleText={t('suppliers.supplier_form.s25', "حفظ المورد")} pendingText={t('suppliers.supplier_form.s26', "جارٍ الحفظ...")} />
      </div>
    </form>
  );
}
