import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useCustomerProfile } from '@/features/customers/constants/customer-profiles';
import { CustomerReceiptVoucherModal, type CustomerReceiptData } from './CustomerReceiptVoucherModal';
import { maritimeApi } from '@/features/maritime-freight/api/maritime-freight.api';
import type { Customer, Supplier } from '@/types/domain';
import {
  useCustomerPaymentMutation,
  useSupplierPaymentMutation,
  type CustomerPaymentFormValues,
  type SupplierPaymentFormValues
} from '@/features/accounts/hooks/useAccountingMutations';
import {
  customerPaymentSchema,
  supplierPaymentSchema,
  type CustomerPaymentInput,
  type CustomerPaymentOutput,
  type SupplierPaymentInput,
  type SupplierPaymentOutput
} from '@/features/accounts/schemas/payment.schema';
import { readSupplierInstapayAddress } from '@/features/accounts/contracts';

export function CustomerPaymentForm({ customers, activeCustomerId, disabled = false }: { customers: Customer[]; activeCustomerId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const profile = useCustomerProfile();
  const [lastReceipt, setLastReceipt] = useState<CustomerReceiptData | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);

  const form = useForm<CustomerPaymentInput, undefined, CustomerPaymentOutput>({
    resolver: zodResolver(customerPaymentSchema),
    defaultValues: { customerId: activeCustomerId || '', amount: 0, note: '', jobId: '', paymentChannel: 'cash', instapayAddress: '', transferReference: '' }
  });

  const watchedCustomerId = useWatch({ control: form.control, name: 'customerId' });
  const watchedChannel = useWatch({ control: form.control, name: 'paymentChannel' });
  const selectedCust = customers.find((c) => String(c.id) === String(watchedCustomerId));
  const currentBal = Number(selectedCust?.balance || 0);
  const [customerJobs, setCustomerJobs] = useState<any[]>([]);

  useEffect(() => {
    if (!watchedCustomerId) {
      setCustomerJobs([]);
      return;
    }
    let isMounted = true;
    maritimeApi
      .getCustomerActiveJobs(watchedCustomerId)
      .then((jobs) => {
        if (isMounted) setCustomerJobs(jobs || []);
      })
      .catch(() => {
        if (isMounted) setCustomerJobs([]);
      });
    return () => {
      isMounted = false;
    };
  }, [watchedCustomerId]);

  useEffect(() => {
    if (activeCustomerId) {
      form.setValue('customerId', activeCustomerId);
    }
  }, [activeCustomerId, form]);

  const mutation = useCustomerPaymentMutation(activeCustomerId, (res) => {
    const custName = selectedCust?.name || res?.customerName || 'العميل';
    const amountVal = Number(form.getValues('amount') || 0);
    const noteVal = String(form.getValues('note') || '');
    const receiptData: CustomerReceiptData = {
      id: res?.id || res?.paymentId,
      docNo: res?.docNo,
      customerId: watchedCustomerId,
      customerName: custName,
      amount: amountVal,
      balanceBefore: currentBal,
      balanceAfter: currentBal - amountVal,
      note: noteVal,
      createdAt: res?.createdAt || new Date().toISOString(),
    };
    setLastReceipt(receiptData);
    form.reset({ customerId: watchedCustomerId, amount: 0, note: '', jobId: '', paymentChannel: 'cash', instapayAddress: '', transferReference: '' });
  });

  const partyLabel =
    profile.id === 'maritime'
      ? 'الشاحن / المستورد'
      : profile.id === 'contracting'
        ? 'جهة الإسناد / المالك'
        : 'العميل';

  const customerOptions = customers.map((c) => {
    const b = Number(c.balance || 0);
    const balanceHint =
      b > 0
        ? ` (مدين: ${formatCurrency(b)})`
        : b < 0
          ? ` (دائن: ${formatCurrency(Math.abs(b))})`
          : ' (0.00)';
    return {
      value: String(c.id),
      label: `${c.name}${balanceHint}`,
    };
  });

  return (
    <>
      <form
        className="form-grid"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values as CustomerPaymentFormValues))}
      >
        <Field label={`${partyLabel} *`} error={form.formState.errors.customerId?.message} className="field-full-span">
          <Controller
            name="customerId"
            control={form.control}
            render={({ field }) => (
              <CustomSelect
                value={field.value}
                onChange={field.onChange}
                options={customerOptions}
                placeholder={`اختر ${partyLabel}...`}
                disabled={mutation.isPending || disabled}
              />
            )}
          />
        </Field>

        {selectedCust && (
          <div
            style={{
              gridColumn: '1 / -1',
              backgroundColor: currentBal > 0 ? '#fef2f2' : currentBal < 0 ? '#f0f9ff' : '#f8fafc',
              border: `1px solid ${currentBal > 0 ? '#fecaca' : currentBal < 0 ? '#bae6fd' : '#e2e8f0'}`,
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '13px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>{t('accounts.payment_forms.s0', "حالة حساب")} {partyLabel}: </span>
              <strong style={{ color: currentBal > 0 ? '#b91c1c' : currentBal < 0 ? '#0369a1' : '#1e293b' }}>
                {currentBal > 0
                  ? `مديونية مستحقة: ${formatCurrency(currentBal)}`
                  : currentBal < 0
                    ? `رصيد دائن سابق (دفعة بالزيادة): ${formatCurrency(Math.abs(currentBal))}`
                    : `الرصيد متزن (0.00) — سيتم قيد المبلغ كدفعة مقدمة / عربون على الحساب`}
              </strong>
            </div>
            {currentBal > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => form.setValue('amount', currentBal)}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  color: '#b91c1c',
                  borderColor: '#fca5a5',
                  background: '#fff',
                  fontWeight: 700,
                }}
              >
                {t('accounts.payment_forms.s1', "سداد كامل المديونية (")}{formatCurrency(currentBal)})
              </Button>
            )}
          </div>
        )}

        {customerJobs.length > 0 && (
          <Field
            label={t('accounts.payment_forms.s2', "تخصيص السداد لشحنة / أمر تشغيل (اختياري)")}
            className="field-full-span"
          >
            <Controller
              name="jobId"
              control={form.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value || ''}
                  onChange={(val) => {
                    field.onChange(val);
                    if (val) {
                      const selectedJob = customerJobs.find((j) => String(j.id) === String(val));
                      if (selectedJob && selectedJob.unpaid > 0 && !form.getValues('amount')) {
                        form.setValue('amount', selectedJob.unpaid);
                      }
                    }
                  }}
                  options={[
                    {
                      value: '',
                      label:
                        customerJobs.length === 1
                          ? t('accounts.payment_forms.s3', "تسوية تلقائية للشحنة النشطة الوحيدة")
                          : t('accounts.payment_forms.s4', "دفعة عامة على الحساب (تسوية يدوية لاحقاً)"),
                    },
                    ...customerJobs.map((j) => ({
                      value: String(j.id),
                      label: `عملية #${j.job_number} (${j.pol_name} ➔ ${j.pod_name}) — المستحق: ${formatCurrency(j.unpaid)}`,
                    })),
                  ]}
                  placeholder={t('accounts.payment_forms.s5', "اختر الشحنة لتسديدها مباشرة أو اتركها على الحساب...")}
                  disabled={mutation.isPending || disabled}
                />
              )}
            />
          </Field>
        )}

        <Field
          label={`المبلغ المحصل (${getGlobalCurrencySymbol()}) *`}
          error={form.formState.errors.amount?.message}
        >
          <input
            type="number"
            step="0.01"
            min="0.01"
            {...form.register('amount')}
            disabled={mutation.isPending || disabled}
            placeholder="0.00"
          />
        </Field>

        <Field label={t('accounts.payment_forms.s27', "وسيلة الدفع")} error={form.formState.errors.paymentChannel?.message}>
          <Controller
            name="paymentChannel"
            control={form.control}
            render={({ field }) => (
              <CustomSelect
                value={field.value || 'cash'}
                onChange={field.onChange}
                options={[
                  { value: 'cash', label: 'نقدي (درج الكاشير)' },
                  { value: 'bank', label: 'تحويل بنكي' },
                  { value: 'card', label: 'بطاقة' },
                  { value: 'wallet', label: 'محفظة إلكترونية' },
                  { value: 'instapay', label: 'إنستاباي' },
                ]}
                disabled={mutation.isPending || disabled}
              />
            )}
          />
        </Field>

        {watchedChannel === 'instapay' && (
          <Field
            label={t('accounts.payment_forms.s28', "رقم حساب إنستاباي (IPA)")}
            hint={t('accounts.payment_forms.s29', "حساب إنستاباي الذي وصل منه التحصيل")}
            error={form.formState.errors.instapayAddress?.message}
          >
            <input
              type="text"
              {...form.register('instapayAddress')}
              disabled={mutation.isPending || disabled}
              placeholder={t('accounts.payment_forms.s30', "مثال: name@instapay")}
            />
          </Field>
        )}

        {watchedChannel && watchedChannel !== 'cash' && (
          <Field
            label="رقم العملية / المرجع البنكي *"
            hint="رقم مرجع التحويل الذي يثبت وصول التحصيل غير النقدي"
            error={form.formState.errors.transferReference?.message}
          >
            <input
              type="text"
              {...form.register('transferReference')}
              disabled={mutation.isPending || disabled}
              placeholder="رقم مرجع التحويل أو آخر 6 أرقام من الإشعار (3 أحرف على الأقل)"
            />
          </Field>
        )}

        <Field
          label={t('accounts.payment_forms.s6', "البيان / رقم الشيك أو الحوالة أو البوليصة أو المشروع")}
          className="field-full-span"
        >
          <input
            type="text"
            {...form.register('note')}
            disabled={mutation.isPending || disabled}
            placeholder={t('accounts.payment_forms.s7', "مثال: دفعة مقدمة لشحنة بوليصة رقم... أو تحويل بنكي على حساب...")}
          />
        </Field>

        {disabled && (
          <div className="muted small" style={{ gridColumn: '1 / -1' }}>
            {t('accounts.payment_forms.s8', "هذا الحساب يملك صلاحية متابعة كشوف الحساب فقط بدون تسجيل سندات قبض جديدة.")}
          </div>
        )}

        <MutationFeedback
          isError={mutation.isError}
          isSuccess={mutation.isSuccess}
          error={mutation.error}
          errorFallback={t('accounts.payment_forms.s9', "تعذر حفظ سند القبض")}
          successText={t('accounts.payment_forms.s10', "تم حفظ سند القبض المالي بنجاح.")}
        />

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <SubmitButton
            type="submit"
            variant="success"
            isPending={mutation.isPending}
            disabled={disabled}
            idleText={t('accounts.payment_forms.s11', "حفظ وتسجيل سند القبض")}
            pendingText={t('accounts.payment_forms.s12', "جارٍ الحفظ...")}
          />
          {lastReceipt && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setVoucherOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                color: '#170c5c',
                borderColor: '#cbd5e1',
              }}
            >
              <PrinterIcon size={14} />
              <span>{t('accounts.payment_forms.s13', "معاينة وطباعة سند القبض (")}{lastReceipt.docNo || 'REC'})</span>
            </Button>
          )}
        </div>
      </form>

      <CustomerReceiptVoucherModal
        open={voucherOpen}
        receipt={lastReceipt}
        onClose={() => setVoucherOpen(false)}
      />
    </>
  );
}

