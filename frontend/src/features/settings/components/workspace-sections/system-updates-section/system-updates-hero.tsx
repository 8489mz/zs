import { useTranslation } from 'react-i18next';
import { formatGregorianDate } from './system-updates-shared';
import type { RefObject } from 'react';

export interface SystemUpdatesHeroProps {
  t: ReturnType<typeof useTranslation>['t'];
  currentVersion: string;
  dataUpdatedAt: number;
  canApplyUpdates: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleCheckUpdates: () => void;
  isCheckingUpdates: boolean;
}
export function SystemUpdatesHero({ t, currentVersion, dataUpdatedAt, canApplyUpdates, fileInputRef, handleCheckUpdates, isCheckingUpdates }: SystemUpdatesHeroProps) {
  return (
    <div className="system-update-hero">
      <div className="system-update-hero-content">
        <div className="system-update-hero-info">
          <div className="system-update-icon-box">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div className="system-update-hero-text">
            <div className="system-update-title-row">
              <span className="system-update-hero-title">{t('settings.workspace_sections.system_updates_section.s0', "مركز إدارة وتحديثات النظام")}</span>
              <span className="system-update-version-chip">
                <span className="system-update-pulse-dot" />
                {t('settings.workspace_sections.system_updates_section.s1', "الإصدار الحالي: v")}{currentVersion}
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
                color: '#065f46',
                border: '1px solid #a7f3d0',
                padding: '3px 10px',
                borderRadius: '16px',
                fontSize: '11px',
                fontWeight: 700
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                {t('settings.workspace_sections.system_updates_section.s2', "تحديث سحابي مباشر متصل")}
              </span>
            </div>
            <div className="system-update-hero-meta">
              <div className="system-update-hero-meta-item">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span>{t('settings.workspace_sections.system_updates_section.s3', "آخر فحص:")} {dataUpdatedAt ? formatGregorianDate(dataUpdatedAt, true) : t('settings.workspace_sections.system_updates_section.s4', "اليوم، مستقر")}</span>
              </div>
              <span>•</span>
              <div className="system-update-hero-meta-item">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <span>{t('settings.workspace_sections.system_updates_section.s5', "القناة: الإصدارات المستقرة للمؤسسات (Enterprise LTS)")}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="system-update-hero-actions">
          {canApplyUpdates && (<button
            type="button"
            className="system-update-btn-glass"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            <span>{t('settings.workspace_sections.system_updates_section.s6', "تحديث يدوي من ملف ZIP")}</span>
          </button>)}
          <button
            type="button"
            className="system-update-btn-primary"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: isCheckingUpdates ? 'spin 1s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            <span>{isCheckingUpdates ? t('settings.workspace_sections.system_updates_section.s7', "جارِ الفحص...") : t('settings.workspace_sections.system_updates_section.s8', "فحص التحديثات الآن")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
