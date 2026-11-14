import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
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

export function SupplierEditorCard({ supplier, onSaved }: { supplier?: Supplier; onSaved?: () => void }) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;
  const form = useForm<SupplierFormInput, undefined, SupplierFormOutput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: { name: '', phone: '', address: '', balance: 0, notes: '', supplierType: 'supplier', overdraftLimit: null }
  });
  const mutation = useUpdateSupplierMutation(supplier?.id ? String(supplier.id) : undefined, onSaved);
  /* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier page is this card —
   * details (the form below), non-stock bills, and the statement of
   * account. The form stays mounted when another tab is active (hidden,
   * not unmounted) so unsaved edits survive tab switches. */
  const [tab, setTab] = useState<'details' | 'bills' | 'statement'>('details');
  const [paymentMode, setPaymentMode] = useState<'pay' | 'advance' | null>(null);
  useUnsavedChangesGuard(Boolean(supplier) && form.formState.isDirty && !mutation.isPending);

  useEffect(() => {
    if (!supplier) return;
    form.reset({
      name: supplier.name || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      balance: Number(supplier.balance || 0),
      notes: supplier.notes || '',
      supplierType: supplier.supplierType || 'supplier',
      overdraftLimit: supplier.overdraftLimit ?? null,
      metadata: supplier.metadata || { currency: 'USD', supplierType: 'factory' }
    });
  }, [supplier, form]);

  if (!supplier) {
    return <div className="muted">{t('suppliers.supplier_editor_card.s0', "اختر موردًا من الجدول لعرض نموذج التعديل.")}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button type="button" variant={tab === 'details' ? 'primary' : 'secondary'} onClick={() => setTab('details')}>
          {t('suppliers.supplier_editor_card.s36', 'البيانات')}
        </Button>
        <Button type="button" variant={tab === 'bills' ? 'primary' : 'secondary'} onClick={() => setTab('bills')}>
          {t('suppliers.supplier_editor_card.s37', 'فواتير بدون مخزون')}
        </Button>
        <Button type="button" variant={tab === 'statement' ? 'primary' : 'secondary'} onClick={() => setTab('statement')}>
          {t('suppliers.supplier_editor_card.s38', 'كشف الحساب')}
        </Button>
        <span style={{ flex: 1 }} />
        <Button type="button" variant="primary" onClick={() => setPaymentMode('pay')}>
          {t('suppliers.supplier_editor_card.s39', 'دفع')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setPaymentMode('advance')}>
          {t('suppliers.supplier_editor_card.s40', 'سحبة')}
        </Button>
      </div>
      <div style={{ display: tab === 'details' ? undefined : 'none' }}>
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

      {/* INV-SUPPLIER-PAGE-BILL-STATEMENT: top-level supplier type —
        'freelancer' is a contractor (ads/marketing) registered here,
        not an HR employee. Do NOT confuse it with
        metadata.supplierType in the import settings below (the import
        classification). */}
      <Field label={t('suppliers.supplier_editor_card.s30', "نوع المورد")} error={form.formState.errors.supplierType?.message}>
        <Controller
          name="supplierType"
          control={form.control}
          render={({ field }) => (
            <CustomSelect
              value={field.value || 'supplier'}
              onChange={field.onChange}
              disabled={mutation.isPending}
              options={[
                { value: 'supplier', label: t('suppliers.supplier_editor_card.s31', "عادي") },
                { value: 'freelancer', label: t('suppliers.supplier_editor_card.s32', "فري لانس (مقاول / خدمات)") },
              ]}
            />
          )}
        />
      </Field>

      <Field
        label={t('suppliers.supplier_editor_card.s33', "حد السحب على المكشوف")}
        hint={t('suppliers.supplier_editor_card.s34', "أقصى مجموع الدفعات المقدمة غير المطبقة — اتركه فارغًا ليعني بدون حد")}
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
              value={field.value ?? ''}
              disabled={mutation.isPending}
              placeholder={t('suppliers.supplier_editor_card.s35', "بدون حد")}
              onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
            />
          )}
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
      </div>
      {tab === 'bills' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SupplierBillForm supplierId={String(supplier.id)} />
          <SupplierBillsList supplierId={String(supplier.id)} />
        </div>
      ) : null}
      {tab === 'statement' ? <SupplierStatementTab supplier={supplier} /> : null}
      <StandardDialog
        open={paymentMode !== null}
        onClose={() => setPaymentMode(null)}
        title={paymentMode === 'advance' ? t('suppliers.supplier_editor_card.s41', 'سحبة / دفعة مقدمة') : t('suppliers.supplier_editor_card.s42', 'دفع للمورد')}
        subtitle={supplier.name}
        width="min(680px, 95vw)"
        minHeight="auto"
        zIndex={11000}
      >
        {paymentMode !== null ? (
          <SupplierPaymentForm
            suppliers={[supplier]}
            activeSupplierId={String(supplier.id)}
            defaultIsAdvance={paymentMode === 'advance'}
            onSuccess={() => setPaymentMode(null)}
          />
        ) : null}
      </StandardDialog>
    </div>
  );
}
