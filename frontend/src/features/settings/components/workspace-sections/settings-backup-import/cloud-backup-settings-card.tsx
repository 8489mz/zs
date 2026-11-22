import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { settingsApi } from '@/features/settings/api/settings.api';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';

export function CloudBackupSettingsCard({ canManage }: { canManage: boolean }) {
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
