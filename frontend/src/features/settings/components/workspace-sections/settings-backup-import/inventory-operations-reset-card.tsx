import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { settingsApi } from '@/features/settings/api/settings.api';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';

export function InventoryOperationsResetCard({ canManage }: { canManage: boolean }) {
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
