import { useTranslation } from 'react-i18next';

export interface SystemUpdatesMetricsProps {
  t: ReturnType<typeof useTranslation>['t'];
  effectiveDeploymentMode: string | undefined;
}
export function SystemUpdatesMetrics({ t, effectiveDeploymentMode }: SystemUpdatesMetricsProps) {
  return (
    <div className="system-update-metrics-grid">
      <div className="system-update-metric-card">
        <div className="system-update-metric-icon" style={{ background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
        </div>
        <div className="system-update-metric-body">
          <span className="system-update-metric-label">{t('settings.workspace_sections.system_updates_section.s9', "الحماية والنسخ الاحتياطي")}</span>
          <strong className="system-update-metric-val">{t('settings.workspace_sections.system_updates_section.s10', "نسخ احتياطي تلقائي مُفعّل")}</strong>
          <span className="system-update-metric-desc">{t('settings.workspace_sections.system_updates_section.s11', "إنشاء نقطة استعادة آمنة لقاعدة البيانات والملفات تلقائياً قبل أي ترقية.")}</span>
        </div>
      </div>

      <div className="system-update-metric-card">
        <div className="system-update-metric-icon" style={{ background: '#eff6ff', color: '#2563eb', borderColor: '#bfdbfe' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
        </div>
        <div className="system-update-metric-body">
          <span className="system-update-metric-label">{t('settings.workspace_sections.system_updates_section.s12', "بيئة تشغيل السيرفر")}</span>
          <strong className="system-update-metric-val">Node.js + PostgreSQL Engine</strong>
          <span className="system-update-metric-desc">{t('settings.workspace_sections.system_updates_section.s13', "بيئة تشغيل عالية الاستقرار تدعم التحديثات الساخنة والإقلاع الفوري.")}</span>
        </div>
      </div>

      <div className="system-update-metric-card">
        <div className="system-update-metric-icon" style={{ background: '#f5f3ff', color: '#7c3aed', borderColor: '#ddd6fe' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
        </div>
        <div className="system-update-metric-body">
          <span className="system-update-metric-label">{t('settings.workspace_sections.system_updates_section.s14', "وضع النشر والاتصال")}</span>
          <strong className="system-update-metric-val">{effectiveDeploymentMode === 'server' ? t('settings.workspace_sections.system_updates_section.s15', "سيرفر شبكي (Server Mode)") : t('settings.workspace_sections.system_updates_section.s16', "مكتبي محلي (Desktop Mode)")}</strong>
          <span className="system-update-metric-desc">{t('settings.workspace_sections.system_updates_section.s17', "يدعم استلام الترقيات السحابية والتثبيت دون الحاجة لإنترنت مستمر.")}</span>
        </div>
      </div>
    </div>
  );
}
