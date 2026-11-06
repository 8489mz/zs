/* Auto-backup UI honesty (INV-BACKUP-UI-HONESTY): on a cloud tenant the
 * stored auto-backup flag defaults to "on" while the scheduler never
 * runs, so the section must not render the schedule as active. The
 * backend now reports automation.schedulerAvailable (false on cloud,
 * true on desktop); the pill, the cloud note and the schedule grid all
 * follow that field, and the support-bundle button is unlocked by the
 * settings permission too (its endpoint accepts it).
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsBackupImportSection } from '../components/workspace-sections/SettingsBackupImportSection';

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost'),
}));

vi.mock('../api/settings.api', () => ({
  settingsApi: {
    verifyBackup: vi.fn(),
    restoreBackup: vi.fn(),
    backupDownloadUrl: vi.fn().mockReturnValue('/api/backup/download'),
    diagnostics: vi.fn(),
    maintenanceReport: vi.fn(),
    launchReadiness: vi.fn(),
    uatReadiness: vi.fn(),
    operationalReadiness: vi.fn(),
    supportSnapshot: vi.fn(),
    backupSnapshots: vi.fn(),
    backupConfig: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  triggerDownload: vi.fn(),
  downloadJsonFile: vi.fn(),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: any) => selector({ user: { username: 'testuser', role: 'admin' }, storeName: 'teststore' })),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/settings' }),
}));

function renderSection(overrides: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    snapshots: [],
    autoBackupEnabled: true,
    canManageBackups: true,
    backupBusy: false,
    backupConfigQuery: { data: { automation: { enabled: true, schedulerAvailable: false, frequency: 'daily', time: '03:00', weeklyDay: 0 } } },
    backupFolderPathDraft: '',
    setBackupFolderPathDraft: vi.fn(),
    backupAutoEnabledDraft: true,
    setBackupAutoEnabledDraft: vi.fn(),
    backupFrequencyDraft: 'daily',
    setBackupFrequencyDraft: vi.fn(),
    backupTimeDraft: '03:00',
    setBackupTimeDraft: vi.fn(),
    backupWeeklyDayDraft: 0,
    setBackupWeeklyDayDraft: vi.fn(),
    backupSelectedFileName: '',
    backupMessage: '',
    backupMessageKind: 'success',
    backupResult: null,
    restoreSnapshotId: '',
    handleBackupDownload: vi.fn(),
    saveBackupConfig: vi.fn(),
    testBackupFolder: vi.fn(),
    saveBackupFileToFolderNow: vi.fn(),
    handleSupportBundleDownload: vi.fn(),
    handleBackupFile: vi.fn(),
    handleSnapshotDownload: vi.fn(),
    onRequestRestoreFile: vi.fn(),
    onRequestRestoreSnapshot: vi.fn(),
    importProductsPending: false,
    importCustomersPending: false,
    importSuppliersPending: false,
    importOpeningStockPending: false,
    importProducts: vi.fn(),
    importCustomers: vi.fn(),
    importSuppliers: vi.fn(),
    importOpeningStock: vi.fn(),
    ...overrides,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsBackupImportSection {...(props as any)} />
    </QueryClientProvider>,
  );
}

function pillText(): string {
  // The pill text is split across two text nodes inside the span, so a
  // plain getByText match cannot find it; read the pill element directly.
  const pills = Array.from(document.querySelectorAll('.nav-pill'));
  const pill = pills.find((el) => el.textContent?.includes('النسخ التلقائي'));
  return pill?.textContent ?? '';
}

describe('Auto-backup UI honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cloud: pill never says active, schedule grid hidden, honest note shown', () => {
    renderSection();
    expect(pillText()).toContain('غير متاح على السحابة');
    expect(pillText()).not.toContain('مفعّل');
    expect(screen.queryByText('وقت النسخ')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByText(/النسخ التلقائي المجدول يعمل على نسخة الديسكتوب فقط/)).toBeTruthy();
    expect(screen.queryByText(/خوادم السحابة المشفرة/)).toBeNull();
  });

  it('cloud: pill falls back to the cloud label when the field is absent', () => {
    renderSection({
      backupConfigQuery: { data: { automation: { enabled: true, frequency: 'daily', time: '03:00', weeklyDay: 0 } } },
    });
    expect(pillText()).toContain('غير متاح على السحابة');
    expect(screen.queryByText('وقت النسخ')).toBeNull();
  });

  it('desktop: pill says active and the 03:00 schedule grid is shown', () => {
    renderSection({
      backupConfigQuery: { data: { automation: { enabled: true, schedulerAvailable: true, frequency: 'daily', time: '03:00', weeklyDay: 0 } } },
    });
    expect(pillText()).toContain('مفعّل');
    expect(screen.getByText('وقت النسخ')).toBeTruthy();
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement | null;
    expect(timeInput).not.toBeNull();
    expect(timeInput!.value).toBe('03:00');
  });

  it('download button follows canManageBackups', () => {
    const first = renderSection({ canManageBackups: true });
    expect((screen.getByRole('button', { name: /تنزيل نسخة احتياطية/ }) as HTMLButtonElement).disabled).toBe(false);
    first.unmount();
    renderSection({ canManageBackups: false, canDownloadSupportBundle: false });
    expect((screen.getByRole('button', { name: /تنزيل نسخة احتياطية/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('support bundle is enabled by the settings permission even without canManageBackups', () => {
    const first = renderSection({ canManageBackups: false, canDownloadSupportBundle: true });
    expect((screen.getByRole('button', { name: /حزمة الدعم/ }) as HTMLButtonElement).disabled).toBe(false);
    first.unmount();
    renderSection({ canManageBackups: false, canDownloadSupportBundle: false });
    expect((screen.getByRole('button', { name: /حزمة الدعم/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
