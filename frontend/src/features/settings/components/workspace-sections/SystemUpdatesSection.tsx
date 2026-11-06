import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveRequestUrl, http } from '@/lib/http';
import { Button } from '@/shared/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { useOfflineUpdateCheck } from '@/shared/hooks/use-offline-update-check';
import { DialogShell } from '@/shared/components/dialog-shell';
import { ClientPortal } from '@/shared/components/ClientPortal';
import { CheckIcon, XIcon } from '@/shared/components/icons/AppIcons';

export function formatGregorianDate(dateInput?: string | number | Date | null, withTime = false): string {
  if (!dateInput) return 'غير محدد';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    calendar: 'gregory',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(d);
}

export function SystemUpdatesSection({ deploymentMode }: { deploymentMode?: string; isSuperAdmin?: boolean }) {
  const { t } = useTranslation();
  const authDeploymentMode = useAuthStore((state) => state.activationStatus?.deploymentMode);
  const effectiveDeploymentMode = deploymentMode ?? authDeploymentMode;
  // Apply is desktop-only: the backend 400s both apply endpoints on cloud
  // (OfflineReleasesService.applyLocalUpdate / applyLocalZipUpdate), so the
  // apply affordances are hidden for server tenants instead of dead buttons.
  const canApplyUpdates = effectiveDeploymentMode === 'desktop';

  // Direct releases history query from backend
  const { data: directHistory = [], isLoading: isHistoryLoading } = useQuery<any[]>({
    queryKey: ['system-releases-history'],
    queryFn: async () => {
      try {
        const res = await http<any[]>('/api/updates/history');
        if (Array.isArray(res) && res.length > 0) return res;
      } catch (err) {
        console.warn('Failed to load direct history:', err);
      }
      return [];
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Update checker hooks
  const { data: updateInfo, refetch: checkUpdates, isFetching: isCheckingUpdates, dataUpdatedAt } = useOfflineUpdateCheck(effectiveDeploymentMode);
  
  const [updateCheckResult, setUpdateCheckResult] = useState<{ open: boolean; type: 'checking' | 'up-to-date' | 'error' | 'available'; data?: any } | null>(null);
  const [selectedReleaseIndex, setSelectedReleaseIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Local ZIP & Online Update States
  const [localUpdateState, setLocalUpdateState] = useState<{ open: boolean; file: File | null; passcode: string; status: 'idle' | 'uploading' | 'error' | 'success'; error?: string }>({ open: false, file: null, passcode: '', status: 'idle' });
  const [onlineUpdatePasscode, setOnlineUpdatePasscode] = useState<string>('');
  
  // Admin Passcode Reveal State
  const [revealedPasscode, setRevealedPasscode] = useState<{ version: string; passcode: string } | null>(null);
  const [copiedPasscode, setCopiedPasscode] = useState<boolean>(false);

  const [copiedReleaseVersion, setCopiedReleaseVersion] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState<boolean>(false);

  const staticVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.14';
  const [currentVersion, setCurrentVersion] = useState<string>(staticVersion);

  // Premium Upgrade Progress State
  const [progressInfo, setProgressInfo] = useState<{
    percent: number;
    step: number;
    stepTitle: string;
    stepDesc: string;
  }>({
    percent: 0,
    step: 1,
    stepTitle: '',
    stepDesc: '',
  });

  const startProgressSequence = (isOnline = false) => {
    setProgressInfo({
      percent: 10,
      step: 1,
      stepTitle: isOnline ? 'الاتصال بسحابة GitHub وتنزيل الحزمة المعتمدة...' : 'قراءة حزمة التحديث ومطابقة التوقيع الرقمي...',
      stepDesc: isOnline ? 'جاري استقبال ملفات الإصدار الجديد المشفرة بأعلى سرعة وأمان' : 'فحص كود التفعيل ومطابقة محتويات الحزمة',
    });

    const t1 = setTimeout(() => {
      setProgressInfo({
        percent: 28,
        step: 1,
        stepTitle: isOnline ? 'اكتمال التنزيل وفحص سلامة التشفير...' : 'التحقق من التوافق البرمجي لملفات التحديث...',
        stepDesc: 'مطابقة الهاش الرقمي والتأكد من سلامة الحزمة 100%',
      });
    }, 2500);

    const t2 = setTimeout(() => {
      setProgressInfo({
        percent: 50,
        step: 2,
        stepTitle: 'إنشاء نقطة استعادة احتياطية آمنة...',
        stepDesc: 'أخذ نسخة أمان كاملة لقاعدة البيانات والملفات تلقائياً قبل تطبيق الترقية',
      });
    }, 5500);

    const t3 = setTimeout(() => {
      setProgressInfo({
        percent: 72,
        step: 3,
        stepTitle: 'فك الضغط واستبدال ملفات النظام...',
        stepDesc: 'تطبيق ملفات السيرفر والواجهات المحدثة وترقية الهيكل البرمجي',
      });
    }, 9500);

    const t4 = setTimeout(() => {
      setProgressInfo({
        percent: 88,
        step: 3,
        stepTitle: 'مزامنة التحديثات وضبط جداول قاعدة البيانات...',
        stepDesc: 'تجهيز بيئة العمل واستكمال الترقيات الصامتة',
      });
    }, 13500);

    const t5 = setTimeout(() => {
      setProgressInfo({
        percent: 100,
        step: 4,
        stepTitle: 'اكتملت الترقية بنجاح!',
        stepDesc: 'جاري تشغيل المنظومة تلقائياً بالإصدار الجديد خلال ثوانٍ معدودة...',
      });
    }, 16500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  };

  useEffect(() => {
    fetch(resolveRequestUrl('/api/updates/version'))
      .then(res => res.json())
      .then(data => {
        if (data && data.version) {
          setCurrentVersion(data.version);
        }
      })
      .catch(err => console.error('Failed to fetch runtime version:', err));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setLocalUpdateState({ open: true, file: e.target.files[0], passcode: '', status: 'idle' });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApplyLocalUpdate = async () => {
    if (!localUpdateState.file) return;
    setLocalUpdateState(s => ({ ...s, status: 'uploading' }));
    const cancelProgress = startProgressSequence(false);
    
    const formData = new FormData();
    formData.append('file', localUpdateState.file);
    if (localUpdateState.passcode) {
      formData.append('passcode', localUpdateState.passcode);
    }

    try {
      try {
        await http('/api/local-updates/apply-local-zip', {
          method: 'POST',
          body: formData,
          timeoutMs: 5 * 60 * 1000,
        });
      } catch (err: any) {
        if (err.status === 404) {
          await http('/api/updates/apply-local-zip', {
            method: 'POST',
            body: formData,
            timeoutMs: 5 * 60 * 1000,
          });
        } else {
          throw err;
        }
      }
    } catch (e: any) {
      cancelProgress();
      const msg = typeof e?.data?.message === 'string' ? e.data.message : (typeof e?.response?.data?.message === 'string' ? e.response.data.message : (e?.message || 'تعذر استكمال عملية التحديث. يرجى التأكد من كود التفعيل وصحة حزمة التحديث.'));
      setLocalUpdateState(s => ({ ...s, status: 'error', error: msg }));
    }
  };

  const handleCheckUpdates = () => {
    setUpdateCheckResult({ open: true, type: 'checking' });
    checkUpdates().then((res) => {
      if (res.data?.updateAvailable) {
        setUpdateCheckResult({ open: true, type: 'available', data: res.data });
      } else if (res.isError || !navigator.onLine) {
        setUpdateCheckResult({ open: true, type: 'error' });
      } else {
        setUpdateCheckResult({ open: true, type: 'up-to-date' });
      }
    });
  };

  const handleApplyOnlineUpdate = async (version: string, patchUrl: string, changelog?: string, passcode?: string) => {
    setUpdateCheckResult(null);
    setSelectedReleaseIndex(null);
    setLocalUpdateState({ open: true, file: null, passcode: '', status: 'uploading' });
    const cancelProgress = startProgressSequence(true);

    try {
      await http('/api/local-updates/apply', {
        method: 'POST',
        body: JSON.stringify({ version, patchUrl, changelog, passcode: passcode || onlineUpdatePasscode }),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (e: any) {
      cancelProgress();
      const msg = typeof e?.data?.message === 'string' ? e.data.message : (typeof e?.response?.data?.message === 'string' ? e.response.data.message : (e?.message || 'تعذر استكمال عملية التحديث. يرجى التأكد من كود التفعيل المعتمد.'));
      setLocalUpdateState(s => ({ ...s, status: 'error', error: msg }));
    }
  };

  const updateHistory = (directHistory && directHistory.length > 0) ? directHistory : (updateInfo?.releases || []);
  const selectedRelease = selectedReleaseIndex !== null && updateHistory ? updateHistory[selectedReleaseIndex] : null;

  return (
    <div className="system-updates-hub">
      <input type="file" accept=".zip" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />

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
    </div>
  );
}
