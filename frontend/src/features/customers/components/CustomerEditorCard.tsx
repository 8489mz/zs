import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useUpdateCustomerMutation } from '@/features/customers/hooks/useCustomerActions';
import { customerFormSchema, type CustomerFormInput, type CustomerFormOutput } from '@/features/customers/schemas/customer.schema';
import type { Customer } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useCustomerProfile } from '@/features/customers/constants/customer-profiles';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { customersApi } from '@/shared/api/customers.api';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { CustomerVisitDaysPicker } from './CustomerVisitDaysPicker';
import { FreightPortalPinCard } from './FreightPortalPinCard';
import {
  UsersIcon,
  MapPinIcon,
  CreditCardIcon,
  CalendarIcon,
  TrashIcon,
  CheckCircleIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';

export interface CustomerEditorCardProps {
  customer?: Customer;
  onSaved?: () => void;
  onDeleteCustomer?: () => void;
  deleteLabel?: string;
}

interface RepScheduleItem {
  repId: number;
  repName: string;
  days: string[];
}

export function CustomerEditorCard({
  customer,
  onSaved,
  onDeleteCustomer,
  deleteLabel,
}: CustomerEditorCardProps) {
  const { t: __t } = useTranslation();
  const profile = useCustomerProfile();
  const settingsQuery = useSettingsQuery();
  const importModuleEnabled = settingsQuery.data?.importModuleEnabled === true;

  const repsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    staleTime: 60000,
  });
  const allReps: DeliveryRep[] = useMemo(() => ((repsQuery.data as any) || []) as DeliveryRep[], [repsQuery.data]);

  // Ledger-derived current book balance (INV-EDIT-DIALOG-BALANCE-LABEL):
  // the disabled input below shows the stored customers.balance column
  // (the opening balance), which is NOT the current balance. The current
  // book balance lives in the ledger (GET /api/reports/customer-balances,
  // coalesce(sum(customer_ledger.amount), customers.balance, 0)), so fetch
  // it the same useQuery way as the reps above and render it as a separate
  // read-only line. The opening-balance input and its form wiring are
  // deliberately untouched.
  const ledgerBalanceQuery = useQuery({
    queryKey: queryKeys.customerBalances,
    queryFn: customersApi.balances,
    staleTime: 60000,
    enabled: Boolean(customer?.id),
  });
  const ledgerBalanceRow = useMemo(
    () => (ledgerBalanceQuery.data || []).find((row) => String(row.id) === String(customer?.id)),
    [ledgerBalanceQuery.data, customer?.id],
  );
  const ledgerBalance = ledgerBalanceRow ? Number(ledgerBalanceRow.balance || 0) : null;

  const [selectedRepIds, setSelectedRepIds] = useState<number[]>([]);
  const [useRepSpecificSchedules, setUseRepSpecificSchedules] = useState<boolean>(false);
  const [repSchedulesState, setRepSchedulesState] = useState<RepScheduleItem[]>([]);

  const form = useForm<CustomerFormInput, undefined, CustomerFormOutput>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: { name: '', phone: '', address: '', balance: 0, type: 'cash', creditLimit: 0 },
  });

  const mutation = useUpdateCustomerMutation(customer?.id ? String(customer.id) : undefined, onSaved);
  useUnsavedChangesGuard(Boolean(customer) && form.formState.isDirty && !mutation.isPending);

  useEffect(() => {
    if (!customer) return;
    const meta: any = customer.metadata || { currency: 'EGP' };

    const visitDays: string[] = Array.isArray(meta.visit_days) && meta.visit_days.length > 0
      ? meta.visit_days
      : (Array.isArray(meta.visitDays) && meta.visitDays.length > 0 ? meta.visitDays : (meta.visit_day ? [meta.visit_day] : []));
    const visitDay = visitDays[0] || meta.visit_day || '';

    // Extract assigned reps (multi or single)
    let assignedIds: number[] = [];
    if (Array.isArray(meta.assigned_rep_ids)) {
      assignedIds = meta.assigned_rep_ids.map((id: any) => Number(id)).filter((id: number) => id > 0);
    } else if (meta.assigned_rep_id) {
      const sId = Number(meta.assigned_rep_id);
      if (sId > 0) assignedIds = [sId];
    }

    const savedSchedules: RepScheduleItem[] = Array.isArray(meta.rep_schedules)
      ? meta.rep_schedules.map((s: any) => ({
          repId: Number(s.repId || s.rep_id),
          repName: s.repName || s.rep_name || '',
          days: Array.isArray(s.days) ? s.days : [],
        }))
      : [];

    setSelectedRepIds(assignedIds);

    if (savedSchedules.length > 0) {
      setUseRepSpecificSchedules(true);
      setRepSchedulesState(savedSchedules);
    } else {
      setUseRepSpecificSchedules(false);
      setRepSchedulesState(
        assignedIds.map((rId) => {
          const repObj = allReps.find((r) => r.id === rId);
          return {
            repId: rId,
            repName: repObj?.name || `مندوب #${rId}`,
            days: [...visitDays],
          };
        }),
      );
    }

    form.reset({
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
      balance: Number(customer.balance || 0),
      type: (['vip', 'credit', 'wholesale', 'cash'].includes(customer.type) ? customer.type : 'cash') as any,
      creditLimit: Number(customer.creditLimit || 0),
      metadata: {
        ...meta,
        visit_days: visitDays,
        visit_day: visitDay,
      },
    });
  }, [customer, form, allReps]);

  const toggleRepSelection = (repId: number) => {
    setSelectedRepIds((prev) => {
      const exists = prev.includes(repId);
      const next = exists ? prev.filter((id) => id !== repId) : [...prev, repId];

      // Update repSchedulesState to include/remove
      if (!exists) {
        const repObj = allReps.find((r) => r.id === repId);
        const currentGeneralDays = form.getValues('metadata.visit_days') || [];
        setRepSchedulesState((old) => [
          ...old.filter((s) => s.repId !== repId),
          {
            repId,
            repName: repObj?.name || `مندوب #${repId}`,
            days: currentGeneralDays.length > 0 ? [...currentGeneralDays] : [],
          },
        ]);
      } else {
        setRepSchedulesState((old) => old.filter((s) => s.repId !== repId));
      }

      return next;
    });
  };

  const handleRepDaysChange = (repId: number, days: string[]) => {
    setRepSchedulesState((prev) =>
      prev.map((item) => (item.repId === repId ? { ...item, days } : item)),
    );
  };

  const onSubmit = (values: CustomerFormOutput) => {
    const existingMeta = values.metadata || {};

    let finalVisitDays: string[] = form.getValues('metadata.visit_days') || [];
    let finalRepSchedules: RepScheduleItem[] = [];

    if (useRepSpecificSchedules && selectedRepIds.length > 0) {
      finalRepSchedules = repSchedulesState.filter((s) => selectedRepIds.includes(s.repId));
      const allDaysSet = new Set<string>();
      for (const s of finalRepSchedules) {
        for (const d of s.days) allDaysSet.add(d);
      }
      finalVisitDays = Array.from(allDaysSet);
    }

    const repNames = selectedRepIds.map((id) => {
      const rep = allReps.find((r) => r.id === id);
      return rep ? `${rep.name}${rep.vehicle_plate ? ` (${rep.vehicle_plate})` : ''}` : `مندوب #${id}`;
    });

    const payload: CustomerFormOutput = {
      ...values,
      metadata: {
        ...existingMeta,
        visit_days: finalVisitDays,
        visit_day: finalVisitDays[0] || '',
        assigned_rep_ids: selectedRepIds,
        assigned_rep_id: selectedRepIds.length > 0 ? selectedRepIds[0] : null,
        assigned_rep_names: repNames,
        assigned_rep_name: repNames.join(' ، '),
        rep_schedules: useRepSpecificSchedules ? finalRepSchedules : [],
      },
    };

    mutation.mutate(payload);
  };

  if (!customer) {
    return <div className="muted">{__t('customers.customer_editor_card.s0', "اختر عميلًا من الجدول لعرض نموذج التعديل.")}</div>;
  }

  return (
    <>
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}
      dir="rtl"
    >
      <DraftStateNotice
        visible={form.formState.isDirty && !mutation.isPending}
        title={__t('customers.customer_editor_card.s1', "تعديلات الحساب الحالية غير محفوظة")}
        hint={__t('customers.customer_editor_card.s2', "احفظ التغييرات أو أعد تعيين القيم قبل الانتقال إلى حساب آخر.")}
      />

      {/* SECTION 1: بيانات المحل الأساسية والاتصال */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <UsersIcon size={15} color="#170e5e" />
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {__t('customers.customer_editor_card.s3', "بيانات المحل والاتصال")}
          </h4>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          <div style={{ gridColumn: 'span 2' }}>
            <Field label={profile.nameLabel} error={form.formState.errors.name?.message}>
              <input
                {...form.register('name')}
                disabled={mutation.isPending}
                placeholder={profile.namePlaceholder}
                style={{ height: '36px', fontSize: '13px', fontWeight: 700 }}
              />
            </Field>
          </div>

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
                  style={{ height: '36px', fontSize: '12.5px' }}
                />
              )}
            />
          </Field>

          <Field label={profile.phoneLabel} error={form.formState.errors.phone?.message}>
            <input
              type="tel"
              {...form.register('phone')}
              disabled={mutation.isPending}
              placeholder={profile.phonePlaceholder}
              style={{ height: '36px', fontSize: '13px' }}
            />
          </Field>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label={profile.addressLabel}>
              <input
                {...form.register('address')}
                disabled={mutation.isPending}
                placeholder={profile.addressPlaceholder}
                style={{ height: '36px', fontSize: '13px' }}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* SECTION 2: السياسة المالية والائتمان */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <CreditCardIcon size={15} color="#170e5e" />
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {__t('customers.customer_editor_card.s4', "السياسة المالية وحدود الائتمان")}
          </h4>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Field
            label={`${profile.balanceLabel} (${getGlobalCurrencySymbol()})`}
            hint={__t('customers.customer_editor_card.s5', "الرصيد الدفتري الحالي")}
            error={form.formState.errors.balance?.message}
          >
            <input
              type="number"
              step="0.01"
              {...form.register('balance')}
              disabled={true}
              style={{ height: '36px', fontSize: '13px', fontWeight: 800, backgroundColor: '#f8fafc', color: Number(customer.balance || 0) > 0 ? '#b91c1c' : '#0f172a' }}
            />
            <div
              data-testid="ledger-current-balance"
              style={{ marginTop: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a', lineHeight: 1.5 }}
            >
              {ledgerBalanceQuery.isPending ? (
                <span style={{ color: '#64748b' }}>
                  {__t('customers.customer_editor_card.s43', "جارٍ تحميل الرصيد الدفتري الحالي…")}
                </span>
              ) : ledgerBalanceQuery.isError ? (
                <span style={{ color: '#b91c1c' }}>
                  {__t('customers.customer_editor_card.s44', "تعذّر تحميل الرصيد الدفتري الحالي من كشف الحساب — أعد فتح البطاقة وحاول مجددًا.")}
                </span>
              ) : (
                <span>
                  {__t('customers.customer_editor_card.s45', "الرصيد الدفتري الحالي:")}{' '}
                  {ledgerBalance === null
                    ? '—'
                    : `${ledgerBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${getGlobalCurrencySymbol()}`}
                </span>
              )}
            </div>
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
              style={{ height: '36px', fontSize: '13px', fontWeight: 700 }}
            />
          </Field>
        </div>

        {/* Rep Isolated Balances Breakdown */}
        {(customer.repBalances && customer.repBalances.length > 0) || (customer.unassignedBalance ?? 0) > 0 ? (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              backgroundColor: '#fff7ed',
              border: '1px solid #fed7aa',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#9a3412' }}>
                {__t('customers.customer_editor_card.s6', "مديونية المحل لكل مندوب (نظام عزل الحسابات المستقلة):")}
              </span>
              <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#dc2626' }}>
                {__t('customers.customer_editor_card.s7', "الإجمالي:")} {Number(customer.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} {getGlobalCurrencySymbol()}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(customer.repBalances || []).map((rb) => (
                <div
                  key={rb.repId}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #fed7aa',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#1e293b' }}>{rb.repName}:</span>
                  <span style={{ fontWeight: 800, color: rb.balance > 0 ? '#b91c1c' : '#15803d' }}>
                    {rb.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} {getGlobalCurrencySymbol()}
                  </span>
                </div>
              ))}
              {/* INV-CUSTOMER-REP-BALANCES-UNASSIGNED: the legacy opening
                  balance no rep owns — without this chip the breakdown
                  shows 570 attributed of a 645 total with 75 invisible. */}
              {(customer.unassignedBalance ?? 0) > 0 && (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#475569' }}>{__t('customers.customer_editor_card.s46', "مباشر/إدارة:")}</span>
                  <span style={{ fontWeight: 800, color: '#475569' }}>
                    {(customer.unassignedBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} {getGlobalCurrencySymbol()}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* SECTION 3: التوزيع الميداني وجدول خط السير والمناديب */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <MapPinIcon size={15} color="#170e5e" />
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {__t('customers.customer_editor_card.s8', "بيانات التوزيع الميداني وخط السير وتعيين المناديب")}
          </h4>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          <Field label={__t('customers.customer_editor_card.s9', "كود المحل / المنفذ الفريد")} hint={__t('customers.customer_editor_card.s10', "رمز تعريفي في أجهزة المناديب")}>
            <input
              {...form.register('metadata.customer_code')}
              disabled={mutation.isPending}
              placeholder={__t('customers.customer_editor_card.s11', "مثال: C-1042 أو CUST-01")}
              style={{ height: '36px', fontSize: '12.5px', fontFamily: 'monospace' }}
            />
          </Field>

          <Field label={__t('customers.customer_editor_card.s12', "خط السير الرئيسي")} hint={__t('customers.customer_editor_card.s13', "الخط الجغرافي التابع له المحل")}>
            <input
              {...form.register('metadata.route')}
              disabled={mutation.isPending}
              placeholder={__t('customers.customer_editor_card.s14', "مثال: خط الضواحي، خط السوق")}
              list="customer-editor-known-routes"
              style={{ height: '36px', fontSize: '12.5px' }}
            />
            <datalist id="customer-editor-known-routes">
              {(() => {
                try {
                  const list: string[] = JSON.parse(localStorage.getItem('zs_van_saved_routes') || '[]');
                  return list.map((r) => <option key={r} value={r} />);
                } catch {
                  return null;
                }
              })()}
            </datalist>
          </Field>

          <Field label={__t('customers.customer_editor_card.s15', "الحي / المربع السكني (District)")} hint={__t('customers.customer_editor_card.s16', "لتجميع المحلات القريبة")}>
            <input
              {...form.register('metadata.district')}
              disabled={mutation.isPending}
              placeholder={__t('customers.customer_editor_card.s17', "مثال: حي الزهور، شارع بورسعيد")}
              list="customer-editor-known-districts"
              style={{ height: '36px', fontSize: '12.5px' }}
            />
            <datalist id="customer-editor-known-districts">
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

          <Field label={__t('customers.customer_editor_card.s18', "رابط الموقع (Google Maps)")} hint={__t('customers.customer_editor_card.s19', "رابط موقع المحل على الخريطة")}>
            <input
              {...form.register('metadata.location_url')}
              disabled={mutation.isPending}
              placeholder="https://maps.google.com/?q=..."
              style={{ height: '36px', fontSize: '12px' }}
            />
          </Field>
        </div>

        {/* MULTI-REP ASSIGNMENT SECTION */}
        <div
          style={{
            marginTop: '14px',
            padding: '12px 14px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UsersIcon size={14} color="#170e5e" />
              <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                {__t('customers.customer_editor_card.s20', "المناديب المسؤولون عن هذا المحل (تخصيص متعدد)")}
              </label>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {selectedRepIds.length === 0
                ? __t('customers.customer_editor_card.s21', "مشترك (يظهر لأي مندوب في الخط العام)")
                : `تم تخصيص ${selectedRepIds.length} مناديب لهذا المحل`}
            </span>
          </div>

          {/* Rep selection pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {allReps.length === 0 ? (
              <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>{__t('customers.customer_editor_card.s22', "لا يوجد مناديب مسجلين بالنظام حالياً.")}</span>
            ) : (
              allReps.map((rep) => {
                const isSelected = selectedRepIds.includes(rep.id);
                return (
                  <button
                    key={rep.id}
                    type="button"
                    onClick={() => toggleRepSelection(rep.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '8px',
                      border: '1px solid ' + (isSelected ? '#170e5e' : '#cbd5e1'),
                      backgroundColor: isSelected ? '#170e5e' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#1e293b',
                      fontSize: '11.5px',
                      fontWeight: isSelected ? 800 : 600,
                      cursor: 'pointer',
                      transition: 'none',
                    }}
                  >
                    {isSelected && <CheckCircleIcon size={13} color="#ffffff" />}
                    <span>{rep.name}</span>
                    {rep.vehicle_plate && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: isSelected ? '#c7d2fe' : '#64748b',
                          fontFamily: 'monospace',
                        }}
                      >
                        ({rep.vehicle_plate})
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Switch to enable Rep-Specific Schedules when multiple reps selected */}
          {selectedRepIds.length > 1 && (
            <div
              style={{
                marginTop: '6px',
                paddingTop: '8px',
                borderTop: '1px dashed #cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <SlidersIcon size={13} color="#170e5e" />
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#170e5e' }}>
                  {__t('customers.customer_editor_card.s23', "تخصيص جدول زيارات مستقل لكل مندوب")}
                </span>
                <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                  {__t('customers.customer_editor_card.s24', "(مثلاً: مندوب يزوره الأحد ومندوب آخر يزوره الخميس)")}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setUseRepSpecificSchedules(false)}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '6px',
                    border: '1px solid ' + (!useRepSpecificSchedules ? '#170e5e' : '#cbd5e1'),
                    backgroundColor: !useRepSpecificSchedules ? '#e0e7ff' : '#ffffff',
                    color: !useRepSpecificSchedules ? '#170e5e' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {__t('customers.customer_editor_card.s25', "جدول موحد للجميع")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseRepSpecificSchedules(true);
                    // Ensure schedules exist for all selected reps
                    setRepSchedulesState((old) => {
                      const existingMap = new Map(old.map((s) => [s.repId, s]));
                      const currentGeneral = form.getValues('metadata.visit_days') || [];
                      return selectedRepIds.map((id) => {
                        const existing = existingMap.get(id);
                        if (existing) return existing;
                        const repObj = allReps.find((r) => r.id === id);
                        return {
                          repId: id,
                          repName: repObj?.name || `مندوب #${id}`,
                          days: [...currentGeneral],
                        };
                      });
                    });
                  }}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '6px',
                    border: '1px solid ' + (useRepSpecificSchedules ? '#170e5e' : '#cbd5e1'),
                    backgroundColor: useRepSpecificSchedules ? '#170e5e' : '#ffffff',
                    color: useRepSpecificSchedules ? '#ffffff' : '#475569',
                    fontSize: '11px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {__t('customers.customer_editor_card.s26', "تخصيص أيام لكل مندوب")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* SCHEDULE PICKER SECTION */}
        <div style={{ marginTop: '12px' }}>
          {useRepSpecificSchedules && selectedRepIds.length > 1 ? (
            /* REP-SPECIFIC SCHEDULES LIST */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CalendarIcon size={14} color="#170e5e" />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                  {__t('customers.customer_editor_card.s27', "أيام الزيارة الأسبوعية المحددة لكل مندوب:")}
                </span>
              </div>

              {selectedRepIds.map((rId) => {
                const repObj = allReps.find((r) => r.id === rId);
                const schedule = repSchedulesState.find((s) => s.repId === rId);
                const assignedDays = schedule?.days || [];

                return (
                  <div
                    key={rId}
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
                        {__t('customers.customer_editor_card.s28', "المندوب:")} {repObj?.name || `مندوب #${rId}`}
                        {repObj?.vehicle_plate ? ` (${repObj.vehicle_plate})` : ''}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {assignedDays.length === 0
                          ? __t('customers.customer_editor_card.s29', "متاح للمندوب يومياً طوال الأسبوع")
                          : `محدد للمندوب في: ${assignedDays.join(__t('customers.customer_editor_card.s30', " ، "))}`}
                      </span>
                    </div>

                    <CustomerVisitDaysPicker
                      value={assignedDays}
                      singleValue={assignedDays[0]}
                      disabled={mutation.isPending}
                      onChange={(days) => handleRepDaysChange(rId, days)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            /* GENERAL UNIFIED SCHEDULE */
            <div>
              <Field
                label={__t('customers.customer_editor_card.s31', "أيام الزيارة الأسبوعية المجدولة للمحل")}
                hint={__t('customers.customer_editor_card.s32', "حدد الأيام التي يظهر فيها هذا المحل في خط سير المندوب")}
              >
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
            </div>
          )}
        </div>
      </div>

      {importModuleEnabled && (
        <fieldset
          style={{
            padding: '12px 16px',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <legend style={{ padding: '0 8px', fontWeight: 800, color: '#170e5e', fontSize: '12.5px' }}>
            {__t('customers.customer_editor_card.s33', "إعدادات الاستيراد")}
          </legend>
          <div>
            <Field label={__t('customers.customer_editor_card.s34', "عملة الحساب")}>
              <Controller
                name="metadata.currency"
                control={form.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={mutation.isPending}
                    options={[
                      { value: 'EGP', label: __t('customers.customer_editor_card.s35', "جنيه مصري") },
                      { value: 'USD', label: __t('customers.customer_editor_card.s36', "دولار أمريكي") },
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </fieldset>
      )}

      <MutationFeedback
        isError={mutation.isError}
        isSuccess={mutation.isSuccess}
        error={mutation.error}
        errorFallback={__t('customers.customer_editor_card.s37', "تعذر تحديث البيانات")}
        successText={__t('customers.customer_editor_card.s38', "تم حفظ وتحديث بيانات المحل وخط السير بنجاح.")}
      />

      {/* FOOTER ACTIONS BAR */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '10px',
          paddingTop: '12px',
          borderTop: '1px solid #e2e8f0',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        {/* Right action in RTL: Delete Button (if provided) */}
        <div>
          {onDeleteCustomer && (
            <Button
              type="button"
              variant="danger"
              onClick={onDeleteCustomer}
              disabled={mutation.isPending}
              style={{
                fontSize: '11.5px',
                padding: '6px 14px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <TrashIcon size={13} />
              <span>{deleteLabel || __t('customers.customer_editor_card.s39', "حذف هذا العميل")}</span>
            </Button>
          )}
        </div>

        {/* Left actions in RTL: Reset & Submit Buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => form.reset()}
            disabled={mutation.isPending}
            style={{ minHeight: '36px', padding: '0 16px', fontSize: '12px', fontWeight: 700 }}
          >
            {__t('customers.customer_editor_card.s40', "إعادة القيم")}
          </Button>

          <SubmitButton
            type="submit"
            isPending={mutation.isPending}
            idleText={__t('customers.customer_editor_card.s41', "حفظ تعديلات المحل وخط السير")}
            pendingText={__t('customers.customer_editor_card.s42', "جارٍ الحفظ والتحديث...")}
            style={{
              minHeight: '36px',
              padding: '0 24px',
              fontSize: '12.5px',
              fontWeight: 800,
              backgroundColor: '#170e5e',
              color: '#ffffff',
            }}
          />
        </div>
      </div>
    </form>
    <FreightPortalPinCard customerId={String(customer.id)} />
    </>
  );
}
