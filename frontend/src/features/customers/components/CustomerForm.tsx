import { useTranslation } from 'react-i18next';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { FormResetButton } from '@/shared/components/form-reset-button';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useMutationFeedbackReset } from '@/shared/hooks/use-mutation-feedback-reset';
import { useCreateCustomerMutation } from '@/features/customers/hooks/useCreateCustomerMutation';
import { customerFormSchema, type CustomerFormInput, type CustomerFormOutput } from '@/features/customers/schemas/customer.schema';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useCustomerProfile } from '@/features/customers/constants/customer-profiles';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CustomerVisitDaysPicker } from './CustomerVisitDaysPicker';

const DEFAULT_VALUES = { name: '', phone: '', address: '', balance: 0, type: 'cash' as const, creditLimit: 0, metadata: { currency: 'EGP' } };

export function CustomerForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { t: __t } = useTranslation();
  const profile = useCustomerProfile();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;
  const repsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    staleTime: 60000,
  });

  const form = useForm<CustomerFormInput, undefined, CustomerFormOutput>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: DEFAULT_VALUES
  });
  const canNavigateAway = useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful && !form.formState.isSubmitting);
  const mutation = useCreateCustomerMutation(() => {
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
    <form className="form-grid customer-form-grid" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <DraftStateNotice visible={form.formState.isDirty && !mutation.isPending} title={__t('customers.customer_form.s0', "بيانات السجل الجديدة لم تُحفظ بعد")} hint={__t('customers.customer_form.s1', "يمكنك الحفظ الآن أو تفريغ النموذج قبل الانتقال لحساب آخر.")} />
      
      <Field label={profile.nameLabel} error={form.formState.errors.name?.message} className="field-full-span">
        <input 
          {...form.register('name')} 
          disabled={mutation.isPending} 
          placeholder={profile.namePlaceholder}
          data-autofocus
        />
      </Field>

      <Field label={profile.phoneLabel} error={form.formState.errors.phone?.message}>
        <input 
          type="tel"
          {...form.register('phone')} 
          disabled={mutation.isPending} 
          placeholder={profile.phonePlaceholder}
        />
      </Field>

      <Field label={profile.typeLabel}>
        <Controller
          name="type"
          control={form.control}
          render={({ field }) => (
            <CustomSelect
              value={field.value}
              onChange={field.onChange}
              disabled={mutation.isPending}
              options={profile.types.map((t) => ({ value: t.value, label: t.label }))}
            />
          )}
        />
      </Field>

      <Field label={profile.addressLabel} className="field-full-span">
        <input 
          {...form.register('address')} 
          disabled={mutation.isPending} 
          placeholder={profile.addressPlaceholder}
        />
      </Field>

      <Field 
        label={`${profile.balanceLabel} (${getGlobalCurrencySymbol()})`} 
        hint={profile.balanceHint}
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

      <Field 
        label={`${profile.creditLimitLabel} (${getGlobalCurrencySymbol()})`} 
        hint={profile.creditLimitHint}
        error={form.formState.errors.creditLimit?.message}
      >
        <input 
          type="number" 
          step="0.01" 
          {...form.register('creditLimit')} 
          disabled={mutation.isPending} 
          placeholder="0.00"
        />
      </Field>
      
      {profile.id === 'distribution' && (
        <fieldset style={{ padding: '12px 16px', border: '1px solid #bfdbfe', borderRadius: '10px', background: '#eff6ff', gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <legend style={{ padding: '0 8px', fontWeight: 800, color: '#1e40af', fontSize: '0.84rem' }}>{__t('customers.customer_form.s2', "بيانات التوزيع وخطوط السير (Distribution & Route)")}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <Field label={__t('customers.customer_form.s3', "كود المحل / المنفذ الفريد")} hint={__t('customers.customer_form.s4', "رمز تعريفي للمندوب في الشارع")}>
              <input
                {...form.register('metadata.customer_code')}
                disabled={mutation.isPending}
                placeholder={__t('customers.customer_form.s5', "مثال: CUST-1042 أو 1042")}
              />
            </Field>

            <Field label={__t('customers.customer_form.s6', "خط السير / المنطقة")} hint={__t('customers.customer_form.s7', "خط التوزيع التابع له المحل")}>
              <input
                {...form.register('metadata.route')}
                disabled={mutation.isPending}
                placeholder={__t('customers.customer_form.s8', "مثال: خط فيصل / خط الهرم")}
              />
            </Field>

            <Field label={__t('customers.customer_form.s9', "الحي / المربع السكني (District)")} hint={__t('customers.customer_form.s10', "لتجميع العملاء وترتيب خط سير المندوب تلقائياً")}>
              <input
                list="customer-known-districts"
                {...form.register('metadata.district')}
                disabled={mutation.isPending}
                placeholder={__t('customers.customer_form.s11', "مثال: حي فيصل / العشرين / الطوابق")}
                onChange={(e) => {
                  form.setValue('metadata.district', e.target.value);
                  const val = e.target.value.trim();
                  if (val && typeof window !== 'undefined') {
                    try {
                      const saved: string[] = JSON.parse(localStorage.getItem('zs_van_saved_districts') || '[]');
                      if (!saved.includes(val)) {
                        localStorage.setItem('zs_van_saved_districts', JSON.stringify([...saved, val].slice(-50)));
                      }
                    } catch {}
                  }
                }}
              />
              <datalist id="customer-known-districts">
                {(() => {
                  try {
                    const list: string[] = JSON.parse(localStorage.getItem('zs_van_saved_districts') || '[]');
                    return list.map((d) => <option key={d} value={d} />);
                  } catch {
                    return null;
                  }
                })()}
              </datalist>
            </Field>

            <Field label={__t('customers.customer_form.s12', "رابط الموقع (Google Maps)")} hint={__t('customers.customer_form.s13', "رابط موقع المحل على الخريطة")}>
              <input
                {...form.register('metadata.location_url')}
                disabled={mutation.isPending}
                placeholder="https://maps.google.com/?q=..."
              />
            </Field>

            <Field label={__t('customers.customer_form.s14', "أيام الزيارة الأسبوعية المجدولة")} hint={__t('customers.customer_form.s15', "حدد الأيام التي يظهر فيها هذا المحل في خط سير المندوب")} className="field-full-span">
              <Controller
                name="metadata.visit_days"
                control={form.control}
                render={({ field }) => (
                  <CustomerVisitDaysPicker
                    value={field.value}
                    singleValue={form.watch('metadata.visit_day')}
                    disabled={mutation.isPending}
                    onChange={(days, primaryDay) => {
                      field.onChange(days);
                      form.setValue('metadata.visit_day', primaryDay, { shouldDirty: true });
                    }}
                  />
                )}
              />
            </Field>

            <Field label={__t('customers.customer_form.s16', "المندوب المسؤول / المخصص")} hint={__t('customers.customer_form.s17', "المندوب الذي يظهر له هذا المحل في خط سيره")}>
              <Controller
                name="metadata.assigned_rep_id"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value ? String(field.value) : ''}
                    onChange={(val) => {
                      field.onChange(val ? Number(val) : null);
                      const rep = repsQuery.data?.find((r) => String(r.id) === String(val));
                      form.setValue('metadata.assigned_rep_name', rep?.name || '');
                    }}
                    disabled={mutation.isPending}
                    options={[
                      { value: '', label: __t('customers.customer_form.s18', "بدون تخصيص (مشترك / عام)") },
                      ...(repsQuery.data || []).map((r) => ({
                        value: String(r.id),
                        label: `${r.name} ${r.vehicle_plate ? `(${r.vehicle_plate})` : ''}`,
                      })),
                    ]}
                    placeholder={__t('customers.customer_form.s19', "اختر المندوب...")}
                  />
                )}
              />
            </Field>
          </div>
        </fieldset>
      )}

      {importModuleEnabled && (
        <fieldset style={{ padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <legend style={{ padding: '0 8px', fontWeight: 700, color: '#170e5e', fontSize: '0.82rem' }}>{__t('customers.customer_form.s20', "إعدادات الاستيراد")}</legend>
          <div>
            <Field label={__t('customers.customer_form.s21', "عملة الحساب")}>
              <Controller
                name="metadata.currency"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'EGP', label: __t('customers.customer_form.s22', "جنيه مصري") },
                      { value: 'USD', label: __t('customers.customer_form.s23', "دولار أمريكي") },
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={__t('customers.customer_form.s24', "تعذر حفظ البيانات")} successText={__t('customers.customer_form.s25', "تم الحفظ بنجاح.")} />
      {mutation.isSuccess && mutation.data?.phoneWarning ? (
        <div className="warning-box">{mutation.data.phoneWarning.message}</div>
      ) : null}
      <div className="actions sticky-form-actions">
        <FormResetButton onReset={handleReset} disabled={mutation.isPending || !form.formState.isDirty}>{__t('customers.customer_form.s26', "تفريغ النموذج")}</FormResetButton>
        <SubmitButton type="submit" isPending={mutation.isPending} idleText={profile.submitCreateText} pendingText={__t('customers.customer_form.s27', "جارٍ الحفظ...")} />
      </div>
    </form>
  );
}
