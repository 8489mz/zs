// Movement branch — shift picker, type select, counterpart picker, amount
// and reason. Pure move; the panel keeps all state and mounts this
// component with the movement values and callbacks.

import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { Field } from '@/shared/ui/field';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CustomSelect } from '@/shared/ui/custom-select';
import { isCashDrawerTransferType } from '@/features/cash-drawer/lib/cash-drawer-movement-request-key';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import type { CashBankAccountRow } from '@/features/cash-drawer/hooks/useCounterpartAccounts';
import type { MovementValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';
import type { CashierShift } from '@/types/domain';
import type { MutationLike } from './CashDrawerOpenForm';

interface CashDrawerMovementFormProps {
  movementForm: UseFormReturn<MovementValues>;
  movementMutation: MutationLike;
  openOptions: CashierShift[];
  myOpenShift?: CashierShift | null;
  isManager?: boolean;
  cashBankAccounts: CashBankAccountRow[];
  accountsLoadFailed: boolean;
  accountsLoadForbidden: boolean;
  isTransferMovement: boolean;
  onMovementSubmit: () => void;
  onCloseForm: () => void;
}

export function CashDrawerMovementForm({
  movementForm,
  movementMutation,
  openOptions,
  myOpenShift,
  isManager,
  cashBankAccounts,
  accountsLoadFailed,
  accountsLoadForbidden,
  isTransferMovement,
  onMovementSubmit,
  onCloseForm,
}: CashDrawerMovementFormProps) {
  const { t } = useTranslation();
  return (
    <>
        <div className="cash-drawer-modal-scroll">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <h2 className="cash-drawer-form-title" style={{ margin: 0 }}>{t('cash_drawer.cash_drawer_forms_panel.s26', "تسجيل حركة درج النقدية")}</h2>
            <button
              type="button"
              onClick={onCloseForm}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#64748b',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
              title={t('common.close', 'إغلاق')}
            >
              <XIcon size={18} />
            </button>
          </div>
        <form className="form-grid" onSubmit={onMovementSubmit}>
          {isManager && openOptions.length > 1 ? (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.s27', "وردية نقطة البيع المفتوحة")}>
              <Controller
                name="shiftId"
                control={movementForm.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={movementMutation.isPending}
                    options={[
                      { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s28', "اختر وردية نقطة البيع") },
                      ...openOptions.map((shift) => ({
                        value: shift.id,
                        label: `${shift.openedByName || t('cash_drawer.cash_drawer_forms_panel.s29', "وردية نقطة بيع")}${shift.docNo ? ` — ${shift.docNo}` : ''}${String(shift.id) === String(myOpenShift?.id) ? t('cash_drawer.cash_drawer_forms_panel.s30', " (ورديتي الحالية)") : ''}`,
                      })),
                    ]}
                  />
                )}
              />
            </Field>
          ) : (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.s31', "وردية نقطة البيع")}>
              <div style={{
                padding: '10px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>{(myOpenShift || openOptions.find(s => String(s.id) === String(movementForm.watch('shiftId'))) || openOptions[0])?.openedByName || t('cash_drawer.cash_drawer_forms_panel.s32', "الوردية الحالية")}{(myOpenShift || openOptions.find(s => String(s.id) === String(movementForm.watch('shiftId'))) || openOptions[0])?.docNo ? ` — ${(myOpenShift || openOptions.find(s => String(s.id) === String(movementForm.watch('shiftId'))) || openOptions[0])?.docNo}` : ''}</span>
                <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>{t('cash_drawer.cash_drawer_forms_panel.s33', "وردية نشطة")}</span>
              </div>
            </Field>
          )}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s34', "النوع")}>
            <Controller
              name="type"
              control={movementForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    if (!isCashDrawerTransferType(value)) {
                      movementForm.setValue('counterpartAccountId', '');
                    }
                  }}
                  disabled={movementMutation.isPending}
                  options={[
                    { value: 'cash_in', label: t('cash_drawer.cash_drawer_forms_panel.s35', "إيداع") },
                    { value: 'cash_out', label: t('cash_drawer.cash_drawer_forms_panel.s36', "صرف") },
                    { value: 'safe_drop', label: t('cash_drawer.cash_drawer_forms_panel.s105', "تحويل للخزنة (إيداع آمن)") },
                    { value: 'safe_replenishment', label: t('cash_drawer.cash_drawer_forms_panel.s106', "تغذية الدرج من الخزنة") },
                  ]}
                />
              )}
            />
          </Field>
          {isTransferMovement && (
            <Field
              label={t('cash_drawer.cash_drawer_forms_panel.s107', "الحساب المقابل (خزنة / بنك)")}
              hint={accountsLoadForbidden ? t('cash_drawer.cash_drawer_forms_panel.s110', "تعذّر تحميل الحسابات — لا تملك الصلاحية المطلوبة") : accountsLoadFailed ? t('cash_drawer.cash_drawer_forms_panel.s111', "تعذّر تحميل الحسابات — حاول مرة أخرى") : cashBankAccounts.length === 0 ? t('cash_drawer.cash_drawer_forms_panel.s109', "لا توجد حسابات نقدية أو بنكية نشطة") : undefined}
            >
              <Controller
                name="counterpartAccountId"
                control={movementForm.control}
                render={({ field }) => (
                  <CustomSelect
                    value={field.value || ''}
                    onChange={field.onChange}
                    disabled={movementMutation.isPending}
                    options={[
                      { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s108', "اختر الحساب المقابل") },
                      ...cashBankAccounts.map((a) => ({
                        value: String(a.id),
                        label: `${a.code} — ${a.nameAr || a.nameEn || a.code}`,
                      })),
                    ]}
                  />
                )}
              />
            </Field>
          )}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s37', "المبلغ")}><input type="number" step="0.01" {...movementForm.register('amount', { valueAsNumber: true })} disabled={movementMutation.isPending} onFocus={(e) => e.target.select()} /></Field>
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s38', "سبب الحركة *")}><textarea rows={2} placeholder={t('cash_drawer.cash_drawer_forms_panel.s39', "اكتب سبب الصرف أو الإيداع بوضوح")} required {...movementForm.register('note', { required: true })} disabled={movementMutation.isPending} /></Field>
          <MutationFeedback isError={movementMutation.isError} isSuccess={movementMutation.isSuccess} error={movementMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s40', "تعذر تسجيل الحركة")} successText={t('cash_drawer.cash_drawer_forms_panel.s41', "تم تسجيل حركة درج النقدية بنجاح.")} />
          <SubmitButton
            type="submit"
            isPending={movementMutation.isPending}
            disabled={!movementForm.watch('shiftId') || !(Number(movementForm.watch('amount')) > 0) || !String(movementForm.watch('note') || '').trim() || (isTransferMovement && !movementForm.watch('counterpartAccountId'))}
            idleText={t('cash_drawer.cash_drawer_forms_panel.s42', "حفظ الحركة")}
            pendingText={t('cash_drawer.cash_drawer_forms_panel.s43', "جارٍ الحفظ...")}
          />
        </form>
        </div>
    </>
  );
}
