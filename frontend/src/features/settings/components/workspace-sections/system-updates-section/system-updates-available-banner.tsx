import { Button } from '@/shared/ui/button';
import { useTranslation } from 'react-i18next';
import type { UpdateCheckResult } from '@/shared/hooks/use-offline-update-check';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesAvailableBannerProps {
  updateInfo: UpdateCheckResult | undefined;
  t: ReturnType<typeof useTranslation>['t'];
  canApplyUpdates: boolean;
  setUpdateCheckResult: Dispatch<SetStateAction<{ open: boolean; type: 'checking' | 'up-to-date' | 'error' | 'available'; data?: any; } | null>>;
}
export function SystemUpdatesAvailableBanner({ updateInfo, t, canApplyUpdates, setUpdateCheckResult }: SystemUpdatesAvailableBannerProps) {
  return (
    <>
    {updateInfo?.updateAvailable && (
      <div style={{ padding: '18px 22px', background: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#d97706', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '15px', color: '#92400e', marginBottom: '2px' }}>
              {t('settings.workspace_sections.system_updates_section.s18', "يتوفر إصدار جديد معتمد للنظام:")} <span style={{ textDecoration: 'underline' }}>v{updateInfo.latestVersion}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#b45309' }}>
              {t('settings.workspace_sections.system_updates_section.s19', "يتضمن هذا التحديث سجل تغييرات تراكمي لكافة الإصدارات السابقة وميزات تشغيلية جديدة.")}
            </div>
          </div>
        </div>
        {canApplyUpdates ? (<Button
          variant="primary"
          onClick={() => {
            setUpdateCheckResult({ open: true, type: 'available', data: updateInfo });
          }}
          style={{ background: '#d97706', borderColor: '#b45309', color: '#ffffff', fontWeight: 800, padding: '8px 20px', borderRadius: '8px' }}
        >
          {t('settings.workspace_sections.system_updates_section.s20', "تطبيق الترقية الآن")}
        </Button>) : (<span style={{ fontSize: '12px', color: '#92400e', fontWeight: 700 }}>{t('settings.workspace_sections.system_updates_section.s98', "تطبيق الترقية متاح على نسخة الديسكتوب فقط.")}</span>)}
      </div>
    )}
    </>
  );
}
