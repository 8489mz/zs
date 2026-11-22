import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { ImportWorkbench } from '@/features/settings/components/ImportWorkbench';
import { SnapshotList, type BackupSnapshotRecord } from '@/features/settings/components/SettingsWorkspacePrimitives';
import { type BackupConfigResponse } from '@/features/settings/api/settings.api';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin, isDesktopOfflineApp } from '@/shared/system/runtime-environment';

import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { TenantTransferCard } from './TenantTransferCard';
import { DatabaseOptimizationCard } from './settings-backup-import/database-optimization-card';
import { CloudBackupSettingsCard } from './settings-backup-import/cloud-backup-settings-card';
import { DemoDataSandboxCard } from './settings-backup-import/demo-data-sandbox-card';
import { InventoryOperationsResetCard } from './settings-backup-import/inventory-operations-reset-card';


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
  // Settings permission also unlocks the support-bundle download (the
  // endpoint accepts settings / canManageSettings, not just canManageBackups).
  canDownloadSupportBundle?: boolean;
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
  canDownloadSupportBundle: canDownloadSupportBundleProp,
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
  // The stored "on" flag alone must never render as an active schedule: the
  // scheduler only ever runs on desktop (SettingsBackupService.onModuleInit
  // returns early on cloud). Fall back to the local runtime check when an
  // older backend payload omits the field.
  const schedulerAvailable = autoState?.schedulerAvailable ?? isDesktopOffline;
  const pillActive = schedulerAvailable && autoBackupEnabled;
  const canDownloadSupportBundle = canDownloadSupportBundleProp ?? canManageBackups;
  const weeklyDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  return (
    <div className="page-stack" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Backup & System Health Section */}
      <QueryCard
        className="settings-admin-card"
        title={t('settings.workspace_sections.settings_backup_import_section.s86', "النسخ الاحتياطي والأمان")}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="nav-pill" style={{ background: pillActive ? '#ecfdf5' : '#f1f5f9', color: pillActive ? '#047857' : '#64748b', border: pillActive ? '1px solid #a7f3d0' : '1px solid #e2e8f0', fontSize: '0.74rem', fontWeight: 700 }}>
              {t('settings.workspace_sections.settings_backup_import_section.s87', "النسخ التلقائي:")} {schedulerAvailable ? (autoBackupEnabled ? t('settings.workspace_sections.settings_backup_import_section.s88', "مفعّل") : t('settings.workspace_sections.settings_backup_import_section.s89', "متوقف")) : t('settings.workspace_sections.settings_backup_import_section.s332', "غير متاح على السحابة")}
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
                disabled={backupBusy || !canDownloadSupportBundle}
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
                  {t('settings.workspace_sections.settings_backup_import_section.s103', "النسخ التلقائي المجدول يعمل على نسخة الديسكتوب فقط ولا يعمل على هذا المستأجر السحابي — لعمل نسخة الآن استخدم زر «تنزيل نسخة احتياطية».")}
                </div>
              )}

              {/* Automation Schedule Grid — desktop only: the scheduler never runs on cloud */}
              {schedulerAvailable && (
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
              )}

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
