import { DialogShell } from '@/shared/components/dialog-shell';
import { Trash2Icon, XIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface SettingsDemoDataWizardClearModalProps {
  isPlatform: boolean;
  showClearModal: boolean;
  setShowClearModal: React.Dispatch<React.SetStateAction<boolean>>;
  setClearPassword: React.Dispatch<React.SetStateAction<string>>;
  t: ReturnType<typeof useTranslation>['t'];
  clearPassword: string;
  clearMutation: { isPending: boolean; mutate: (pass: string) => void };
}

export function SettingsDemoDataWizardClearModal(props: SettingsDemoDataWizardClearModalProps) {
  const { isPlatform, showClearModal, setShowClearModal, setClearPassword, t, clearPassword, clearMutation } = props;
  return (
    <>
    {/* ─── Modal: Clear Demo Data (Super Admin Only) ─────────────────────────── */}
    {isPlatform && showClearModal && (
      <DialogShell
        open={showClearModal}
        onClose={() => {
          setShowClearModal(false);
          setClearPassword('');
        }}
        width="min(480px, 95vw)"
      >
        <div className="standard-dialog-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trash2Icon size={20} />
            </div>
            <div>
              <h3 className="standard-dialog-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#170e5e' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s44', "تفريغ الأصناف والبيانات التجريبية")}
              </h3>
              <span className="standard-dialog-subtitle" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s45', "سيتم حذف الأصناف والفواتير التجريبية فقط بأمان")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="standard-dialog-close-btn"
            onClick={() => {
              setShowClearModal(false);
              setClearPassword('');
            }}
            aria-label={t('settings.workspace_sections.settings_demo_data_wizard_section.s46', "إغلاق")}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="standard-dialog-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s47', "سيتم إزالة كافة الأصناف والعملاء والموردين التجريبيين الذين تم استيرادهم بواسطة المعالج، وتهيئة المخزن للعمل الحقيقي. أدخل كلمة مرور الأدمن للتأكيد:")}
          </p>

          <input
            type="password"
            placeholder={t('settings.workspace_sections.settings_demo_data_wizard_section.s48', "كلمة المرور (اختياري للأدمن في مرحلة التجربة)")}
            value={clearPassword}
            onChange={(e) => setClearPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.95rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div className="standard-dialog-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <button
            type="button"
            disabled={clearMutation.isPending}
            onClick={() => {
              setShowClearModal(false);
              setClearPassword('');
            }}
            style={{
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '9px 18px',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
            }}
          >
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s49', "إلغاء")}
          </button>

          <button
            type="button"
            disabled={clearMutation.isPending}
            onClick={() => clearMutation.mutate(clearPassword)}
            style={{
              background: '#dc2626',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '9px 20px',
              fontWeight: 800,
              fontSize: '0.86rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {clearMutation.isPending ? t('settings.workspace_sections.settings_demo_data_wizard_section.s50', "جاري الحذف...") : t('settings.workspace_sections.settings_demo_data_wizard_section.s51', "تأكيد الحذف والتنظيف")}
          </button>
        </div>
      </DialogShell>
    )}
    </>
  );
}
