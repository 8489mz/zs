import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { ImportWorkbench } from '@/features/settings/components/ImportWorkbench';
import { SnapshotList, type BackupSnapshotRecord } from '@/features/settings/components/SettingsWorkspacePrimitives';
import { settingsApi, type BackupConfigResponse } from '@/features/settings/api/settings.api';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin, isDesktopOfflineApp } from '@/shared/system/runtime-environment';

import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { TenantTransferCard } from './TenantTransferCard';


export interface BackupConfigQueryState {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  data?: BackupConfigResponse;
}

interface SettingsBackupImportSectionProps {
  snapshots: BackupSnapshotRecord[];
  autoBackupEnabled: boolean;
  canManageBackups: boolean;
  backupBusy: boolean;
  backupConfigQuery: BackupConfigQueryState;
  backupFolderPathDraft: string;
  setBackupFolderPathDraft: (value: string) => void;
  backupAutoEnabledDraft: boolean;
  setBackupAutoEnabledDraft: (value: boolean) => void;
  backupFrequencyDraft: 'daily' | 'weekly';
  setBackupFrequencyDraft: (value: 'daily' | 'weekly') => void;
  backupTimeDraft: string;
  setBackupTimeDraft: (value: string) => void;
  backupWeeklyDayDraft: number;
  setBackupWeeklyDayDraft: (value: number) => void;
  backupSelectedFileName: string;
  backupMessage: string;
  backupMessageKind: 'success' | 'error';
  backupResult: unknown;
  restoreSnapshotId: string;
  handleBackupDownload: () => void;
  saveBackupConfig: () => Promise<void>;
  testBackupFolder: () => Promise<void>;
  saveBackupFileToFolderNow: () => Promise<void>;
  handleSupportBundleDownload?: () => Promise<void>;
  handleBackupFile: (file: File, mode: 'verify' | 'restore') => void | Promise<void>;
  handleSnapshotDownload: (snapshot: BackupSnapshotRecord) => void;
  onRequestRestoreFile: (file: File) => void;
  onRequestRestoreSnapshot: (snapshot: BackupSnapshotRecord) => void;
  importProductsPending: boolean;
  importCustomersPending: boolean;
  importSuppliersPending: boolean;
  importOpeningStockPending: boolean;
  importProducts: (rows: Record<string, string>[]) => Promise<unknown>;
  importCustomers: (rows: Record<string, string>[]) => Promise<unknown>;
  importSuppliers: (rows: Record<string, string>[]) => Promise<unknown>;
  importOpeningStock: (rows: Record<string, string>[]) => Promise<unknown>;
  downloadTemplate: (kind: 'products' | 'customers' | 'customers-retail' | 'customers-van' | 'suppliers' | 'opening-stock') => void;
  onExportData?: (kind: 'products' | 'customers' | 'suppliers' | 'opening-stock') => Promise<void> | void;
}

import { http } from '@/lib/http';
import { useQuery, useMutation } from '@tanstack/react-query';

function DatabaseOptimizationCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const statsQuery = useQuery({
    queryKey: ['health', 'db-stats'],
    queryFn: () => http<{ database_size_mb: number; pg_uptime_hours: number; maintenance_last_run?: any }>('/api/health/db-stats'),
    staleTime: 30_000,
  });

  const dbSize = statsQuery.data?.database_size_mb ? `${statsQuery.data.database_size_mb} MB` : '—';

  const optimizeMutation = useMutation({
    mutationFn: () => http<{ ok: boolean; message: string; database_size_mb?: number }>('/api/health/optimize-db', { method: 'POST' }),
    onSuccess: (data) => {
      setFeedback({ kind: 'success', message: data.message || 'تم تحسين قاعدة البيانات وضغط المساحة بنجاح!' });
      statsQuery.refetch();
    },
    onError: (err: any) => {
      setFeedback({ kind: 'error', message: err.message || 'فشل تشغيل عملية الصيانة.' });
    },
  });

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '12px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.workspace_sections.settings_backup_import_section.s0', "صيانة وتسريع قاعدة البيانات")}</strong>
          <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>{t('settings.workspace_sections.settings_backup_import_section.s1', "أداء النظام")}</span>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
          {t('settings.workspace_sections.settings_backup_import_section.s2', "تنظيف البيانات المؤقتة، إعادة بناء الفهارس، وضغط المساحة (VACUUM ANALYZE) لتحسين سرعة واستجابة النظام.")}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ textAlign: 'center', padding: '4px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
          <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block' }}>{t('settings.workspace_sections.settings_backup_import_section.s3', "حجم البيانات")}</span>
          <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{dbSize}</strong>
        </div>

        <Button
          type="button"
          disabled={!canManage || optimizeMutation.isPending}
          onClick={() => {
            setFeedback(null);
            optimizeMutation.mutate();
          }}
          style={{
            fontSize: '0.82rem',
            padding: '7px 16px',
            background: '#0f172a',
            color: '#ffffff',
            fontWeight: 700,
          }}
        >
          {optimizeMutation.isPending ? t('settings.workspace_sections.settings_backup_import_section.s4', "جاري التحسين...") : t('settings.workspace_sections.settings_backup_import_section.s5', "تحسين وتسريع الآن")}
        </Button>
      </div>

      {feedback && (
        <div style={{
          width: '100%',
          marginTop: '4px',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontWeight: 600,
          background: feedback.kind === 'success' ? '#ecfdf5' : '#fef2f2',
          color: feedback.kind === 'success' ? '#047857' : '#b91c1c',
          border: feedback.kind === 'success' ? '1px solid #a7f3d0' : '1px solid #fca5a5',
        }}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}

function CloudBackupSettingsCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<{
    enabled: boolean;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    retentionDays: number;
    lastBackupAt?: string;
    lastBackupStatus?: string;
    lastError?: string;
  }>({
    enabled: false,
    endpoint: 's3.amazonaws.com',
    region: 'us-east-1',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    retentionDays: 30
  });

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    settingsApi.cloudBackupConfig().then((data: any) => {
      if (data) setConfig((prev) => ({ ...prev, ...data }));
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await settingsApi.saveCloudBackupConfig(config);
      setConfig(res);
      setFeedback({ text: 'تم حفظ إعدادات النسخ السحابي بنجاح', type: 'success' });
    } catch (e: any) {
      setFeedback({ text: e?.message || 'فشل حفظ الإعدادات', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await settingsApi.testCloudConnection();
      setFeedback({ text: res.message || 'تم التحقق من الاتصال بالسحابة بنجاح', type: 'success' });
    } catch (e: any) {
      setFeedback({ text: e?.message || 'فشل الاتصال بالسحابة', type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await settingsApi.triggerCloudBackupNow();
      setFeedback({ text: `تم رفع النسخة الاحتياطية (${res.fileName}) إلى السحابة بنجاح!`, type: 'success' });
      setConfig((prev) => ({ ...prev, lastBackupAt: new Date().toISOString(), lastBackupStatus: 'success' }));
    } catch (e: any) {
      setFeedback({ text: e?.message || 'فشل رفع النسخة إلى السحابة', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <QueryCard
      className="settings-admin-card"
      title={t('settings.workspace_sections.settings_backup_import_section.s6', "النسخ الاحتياطي السحابي المباشر (Cloud S3 Backup)")}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="nav-pill"
            style={{
              background: config.enabled ? '#ecfdf5' : '#f1f5f9',
              color: config.enabled ? '#047857' : '#64748b',
              border: config.enabled ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
              fontSize: '0.74rem',
              fontWeight: 700
            }}
          >
            {t('settings.workspace_sections.settings_backup_import_section.s7', "السحابة:")} {config.enabled ? t('settings.workspace_sections.settings_backup_import_section.s8', "مفعلة") : t('settings.workspace_sections.settings_backup_import_section.s9', "متوقفة")}
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {t('settings.workspace_sections.settings_backup_import_section.s10', "ربط النظام بمخزن سحابي متوافق مع S3 (مثل Amazon AWS S3, Cloudflare R2, Wasabi, MinIO) لحفظ نسخ احتياطية مشفرة تلقائياً.")}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>{t('settings.workspace_sections.settings_backup_import_section.s11', "مزود الخدمة / Endpoint")}</span>
            <input
              value={config.endpoint}
              onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
              placeholder={t('settings.workspace_sections.settings_backup_import_section.s12', "s3.amazonaws.com أو wasabisys.com")}
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            />
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>{t('settings.workspace_sections.settings_backup_import_section.s13', "اسم الـ Bucket")}</span>
            <input
              value={config.bucket}
              onChange={(e) => setConfig({ ...config, bucket: e.target.value })}
              placeholder="my-erp-backups"
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            />
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>Region</span>
            <input
              value={config.region}
              onChange={(e) => setConfig({ ...config, region: e.target.value })}
              placeholder="us-east-1"
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            />
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>Access Key ID</span>
            <input
              value={config.accessKeyId}
              onChange={(e) => setConfig({ ...config, accessKeyId: e.target.value })}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            />
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>Secret Access Key</span>
            <input
              type="password"
              value={config.secretAccessKey}
              onChange={(e) => setConfig({ ...config, secretAccessKey: e.target.value })}
              placeholder="••••••••••••••••••••••••"
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            />
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '2px', display: 'block' }}>{t('settings.workspace_sections.settings_backup_import_section.s14', "تفعيل النسخ السحابي")}</span>
            <select
              value={config.enabled ? 'true' : 'false'}
              onChange={(e) => setConfig({ ...config, enabled: e.target.value === 'true' })}
              disabled={!canManage || loading}
              style={{ height: '36px', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #cbd5e1', padding: '0 8px' }}
            >
              <option value="false">{t('settings.workspace_sections.settings_backup_import_section.s15', "متوقف")}</option>
              <option value="true">{t('settings.workspace_sections.settings_backup_import_section.s16', "مفعل (تلقائي)")}</option>
            </select>
          </label>
        </div>

        {feedback && (
          <div style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 600,
            background: feedback.type === 'error' ? '#fef2f2' : '#ecfdf5',
            color: feedback.type === 'error' ? '#b91c1c' : '#047857',
            border: feedback.type === 'error' ? '1px solid #fca5a5' : '1px solid #a7f3d0'
          }}>
            {feedback.text}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_backup_import_section.s17', "آخر رفع سحابي:")} <strong style={{ color: '#0f172a' }}>{config.lastBackupAt ? new Date(config.lastBackupAt).toLocaleString('ar-EG') : t('settings.workspace_sections.settings_backup_import_section.s18', "لا يوجد")}</strong>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Button type="button" variant="secondary" onClick={handleTest} disabled={!canManage || testing || loading} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
              {testing ? t('settings.workspace_sections.settings_backup_import_section.s19', "جاري الفحص...") : t('settings.workspace_sections.settings_backup_import_section.s20', "اختبار الاتصال بالسحابة")}
            </Button>
            <Button type="button" variant="secondary" onClick={handleSave} disabled={!canManage || loading} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
              {loading ? t('settings.workspace_sections.settings_backup_import_section.s21', "جاري الحفظ...") : t('settings.workspace_sections.settings_backup_import_section.s22', "حفظ الإعدادات")}
            </Button>
            <Button type="button" variant="primary" onClick={handleSyncNow} disabled={!canManage || syncing || loading} style={{ fontSize: '0.78rem', padding: '6px 14px' }}>
              {syncing ? t('settings.workspace_sections.settings_backup_import_section.s23', "جاري الرفع...") : t('settings.workspace_sections.settings_backup_import_section.s24', "نسخ احتياطي سحابي الآن")}
            </Button>
          </div>
        </div>
      </div>
    </QueryCard>
  );
}

function DemoDataSandboxCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = isPlatformAdmin(user);
  const [modalMode, setModalMode] = useState<'seed' | 'wipe' | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const statusQuery = useQuery({
    queryKey: ['demo-data', 'status'],
    queryFn: () => http<{ isEmpty: boolean; productCount: number; saleCount: number; isSuperAdmin: boolean }>('/api/admin/demo-data/status'),
    staleTime: 30_000,
  });

  const isEmpty = Boolean(statusQuery.data?.isEmpty);

  const mutation = useMutation({
    mutationFn: async ({ mode, pass }: { mode: 'seed' | 'wipe'; pass: string }) => {
      const endpoint = mode === 'seed' ? '/api/admin/demo-data/seed' : '/api/admin/demo-data/wipe';
      return http<{ ok: boolean; message: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ password: pass }),
      });
    },
    onSuccess: (data, vars) => {
      setFeedback({
        kind: 'success',
        message: data.message || (vars.mode === 'seed' ? 'تم ملء النظام بالبيانات التجريبية بنجاح!' : 'تم تصفير البيانات بنجاح!'),
      });
      setModalMode(null);
      setPassword('');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    },
    onError: (err: any) => {
      setFeedback({
        kind: 'error',
        message: err?.message || 'فشل تنفيذ العملية. تأكد من كلمة مرور السوبر أدمن.',
      });
    },
  });

  if (!isSuperAdmin) return null;

  return (
    <>
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1.05rem',
              flexShrink: 0,
              boxShadow: '0 2px 6px rgba(23, 14, 94, 0.18)',
            }}>
              Z
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.98rem', color: '#0f172a', fontWeight: 800 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s25', "بيئة العرض التجريبية وتصفير النظام")}
                </strong>
                {isEmpty ? (
                  <span style={{ fontSize: '0.72rem', background: '#ecfdf5', color: '#047857', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #a7f3d0' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s26', "متجر جديد وفارغ (جاهز للملء)")}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #e2e8f0' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s27', "منصة الإدارة فقط")}
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #e2e8f0' }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s28', "نسخ احتياطي تلقائي إجباري")}
                </span>
              </div>
              <p style={{ margin: '5px 0 0', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                {t('settings.workspace_sections.settings_backup_import_section.s29', "أداة فورية لملء النظام بكافة بيانات المتجر الواقعية لاختبار الكاشير والتقارير والمناديب والمخازن على مدار 6 أشهر، أو تصفير النظام تماماً للبدء الفعلي.")}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <Button
              type="button"
              onClick={() => navigate('/settings/demo-data')}
              style={{
                fontSize: '0.85rem',
                padding: '9px 18px',
                background: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(23, 14, 94, 0.22)',
                transition: 'all 0.15s ease',
              }}
            >
              {t('settings.workspace_sections.settings_backup_import_section.s30', "معالج الأنشطة التجريبية")}
            </Button>

            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setFeedback(null);
                if (isEmpty) {
                  mutation.mutate({ mode: 'seed', pass: '' });
                } else {
                  setPassword('');
                  setModalMode('seed');
                }
              }}
              style={{
                fontSize: '0.85rem',
                padding: '9px 16px',
                background: '#f8fafc',
                color: '#334155',
                fontWeight: 700,
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {mutation.isPending && isEmpty ? t('settings.workspace_sections.settings_backup_import_section.s31', "جاري السكب...") : t('settings.workspace_sections.settings_backup_import_section.s32', "ملء سريع (سوبرماركت)")}
            </Button>

            {isSuperAdmin && (
              <Button
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setFeedback(null);
                  setPassword('');
                  setModalMode('wipe');
                }}
                style={{
                  fontSize: '0.85rem',
                  padding: '9px 16px',
                  background: '#fff1f2',
                  color: '#be123c',
                  fontWeight: 700,
                  borderRadius: '8px',
                  border: '1px solid #fecdd3',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t('settings.workspace_sections.settings_backup_import_section.s33', "تصفير ومسح كافة البيانات")}
              </Button>
            )}
          </div>
        </div>

        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          fontSize: '0.8rem',
          color: '#334155',
        }}>
          <div>
            <strong style={{ color: '#0f172a' }}>{t('settings.workspace_sections.settings_backup_import_section.s34', "الأصناف والأسعار:")}</strong> {t('settings.workspace_sections.settings_backup_import_section.s35', "50 صنفاً تجارياً، نواقص شراء، وأصناف نفدت.")}
          </div>
          <div>
            <strong style={{ color: '#0f172a' }}>{t('settings.workspace_sections.settings_backup_import_section.s36', "الشركاء والموظفون:")}</strong> {t('settings.workspace_sections.settings_backup_import_section.s37', "10 عملاء، 8 موردين، 6 مناديب، 20 موظفاً (HR).")}
          </div>
          <div>
            <strong style={{ color: '#0f172a' }}>{t('settings.workspace_sections.settings_backup_import_section.s38', "الفواتير والتقارير:")}</strong> {t('settings.workspace_sections.settings_backup_import_section.s39', "مبيعات ومشتريات موزعة على 6 أشهر كاملة.")}
          </div>
          <div>
            <strong style={{ color: '#0f172a' }}>{t('settings.workspace_sections.settings_backup_import_section.s40', "حسابات تجريبية:")}</strong> {t('settings.workspace_sections.settings_backup_import_section.s41', "تُنشأ كلمات مرور مؤقتة عشوائية وتُفرض على المستخدمين عند أول دخول.")}
          </div>
        </div>

        {feedback && (
          <div style={{
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 700,
            background: feedback.kind === 'success' ? '#ecfdf5' : '#fef2f2',
            color: feedback.kind === 'success' ? '#047857' : '#b91c1c',
            border: feedback.kind === 'success' ? '1px solid #a7f3d0' : '1px solid #fca5a5',
          }}>
            {feedback.message}
          </div>
        )}
      </div>

      <DialogShell
        open={Boolean(modalMode)}
        onClose={() => {
          if (!mutation.isPending) {
            setModalMode(null);
            setPassword('');
            setFeedback(null);
          }
        }}
        width="min(480px, 95vw)"
        ariaLabel={modalMode === 'wipe' ? t('settings.workspace_sections.settings_backup_import_section.s42', "مسح بيانات العمليات والمبيعات") : t('settings.workspace_sections.settings_backup_import_section.s43', "ملء بيانات تجريبية مؤسسية")}
      >
        <div style={{
          background: '#ffffff',
          padding: '24px',
          direction: 'rtl',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: modalMode === 'wipe' ? '#fef2f2' : '#f0f4ff',
                border: modalMode === 'wipe' ? '1px solid #fca5a5' : '1px solid #c7d2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                fontWeight: 800,
                color: modalMode === 'wipe' ? '#dc2626' : '#170e5e',
              }}>
                !
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: modalMode === 'wipe' ? '#991b1b' : '#0f172a' }}>
                  {modalMode === 'wipe' ? t('settings.workspace_sections.settings_backup_import_section.s44', "تأكيد تصفير ومسح كافة البيانات") : t('settings.workspace_sections.settings_backup_import_section.s45', "تأكيد ملء النظام بالبيانات التجريبية")}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  {modalMode === 'wipe' ? t('settings.workspace_sections.settings_backup_import_section.s46', "سيتم مسح كل الحركات والبيانات وإعادة النظام لضبط المصنع") : t('settings.workspace_sections.settings_backup_import_section.s47', "سيتم إضافة أصناف وعملاء وموظفين وفواتير 6 أشهر")}
                </p>
              </div>
            </div>

            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px',
              fontSize: '0.82rem',
              color: '#334155',
              lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, color: '#047857', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span>{t('settings.workspace_sections.settings_backup_import_section.s48', "أمان إضافي مؤكد:")}</span>
              </div>
              {t('settings.workspace_sections.settings_backup_import_section.s49', "سيقوم السستم تلقائياً بأخذ لقطة احتياطية كاملة (Backup) من قاعدة البيانات الحالية وحفظها في المجلد السحابي والمحلي قبل الشروع في التنفيذ لحماية بياناتك تماماً.")}
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_backup_import_section.s50', "كلمة مرور السوبر أدمن (مطلوبة للتنفيذ)")}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('settings.workspace_sections.settings_backup_import_section.s51', "أدخل كلمة مرور السوبر أدمن الحالية...")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password && !mutation.isPending && modalMode) {
                      mutation.mutate({ mode: modalMode, pass: password });
                    }
                  }}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    paddingLeft: '40px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                  }}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {feedback?.kind === 'error' && (
              <div style={{
                marginBottom: '16px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fca5a5',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}>
                {feedback.message}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
              <Button
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setModalMode(null);
                  setPassword('');
                  setFeedback(null);
                }}
                style={{
                  padding: '8px 18px',
                  background: '#f1f5f9',
                  color: '#475569',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}
              >
                {t('settings.workspace_sections.settings_backup_import_section.s52', "إلغاء")}
              </Button>

              <Button
                type="button"
                disabled={!password || !modalMode || mutation.isPending}
                onClick={() => modalMode && mutation.mutate({ mode: modalMode, pass: password })}
                style={{
                  padding: '8px 22px',
                  background: modalMode === 'wipe' ? '#dc2626' : '#170e5e',
                  color: '#ffffff',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  boxShadow: modalMode === 'wipe' ? '0 2px 6px rgba(220, 38, 38, 0.3)' : '0 2px 6px rgba(23, 14, 94, 0.25)',
                }}
              >
                {mutation.isPending ? t('settings.workspace_sections.settings_backup_import_section.s53', "جاري التنفيذ وأخذ النسخة...") : modalMode === 'wipe' ? t('settings.workspace_sections.settings_backup_import_section.s54', "تأكيد المسح والتصفير") : t('settings.workspace_sections.settings_backup_import_section.s55', "تأكيد ملء البيانات التجريبية")}
              </Button>
            </div>
        </div>
      </DialogShell>
    </>
  );
}

function InventoryOperationsResetCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [modalMode, setModalMode] = useState<'reset_stock' | 'wipe_catalog' | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ mode, pass }: { mode: 'reset_stock' | 'wipe_catalog'; pass: string }) => {
      if (mode === 'reset_stock') {
        return settingsApi.resetStockBalances(pass);
      } else {
        return settingsApi.wipeCatalogProducts(pass);
      }
    },
    onSuccess: (data, vars) => {
      setFeedback({
        kind: 'success',
        message: data.message || (vars.mode === 'reset_stock' ? 'تم تصفير أرصدة المخزون بنجاح!' : 'تم مسح كافة الأصناف والمخزون بنجاح!'),
      });
      setModalMode(null);
      setPassword('');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    },
    onError: (err: any) => {
      setFeedback({
        kind: 'error',
        message: err?.message || 'فشل تنفيذ العملية. يرجى التأكد من كلمة المرور.',
      });
    },
  });

  if (!canManage) return null;

  return (
    <>
      <QueryCard
        className="settings-admin-card"
        title={t('settings.workspace_sections.settings_backup_import_section.s56', "إدارة تهيئة المخزون وتصفير البيانات للبدء الفعلي")}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              className="nav-pill"
              style={{
                background: '#f8fafc',
                color: '#475569',
                border: '1px solid #e2e8f0',
                fontSize: '0.74rem',
                fontWeight: 700,
              }}
            >
              {t('settings.workspace_sections.settings_backup_import_section.s57', "صلاحية الإدارة فقط")}
            </span>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
            {t('settings.workspace_sections.settings_backup_import_section.s58', "أدوات إدارية مخصصة لتهيئة المنشأة وبدء التشغيل الفعلي. تتيح لك إما تصفير كميات وحركات المخزون فقط مع الاحتفاظ بأسماء الأصناف وأسعارها، أو مسح كافة الأصناف بالكامل للبدء بكتالوج جديد، مع الحفاظ الصارم في الحالتين على بيانات المنشأة والفروع والمستخدمين والإعدادات.")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
            {/* Action 1: Reset Stock Balances */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 800 }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s59', "1. تصفير أرصدة المخزون والحركات")}
                  </strong>
                  <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #bfdbfe' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s60', "الأصناف والأسعار محفوظة")}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s61', "تصفير كميات وأرصدة كافة الأصناف في جميع المخازن لتصبح (0)، ومسح الحركات والفواتير السابقة للبدء الفعلي بجرد نظيف أو إدخال رصيد أول المدة،")} <strong>{t('settings.workspace_sections.settings_backup_import_section.s62', "مع الحفاظ التام على بيانات الأصناف والباركودات والأسعار والتصنيفات")}</strong>.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s63', "نسخة احتياطية تلقائية")}
                </span>
                <Button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setFeedback(null);
                    setPassword('');
                    setModalMode('reset_stock');
                  }}
                  style={{
                    fontSize: '0.8rem',
                    padding: '8px 16px',
                    background: '#170e5e',
                    color: '#ffffff',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(23, 14, 94, 0.2)',
                  }}
                >
                  {t('settings.workspace_sections.settings_backup_import_section.s64', "تصفير أرصدة المخزون لبدء الشغل")}
                </Button>
              </div>
            </div>

            {/* Action 2: Wipe Catalog Products */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #fee2e2',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.92rem', color: '#991b1b', fontWeight: 800 }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s65', "2. مسح كافة الأصناف والمخزون كلياً")}
                  </strong>
                  <span style={{ fontSize: '0.7rem', background: '#fff1f2', color: '#be123c', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, border: '1px solid #fecdd3' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s66', "بيانات المنشأة محفوظة")}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s67', "مسح كافة الأصناف والباركودات والتصنيفات والمخزون بالكامل للبدء بقائمة أصناف جديدة،")} <strong>{t('settings.workspace_sections.settings_backup_import_section.s68', "مع الحفاظ الصارم على اسم المنشأة، الشعار، العنوان، الهواتف، الفروع، المستخدمين، والإعدادات")}</strong>.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px', borderTop: '1px solid #fef2f2' }}>
                <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s69', "إجراء جذري بحماية كلمة المرور")}
                </span>
                <Button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setFeedback(null);
                    setPassword('');
                    setModalMode('wipe_catalog');
                  }}
                  style={{
                    fontSize: '0.8rem',
                    padding: '8px 16px',
                    background: '#fff1f2',
                    color: '#be123c',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: '1px solid #fecdd3',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_backup_import_section.s70', "مسح كافة الأصناف والمخزون")}
                </Button>
              </div>
            </div>
          </div>

          {feedback && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              background: feedback.kind === 'success' ? '#ecfdf5' : '#fef2f2',
              color: feedback.kind === 'success' ? '#047857' : '#b91c1c',
              border: feedback.kind === 'success' ? '1px solid #a7f3d0' : '1px solid #fca5a5',
            }}>
              {feedback.message}
            </div>
          )}
        </div>
      </QueryCard>

      {/* Confirmation Modal */}
      <DialogShell
        open={Boolean(modalMode)}
        onClose={() => {
          if (!mutation.isPending) {
            setModalMode(null);
            setPassword('');
            setFeedback(null);
          }
        }}
        width="min(500px, 95vw)"
        ariaLabel={modalMode === 'wipe_catalog' ? t('settings.workspace_sections.settings_backup_import_section.s71', "مسح وحذف سجل الأصناف بالكامل") : t('settings.workspace_sections.settings_backup_import_section.s72', "تصفير أرصدة المخزون وحركات البيع")}
      >
        <div style={{
          background: '#ffffff',
          padding: '24px',
          direction: 'rtl',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: modalMode === 'wipe_catalog' ? '#fef2f2' : '#f0f4ff',
                border: modalMode === 'wipe_catalog' ? '1px solid #fca5a5' : '1px solid #c7d2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: modalMode === 'wipe_catalog' ? '#dc2626' : '#170e5e',
              }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: modalMode === 'wipe_catalog' ? '#991b1b' : '#0f172a' }}>
                  {modalMode === 'reset_stock' ? t('settings.workspace_sections.settings_backup_import_section.s73', "تأكيد تصفير أرصدة المخزون لبدء التشغيل") : t('settings.workspace_sections.settings_backup_import_section.s74', "تأكيد مسح كافة الأصناف والمخزون كلياً")}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  {modalMode === 'reset_stock' 
                    ? t('settings.workspace_sections.settings_backup_import_section.s75', "سيتم تصفير الكميات ومسح الحركات السابقة مع الإبقاء على قائمة الأصناف والأسعار")
                    : t('settings.workspace_sections.settings_backup_import_section.s76', "سيتم مسح كافة الأصناف والكتالوج بالكامل مع الحفاظ الصارم على بيانات المنشأة")}
                </p>
              </div>
            </div>

            {/* Scope Summary Box */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '0.8rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#047857', fontWeight: 700 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>{t('settings.workspace_sections.settings_backup_import_section.s77', "البيانات المحفوظة التي لن يتم المساس بها:")}</span>
              </div>
              <div style={{ color: '#334155', paddingRight: '22px', fontSize: '0.78rem', lineHeight: 1.5 }}>
                {modalMode === 'reset_stock'
                  ? t('settings.workspace_sections.settings_backup_import_section.s78', "• أسماء الأصناف، الأكواد، الباركودات، أسعار التكلفة والبيع، التصنيفات، الوحدات، بيانات المنشأة، الفروع، والمستخدمين.")
                  : t('settings.workspace_sections.settings_backup_import_section.s79', "• اسم المنشأة، الشعار، العنوان، أرقام الهواتف، الفروع، أماكن التخزين، المستخدمين والصلاحيات، وإعدادات النظام.")}
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_backup_import_section.s80', "كلمة مرور حساب المدير (مطلوبة لتأكيد العملية)")}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('settings.workspace_sections.settings_backup_import_section.s81', "أدخل كلمة المرور لتأكيد الهوية...")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password && !mutation.isPending && (modalMode === 'reset_stock' || modalMode === 'wipe_catalog')) {
                      mutation.mutate({ mode: modalMode, pass: password });
                    }
                  }}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    paddingLeft: '40px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                  }}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {feedback?.kind === 'error' && (
              <div style={{
                marginBottom: '16px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fca5a5',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}>
                {feedback.message}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
              <Button
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setModalMode(null);
                  setPassword('');
                  setFeedback(null);
                }}
                style={{
                  padding: '8px 18px',
                  background: '#f1f5f9',
                  color: '#475569',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}
              >
                {t('settings.workspace_sections.settings_backup_import_section.s82', "إلغاء")}
              </Button>

              <Button
                type="button"
                disabled={!password || !modalMode || mutation.isPending}
                onClick={() => (modalMode === 'reset_stock' || modalMode === 'wipe_catalog') && mutation.mutate({ mode: modalMode, pass: password })}
                style={{
                  padding: '8px 22px',
                  background: modalMode === 'wipe_catalog' ? '#dc2626' : '#170e5e',
                  color: '#ffffff',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  boxShadow: modalMode === 'wipe_catalog' ? '0 2px 6px rgba(220, 38, 38, 0.3)' : '0 2px 6px rgba(23, 14, 94, 0.25)',
                }}
              >
                {mutation.isPending ? t('settings.workspace_sections.settings_backup_import_section.s83', "جاري التنفيذ...") : modalMode === 'reset_stock' ? t('settings.workspace_sections.settings_backup_import_section.s84', "تأكيد تصفير الأرصدة") : t('settings.workspace_sections.settings_backup_import_section.s85', "تأكيد مسح الأصناف")}
              </Button>
            </div>
        </div>
      </DialogShell>
    </>
  );
}


