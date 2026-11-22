import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/shared/system/runtime-environment';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';

export function DemoDataSandboxCard() {
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
