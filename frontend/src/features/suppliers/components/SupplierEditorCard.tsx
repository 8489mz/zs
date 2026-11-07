import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useUpdateSupplierMutation } from '@/features/suppliers/hooks/useSupplierActions';
import { supplierFormSchema, type SupplierFormInput, type SupplierFormOutput } from '@/features/suppliers/schemas/supplier.schema';
import type { Supplier } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';

export function SupplierEditorCard({ supplier, onSaved }: { supplier?: Supplier; onSaved?: () => void }) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;
  const form = useForm<SupplierFormInput, undefined, SupplierFormOutput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: { name: '', phone: '', address: '', balance: 0, notes: '' }
  });
  const mutation = useUpdateSupplierMutation(supplier?.id ? String(supplier.id) : undefined, onSaved);
  useUnsavedChangesGuard(Boolean(supplier) && form.formState.isDirty && !mutation.isPending);

  useEffect(() => {
    if (!supplier) return;
    form.reset({
      name: supplier.name || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      balance: Number(supplier.balance || 0),
      notes: supplier.notes || '',
      metadata: supplier.metadata || { currency: 'USD', supplierType: 'factory' }
    });
  }, [supplier, form]);

  if (!supplier) {
    return <div className="muted">{t('suppliers.supplier_editor_card.s0', "اختر موردًا من الجدول لعرض نموذج التعديل.")}</div>;
  }

  return (
    <form className="form-grid supplier-form-grid" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <DraftStateNotice visible={form.formState.isDirty && !mutation.isPending} title={t('suppliers.supplier_editor_card.s1', "تعديلات المورد الحالية غير محفوظة")} hint={t('suppliers.supplier_editor_card.s2', "احفظ التغييرات أو أعد تعيين القيم قبل الانتقال إلى مورد آخر.")} />
      
      <Field label={t('suppliers.supplier_editor_card.s3', "اسم المورد *")} error={form.formState.errors.name?.message} className="field-full-span">
        <input 
          {...form.register('name')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_editor_card.s4', "مثال: شركة التوحيد للتوريدات / أحمد حسن")}
        />
      </Field>

      <Field label={t('suppliers.supplier_editor_card.s5', "رقم الهاتف")} error={form.formState.errors.phone?.message}>
        <input 
          type="tel"
          {...form.register('phone')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_editor_card.s6', "مثال: 010xxxxxxxx")}
        />
      </Field>

      {/* INV-INSTAPAY-FIELD-MISSING: the supplier's own InstaPay
        account number. It is saved on the supplier record
        (metadata.instapayAddress) and the payment forms prefill from
        it when InstaPay is picked. The edit reset already loads the
        saved metadata back into the form. */}
      <Field
        label={t('suppliers.supplier_editor_card.s27', "رقم حساب إنستاباي (IPA)")}
        hint={t('suppliers.supplier_editor_card.s28', "حساب إنستاباي الذي تُرسَل إليه دفعات هذا المورد")}
      >
        <input
          type="text"
          {...form.register('metadata.instapayAddress')}
          disabled={mutation.isPending}
          placeholder={t('suppliers.supplier_editor_card.s29', "مثال: name@instapay")}
        />
      </Field>

      <Field 
        label={`الرصيد الافتتاحي (${getGlobalCurrencySymbol()})`} 
        hint={t('suppliers.supplier_editor_card.s7', "المبلغ المستحق للمورد عند بداية التسجيل (إن وجد)")}
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

      <Field label={t('suppliers.supplier_editor_card.s8', "العنوان / المقر")} className="field-full-span">
        <input 
          {...form.register('address')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_editor_card.s9', "المدينة، المنطقة، العنوان التفصيلي...")}
        />
      </Field>

      <Field 
        label={t('suppliers.supplier_editor_card.s10', "ملاحظات إضافية")} 
        className="field-full-span"
        hint={t('suppliers.supplier_editor_card.s11', "ملاحظات اختيارية أو شروط سداد خاصة بالمورد")}
      >
        <textarea 
          rows={3} 
          {...form.register('notes')} 
          disabled={mutation.isPending} 
          placeholder={t('suppliers.supplier_editor_card.s12', "أي شروط دفع، أرقام تواصل بديلة، أو تفاصيل خاصة بالمورد...")}
        />
      </Field>
      
      {importModuleEnabled && (
        <fieldset style={{ padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <legend style={{ padding: '0 8px', fontWeight: 700, color: '#170e5e', fontSize: '0.82rem' }}>{t('suppliers.supplier_editor_card.s13', "إعدادات الاستيراد")}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <Field label={t('suppliers.supplier_editor_card.s14', "عملة التعامل")}>
              <Controller
                name="metadata.currency"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'USD', label: t('suppliers.supplier_editor_card.s15', "USD (دولار أمريكي)") },
                      { value: 'EUR', label: t('suppliers.supplier_editor_card.s16', "EUR (يورو)") },
                      { value: 'CNY', label: t('suppliers.supplier_editor_card.s17', "CNY (يوان صيني)") },
                      { value: 'EGP', label: t('suppliers.supplier_editor_card.s18', "EGP (جنيه مصري)") },
                    ]}
                  />
                )}
              />
            </Field>
            <Field label={t('suppliers.supplier_editor_card.s19', "تصنيف المورد")}>
              <Controller
                name="metadata.supplierType"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'factory', label: t('suppliers.supplier_editor_card.s20', "مصنع خارجي") },
                      { value: 'shipping', label: t('suppliers.supplier_editor_card.s21', "شركة شحن") },
                      { value: 'customs', label: t('suppliers.supplier_editor_card.s22', "مخلص جمركي") },
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={t('suppliers.supplier_editor_card.s23', "تعذر تحديث المورد")} successText={t('suppliers.supplier_editor_card.s24', "تم تحديث المورد بنجاح.")} />
      <div className="actions sticky-form-actions">
        <Button type="button" variant="secondary" onClick={() => form.reset()} disabled={mutation.isPending}>{t('suppliers.supplier_editor_card.s25', "إعادة القيم")}</Button>
        <SubmitButton type="submit" isPending={mutation.isPending} idleText={t('suppliers.supplier_editor_card.s26', "حفظ التعديل")} pendingText={t('suppliers.supplier_editor_card.s27', "جارٍ الحفظ...")} />
      </div>
    </form>
  );
}
