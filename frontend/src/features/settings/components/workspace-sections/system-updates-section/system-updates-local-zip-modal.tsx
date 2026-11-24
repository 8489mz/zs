import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { CheckIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesLocalZipModalProps {
  localUpdateState: { open: boolean; file: File | null; passcode: string; status: 'error' | 'idle' | 'uploading' | 'success'; error?: string; };
  setLocalUpdateState: Dispatch<SetStateAction<{ open: boolean; file: File | null; passcode: string; status: 'error' | 'idle' | 'uploading' | 'success'; error?: string; }>>;
  t: ReturnType<typeof useTranslation>['t'];
  handleApplyLocalUpdate: () => Promise<void>;
  progressInfo: { percent: number; step: number; stepTitle: string; stepDesc: string; };
}
export function SystemUpdatesLocalZipModal({ localUpdateState, setLocalUpdateState, t, handleApplyLocalUpdate, progressInfo }: SystemUpdatesLocalZipModalProps) {
  return (
    <>
    {/* 4. Local ZIP Update Modal - Luxury Enterprise Standard */}
    {localUpdateState.open && (
      <DialogShell
        open={localUpdateState.open}
        onClose={() => localUpdateState.status !== 'uploading' && setLocalUpdateState(s => ({ ...s, open: false }))}
        width="min(540px, 95vw)"
        ariaLabel={t('settings.workspace_sections.system_updates_section.s76', "تطبيق حزمة التحديث")}
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
                      {t('settings.workspace_sections.system_updates_section.s77', "تطبيق حزمة التحديث (.ZIP)")}
                    </h3>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{t('settings.workspace_sections.system_updates_section.s78', "تثبيت وترقية المنظومة محلياً من ملف معتمد")}</div>
                  </div>
                </div>
                {localUpdateState.status !== 'uploading' && localUpdateState.status !== 'success' && (
                  <button
                    type="button"
                    onClick={() => setLocalUpdateState(s => ({ ...s, open: false }))}
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
                    title={t('settings.workspace_sections.system_updates_section.s79', "إغلاق")}
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </div>

              {localUpdateState.status === 'idle' && localUpdateState.file && (
                <>
                  {/* File Metadata Panel */}
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>{localUpdateState.file.name}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                          {t('settings.workspace_sections.system_updates_section.s80', "حجم الحزمة:")} {(localUpdateState.file.size / 1024 / 1024).toFixed(2)} {t('settings.workspace_sections.system_updates_section.s81', "ميجابايت")}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                      {t('settings.workspace_sections.system_updates_section.s82', "جاهز للتثبيت")}
                    </span>
                  </div>

                  {/* Passcode Input */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('settings.workspace_sections.system_updates_section.s83', "كود تفعيل التحديث المعتمد:")}
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
                      value={localUpdateState.passcode}
                      onChange={(e) => setLocalUpdateState(s => ({ ...s, passcode: e.target.value }))}
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
                    <span><strong>{t('settings.workspace_sections.system_updates_section.s84', "إجراء الأمان")}</strong>{t('settings.workspace_sections.system_updates_section.s85', ": سيتم أخذ نسخة احتياطية آمنة لقاعدة البيانات والملفات تلقائياً قبل الترقية.")}</span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Button
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
                      onClick={handleApplyLocalUpdate}
                    >
                      {t('settings.workspace_sections.system_updates_section.s86', "تأكيد وبدء التثبيت")}
                    </Button>
                    <Button variant="secondary" style={{ height: '44px', borderRadius: '10px' }} onClick={() => setLocalUpdateState(s => ({ ...s, open: false }))}>
                      {t('settings.workspace_sections.system_updates_section.s87', "إلغاء")}
                    </Button>
                  </div>
                </>
              )}

              {(localUpdateState.status === 'uploading' || localUpdateState.status === 'success') && (
                <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
                  {/* Status Animated Icon */}
                  <div style={{
                    width: '68px',
                    height: '68px',
                    borderRadius: '20px',
                    background: progressInfo.percent === 100 ? '#ecfdf5' : '#eff6ff',
                    border: progressInfo.percent === 100 ? '1.5px solid #a7f3d0' : '1.5px solid #bfdbfe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 18px',
                    boxShadow: progressInfo.percent === 100 ? '0 10px 25px rgba(16, 185, 129, 0.2)' : '0 10px 25px rgba(37, 99, 235, 0.15)'
                  }}>
                    {progressInfo.percent === 100 ? (
                      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#2563eb" strokeWidth="2.2" style={{ animation: 'spin 1.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    )}
                  </div>

                  <h3 style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                    {progressInfo.stepTitle || t('settings.workspace_sections.system_updates_section.s88', "جاري تطبيق الترقية البرمجية...")}
                  </h3>
                  <p style={{ margin: '0 auto 22px', fontSize: '13px', color: '#64748b', lineHeight: 1.5, maxWidth: '420px' }}>
                    {progressInfo.stepDesc || t('settings.workspace_sections.system_updates_section.s89', "يرجى الانتظار حتى اكتمال الترقية بأمان")}
                  </p>

                  {/* 4 Step Badges */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '22px' }}>
                    {[
                      { stepNum: 1, label: t('settings.workspace_sections.system_updates_section.s90', "تنزيل الحزمة") },
                      { stepNum: 2, label: t('settings.workspace_sections.system_updates_section.s91', "نقطة استعادة") },
                      { stepNum: 3, label: t('settings.workspace_sections.system_updates_section.s92', "تثبيت وترقية") },
                      { stepNum: 4, label: t('settings.workspace_sections.system_updates_section.s93', "إعادة التشغيل") },
                    ].map((st) => {
                      const isDone = (progressInfo.step || 1) > st.stepNum || progressInfo.percent === 100;
                      const isActive = (progressInfo.step || 1) === st.stepNum && progressInfo.percent < 100;
                      return (
                        <div key={st.stepNum} style={{
                          padding: '8px 4px',
                          borderRadius: '10px',
                          background: isDone ? '#ecfdf5' : isActive ? '#eff6ff' : '#f8fafc',
                          border: isDone ? '1px solid #a7f3d0' : isActive ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                          color: isDone ? '#059669' : isActive ? '#1d4ed8' : '#64748b',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
                        }}>
                          <div style={{ fontSize: '12px', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{isDone ? <CheckIcon size={12} /> : st.stepNum}</div>
                          <div>{st.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sleek Precision Progress Bar */}
                  <div style={{
                    background: '#f1f5f9',
                    borderRadius: '999px',
                    height: '12px',
                    padding: '2px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '12px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${progressInfo.percent}%`,
                      height: '100%',
                      borderRadius: '999px',
                      background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 50%, #10b981 100%)',
                      boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)',
                      transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
                    }} />
                  </div>

                  {/* Percentage */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#64748b', fontWeight: 700, marginBottom: '20px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      {t('settings.workspace_sections.system_updates_section.s94', "التقدم العام للترقية")}
                    </span>
                    <span style={{ fontSize: '15px', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>{progressInfo.percent}%</span>
                  </div>

                  {/* Security Badge */}
                  <div style={{
                    padding: '11px 16px',
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#10b981" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    <span>{t('settings.workspace_sections.system_updates_section.s95', "حماية البيانات نشطة: تم تأمين قاعدة البيانات والملفات تلقائياً.")}</span>
                  </div>
                </div>
              )}

              {localUpdateState.status === 'error' && (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: '1px solid #fecaca' }}>
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </div>
                  <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#991b1b' }}>{t('settings.workspace_sections.system_updates_section.s96', "تعذر تطبيق التحديث")}</h4>
                  <p style={{ margin: '8px auto 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>{localUpdateState.error}</p>
                  <div style={{ marginTop: '20px' }}>
                    <Button variant="secondary" style={{ borderRadius: '10px' }} onClick={() => setLocalUpdateState(s => ({ ...s, open: false }))}>
                      {t('settings.workspace_sections.system_updates_section.s97', "إغلاق")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
        </div>
      </DialogShell>
    )}
    </>
  );
}
