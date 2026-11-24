import { Button } from '@/shared/ui/button';
import { CheckIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import { formatGregorianDate } from './system-updates-shared';
import type { Dispatch, SetStateAction } from 'react';

export interface SystemUpdatesReleasesProps {
  t: ReturnType<typeof useTranslation>['t'];
  updateHistory: any[];
  isHistoryLoading: boolean;
  currentVersion: string;
  setRevealedPasscode: Dispatch<SetStateAction<{ version: string; passcode: string; } | null>>;
  setSelectedReleaseIndex: Dispatch<SetStateAction<number | null>>;
  setShowArchive: Dispatch<SetStateAction<boolean>>;
  showArchive: boolean;
}
export function SystemUpdatesReleases({ t, updateHistory, isHistoryLoading, currentVersion, setRevealedPasscode, setSelectedReleaseIndex, setShowArchive, showArchive }: SystemUpdatesReleasesProps) {
  return (
    <div className="system-releases-card">
      <div className="system-releases-header">
        <div className="system-releases-title">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
          <span>{t('settings.workspace_sections.system_updates_section.s21', "سجل الإصدارات المعتمدة وقوائم التغييرات")}</span>
          <span className="system-releases-badge-count">{updateHistory.length} {t('settings.workspace_sections.system_updates_section.s22', "إصدارات مسجلة")}</span>
        </div>
      </div>

      <div className="system-releases-list">
        {isHistoryLoading && (!updateHistory || updateHistory.length === 0) ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            {t('settings.workspace_sections.system_updates_section.s23', "جارِ فحص وتحديث سجل الإصدارات من السيرفر...")}
          </div>
        ) : updateHistory && updateHistory.length > 0 ? (
          (() => {
            const currentRelease = updateHistory.find(r => r.version === currentVersion) || updateHistory[0];
            const archivedReleases = updateHistory.filter(r => r.version !== currentRelease?.version);
            const currentReleaseIdx = updateHistory.findIndex(r => r.version === currentRelease?.version);

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Current Active Release Card */}
                {currentRelease && (
                  <div className="system-release-item" style={{ border: '1.5px solid #bbf7d0', background: '#ffffff' }}>
                    <div className="system-release-info">
                      <div className="system-release-icon-tag" style={{ minWidth: '48px', padding: '0 6px', fontSize: '11px', fontWeight: 800, background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                        v{currentRelease.version}
                      </div>
                      <div className="system-release-details">
                        <div className="system-release-version-row">
                          <span className="system-release-version-num">{t('settings.workspace_sections.system_updates_section.s24', "الإصدار")} {currentRelease.version}</span>
                          <span className="system-release-tag-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <CheckIcon size={12} />
                            <span>{t('settings.workspace_sections.system_updates_section.s25', "الإصدار الحالي المستقر")}</span>
                          </span>
                        </div>
                        <div className="system-release-date">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                          <span>{t('settings.workspace_sections.system_updates_section.s26', "تاريخ الاعتماد:")} {formatGregorianDate(currentRelease.promotedAt || (currentRelease as any).createdAt, true)}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {currentRelease.passcode && (
                        <Button
                          variant="secondary"
                          onClick={() => setRevealedPasscode({ version: currentRelease.version, passcode: currentRelease.passcode! })}
                          style={{ fontWeight: 700, fontSize: '12px', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="15" r="4" /><line x1="10.85" y1="12.15" x2="19" y2="4" /><line x1="18" y1="5" x2="20" y2="7" /><line x1="15" y1="8" x2="17" y2="10" /></svg>
                          <span>{t('settings.workspace_sections.system_updates_section.s27', "كود التفعيل")}</span>
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        onClick={() => setSelectedReleaseIndex(currentReleaseIdx >= 0 ? currentReleaseIdx : 0)}
                        style={{ fontWeight: 700, fontSize: '12px', padding: '6px 14px', borderRadius: '8px' }}
                      >
                        {t('settings.workspace_sections.system_updates_section.s28', "عرض التفاصيل وسجل التغييرات")}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Archived / Older Releases Collapsible Card */}
                {archivedReleases.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setShowArchive(prev => !prev)}
                      style={{
                        width: '100%',
                        padding: '12px 18px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        color: '#334155',
                        fontWeight: 700,
                        fontSize: '13px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#64748b" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                        <span>{t('settings.workspace_sections.system_updates_section.s29', "أرشيف الإصدارات السابقة (")}{archivedReleases.length} {t('settings.workspace_sections.system_updates_section.s30', "إصدارات مؤرشفة)")}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#64748b', transform: showArchive ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block' }}>
                        ▼
                      </span>
                    </button>

                    {showArchive && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', animation: 'fadeIn 0.2s ease' }}>
                        {archivedReleases.map((release) => {
                          const originalIdx = updateHistory.findIndex(r => r.version === release.version);
                          return (
                            <div key={release.version} className="system-release-item" style={{ background: '#fafbfc' }}>
                              <div className="system-release-info">
                                <div className="system-release-icon-tag" style={{ minWidth: '48px', padding: '0 6px', fontSize: '11px', fontWeight: 800 }}>
                                  v{release.version}
                                </div>
                                <div className="system-release-details">
                                  <div className="system-release-version-row">
                                    <span className="system-release-version-num">{t('settings.workspace_sections.system_updates_section.s31', "الإصدار")} {release.version}</span>
                                    <span className="system-release-tag-available">{t('settings.workspace_sections.system_updates_section.s32', "سجل معتمد ومؤرشف")}</span>
                                  </div>
                                  <div className="system-release-date">
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                                    <span>{t('settings.workspace_sections.system_updates_section.s33', "تاريخ الاعتماد:")} {formatGregorianDate(release.promotedAt || (release as any).createdAt, true)}</span>
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {release.passcode && (
                                  <Button
                                    variant="secondary"
                                    onClick={() => setRevealedPasscode({ version: release.version, passcode: release.passcode! })}
                                    style={{ fontWeight: 700, fontSize: '12px', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                                  >
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="15" r="4" /><line x1="10.85" y1="12.15" x2="19" y2="4" /><line x1="18" y1="5" x2="20" y2="7" /><line x1="15" y1="8" x2="17" y2="10" /></svg>
                                    <span>{t('settings.workspace_sections.system_updates_section.s34', "كود التفعيل")}</span>
                                  </Button>
                                )}

                                <Button
                                  variant="secondary"
                                  onClick={() => setSelectedReleaseIndex(originalIdx >= 0 ? originalIdx : 0)}
                                  style={{ fontWeight: 700, fontSize: '12px', padding: '6px 14px', borderRadius: '8px' }}
                                >
                                  {t('settings.workspace_sections.system_updates_section.s35', "عرض التفاصيل وسجل التغييرات")}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            {t('settings.workspace_sections.system_updates_section.s36', "لا توجد إصدارات سابقة مسجلة في هذا النشاط.")}
          </div>
        )}
      </div>
    </div>
  );
}
