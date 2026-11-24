import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveRequestUrl, http } from '@/lib/http';
import { useAuthStore } from '@/stores/auth-store';
import { useOfflineUpdateCheck } from '@/shared/hooks/use-offline-update-check';
import { SystemUpdatesFileInput } from './system-updates-section/system-updates-file-input';
import { SystemUpdatesHero } from './system-updates-section/system-updates-hero';
import { SystemUpdatesMetrics } from './system-updates-section/system-updates-metrics';
import { SystemUpdatesAvailableBanner } from './system-updates-section/system-updates-available-banner';
import { SystemUpdatesReleases } from './system-updates-section/system-updates-releases';
import { SystemUpdatesPasscodeModal } from './system-updates-section/system-updates-passcode-modal';
import { SystemUpdatesReleaseDetailsModal } from './system-updates-section/system-updates-release-details-modal';
import { SystemUpdatesCheckResultModal } from './system-updates-section/system-updates-check-result-modal';
import { SystemUpdatesLocalZipModal } from './system-updates-section/system-updates-local-zip-modal';

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
      <SystemUpdatesFileInput
        fileInputRef={fileInputRef}
        handleFileChange={handleFileChange}
      />

      <SystemUpdatesHero
        t={t}
        currentVersion={currentVersion}
        dataUpdatedAt={dataUpdatedAt}
        canApplyUpdates={canApplyUpdates}
        fileInputRef={fileInputRef}
        handleCheckUpdates={handleCheckUpdates}
        isCheckingUpdates={isCheckingUpdates}
      />

      <SystemUpdatesMetrics
        t={t}
        effectiveDeploymentMode={effectiveDeploymentMode}
      />

      <SystemUpdatesAvailableBanner
        updateInfo={updateInfo}
        t={t}
        canApplyUpdates={canApplyUpdates}
        setUpdateCheckResult={setUpdateCheckResult}
      />

      <SystemUpdatesReleases
        t={t}
        updateHistory={updateHistory}
        isHistoryLoading={isHistoryLoading}
        currentVersion={currentVersion}
        setRevealedPasscode={setRevealedPasscode}
        setSelectedReleaseIndex={setSelectedReleaseIndex}
        setShowArchive={setShowArchive}
        showArchive={showArchive}
      />

      <SystemUpdatesPasscodeModal
        revealedPasscode={revealedPasscode}
        setRevealedPasscode={setRevealedPasscode}
        setCopiedPasscode={setCopiedPasscode}
        t={t}
        copiedPasscode={copiedPasscode}
      />

      <SystemUpdatesReleaseDetailsModal
        selectedRelease={selectedRelease}
        setSelectedReleaseIndex={setSelectedReleaseIndex}
        t={t}
        setCopiedReleaseVersion={setCopiedReleaseVersion}
        copiedReleaseVersion={copiedReleaseVersion}
        currentVersion={currentVersion}
        canApplyUpdates={canApplyUpdates}
        handleApplyOnlineUpdate={handleApplyOnlineUpdate}
      />

      <SystemUpdatesCheckResultModal
        updateCheckResult={updateCheckResult}
        setUpdateCheckResult={setUpdateCheckResult}
        t={t}
        currentVersion={currentVersion}
        onlineUpdatePasscode={onlineUpdatePasscode}
        setOnlineUpdatePasscode={setOnlineUpdatePasscode}
        canApplyUpdates={canApplyUpdates}
        handleApplyOnlineUpdate={handleApplyOnlineUpdate}
      />

      <SystemUpdatesLocalZipModal
        localUpdateState={localUpdateState}
        setLocalUpdateState={setLocalUpdateState}
        t={t}
        handleApplyLocalUpdate={handleApplyLocalUpdate}
        progressInfo={progressInfo}
      />
    </div>
  );
}
