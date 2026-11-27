import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon, ShoppingCartIcon, BarChartIcon, PackageIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type {SeedDemoDataResult, DemoActivitySummary} from '@/features/settings/api/demo-data.api';
import type { useNavigate } from 'react-router-dom';

export interface SettingsDemoDataWizardSuccessDialogProps {
  successResult: SeedDemoDataResult | null;
  setSuccessResult: React.Dispatch<React.SetStateAction<SeedDemoDataResult | null>>;
  t: ReturnType<typeof useTranslation>['t'];
  selectedActivity: DemoActivitySummary;
  navigate: ReturnType<typeof useNavigate>;
}

export function SettingsDemoDataWizardSuccessDialog(props: SettingsDemoDataWizardSuccessDialogProps) {
  const { successResult, setSuccessResult, t, selectedActivity, navigate } = props;
  return (
    <>
    {/* ─── Modal: Success Celebration Dialog ───────────────────────────────────── */}
    {successResult && (
      <DialogShell
        open={!!successResult}
        onClose={() => setSuccessResult(null)}
        width="min(520px, 95vw)"
      >
        <div className="standard-dialog-body" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '18px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#ecfdf5',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckCircleIcon size={36} color="#10b981" />
          </div>

          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s52', "تم استيراد البيانات التجريبية بنجاح!")}
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s53', "أصبح النظام الآن ممتلئاً بالحياة والبيانات الواقعية لنشاط (")}
              <strong>{selectedActivity?.name}</strong>)
            </p>
          </div>

          {/* Metrics Breakdown Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
              width: '100%',
              margin: '8px 0',
            }}
          >
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 8px' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#170e5e', display: 'block' }}>
                {successResult.productsCount || 0}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s54', "أصناف بالمخزن")}</span>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 8px' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981', display: 'block' }}>
                {successResult.salesCount || 0}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s55', "فواتير مبيعات")}</span>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 8px' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0284c7', display: 'block' }}>
                {successResult.onlineOrdersCount || 0}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s56', "طلبات متجر")}</span>
            </div>
          </div>

          {successResult.demoCredentials && successResult.demoCredentials.length > 0 && (
            <div style={{ width: '100%', textAlign: 'right', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px' }}>
              <strong style={{ display: 'block', color: '#92400e', marginBottom: '8px' }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s57', "بيانات الدخول المؤقتة")}</strong>
              <p style={{ margin: '0 0 8px', color: '#78350f', fontSize: '0.8rem' }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s58', "احفظها الآن؛ سيُطلب تغيير كلمة المرور عند أول دخول.")}</p>
              {successResult.demoCredentials.map((credential) => (
                <div key={credential.username} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', direction: 'rtl', fontFamily: 'monospace', fontSize: '0.86rem', padding: '4px 0' }}>
                  <span>{credential.username}</span>
                  <span>{credential.temporaryPassword}</span>
                </div>
              ))}
            </div>
          )}

          {/* Quick Navigation Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <Button
              type="button"
              onClick={() => navigate('/pos')}
              style={{
                background: '#170e5e',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.92rem',
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <ShoppingCartIcon size={16} />
                <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s59', "الخطوة 3 والأخيرة: فتح شاشة الكاشير (POS) وبدء البيع")}</span>
              </span>
            </Button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', width: '100%' }}>
              <button
                type="button"
                onClick={() => navigate('/')}
                style={{
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1px solid #e2e8f0',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  padding: '10px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <BarChartIcon size={15} />
                  <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s60', "لوحة التحكم الرئيسية")}</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/products')}
                style={{
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1px solid #e2e8f0',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  padding: '10px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <PackageIcon size={15} />
                  <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s61', "مراجعة الأصناف والمخزون")}</span>
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSuccessResult(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '0.82rem',
                cursor: 'pointer',
                marginTop: '4px',
              }}
            >
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s62', "إغلاق والبقاء في الإعدادات")}
            </button>
          </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
