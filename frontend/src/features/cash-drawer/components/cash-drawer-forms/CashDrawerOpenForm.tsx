// Open-shift form — the open branch inner panel: header with the close
// button plus the opening form (opening cash, branch and location pickers,
// current-user password for open confirmation, opening note, feedback and
// submit). Pure move; the panel keeps all state and mounts this component
// with the form, the mutation and the pickers data. The MutationLike
// shape below is shared by the movement and close forms too.

import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { Field } from '@/shared/ui/field';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import type { Branch, Location } from '@/types/domain';
import type { OpenShiftValues } from '@/features/cash-drawer/hooks/useCashDrawerPageController';

export interface MutationLike {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  reset?: () => void;
}

export function CashDrawerOpenForm({
  openForm,
  openMutation,
  branches,
  locationList,
  availableLocations,
  requirePasswordOnShiftOpen,
  onCloseForm,
}: {
  openForm: UseFormReturn<OpenShiftValues>;
  openMutation: MutationLike & { mutate: (values: OpenShiftValues) => void };
  branches: Branch[];
  locationList: Location[];
  availableLocations: Location[];
  requirePasswordOnShiftOpen?: boolean;
  onCloseForm: () => void;
}) {
  const { t } = useTranslation();
  return (
        <div className="cash-drawer-modal-scroll">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <h2 className="cash-drawer-form-title" style={{ margin: 0 }}>{t('cash_drawer.cash_drawer_forms_panel.s12', "فتح وردية نقطة بيع")}</h2>
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
        <form className="form-grid" onSubmit={openForm.handleSubmit((values) => openMutation.mutate(values))}>
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s13', "رصيد الفتح")}><input type="number" step="0.01" {...openForm.register('openingCash', { valueAsNumber: true })} disabled={openMutation.isPending} onFocus={(e) => e.target.select()} /></Field>
          {!SINGLE_STORE_MODE ? <Field label={t('cash_drawer.cash_drawer_forms_panel.s14', "الفرع")}>
            <select
              {...openForm.register('branchId')}
              disabled={openMutation.isPending}
              onChange={(e) => {
                const nextBranchId = e.target.value;
                openForm.setValue('branchId', nextBranchId);
                const branchObj = branches.find(b => String(b.id) === String(nextBranchId));
                const nextLocs = locationList.filter(l => !l.branchId || String(l.branchId) === String(nextBranchId));
                const nextDefaultLoc = (branchObj?.defaultStockLocationId && locationList.find(l => String(l.id) === String(branchObj.defaultStockLocationId)))
                  || nextLocs.find(l => l.name.includes(t('cash_drawer.cash_drawer_forms_panel.s15', "الرئيسي")) || l.name.toLowerCase().includes('main'))
                  || nextLocs[0]
                  || locationList[0];
                if (nextDefaultLoc?.id) {
                  openForm.setValue('locationId', nextDefaultLoc.id);
                }
              }}
            >
              <option value="">{t('cash_drawer.cash_drawer_forms_panel.s16', "بدون فرع")}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </Field> : null}
          {SINGLE_STORE_MODE ? <Field label={t('cash_drawer.cash_drawer_forms_panel.s17', "المخزن الأساسي")}><input value={locationList[0]?.name || t('cash_drawer.cash_drawer_forms_panel.s18', "سيتم الربط تلقائيًا بالمخزن الأساسي")} disabled readOnly /></Field> : <Field label={t('cash_drawer.cash_drawer_forms_panel.s19', "المخزن")}>
            <Controller
              name="locationId"
              control={openForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value}
                  onChange={field.onChange}
                  disabled={openMutation.isPending}
                  options={[
                    { value: '', label: t('cash_drawer.cash_drawer_forms_panel.s20', "بدون مخزن") },
                    ...availableLocations.map((location) => ({ value: location.id, label: location.name })),
                  ]}
                />
              )}
            />
          </Field>}
          {requirePasswordOnShiftOpen ? (
            <Field label={t('cash_drawer.cash_drawer_forms_panel.open_password', "كلمة مرور المستخدم الحالي (تأكيد الفتح)")}>
              <input
                type="password"
                placeholder={t('cash_drawer.cash_drawer_forms_panel.open_password_ph', "أدخل كلمة المرور لتأكيد فتح الوردية")}
                required
                {...openForm.register('password', { required: requirePasswordOnShiftOpen })}
                disabled={openMutation.isPending}
                autoComplete="off"
                data-lpignore="true"
              />
            </Field>
          ) : null}
          <Field label={t('cash_drawer.cash_drawer_forms_panel.s21', "ملاحظة الافتتاح")}><textarea rows={2} {...openForm.register('note')} disabled={openMutation.isPending} /></Field>
          <MutationFeedback isError={openMutation.isError} isSuccess={openMutation.isSuccess} error={openMutation.error} errorFallback={t('cash_drawer.cash_drawer_forms_panel.s22', "تعذر فتح وردية نقطة البيع")} successText={t('cash_drawer.cash_drawer_forms_panel.s23', "تم فتح وردية نقطة البيع بنجاح.")} />
          <SubmitButton type="submit" isPending={openMutation.isPending} idleText={t('cash_drawer.cash_drawer_forms_panel.s24', "فتح وردية نقطة البيع")} pendingText={t('cash_drawer.cash_drawer_forms_panel.s25', "جارٍ الفتح...")} />
        </form>
        </div>
  );
}
