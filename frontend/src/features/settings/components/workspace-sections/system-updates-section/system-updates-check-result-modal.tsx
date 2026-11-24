import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesCheckResultModalProps {
  updateCheckResult: { open: boolean; type: 'checking' | 'up-to-date' | 'error' | 'available'; data?: any; } | null;
  setUpdateCheckResult: Dispatch<SetStateAction<{ open: boolean; type: 'checking' | 'up-to-date' | 'error' | 'available'; data?: any; } | null>>;
  t: ReturnType<typeof useTranslation>['t'];
  currentVersion: string;
  onlineUpdatePasscode: string;
  setOnlineUpdatePasscode: Dispatch<SetStateAction<string>>;
  canApplyUpdates: boolean;
  handleApplyOnlineUpdate: (version: string, patchUrl: string, changelog?: string, passcode?: string) => Promise<void>;
}
export function SystemUpdatesCheckResultModal({ updateCheckResult, setUpdateCheckResult, t, currentVersion, onlineUpdatePasscode, setOnlineUpdatePasscode, canApplyUpdates, handleApplyOnlineUpdate }: SystemUpdatesCheckResultModalProps) {
  return (
    <>
    {/* 3. Update Check Result Modal - Luxury Enterprise Standard */}
    {updateCheckResult && updateCheckResult.open && (
      <DialogShell
        open={Boolean(updateCheckResult && updateCheckResult.open)}
        onClose={() => setUpdateCheckResult(null)}
        width="min(540px, 95vw)"
        ariaLabel={t('settings.workspace_sections.system_updates_section.s56', "نتيجة فحص التحديثات")}
      >
        <div style={{
          width: '100%',
          background: '#ffffff',
          overflow: 'hidden',
          textAlign: 'right',
          color: '#0f172a',
          position: 'relative',
          direction: 'rtl',
        }}>
            <div style={{ padding: '24px 28px 26px' }}>
              {/* Header with Brand & Close */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <img
                    src="./brand/z-erp-approved-icon.png"
                    alt="Z-ERP"
                    style={{ width: '38px', height: '38px', objectFit: 'contain', filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.12))' }}
                  />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                      {t('settings.workspace_sections.system_updates_section.s57', "مركز ترقية وتحديث المنظومة")}
                    </h3>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>ZSystems Enterprise Release Manager</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setUpdateCheckResult(null)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    color: '#64748b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                  title={t('settings.workspace_sections.system_updates_section.s58', "إغلاق")}
                >
                  <XIcon size={14} />
                </button>
              </div>

              {updateCheckResult.type === 'checking' && (
                <div style={{ padding: '28px 0', textAlign: 'center' }}>
                  <div style={{ width: '48px', height: '48px', border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.system_updates_section.s59', "جارِ الاتصال بسيرفر التحديثات المعتمد...")}</h4>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>{t('settings.workspace_sections.system_updates_section.s60', "يتم فحص وجود ترقيات جديدة وسجلات تغييرات تراكمية.")}</p>
                </div>
              )}

              {updateCheckResult.type === 'up-to-date' && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: '1px solid #a7f3d0' }}>
                    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.system_updates_section.s61', "أنت تعمل على أحدث إصدار معتمد!")}</h4>
                  <p style={{ margin: '8px auto 0', fontSize: '13px', color: '#64748b', lineHeight: 1.6, maxWidth: '380px' }}>
                    {t('settings.workspace_sections.system_updates_section.s62', "نظامك يعمل حالياً بالإصدار المستقر")} <strong>v{currentVersion}</strong>{t('settings.workspace_sections.system_updates_section.s63', "، ولم تصدر أي تحديثات جديدة بعد.")}
                  </p>
                  <div style={{ marginTop: '22px' }}>
                    <Button variant="primary" onClick={() => setUpdateCheckResult(null)} style={{ minWidth: '130px', height: '42px', fontWeight: 800, borderRadius: '10px', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', border: 'none' }}>
                      {t('settings.workspace_sections.system_updates_section.s64', "تمام")}
                    </Button>
                  </div>
                </div>
              )}

              {updateCheckResult.type === 'error' && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: '1px solid #fecaca' }}>
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </div>
                  <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#991b1b' }}>{t('settings.workspace_sections.system_updates_section.s65', "تعذر الاتصال بسيرفر التحديثات")}</h4>
                  <p style={{ margin: '8px auto 0', fontSize: '13px', color: '#64748b', lineHeight: 1.6, maxWidth: '380px' }}>
                    {t('settings.workspace_sections.system_updates_section.s66', "يرجى التحقق من اتصال الإنترنت، أو استخدام خاصية التحديث اليدوي من ملف ZIP.")}
                  </p>
                  <div style={{ marginTop: '22px' }}>
                    <Button variant="secondary" onClick={() => setUpdateCheckResult(null)} style={{ minWidth: '110px', height: '40px', borderRadius: '10px' }}>{t('settings.workspace_sections.system_updates_section.s67', "إغلاق")}</Button>
                  </div>
                </div>
              )}

              {updateCheckResult.type === 'available' && (
                <div>
                  {/* Version Transition Box */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: '#f8fafc',
                    borderRadius: '14px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '16px'
                  }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.system_updates_section.s68', "الإصدار الحالي:")}</div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>v{currentVersion}</div>
                    </div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '11.5px', color: '#059669', fontWeight: 700 }}>{t('settings.workspace_sections.system_updates_section.s69', "الإصدار الجديد المتوفر:")}</div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#059669', marginTop: '2px' }}>v{updateCheckResult.data.latestVersion}</div>
                    </div>
                  </div>

                  {/* Changelog */}
                  {(updateCheckResult.data.cumulativeChangelog || updateCheckResult.data.changelog) && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                        {t('settings.workspace_sections.system_updates_section.s70', "سجل التغييرات والتحسينات المعتمدة:")}
                      </div>
                      <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: '10px', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '130px', overflowY: 'auto', border: '1px solid #e2e8f0', lineHeight: 1.6, color: '#334155' }}>
                        {updateCheckResult.data.cumulativeChangelog || updateCheckResult.data.changelog}
                      </div>
                    </div>
                  )}

                  {/* Passcode Input */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('settings.workspace_sections.system_updates_section.s71', "كود تفعيل التحديث المعتمد:")}
                    </label>
                    <input
                      type="text"
                      style={{
                        width: '100%',
                        height: '44px',
                        background: '#f8fafc',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '10px',
                        color: '#0f172a',
                        padding: '0 14px',
                        fontSize: '14.5px',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        direction: 'ltr',
                        textAlign: 'center',
                        outline: 'none',
                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      placeholder="ZS-UPD-XXXX-XXXX"
                      value={onlineUpdatePasscode}
                      onChange={(e) => setOnlineUpdatePasscode(e.target.value)}
                    />
                  </div>

                  {/* Security Notice */}
                  <div style={{
                    padding: '10px 14px',
                    background: '#f0fdf4',
                    borderRadius: '10px',
                    border: '1px solid #bbf7d0',
                    fontSize: '12px',
                    color: '#166534',
                    lineHeight: 1.5,
                    marginBottom: '20px',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center'
                  }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" strokeWidth="2.2" style={{ flexShrink: 0 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    <span><strong>{t('settings.workspace_sections.system_updates_section.s72', "إجراء الأمان")}</strong>{t('settings.workspace_sections.system_updates_section.s73', ": سيتم أخذ نسخة احتياطية آمنة لقاعدة البيانات والملفات تلقائياً قبل الترقية.")}</span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {canApplyUpdates && (<Button
                      variant="primary"
                      style={{
                        flex: 1,
                        height: '44px',
                        fontWeight: 800,
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.25)'
                      }}
                      onClick={() => {
                        if (updateCheckResult.data.latestVersion && updateCheckResult.data.patchUrl) {
                          handleApplyOnlineUpdate(
                            updateCheckResult.data.latestVersion,
                            updateCheckResult.data.patchUrl,
                            updateCheckResult.data.changelog ?? undefined,
                            onlineUpdatePasscode
                          );
                        }
                      }}
                    >
                      {t('settings.workspace_sections.system_updates_section.s74', "تطبيق الترقية الآن")}
                    </Button>)}
                    <Button variant="secondary" style={{ height: '44px', borderRadius: '10px' }} onClick={() => setUpdateCheckResult(null)}>
                      {t('settings.workspace_sections.system_updates_section.s75', "لاحقاً")}
                    </Button>
                  </div>
                  {!canApplyUpdates && (<div style={{ fontSize: '12px', color: '#92400e', marginTop: '10px' }}>{t('settings.workspace_sections.system_updates_section.s98', "تطبيق الترقية متاح على نسخة الديسكتوب فقط.")}</div>)}
                </div>
              )}
            </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
