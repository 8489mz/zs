import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { ShieldCheckIcon, XIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { DemoActivitySummary } from '@/features/settings/api/demo-data.api';

export interface SettingsDemoDataWizardPasswordModalProps {
  showPasswordModal: boolean;
  setShowPasswordModal: React.Dispatch<React.SetStateAction<boolean>>;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
  t: ReturnType<typeof useTranslation>['t'];
  selectedActivity: DemoActivitySummary;
  password: string;
  seedMutation: { isPending: boolean; mutate: (vars: { activityType: string; pass: string }) => void };
  selectedActivityKey: string;
  errorMessage: string | null;
}

export function SettingsDemoDataWizardPasswordModal(props: SettingsDemoDataWizardPasswordModalProps) {
  const { showPasswordModal, setShowPasswordModal, setPassword, setErrorMessage, t, selectedActivity, password, seedMutation, selectedActivityKey, errorMessage } = props;
  return (
    <>
    {/* ─── Modal: Confirmation Password when DB is not empty ──────────────────── */}
    {showPasswordModal && (
      <DialogShell
        open={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setPassword('');
          setErrorMessage(null);
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
                background: '#fef3c7',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheckIcon size={20} />
            </div>
            <div>
              <h3 className="standard-dialog-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#170e5e' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s36', "تأكيد استبدال البيانات الحالية")}
              </h3>
              <span className="standard-dialog-subtitle" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s37', "يوجد حالياً بيانات مسجلة في المتجر، سيتم أخذ نسخة احتياطية تلقائياً")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="standard-dialog-close-btn"
            onClick={() => {
              setShowPasswordModal(false);
              setPassword('');
              setErrorMessage(null);
            }}
            aria-label={t('settings.workspace_sections.settings_demo_data_wizard_section.s38', "إغلاق")}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="standard-dialog-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s39', "يرجى إدخال كلمة مرور السوبر أدمن لتأكيد تفريغ البيانات القديمة واستيراد نشاط (")}
            <strong>{selectedActivity?.name}</strong>):
          </p>

          <input
            type="password"
            placeholder={t('settings.workspace_sections.settings_demo_data_wizard_section.s40', "كلمة مرور السوبر أدمن")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.95rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password.trim()) {
                seedMutation.mutate({ activityType: selectedActivityKey, pass: password });
              }
            }}
          />

          {errorMessage && (
            <div style={{ fontSize: '0.82rem', color: '#be123c', fontWeight: 700 }}>
              {errorMessage}
            </div>
          )}
        </div>

        <div className="standard-dialog-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <button
            type="button"
            disabled={seedMutation.isPending}
            onClick={() => {
              setShowPasswordModal(false);
              setPassword('');
              setErrorMessage(null);
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
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s41', "إلغاء")}
          </button>

          <Button
            type="button"
            disabled={!password.trim() || seedMutation.isPending}
            onClick={() => seedMutation.mutate({ activityType: selectedActivityKey, pass: password })}
            style={{
              background: '#170e5e',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '9px 20px',
              fontWeight: 800,
              fontSize: '0.86rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {seedMutation.isPending ? t('settings.workspace_sections.settings_demo_data_wizard_section.s42', "جاري الاستيراد...") : t('settings.workspace_sections.settings_demo_data_wizard_section.s43', "تأكيد واستيراد الآن")}
          </Button>
        </div>
      </DialogShell>
    )}
    </>
  );
}
