import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { ClientPortal } from '@/shared/components/ClientPortal';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesPasscodeModalProps {
  revealedPasscode: { version: string; passcode: string; } | null;
  setRevealedPasscode: Dispatch<SetStateAction<{ version: string; passcode: string; } | null>>;
  setCopiedPasscode: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useTranslation>['t'];
  copiedPasscode: boolean;
}
export function SystemUpdatesPasscodeModal({ revealedPasscode, setRevealedPasscode, setCopiedPasscode, t, copiedPasscode }: SystemUpdatesPasscodeModalProps) {
  return (
    <>
    {/* 1. Admin Passcode Reveal Modal */}
    {revealedPasscode && (
      <ClientPortal targetId="root">
        <DialogShell open={true} showCloseButton={true} onClose={() => { setRevealedPasscode(null); setCopiedPasscode(false); }} width="min(460px, 100%)" ariaLabel={t('settings.workspace_sections.system_updates_section.s37', "كود التفعيل")}>
          <div className="system-update-modal-header">
            <h3 className="system-update-modal-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="15" r="4" /><line x1="10.85" y1="12.15" x2="19" y2="4" /><line x1="18" y1="5" x2="20" y2="7" /><line x1="15" y1="8" x2="17" y2="10" /></svg>
              <span>{t('settings.workspace_sections.system_updates_section.s38', "كود تفعيل التحديث المعتمد")}</span>
            </h3>
          </div>
          <div className="system-update-modal-body stack gap-16" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
              {t('settings.workspace_sections.system_updates_section.s39', "هذا هو كود الترخيص المشفر المخصص للإصدار")} <strong>v{revealedPasscode.version}</strong>{t('settings.workspace_sections.system_updates_section.s40', ". يمكنك إعطاؤه للعميل بعد التحصيل والمحاسبة ليتمكن من فك وتطبيق التحديث.")}
            </div>

            <div style={{ padding: '16px', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '12px', margin: '4px 0 10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>{t('settings.workspace_sections.system_updates_section.s41', "كود الترخيص الفريد")}</div>
              <div style={{ fontFamily: 'monospace', fontSize: '18px', fontWeight: 900, letterSpacing: '2px', color: '#0f172a' }}>
                {revealedPasscode.passcode}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button
                variant="primary"
                style={{ flex: 1, fontWeight: 800 }}
                onClick={() => {
                  navigator.clipboard.writeText(revealedPasscode.passcode);
                  setCopiedPasscode(true);
                  setTimeout(() => setCopiedPasscode(false), 2000);
                }}
              >
                {copiedPasscode ? t('settings.workspace_sections.system_updates_section.s42', "تم النسخ بنجاح") : t('settings.workspace_sections.system_updates_section.s43', "نسخ كود التفعيل")}
              </Button>
              <Button variant="secondary" onClick={() => { setRevealedPasscode(null); setCopiedPasscode(false); }}>{t('settings.workspace_sections.system_updates_section.s44', "إغلاق")}</Button>
            </div>
          </div>
        </DialogShell>
      </ClientPortal>
    )}
    </>
  );
}