function formatSummaryPairs(result: unknown): Array<{ label: string; value: string }> {
  if (!result || typeof result !== 'object') return [];
  const payload = result as Record<string, unknown>;
  const summary = payload.summary && typeof payload.summary === 'object' ? (payload.summary as Record<string, unknown>) : null;
  if (!summary) return [];

  const preferredKeys: Array<[string, string]> = [
    ['version', 'الإصدار'],
    ['exportedAt', 'تاريخ التصدير'],
    ['source', 'المصدر'],
    ['tablesPresent', 'الجداول الموجودة'],
    ['restoredTables', 'الجداول المستعادة'],
    ['product_location_stock', 'أرصدة المخازن'],
    ['products', 'الأصناف'],
    ['customers', 'العملاء'],
    ['suppliers', 'الموردون'],
    ['sales', 'المبيعات'],
    ['purchases', 'المشتريات'],
  ];

  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, label] of preferredKeys) {
    const directValue = key in payload ? payload[key] : summary[key];
    if (directValue === undefined || directValue === null || directValue === '') continue;
    rows.push({ label, value: String(directValue) });
  }
  return rows;
}

export function SettingsBackupImportSection({
  snapshots,
  autoBackupEnabled,
  canManageBackups,
  backupBusy,
  backupConfigQuery,
  backupFolderPathDraft,
  setBackupFolderPathDraft,
  backupAutoEnabledDraft,
  setBackupAutoEnabledDraft,
  backupFrequencyDraft,
  setBackupFrequencyDraft,
  backupTimeDraft,
  setBackupTimeDraft,
  backupWeeklyDayDraft,
  setBackupWeeklyDayDraft,
  backupSelectedFileName: _backupSelectedFileName,
  backupMessage,
  backupMessageKind,
  backupResult,
  restoreSnapshotId,
  handleBackupDownload,
  handleSupportBundleDownload,
  saveBackupConfig,
  testBackupFolder,
  saveBackupFileToFolderNow,
  handleBackupFile,
  handleSnapshotDownload,
  onRequestRestoreFile,
  onRequestRestoreSnapshot,
  importProductsPending,
  importCustomersPending,
  importSuppliersPending,
  importOpeningStockPending,
  importProducts,
  importCustomers,
  importSuppliers,
  importOpeningStock,
  downloadTemplate,
  onExportData,
}: SettingsBackupImportSectionProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const currentVertical = resolveCurrentVertical(tenant);
  const isMaritime = currentVertical === 'maritime';
  const isContracting = currentVertical === 'contracting';
  const isPlatformSuperAdmin = isPlatformAdmin(user);
  const isDesktopOffline = isDesktopOfflineApp();
  const isPlatformTenant = !isDesktopOffline && (isPlatformSuperAdmin || user?.tenantId === 'zs');
  const canRestore = !isPlatformTenant && (isDesktopOffline || user?.role === 'super_admin' || (user?.role === 'admin' && canManageBackups) || user?.username?.trim().toLowerCase() === 'zs');
  const [isSnapshotsOpen, setIsSnapshotsOpen] = useState(false);
  const summaryPairs = formatSummaryPairs(backupResult);
  const resolvedFolder = backupFolderPathDraft || backupConfigQuery.data?.folderPath || backupConfigQuery.data?.defaultFolderPath || 'D:\\ZS Backups';
  const autoState = backupConfigQuery.data?.automation;
  const weeklyDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  return (
    <div className="page-stack" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Backup & System Health Section */}
      <QueryCard
        className="settings-admin-card"
        title={t('settings.workspace_sections.settings_backup_import_section.s86', "النسخ الاحتياطي والأمان")}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="nav-pill" style={{ background: autoBackupEnabled ? '#ecfdf5' : '#f1f5f9', color: autoBackupEnabled ? '#047857' : '#64748b', border: autoBackupEnabled ? '1px solid #a7f3d0' : '1px solid #e2e8f0', fontSize: '0.74rem', fontWeight: 700 }}>
              {t('settings.workspace_sections.settings_backup_import_section.s87', "النسخ التلقائي:")} {autoBackupEnabled ? t('settings.workspace_sections.settings_backup_import_section.s88', "مفعّل") : t('settings.workspace_sections.settings_backup_import_section.s89', "متوقف")}
            </span>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Top Quick Actions Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', width: '100%' }}>
              <Button
                type="button"
                onClick={handleBackupDownload}
                disabled={backupBusy || !canManageBackups}
                style={{ background: '#0f172a', color: '#ffffff', fontSize: '0.82rem', padding: '7px 14px', fontWeight: 700, flex: '1 1 auto', minWidth: '160px' }}
              >
                {t('settings.workspace_sections.settings_backup_import_section.s90', "تنزيل نسخة احتياطية")}
              </Button>

              {(isDesktopOffline || isPlatformSuperAdmin) && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void saveBackupFileToFolderNow()}
                  disabled={backupBusy || !canManageBackups}
                  style={{ fontSize: '0.80rem', padding: '7px 12px', flex: '1 1 auto' }}
                >
                  {t('settings.workspace_sections.settings_backup_import_section.s91', "حفظ نسخة بالمجلد")}
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                onClick={handleSupportBundleDownload}
                disabled={backupBusy || !canManageBackups}
                style={{ fontSize: '0.80rem', padding: '7px 12px', flex: '1 1 auto' }}
              >
                {t('settings.workspace_sections.settings_backup_import_section.s92', "حزمة الدعم")}
              </Button>
            </div>

            {(isDesktopOffline || isPlatformSuperAdmin) && (
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_backup_import_section.s93', "المسار الافتراضي:")} <strong style={{ color: '#0f172a' }}>{resolvedFolder}</strong>
              </span>
            )}
          </div>

          {/* 2-Column Balanced Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px' }}>
            {/* Column 1: Automated Backups & Folder Config */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                {isDesktopOffline || isPlatformSuperAdmin ? t('settings.workspace_sections.settings_backup_import_section.s94', "إعدادات النسخ التلقائي ومجلد الحفظ") : t('settings.workspace_sections.settings_backup_import_section.s95', "النسخ الاحتياطي التلقائي")}
              </strong>

              {/* Folder Path Row */}
              {(isDesktopOffline || isPlatformSuperAdmin) ? (
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s96', "مسار مجلد النسخ الاحتياطية على السيرفر")}
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      value={backupFolderPathDraft}
                      placeholder={t('settings.workspace_sections.settings_backup_import_section.s97', "مثال: D:\\ZS Backups")}
                      onChange={(event) => setBackupFolderPathDraft(event.target.value)}
                      disabled={backupBusy || !canManageBackups}
                      style={{ flex: 1, padding: '7px 12px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', outline: 'none' }}
                    />
                    <Button type="button" variant="secondary" onClick={() => void testBackupFolder()} disabled={backupBusy || !canManageBackups} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                      {t('settings.workspace_sections.settings_backup_import_section.s98', "اختبار")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void saveBackupConfig()} disabled={backupBusy || !canManageBackups} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                      {t('settings.workspace_sections.settings_backup_import_section.s99', "حفظ")}
                    </Button>
                  </div>

                  {/* Cloud & Drive Quick Presets */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>{t('settings.workspace_sections.settings_backup_import_section.s100', "سحابة / اختصارات سريعة:")}</span>
                    {[
                      { label: 'Google Drive', path: 'C:\\Users\\Public\\Google Drive\\ZS Backups' },
                      { label: 'OneDrive', path: 'C:\\Users\\Public\\OneDrive\\ZS Backups' },
                      { label: 'Dropbox', path: 'C:\\Users\\Public\\Dropbox\\ZS Backups' },
                      { label: t('settings.workspace_sections.settings_backup_import_section.s101', "قرص D:"), path: 'D:\\ZS Backups' },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setBackupFolderPathDraft(p.path)}
                        style={{
                          background: backupFolderPathDraft === p.path ? '#e0f2fe' : '#ffffff',
                          border: '1px solid #cbd5e1',
                          color: backupFolderPathDraft === p.path ? '#0369a1' : '#334155',
                          borderRadius: '4px',
                          padding: '2px 7px',
                          fontSize: '0.70rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                    {t('settings.workspace_sections.settings_backup_import_section.s102', "ملاحظة: عند اختيار مجلد مزامنة سحابية لـ (Google Drive أو OneDrive أو Dropbox)، تُرفع النسخ للسحابة تلقائياً لحظة إنشائها لحماية بياناتك من أي عطل بالهارد ديسك.")}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s103', "يتم حفظ وتأمين نسخ احتياطية دورية لقاعدة بيانات المنشأة تلقائياً على خوادم السحابة المشفرة لضمان استمرارية الأعمال وحماية البيانات.")}
                </div>
              )}

              {/* Automation Schedule Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: backupFrequencyDraft === 'weekly' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_backup_import_section.s104', "الحالة")}</label>
                  <select
                    value={backupAutoEnabledDraft ? 'on' : 'off'}
                    onChange={(event) => setBackupAutoEnabledDraft(event.target.value === 'on')}
                    disabled={backupBusy || !canManageBackups}
                    style={{ width: '100%', padding: '6px 8px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    <option value="on">{t('settings.workspace_sections.settings_backup_import_section.s105', "مفعّل")}</option>
                    <option value="off">{t('settings.workspace_sections.settings_backup_import_section.s106', "متوقف")}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_backup_import_section.s107', "التكرار")}</label>
                  <select
                    value={backupFrequencyDraft}
                    onChange={(event) => setBackupFrequencyDraft(event.target.value === 'weekly' ? 'weekly' : 'daily')}
                    disabled={backupBusy || !canManageBackups}
                    style={{ width: '100%', padding: '6px 8px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    <option value="daily">{t('settings.workspace_sections.settings_backup_import_section.s108', "يومي")}</option>
                    <option value="weekly">{t('settings.workspace_sections.settings_backup_import_section.s109', "أسبوعي")}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_backup_import_section.s110', "وقت النسخ")}</label>
                  <input
                    type="time"
                    value={backupTimeDraft || '03:00'}
                    onChange={(event) => setBackupTimeDraft(event.target.value || '03:00')}
                    disabled={backupBusy || !canManageBackups}
                    style={{ width: '100%', padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', boxSizing: 'border-box' }}
                  />
                </div>

                {backupFrequencyDraft === 'weekly' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_backup_import_section.s111', "اليوم")}</label>
                    <select
                      value={backupWeeklyDayDraft}
                      onChange={(event) => setBackupWeeklyDayDraft(Number(event.target.value || 0))}
                      disabled={backupBusy || !canManageBackups}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                    >
                      {weeklyDays.map((label, index) => <option key={label} value={index}>{label}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Status Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.76rem', color: '#64748b', background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '6px', padding: '6px 10px', marginTop: 'auto' }}>
                <span>{t('settings.workspace_sections.settings_backup_import_section.s112', "آخر نسخة ناجحة:")} <strong style={{ color: '#0f172a' }}>{autoState?.lastSuccessAt ? new Date(autoState.lastSuccessAt).toLocaleString('ar-EG') : t('settings.workspace_sections.settings_backup_import_section.s113', "لا يوجد")}</strong></span>
                <span>{t('settings.workspace_sections.settings_backup_import_section.s114', "الحالة:")} <strong style={{ color: autoState?.lastAttemptStatus === 'success' ? '#16a34a' : autoState?.lastAttemptStatus === 'failed' ? '#dc2626' : '#64748b' }}>{autoState?.lastAttemptStatus === 'success' ? t('settings.workspace_sections.settings_backup_import_section.s115', "ناجحة") : autoState?.lastAttemptStatus === 'failed' ? t('settings.workspace_sections.settings_backup_import_section.s116', "فشلت") : '—'}</strong></span>
              </div>
            </div>

            {/* Column 2: Restore, Verification & Optimization */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                  {t('settings.workspace_sections.settings_backup_import_section.s117', "فحص واستعادة النسخ الاحتياطية")}
                </strong>
                <button
                  type="button"
                  onClick={() => setIsSnapshotsOpen(!isSnapshotsOpen)}
                  style={{ fontSize: '0.76rem', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#1e293b', cursor: 'pointer' }}
                >
                  {isSnapshotsOpen ? t('settings.workspace_sections.settings_backup_import_section.s118', "إخفاء سجل اللقطات ▲") : `سجل اللقطات (${snapshots.length}) ▼`}
                </button>
              </div>

              {/* Custom File Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px', background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s ease' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>{t('settings.workspace_sections.settings_backup_import_section.s119', "فحص ملف نسخة")}</span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t('settings.workspace_sections.settings_backup_import_section.s120', "للتأكد من سلامة الملف")}</span>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    accept=".zip,application/zip,application/json,.json"
                    disabled={!canManageBackups || backupBusy}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleBackupFile(file, 'verify'); e.currentTarget.value = ''; }}
                  />
                </label>

                {canRestore && canManageBackups ? (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px', background: '#ffffff', border: '1px dashed #fca5a5', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s ease' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#b91c1c' }}>{t('settings.workspace_sections.settings_backup_import_section.s121', "استعادة من ملف")}</span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t('settings.workspace_sections.settings_backup_import_section.s122', "تستبدل البيانات الحالية")}</span>
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      accept=".zip,application/zip,application/json,.json"
                      disabled={!canManageBackups || backupBusy}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) onRequestRestoreFile(file); e.currentTarget.value = ''; }}
                    />
                  </label>
                ) : isPlatformTenant ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#170e5e' }}>المنصة المركزية محصنة</span>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>محمية ضد استرجاع بيانات المتاجر</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center', opacity: 0.8, cursor: 'not-allowed' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>{t('settings.workspace_sections.settings_backup_import_section.s123', "استعادة من ملف")}</span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      {t('settings.workspace_sections.settings_backup_import_section.s124', "خاص بالإدارة")}
                    </span>
                  </div>
                )}
              </div>

              {/* Backup Message feedback */}
              {backupMessage && (
                <div style={{
                  background: backupMessageKind === 'error' ? '#fef2f2' : '#ecfdf5',
                  border: backupMessageKind === 'error' ? '1px solid #fca5a5' : '1px solid #a7f3d0',
                  color: backupMessageKind === 'error' ? '#b91c1c' : '#047857',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}>
                  {backupMessage}
                </div>
              )}

              {/* Summary Pairs if verified */}
              {summaryPairs.length > 0 && (
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 12px', maxHeight: '120px', overflowY: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.75rem' }}>
                    {summaryPairs.map((item) => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ color: '#64748b' }}>{item.label}:</span>
                        <strong style={{ color: '#0f172a' }}>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Snapshots Drawer if open */}
          {isSnapshotsOpen && (
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', maxHeight: '280px', overflowY: 'auto' }}>
              <SnapshotList
                snapshots={snapshots}
                onDownload={handleSnapshotDownload}
                onRestore={canRestore && canManageBackups ? onRequestRestoreSnapshot : () => undefined}
                restoringId={restoreSnapshotId}
              />
            </div>
          )}
        </div>
      </QueryCard>

      {/* Cloud S3 Backup Card (Super Admin only) */}
      {isPlatformSuperAdmin && <CloudBackupSettingsCard canManage={isPlatformSuperAdmin} />}

      {/* Demo Data Engine & Factory Reset Card (Super Admin only) */}
      {isPlatformSuperAdmin && <DemoDataSandboxCard />}

      {/* Database Maintenance Strip (Super Admin only) */}
      {isPlatformSuperAdmin && <DatabaseOptimizationCard canManage={isPlatformSuperAdmin} />}

      {/* Move this business between the cloud and the desktop app */}
      <TenantTransferCard canManage={canManageBackups || user?.role === 'super_admin'} />

      {/* Inventory Stock Reset & Catalog Wipe for Operational Setup (Admin & Super Admin - Retail/Inventory Verticals Only) */}
      {!isMaritime && <InventoryOperationsResetCard canManage={canRestore} />}

      {/* Import / Export Workbench */}
      <QueryCard
        className="settings-admin-card settings-import-card"
        title={isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s125', "استيراد وتصدير بيانات الشحن والعملاء") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s126', "استيراد وتصدير بيانات المقاولات") : t('settings.workspace_sections.settings_backup_import_section.s127', "استيراد وتصدير البيانات")}
        actions={<span className="nav-pill">{t('settings.workspace_sections.settings_backup_import_section.s128', "ملفات Excel / CSV")}</span>}
      >
        <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: isMaritime ? 'repeat(auto-fit, minmax(320px, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
          {!canManageBackups ? <div className="muted small" style={{ gridColumn: '1 / -1' }}>{t('settings.workspace_sections.settings_backup_import_section.s129', "إدارة النسخ الاحتياطي والاسترداد غير متاحة لهذا الحساب.")}</div> : null}
          <ImportWorkbench
            title={isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s130', "استيراد بنود وتعريفات خدمات الشحن والنولون") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s131', "استيراد بنود المقايسة وتكاليف المشروعات") : t('settings.workspace_sections.settings_backup_import_section.s132', "استيراد الأصناف")}
            requiredColumns={[isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s133', "اسم الخدمة / البند") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s134', "اسم البند") : t('settings.workspace_sections.settings_backup_import_section.s135', "اسم الصنف")]}
            requiredFieldKeys={['name']}
            fieldMappings={[
              { key: 'name', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s136', "اسم الخدمة / البند") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s137', "اسم البند") : t('settings.workspace_sections.settings_backup_import_section.s138', "اسم الصنف"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s139', "اسم الصنف (إجباري)"), t('settings.workspace_sections.settings_backup_import_section.s140', "اسم الخدمة"), t('settings.workspace_sections.settings_backup_import_section.s141', "اسم البند"), t('settings.workspace_sections.settings_backup_import_section.s142', "اسم الصنف"), t('settings.workspace_sections.settings_backup_import_section.s143', "الاسم"), 'name'] },
              { key: 'nameEn', label: t('settings.workspace_sections.settings_backup_import_section.s329', "اسم الصنف (إنجليزي)"), aliases: ['nameEn', 'name_en', t('settings.workspace_sections.settings_backup_import_section.s330', "الاسم الإنجليزي"), t('settings.workspace_sections.settings_backup_import_section.s331', "English name")] },
              { key: 'categoryName', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s144', "التصنيف اللوجستي") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s145', "المجموعة / المرحلة") : t('settings.workspace_sections.settings_backup_import_section.s146', "الصنف"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s147', "القسم"), 'category', t('settings.workspace_sections.settings_backup_import_section.s148', "التصنيف")] },
              { key: 'supplierName', label: t('settings.workspace_sections.settings_backup_import_section.s149', "المورد"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s150', "المورد"), t('settings.workspace_sections.settings_backup_import_section.s151', "اسم المورد"), 'supplier', 'supplierName'] },
              { key: 'itemType', label: t('settings.workspace_sections.settings_backup_import_section.s152', "النوع"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s153', "النوع"), t('settings.workspace_sections.settings_backup_import_section.s154', "تصنيف"), 'type', 'itemType', 'item_type'] },
              { key: 'barcode', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s155', "كود التعريفة") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s156', "كود البند") : t('settings.workspace_sections.settings_backup_import_section.s157', "الباركود"), aliases: ['barcode', t('settings.workspace_sections.settings_backup_import_section.s158', "كود"), 'code'] },
              { key: 'costPrice', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s159', "التكلفة المرجعية") : t('settings.workspace_sections.settings_backup_import_section.s160', "التكلفة"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s161', "سعر التكلفة"), 'cost', 'cost_price'] },
              { key: 'retailPrice', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s162', "سعر الخدمة / النولون") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s163', "فئة البند التعاقدية") : t('settings.workspace_sections.settings_backup_import_section.s164', "السعر"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s165', "سعر البيع"), 'price', 'retail_price', t('settings.workspace_sections.settings_backup_import_section.s166', "تعريفة")] },
              { key: 'wholesalePrice', label: t('settings.workspace_sections.settings_backup_import_section.s167', "سعر الجملة"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s168', "سعر الجملة"), t('settings.workspace_sections.settings_backup_import_section.s169', "الجملة"), 'wholesalePrice', 'wholesale_price'] },
              { key: 'minStockQty', label: t('settings.workspace_sections.settings_backup_import_section.s170', "الحد الأدنى"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s171', "الحد الأدنى"), t('settings.workspace_sections.settings_backup_import_section.s172', "حد الطلب"), 'minStockQty', 'minQty', 'min_stock'] },
              { key: 'stockQty', label: t('settings.workspace_sections.settings_backup_import_section.s173', "الكمية الافتتاحية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s174', "الكمية"), 'stock', 'stockQty', 'qty'] },
              { key: 'warehouseName', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s175', "الميناء / المحطة") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s176', "موقع التشوين") : t('settings.workspace_sections.settings_backup_import_section.s177', "المخزن"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s178', "المخزن"), 'warehouse', 'store', t('settings.workspace_sections.settings_backup_import_section.s179', "الميناء")] },
              { key: 'unitName', label: t('settings.workspace_sections.settings_backup_import_section.s180', "وحدة القياس الأساسية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s181', "وحدة القياس الأساسية"), t('settings.workspace_sections.settings_backup_import_section.s182', "وحدة القياس"), t('settings.workspace_sections.settings_backup_import_section.s183', "الوحدة الأساسية"), t('settings.workspace_sections.settings_backup_import_section.s184', "الوحدة"), 'unit', 'unitName', t('settings.workspace_sections.settings_backup_import_section.s185', "القياس")] },
              { key: 'saleUnit', label: t('settings.workspace_sections.settings_backup_import_section.s186', "وحدة البيع"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s187', "وحدة البيع"), 'saleUnit', 'sale_unit'] },
              { key: 'purchaseUnit', label: t('settings.workspace_sections.settings_backup_import_section.s188', "وحدة الشراء"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s189', "وحدة الشراء"), 'purchaseUnit', 'purchase_unit'] },
              { key: 'extraUnitName', label: t('settings.workspace_sections.settings_backup_import_section.s190', "اسم وحدة إضافية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s191', "اسم وحدة إضافية"), t('settings.workspace_sections.settings_backup_import_section.s192', "وحدة إضافية"), t('settings.workspace_sections.settings_backup_import_section.s193', "الوحدة الكبرى"), t('settings.workspace_sections.settings_backup_import_section.s194', "اسم الوحدة الكبرى"), 'extraUnit', 'extraUnitName', 'extra_unit'] },
              { key: 'extraUnitMultiplier', label: t('settings.workspace_sections.settings_backup_import_section.s195', "معامل الوحدة الإضافية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s196', "معامل الوحدة الإضافية"), t('settings.workspace_sections.settings_backup_import_section.s197', "معامل التحويل"), t('settings.workspace_sections.settings_backup_import_section.s198', "معامل الوحدة"), t('settings.workspace_sections.settings_backup_import_section.s199', "التحويل"), t('settings.workspace_sections.settings_backup_import_section.s200', "المعامل"), t('settings.workspace_sections.settings_backup_import_section.s201', "عدد القطع في الوحدة الكبرى"), 'extraUnitMultiplier', 'multiplier', 'factor'] },
              { key: 'extraUnitBarcode', label: t('settings.workspace_sections.settings_backup_import_section.s202', "باركود الوحدة الإضافية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s203', "باركود الوحدة الإضافية"), t('settings.workspace_sections.settings_backup_import_section.s204', "باركود الوحدة"), t('settings.workspace_sections.settings_backup_import_section.s205', "باركود الكرتونة"), 'extraUnitBarcode', 'extra_barcode'] },
              { key: 'notes', label: t('settings.workspace_sections.settings_backup_import_section.s206', "ملاحظات"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s207', "ملاحظات"), t('settings.workspace_sections.settings_backup_import_section.s208', "الوصف"), 'notes', 'description'] },

            ]}
            onDownloadTemplate={() => downloadTemplate('products')}
            onExportData={onExportData ? () => onExportData('products') : undefined}
            onImportRows={importProducts}
            isPending={importProductsPending || !canManageBackups}
          />
          {!isMaritime && (
            <ImportWorkbench
              title={isContracting ? t('settings.workspace_sections.settings_backup_import_section.s209', "استيراد رصيد تشوينات الموقع الافتتاحي") : t('settings.workspace_sections.settings_backup_import_section.s210', "استيراد/تعديل المخزون")}
              requiredColumns={[t('settings.workspace_sections.settings_backup_import_section.s211', "الكمية")]}
              requiredFieldKeys={['qty']}
              fieldMappings={[
                { key: 'barcode', label: t('settings.workspace_sections.settings_backup_import_section.s212', "الباركود"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s213', "الباركود"), 'barcode', t('settings.workspace_sections.settings_backup_import_section.s214', "كود")] },
                { key: 'name', label: t('settings.workspace_sections.settings_backup_import_section.s215', "اسم الصنف"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s216', "اسم الصنف (إجباري)"), t('settings.workspace_sections.settings_backup_import_section.s217', "اسم الصنف"), 'name'] },
                { key: 'qty', label: t('settings.workspace_sections.settings_backup_import_section.s218', "الكمية"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s219', "الكمية"), 'qty', 'quantity', 'stock'] },
                { key: 'warehouseName', label: isContracting ? t('settings.workspace_sections.settings_backup_import_section.s220', "موقع التشوين") : t('settings.workspace_sections.settings_backup_import_section.s221', "المخزن"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s222', "المخزن"), 'warehouse', 'store'] },
              ]}
              onDownloadTemplate={() => downloadTemplate('opening-stock')}
              onExportData={onExportData ? () => onExportData('opening-stock') : undefined}
              onImportRows={importOpeningStock}
              isPending={importOpeningStockPending || !canManageBackups}
            />
          )}
          <ImportWorkbench
            title={isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s223', "استيراد العملاء والمشحون إليهم (Shippers & Consignees)") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s224', "استيراد جهات الإسناد والملاك") : t('settings.workspace_sections.settings_backup_import_section.s225', "استيراد العملاء والمحلات")}
            requiredColumns={[t('settings.workspace_sections.settings_backup_import_section.s226', "اسم العميل")]}
            requiredFieldKeys={['name']}
            fieldMappings={[
              { key: 'name', label: t('settings.workspace_sections.settings_backup_import_section.s227', "اسم العميل / المحل"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s228', "اسم العميل (إجباري)"), t('settings.workspace_sections.settings_backup_import_section.s229', "اسم العميل / المحل (إجباري)"), t('settings.workspace_sections.settings_backup_import_section.s230', "اسم العميل / المحل"), t('settings.workspace_sections.settings_backup_import_section.s231', "اسم العميل"), t('settings.workspace_sections.settings_backup_import_section.s232', "اسم المحل"), t('settings.workspace_sections.settings_backup_import_section.s233', "العميل"), t('settings.workspace_sections.settings_backup_import_section.s234', "المحل"), t('settings.workspace_sections.settings_backup_import_section.s235', "الاسم"), 'name'] },
              { key: 'customerCode', label: t('settings.workspace_sections.settings_backup_import_section.s236', "كود المحل / العميل"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s237', "كود المحل / العميل"), t('settings.workspace_sections.settings_backup_import_section.s238', "كود العميل"), t('settings.workspace_sections.settings_backup_import_section.s239', "كود المحل"), t('settings.workspace_sections.settings_backup_import_section.s240', "كود المحل الفريد"), t('settings.workspace_sections.settings_backup_import_section.s241', "الكود"), 'customerCode', 'customer_code', 'code'] },
              { key: 'phone', label: t('settings.workspace_sections.settings_backup_import_section.s242', "الموبايل"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s243', "رقم الموبايل"), t('settings.workspace_sections.settings_backup_import_section.s244', "الموبايل"), t('settings.workspace_sections.settings_backup_import_section.s245', "الهاتف"), 'phone', 'mobile'] },
              { key: 'route', label: t('settings.workspace_sections.settings_backup_import_section.s246', "خط السير"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s247', "خط السير / مسار التوزيع"), t('settings.workspace_sections.settings_backup_import_section.s248', "خط السير / المنطقة"), t('settings.workspace_sections.settings_backup_import_section.s249', "خط السير"), t('settings.workspace_sections.settings_backup_import_section.s250', "مسار التوزيع"), 'route'] },
              { key: 'district', label: t('settings.workspace_sections.settings_backup_import_section.s251', "الحي / المربع السكني"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s252', "الحي / المربع السكني"), t('settings.workspace_sections.settings_backup_import_section.s253', "الحي"), t('settings.workspace_sections.settings_backup_import_section.s254', "المنطقة"), t('settings.workspace_sections.settings_backup_import_section.s255', "المربع السكني"), 'district', 'area'] },
              { key: 'address', label: t('settings.workspace_sections.settings_backup_import_section.s256', "العنوان التفصيلي"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s257', "العنوان التفصيلي"), t('settings.workspace_sections.settings_backup_import_section.s258', "العنوان"), 'address'] },
              { key: 'visitDay', label: t('settings.workspace_sections.settings_backup_import_section.s259', "يوم الزيارة الأسبوعي"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s260', "يوم الزيارة الأسبوعي"), t('settings.workspace_sections.settings_backup_import_section.s261', "يوم الزيارة"), 'visitDay', 'visit_day'] },
              { key: 'visitDays', label: t('settings.workspace_sections.settings_backup_import_section.s262', "أيام الزيارة"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s263', "أيام الزيارة (إن تعددت)"), t('settings.workspace_sections.settings_backup_import_section.s264', "أيام الزيارة"), 'visitDays', 'visit_days'] },
              { key: 'routeSequence', label: t('settings.workspace_sections.settings_backup_import_section.s265', "ترتيب خط السير"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s266', "ترتيب خط السير"), t('settings.workspace_sections.settings_backup_import_section.s267', "ترتيب الزيارة"), t('settings.workspace_sections.settings_backup_import_section.s268', "التسلسل"), 'routeSequence', 'route_sequence', 'sequence'] },
              { key: 'assignedRepName', label: t('settings.workspace_sections.settings_backup_import_section.s269', "المندوب المخصص"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s270', "المندوب المسؤول / المخصص"), t('settings.workspace_sections.settings_backup_import_section.s271', "المندوب المسؤول"), t('settings.workspace_sections.settings_backup_import_section.s272', "المندوب المخصص"), t('settings.workspace_sections.settings_backup_import_section.s273', "المندوب"), 'assignedRep', 'assignedRepName', 'rep'] },
              { key: 'locationUrl', label: t('settings.workspace_sections.settings_backup_import_section.s274', "رابط الموقع / GPS"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s275', "رابط الموقع / GPS"), t('settings.workspace_sections.settings_backup_import_section.s276', "رابط الموقع"), t('settings.workspace_sections.settings_backup_import_section.s277', "رابط الخريطة"), t('settings.workspace_sections.settings_backup_import_section.s278', "موقع المحل"), 'locationUrl', 'location_url', 'maps', 'gps'] },
              { key: 'priceTier', label: t('settings.workspace_sections.settings_backup_import_section.s279', "فئة السعر"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s280', "فئة السعر"), t('settings.workspace_sections.settings_backup_import_section.s281', "فئة التسعير"), t('settings.workspace_sections.settings_backup_import_section.s282', "قائمة الأسعار"), 'priceTier', 'price_tier'] },
              { key: 'category', label: t('settings.workspace_sections.settings_backup_import_section.s283', "نوع النشاط / التصنيف"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s284', "نوع النشاط / التصنيف"), t('settings.workspace_sections.settings_backup_import_section.s285', "نوع النشاط"), t('settings.workspace_sections.settings_backup_import_section.s286', "تصنيف المحل"), t('settings.workspace_sections.settings_backup_import_section.s287', "التصنيف"), 'category', 'businessType'] },
              { key: 'type', label: t('settings.workspace_sections.settings_backup_import_section.s288', "النوع"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s289', "نوع العميل (نقدي / آجل)"), t('settings.workspace_sections.settings_backup_import_section.s290', "نوع العميل"), t('settings.workspace_sections.settings_backup_import_section.s291', "النوع"), 'type'] },
              { key: 'creditLimit', label: t('settings.workspace_sections.settings_backup_import_section.s292', "الحد الائتماني"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s293', "الحد الائتماني"), 'creditLimit'] },
              { key: 'openingBalance', label: t('settings.workspace_sections.settings_backup_import_section.s294', "رصيد افتتاحي"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s295', "رصيد افتتاحي"), 'openingBalance', 'balance'] },
              { key: 'storeCreditBalance', label: t('settings.workspace_sections.settings_backup_import_section.s296', "رصيد محفظة"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s297', "رصيد محفظة"), 'storeCreditBalance'] },
              { key: 'companyName', label: t('settings.workspace_sections.settings_backup_import_section.s298', "اسم المنشأة / الشركة"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s299', "اسم المنشأة / الشركة"), t('settings.workspace_sections.settings_backup_import_section.s300', "اسم الشركة"), t('settings.workspace_sections.settings_backup_import_section.s301', "اسم المنشأة"), 'companyName'] },
              { key: 'taxNumber', label: t('settings.workspace_sections.settings_backup_import_section.s302', "الرقم الضريبي"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s303', "الرقم الضريبي"), t('settings.workspace_sections.settings_backup_import_section.s304', "البطاقة الضريبية"), 'taxNumber'] },
              { key: 'notes', label: t('settings.workspace_sections.settings_backup_import_section.s305', "ملاحظات"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s306', "ملاحظات"), 'notes'] },
            ]}
            onDownloadTemplate={() => downloadTemplate('customers')}
            templateOptions={[
              {
                label: t('settings.workspace_sections.settings_backup_import_section.s307', "قالب تجزئة ونقدي"),
                onDownload: () => downloadTemplate('customers-retail'),
                description: t('settings.workspace_sections.settings_backup_import_section.s308', "تحميل نموذج Excel مخصص لعملاء التجزئة والقطاعي"),
              },
              {
                label: t('settings.workspace_sections.settings_backup_import_section.s309', "قالب جملة وتوزيع (فان)"),
                variant: 'primary',
                onDownload: () => downloadTemplate('customers-van'),
                description: t('settings.workspace_sections.settings_backup_import_section.s310', "تحميل نموذج Excel شامل لعملاء الجملة والتوزيع الميداني وخطوط السير"),
              },
            ]}
            onExportData={onExportData ? () => onExportData('customers') : undefined}
            onImportRows={importCustomers}
            isPending={importCustomersPending || !canManageBackups}
          />
          <ImportWorkbench
            title={isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s311', "استيراد الخطوط الملاحية والوكلاء والناقلين") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s312', "استيراد الموردين ومقاولي الباطن") : t('settings.workspace_sections.settings_backup_import_section.s313', "استيراد الموردين")}
            requiredColumns={[t('settings.workspace_sections.settings_backup_import_section.s314', "اسم المورد")]}
            requiredFieldKeys={['name']}
            fieldMappings={[
              { key: 'name', label: isMaritime ? t('settings.workspace_sections.settings_backup_import_section.s315', "اسم الخط الملاحي / المورد") : isContracting ? t('settings.workspace_sections.settings_backup_import_section.s316', "اسم المورد / مقاول الباطن") : t('settings.workspace_sections.settings_backup_import_section.s317', "اسم المورد"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s318', "اسم المورد (إجباري)"), t('settings.workspace_sections.settings_backup_import_section.s319', "اسم المورد"), t('settings.workspace_sections.settings_backup_import_section.s320', "الاسم"), 'name'] },
              { key: 'phone', label: t('settings.workspace_sections.settings_backup_import_section.s321', "الموبايل"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s322', "رقم الموبايل"), 'phone'] },
              { key: 'address', label: t('settings.workspace_sections.settings_backup_import_section.s323', "العنوان"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s324', "العنوان"), 'address'] },
              { key: 'openingBalance', label: t('settings.workspace_sections.settings_backup_import_section.s325', "رصيد افتتاحي"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s326', "رصيد افتتاحي"), 'openingBalance'] },
              { key: 'notes', label: t('settings.workspace_sections.settings_backup_import_section.s327', "ملاحظات"), aliases: [t('settings.workspace_sections.settings_backup_import_section.s328', "ملاحظات"), 'notes'] },
            ]}
            onDownloadTemplate={() => downloadTemplate('suppliers')}
            onExportData={onExportData ? () => onExportData('suppliers') : undefined}
            onImportRows={importSuppliers}
            isPending={importSuppliersPending || !canManageBackups}
          />
        </div>
      </QueryCard>
    </div>
  );
}
