import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { ClientPortal } from '@/shared/components/ClientPortal';
import { useTranslation } from 'react-i18next';
import { formatGregorianDate } from './system-updates-shared';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesReleaseDetailsModalProps {
  selectedRelease: any;
  setSelectedReleaseIndex: Dispatch<SetStateAction<number | null>>;
  t: ReturnType<typeof useTranslation>['t'];
  setCopiedReleaseVersion: Dispatch<SetStateAction<string | null>>;
  copiedReleaseVersion: string | null;
  currentVersion: string;
  canApplyUpdates: boolean;
  handleApplyOnlineUpdate: (version: string, patchUrl: string, changelog?: string, passcode?: string) => Promise<void>;
}
export function SystemUpdatesReleaseDetailsModal({ selectedRelease, setSelectedReleaseIndex, t, setCopiedReleaseVersion, copiedReleaseVersion, currentVersion, canApplyUpdates, handleApplyOnlineUpdate }: SystemUpdatesReleaseDetailsModalProps) {
  return (
    <>
    {/* 2. Release Details Modal */}
    {selectedRelease && (
      <ClientPortal targetId="root">
        <DialogShell open={true} showCloseButton={true} onClose={() => setSelectedReleaseIndex(null)} width="min(640px, 100%)" ariaLabel={t('settings.workspace_sections.system_updates_section.s45', "تفاصيل الإصدار")}>
          <div className="system-update-modal-header">
            <h3 className="system-update-modal-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
              <span>{t('settings.workspace_sections.system_updates_section.s46', "سجل التغييرات والميزات • الإصدار v")}{selectedRelease.version}</span>
            </h3>
          </div>
          <div className="system-update-modal-body stack gap-16">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '13px', color: '#475569' }}>{t('settings.workspace_sections.system_updates_section.s47', "تاريخ الإصدار الرسمي:")}</span>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                {selectedRelease.promotedAt ? formatGregorianDate(selectedRelease.promotedAt, true) : t('settings.workspace_sections.system_updates_section.s48', "مؤرشف")}
              </strong>
            </div>

            <div>
              <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '8px', color: '#0f172a' }}>{t('settings.workspace_sections.system_updates_section.s49', "ملاحظات وسجل التحسينات:")}</div>
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', fontSize: '13px', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', lineHeight: 1.7, border: '1px solid #e2e8f0', color: '#334155' }}>
                {selectedRelease.changelog || t('settings.workspace_sections.system_updates_section.s50', "لا توجد ملاحظات مسجلة لهذا الإصدار.")}
              </div>
            </div>

            {selectedRelease.passcode && (
              <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 700 }}>{t('settings.workspace_sections.system_updates_section.s51', "كود تفعيل هذا الإصدار (وضع المطور):")}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 900, color: '#0f172a', marginTop: '3px' }}>{selectedRelease.passcode}</div>
                </div>
                <Button
                  variant="secondary"
                  style={{ fontWeight: 800, fontSize: '12px', height: '36px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(selectedRelease.passcode!);
                    setCopiedReleaseVersion(selectedRelease.version);
                    setTimeout(() => setCopiedReleaseVersion(null), 2000);
                  }}
                >
                  {copiedReleaseVersion === selectedRelease.version ? t('settings.workspace_sections.system_updates_section.s52', "تم النسخ") : t('settings.workspace_sections.system_updates_section.s53', "نسخ الكود")}
                </Button>
              </div>
            )}

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button variant="secondary" onClick={() => setSelectedReleaseIndex(null)}>{t('settings.workspace_sections.system_updates_section.s54', "إغلاق")}</Button>
              {selectedRelease.version !== currentVersion && canApplyUpdates && (
                <Button variant="primary" onClick={() => {
                  if (selectedRelease.version && selectedRelease.patchUrl) {
                    handleApplyOnlineUpdate(selectedRelease.version, selectedRelease.patchUrl, selectedRelease.changelog ?? undefined);
                  }
                }}>{t('settings.workspace_sections.system_updates_section.s55', "تطبيق هذا الإصدار")}</Button>
              )}
            </div>
          </div>
        </DialogShell>
      </ClientPortal>
    )}
    </>
  );
}
