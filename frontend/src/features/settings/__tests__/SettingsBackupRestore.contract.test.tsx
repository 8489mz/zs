import {renderHook, act, render} from '@testing-library/react';
import { useSettingsAdminWorkspace } from '../hooks/useSettingsAdminWorkspace';
import { settingsApi } from '../api/settings.api';
import { SettingsBackupImportSection } from '../components/workspace-sections/SettingsBackupImportSection';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as browserLib from '@/lib/browser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost')
}));

vi.mock('../api/settings.api', () => ({
  settingsApi: {
    verifyBackup: vi.fn().mockResolvedValue({ valid: true }),
    restoreBackup: vi.fn().mockResolvedValue({ restored: true }),
    backupDownloadUrl: vi.fn().mockReturnValue('/api/backup/download'),
    diagnostics: vi.fn(),
    maintenanceReport: vi.fn(),
    launchReadiness: vi.fn(),
    uatReadiness: vi.fn(),
    operationalReadiness: vi.fn(),
    supportSnapshot: vi.fn(),
    backupSnapshots: vi.fn(),
    backupConfig: vi.fn()
  }
}));

vi.mock('@/lib/browser', () => ({
  triggerDownload: vi.fn(),
  downloadJsonFile: vi.fn()
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector) => {
    return selector({ user: { username: 'testuser', role: 'admin' }, storeName: 'teststore' });
  })
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/settings' })
}));

describe('Settings Backup/Restore Contract', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('1. ZIP and JSON payloads are passed directly (no JSON.parse on ZIP)', async () => {
    const { result } = renderHook(() => useSettingsAdminWorkspace('backup'), { wrapper });
    
    // Create a mock ZIP file
    const zipFile = new File(['PK...'], 'backup.zip', { type: 'application/zip' });
    
    // Attempt to restore it
    await act(async () => {
      await result.current.handleBackupFile(zipFile, 'restore');
    });

    // Ensure verify is called
    expect(settingsApi.verifyBackup).toHaveBeenCalledWith(zipFile);
    
    // Ensure restore is called with the file directly, NOT parsed
    expect(settingsApi.restoreBackup).toHaveBeenCalledWith({
      file: zipFile,
      confirmation: 'RESTORE BACKUP'
    }, true); // dry-run
    
    expect(settingsApi.restoreBackup).toHaveBeenCalledWith({
      file: zipFile,
      confirmation: 'RESTORE BACKUP'
    }, false); // actual
  });

  it('2. JSON legacy is still supported via the same direct File payload', async () => {
    const { result } = renderHook(() => useSettingsAdminWorkspace('backup'), { wrapper });
    
    // Create a mock JSON file
    const jsonFile = new File(['{"valid":true}'], 'backup.json', { type: 'application/json' });
    
    await act(async () => {
      await result.current.handleBackupFile(jsonFile, 'restore');
    });

    expect(settingsApi.restoreBackup).toHaveBeenCalledWith({
      file: jsonFile,
      confirmation: 'RESTORE BACKUP'
    }, true);
  });

  it('3. Downloaded backup filename ends with .zip', async () => {
    const { result } = renderHook(() => useSettingsAdminWorkspace('backup'), { wrapper });
    
    // Mock fetch for the blob
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['PK...'], { type: 'application/zip' })),
      text: vi.fn().mockResolvedValue('')
    }) as any;

    await act(async () => {
      await result.current.handleBackupDownload();
    });

    // The triggerDownload should be called with a .zip filename
    expect(browserLib.triggerDownload).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.zip$/));
  });

  it('4. The input accept attribute allows .zip and .json', () => {
    // Mock the hook state needed for the component
    // we need to require the module or spy on it, but vitest mock makes it a bit tricky.
    // Instead we can just render it and we don't care if the inner handlers are mocked if we only check attributes
    render(
      <SettingsBackupImportSection 
        {...({
          canManageBackups: true,
          onRequestRestoreFile: vi.fn(),
          backupConfigQuery: { data: {} },
          snapshots: [],
          handleBackupFile: vi.fn(),
          handleBackupDownload: vi.fn(),
          handleSupportBundleDownload: vi.fn()
        } as any)}
      />, 
      { wrapper }
    );
    
    const fileInputs = document.querySelectorAll('input[type="file"]');
    
    const backupInputs = Array.from(fileInputs).filter(input => {
      const accept = input.getAttribute('accept');
      return accept && accept.includes('application/json');
    });
    
    expect(backupInputs.length).toBe(2);
    
    backupInputs.forEach((input) => {
      const accept = input.getAttribute('accept');
      expect(accept).toContain('.zip');
      expect(accept).toContain('application/zip');
      expect(accept).toContain('.json');
      expect(accept).toContain('application/json');
    });
  });
});
