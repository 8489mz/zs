import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { AlertTriangleIcon, LightbulbIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

export interface SettingsMainFormNoticesProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  __t: ReturnType<typeof useTranslation>['t'];
  canManageSettings: boolean;
  tabErrors: Record<'general' | 'sales_inventory' | 'modules' | 'printing', { fieldKey: string; label: string; message?: string }[]>;
  navigateToFieldAndHighlight: (fieldKey: string) => void;
}

export function SettingsMainFormNotices(props: SettingsMainFormNoticesProps) {
  const { form, mutation, __t, canManageSettings, tabErrors, navigateToFieldAndHighlight } = props;
  return (
    <>
    {/* الإشعارات والأخطاء */}
    <DraftStateNotice visible={form.formState.isDirty && !mutation.isPending} title={__t('settings.forms.settings_main_form.s5', "تغييرات غير محفوظة")} hint={__t('settings.forms.settings_main_form.s6', "احفظ التعديلات أو أعد ضبطها قبل مغادرة الشاشة.")} />
    {!canManageSettings ? <div className="muted small" style={{ marginBottom: 16 }}>{__t('settings.forms.settings_main_form.s7', "هذا الحساب يملك صلاحية عرض الإعدادات فقط بدون تعديل.")}</div> : null}
    <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={__t('settings.forms.settings_main_form.s8', "تعذر حفظ الإعدادات")} successText={__t('settings.forms.settings_main_form.s9', "تم حفظ الإعدادات بنجاح.")} />
    {form.formState.errors.root?.serverError?.message ? (
      <div className="document-prototype-section" style={{ backgroundColor: '#fee2e2', borderColor: '#ef4444', marginBottom: 16 }}>
        <div style={{ color: '#b91c1c' }}>{form.formState.errors.root.serverError.message}</div>
      </div>
    ) : null}

    {/* التابات وتنبيه الأخطاء التفاعلي */}
    {!form.formState.isValid && form.formState.isSubmitted && Object.keys(form.formState.errors).length > 0 && (
      <div
        className="settings-validation-alert"
        style={{
          padding: '14px 18px',
          background: '#fff5f5',
          border: '1px solid #fca5a5',
          borderInlineStart: '4px solid #ef4444',
          borderRadius: '10px',
          marginBottom: '16px',
          fontSize: '0.86rem',
          boxShadow: '0 2px 6px rgba(239, 68, 68, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontWeight: 800, color: '#991b1b', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem' }}>
            <AlertTriangleIcon size={18} color="#dc2626" />
            <span>{__t('settings.forms.settings_main_form.s10', "توجد حقول تتطلب المراجعة أو استكمال البيانات قبل الحفظ (")}{Object.keys(form.formState.errors).filter(k => k !== 'root').length} {__t('settings.forms.settings_main_form.s11', "حقول):")}</span>
          </div>
          <span style={{ fontSize: '0.78rem', color: '#b91c1c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <LightbulbIcon size={13} color="#b91c1c" />
            <span>{__t('settings.forms.settings_main_form.s12', "انقر على أي حقل أدناه للانتقال إليه مباشرة وتمييزه")}</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {Object.entries(tabErrors).map(([tabId, items]) => {
            if (!items.length) return null;
            const tabNames: Record<string, string> = {
              general: __t('settings.forms.settings_main_form.s13', "عام"),
              sales_inventory: __t('settings.forms.settings_main_form.s14', "البيع وقواعد المخزون"),
              modules: __t('settings.forms.settings_main_form.s15', "موديولات النظام"),
              printing: __t('settings.forms.settings_main_form.s16', "الطباعة والإيصالات"),
            };
            return (
              <div
                key={tabId}
                style={{
                  background: '#ffffff',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#7f1d1d', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#dc2626' }} />
                  <span>{__t('settings.forms.settings_main_form.s17', "تبويب \"")}{tabNames[tabId] || tabId}&quot;:</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {items.map((item) => (
                    <button
                      key={item.fieldKey}
                      type="button"
                      onClick={() => navigateToFieldAndHighlight(item.fieldKey)}
                      title={__t('settings.forms.settings_main_form.s18', "انقر للانتقال للحقل وتمييزه")}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#fef2f2',
                        border: '1px solid #f87171',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        color: '#b91c1c',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#fee2e2';
                        e.currentTarget.style.borderColor = '#dc2626';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#fef2f2';
                        e.currentTarget.style.borderColor = '#f87171';
                      }}
                    >
                      <span>{item.label}</span>
                      {item.message && item.message !== item.label ? (
                        <span style={{ fontWeight: 500, color: '#991b1b', fontSize: '0.76rem' }}>
                          ({item.message})
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
    </>
  );
}
