import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { http } from '@/lib/http';
import { useQuery, useMutation } from '@tanstack/react-query';

export function DatabaseOptimizationCard({ canManage }: { canManage: boolean }) {
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
