import { BranchForm } from '@/features/settings/components/forms/BranchForm';
import { CheckIcon } from '@/shared/components/icons/AppIcons';
import { DialogShell } from '@/shared/components/dialog-shell';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { SubmitButton } from '@/shared/components/submit-button';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { normalizeText } from '@/features/settings/components/forms/settings-forms.shared';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { Branch, Location } from '@/types/domain';

export interface SettingsMainFormActionsProps {
  canManageSettings: boolean;
  __t: ReturnType<typeof useTranslation>['t'];
  mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  setupMode: boolean;
  canNavigateAway: () => boolean;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  showSaveSuccess: boolean;
  showBranchQuickAdd: boolean;
  setShowBranchQuickAdd: React.Dispatch<React.SetStateAction<boolean>>;
  onSetupAdvance?: () => void;
  locations: Location[];
  branchPrefillName: string;
  commitSelectedBranch: (branchId: string, branchName?: string) => void;
  branches: Branch[];
  setBranchQuery: React.Dispatch<React.SetStateAction<string>>;
}

export function SettingsMainFormActions(props: SettingsMainFormActionsProps) {
  const { canManageSettings, __t, mutation, setupMode, canNavigateAway, form, showSaveSuccess, showBranchQuickAdd, setShowBranchQuickAdd, onSetupAdvance, locations, branchPrefillName, commitSelectedBranch, branches, setBranchQuery } = props;
  return (
    <>
    {!canManageSettings ? <div className="muted small">{__t('settings.forms.settings_main_form.s21', "هذا الحساب يملك صلاحية عرض الإعدادات فقط بدون تعديل.")}</div> : null}
    <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={__t('settings.forms.settings_main_form.s22', "تعذر حفظ الإعدادات")} successText={__t('settings.forms.settings_main_form.s23', "تم حفظ الإعدادات بنجاح.")} />

    <div
      className="actions compact-actions sticky-form-actions settings-save-actions"
      style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}
    >
      <SubmitButton
        type="submit"
        isPending={mutation.isPending}
        isSuccess={mutation.isSuccess}
        disabled={!canManageSettings}
        idleText={setupMode ? __t('settings.forms.settings_main_form.s24', "حفظ والانتقال للخطوة التالية") : __t('settings.forms.settings_main_form.s25', "حفظ الإعدادات")}
        pendingText={__t('settings.forms.settings_main_form.s26', "جارٍ الحفظ...")}
        successText={__t('settings.forms.settings_main_form.s23', "تم حفظ الإعدادات بنجاح.")}
        style={{ minWidth: '160px', background: '#170e5e', color: '#ffffff' }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => { if (canNavigateAway()) form.reset(); }}
        disabled={mutation.isPending || !form.formState.isDirty}
        style={{ height: '36px', padding: '0 16px', fontSize: '13px' }}
      >
        {__t('settings.forms.settings_main_form.s27', "تفريغ التغييرات")}
      </button>
    </div>

    {showSaveSuccess && (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: '#f0fdf4',
          border: '1.5px solid #86efac',
          borderRadius: '8px',
          color: '#15803d',
          fontSize: '12.5px',
          fontWeight: 800,
          marginTop: '10px',
          boxShadow: '0 1px 4px rgba(22, 163, 74, 0.12)',
          transition: 'all 0.3s ease',
        }}
      >
        <CheckIcon size={16} color="#16a34a" />
        <span>{__t('settings.forms.settings_main_form.s23', "تم حفظ الإعدادات بنجاح.")} كافة التعديلات مطبقة ومفعلة مباشرة الآن.</span>
      </div>
    )}

    {/* مودال إضافة فرع سريع */}
    <DialogShell open={!SINGLE_STORE_MODE && showBranchQuickAdd} onClose={() => setShowBranchQuickAdd(false)} width="min(560px, 100%)" ariaLabel={__t('settings.forms.settings_main_form.s28', "إضافة فرع جديد")}>
      <div className="page-stack">
        <div><strong>{__t('settings.forms.settings_main_form.s29', "إضافة فرع جديد")}</strong></div>
        <BranchForm
          canManageSettings={canManageSettings}
          setupMode={setupMode}
          onSetupAdvance={onSetupAdvance}
          hasExistingLocations={locations.length > 0}
          initialValues={{ name: branchPrefillName }}
          onCreated={(payload) => {
            const nextBranchId = String(payload.branchId || '').trim();
            if (nextBranchId) {
              commitSelectedBranch(nextBranchId, payload.name || branchPrefillName);
            } else if (payload.name) {
              const matched = branches.find((branch) => normalizeText(String(branch.name || '')) === normalizeText(payload.name || ''));
              if (matched?.id) {
                commitSelectedBranch(String(matched.id), String(matched.name || payload.name));
              } else {
                setBranchQuery(payload.name || branchPrefillName);
              }
            }
            setShowBranchQuickAdd(false);
          }}
        />
        <div className="actions compact-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setShowBranchQuickAdd(false)}>{__t('settings.forms.settings_main_form.s30', "إلغاء")}</button>
        </div>
      </div>
    </DialogShell>
    </>
  );
}