export function SupplierPaymentForm({ suppliers, activeSupplierId, disabled = false }: { suppliers: Supplier[]; activeSupplierId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const form = useForm<SupplierPaymentInput, undefined, SupplierPaymentOutput>({
    resolver: zodResolver(supplierPaymentSchema),
    defaultValues: { supplierId: activeSupplierId || '', amount: 0, note: '', paymentChannel: 'cash', instapayAddress: '', isAdvance: false }
  });
  // Mirror CustomerPaymentForm: a deep link (?supplierId=) must preselect
  // the supplier even when the id arrives after mount. Without this the
  // "pay supplier" link lands on an empty supplier field.
  useEffect(() => {
    if (activeSupplierId) {
      form.setValue('supplierId', activeSupplierId);
    }
  }, [activeSupplierId, form]);
  const watchedSupplierId = useWatch({ control: form.control, name: 'supplierId' });
  const watchedChannel = useWatch({ control: form.control, name: 'paymentChannel' });
  const watchedIsAdvance = useWatch({ control: form.control, name: 'isAdvance' });
  const selectedSupplier = suppliers.find((s) => String(s.id) === String(watchedSupplierId));
  const savedSupplierIpa = readSupplierInstapayAddress(selectedSupplier);
  /* INV-INSTAPAY-FIELD-MISSING: when InstaPay is picked, prefill the
   * IPA saved on the supplier record — but only into an empty field,
   * never over a value the merchant already typed. */
  useEffect(() => {
    if (watchedChannel === 'instapay' && savedSupplierIpa && !String(form.getValues('instapayAddress') || '').trim()) {
      form.setValue('instapayAddress', savedSupplierIpa);
    }
  }, [watchedChannel, savedSupplierIpa, form]);
  /* INV-SUPPLIER-ADVANCE-UI-WIRING: a payment against a zero-balance
   * supplier settles nothing, so it is an advance by definition — the
   * toggle defaults ON for such a supplier. The merchant can still
   * switch it off by hand (the backend derives the same from the
   * balance, so the payment stays an advance either way). */
  useEffect(() => {
    if (watchedSupplierId) {
      form.setValue('isAdvance', Number(selectedSupplier?.balance || 0) <= 0);
    }
  }, [watchedSupplierId, form]);
  const mutation = useSupplierPaymentMutation(activeSupplierId, () => form.reset({ supplierId: '', amount: 0, note: '', paymentChannel: 'cash', instapayAddress: '', isAdvance: false }));

  const supplierOptions = suppliers.map((s) => ({
    value: String(s.id),
    label: `${s.name}${Number(s.balance || 0) > 0 ? ` (مستحق: ${formatCurrency(Number(s.balance))})` : ''}`,
  }));

  return (
    <form className="form-grid" onSubmit={form.handleSubmit((values) => mutation.mutate(values as SupplierPaymentFormValues))}>
      <Field label={t('accounts.payment_forms.s14', "المورد *")} error={form.formState.errors.supplierId?.message} className="field-full-span">
        <Controller
          name="supplierId"
          control={form.control}
          render={({ field }) => (
            <CustomSelect
              value={field.value}
              onChange={field.onChange}
              options={supplierOptions}
              placeholder={t('accounts.payment_forms.s15', "اختر المورد...")}
              disabled={mutation.isPending || disabled}
            />
          )}
        />
      </Field>
      <Field label={`المبلغ المدفوع (${getGlobalCurrencySymbol()}) *`} error={form.formState.errors.amount?.message}>
        <input type="number" step="0.01" min="0.01" {...form.register('amount')} disabled={mutation.isPending || disabled} placeholder="0.00" />
      </Field>
      <Field label={t('accounts.payment_forms.s27', "وسيلة الدفع")} error={form.formState.errors.paymentChannel?.message}>
        <Controller
          name="paymentChannel"
          control={form.control}
          render={({ field }) => (
            <CustomSelect
              value={field.value || 'cash'}
              onChange={field.onChange}
              options={[
                { value: 'cash', label: 'نقدي (درج الكاشير)' },
                { value: 'bank', label: 'تحويل بنكي' },
                { value: 'card', label: 'بطاقة' },
                { value: 'wallet', label: 'محفظة إلكترونية' },
                { value: 'instapay', label: 'إنستاباي' },
              ]}
              disabled={mutation.isPending || disabled}
            />
          )}
        />
      </Field>
      {watchedChannel === 'instapay' && (
        <Field
          label={t('accounts.payment_forms.s28', "رقم حساب إنستاباي (IPA)")}
          hint={t('accounts.payment_forms.s31', "حساب إنستاباي الذي أُرسل إليه الدفع — يُعبَّأ تلقائيًا من بيانات المورد إن وُجد")}
          error={form.formState.errors.instapayAddress?.message}
        >
          <input type="text" {...form.register('instapayAddress')} disabled={mutation.isPending || disabled} placeholder={t('accounts.payment_forms.s30', "مثال: name@instapay")} />
        </Field>
      )}
      <Field label={t('accounts.payment_forms.s32', "نوع الدفع")} className="field-full-span">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" id="supplier-advance-toggle" {...form.register('isAdvance')} disabled={mutation.isPending || disabled} />
          <label htmlFor="supplier-advance-toggle" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('accounts.payment_forms.s33', "دفعة مقدمة / عربون (لا تسدد مديونية — تُقيد في حساب الدفعات المقدمة 1185)")}
          </label>
        </div>
        {watchedIsAdvance ? (
          <div className="muted small" style={{ marginTop: '6px' }}>
            {t('accounts.payment_forms.s34', "سيُقيد المبلغ كدفعة مقدمة للمورد في حساب 1185، والرصيد المستحق لا يتغير — تُطبق لاحقًا على فاتورة من بطاقة الدفعات المقدمة.")}
          </div>
        ) : null}
      </Field>
      <Field label={t('accounts.payment_forms.s16', "البيان / ملاحظات السداد")}><input type="text" {...form.register('note')} disabled={mutation.isPending || disabled} placeholder={t('accounts.payment_forms.s17', "تفاصيل الدفع أو رقم الحوالة...")} /></Field>
      {disabled ? <div className="muted small" style={{ gridColumn: '1 / -1' }}>{t('accounts.payment_forms.s18', "هذا الحساب يملك متابعة كشوف الحساب فقط بدون تسجيل سندات صرف جديدة.")}</div> : null}
      <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={t('accounts.payment_forms.s19', "تعذر حفظ الدفع")} successText={t('accounts.payment_forms.s20', "تم حفظ الدفع بنجاح.")} />
      <div style={{ gridColumn: '1 / -1' }}>
        <SubmitButton type="submit" variant="primary" isPending={mutation.isPending} disabled={disabled} idleText={watchedIsAdvance ? t('accounts.payment_forms.s35', "حفظ سند الدفعة المقدمة") : t('accounts.payment_forms.s21', "حفظ سند الصرف للمورد")} pendingText={t('accounts.payment_forms.s22', "جارٍ الحفظ...")} />
      </div>
    </form>
  );
}
