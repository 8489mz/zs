import { UserManagementSection } from '@/features/settings/components/UserManagementSection';
import {
  SettingsOverviewStats,
  SettingsCoreSection,
  SettingsReferenceSection,
  SettingsBackupImportSection,
  SettingsLanModesSection,
  TaxIntegrationSection,
} from '@/features/settings/components/SettingsWorkspaceSections';
import type { SetupStepKey } from '@/features/settings/hooks/useFirstRunSetupFlow';
import type { BackupConfigQueryState } from '@/features/settings/components/workspace-sections/SettingsBackupImportSection';
import type { Branch, Location, AppSettings } from '@/types/domain';
import type { BackupSnapshotRecord } from '@/features/settings/components/SettingsWorkspacePrimitives';

type QueryState = { isLoading: boolean; isError: boolean; error?: unknown; isSuccess?: boolean; data?: unknown };

export interface SharedSettingsSectionProps {
  currentUserRole: string;
  settings?: AppSettings;
  branches: Branch[];
  locations: Location[];
  filteredBranches: Branch[];
  filteredLocations: Location[];
  branchSearch: string;
  locationSearch: string;
  branchFilter: 'all' | 'with-code' | 'without-code';
  locationFilter: 'all' | 'with-branch' | 'without-branch';
  setBranchSearch: (value: string) => void;
  setLocationSearch: (value: string) => void;
  setBranchFilter: (value: 'all' | 'with-code' | 'without-code') => void;
  setLocationFilter: (value: 'all' | 'with-branch' | 'without-branch') => void;
  resetBranchFilters: () => void;
  resetLocationFilters: () => void;
  copyVisibleBranches: () => Promise<void>;
  copyVisibleLocations: () => Promise<void>;
  settingsQuery: QueryState;
  branchesQuery: QueryState;
  locationsQuery: QueryState;
  snapshots: BackupSnapshotRecord[];
  canManageSettings: boolean;
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
  handleBackupDownload: () => Promise<void>;
  handleSupportBundleDownload: () => Promise<void>;
  saveBackupConfig: () => Promise<void>;
  testBackupFolder: () => Promise<void>;
  saveBackupFileToFolderNow: () => Promise<void>;
  handleBackupFile: (file: File, mode: 'verify' | 'restore') => Promise<void>;
  handleSnapshotDownload: (snapshot: BackupSnapshotRecord) => void;
  onRequestRestoreFile: (file: File) => void;
  onRequestRestoreSnapshot: (snapshot: BackupSnapshotRecord) => void;
  onUpdateBranch: (branchId: string, values: { name: string; code: string }) => Promise<void>;
  onDeleteBranch: (branch: Branch) => Promise<void>;
  onUpdateLocation: (locationId: string, values: { name: string; code: string; branchId: string }) => Promise<void>;
  onDeleteLocation: (location: Location) => Promise<void>;
  branchActionBusy: boolean;
  locationActionBusy: boolean;
  branchActionError?: unknown;
  locationActionError?: unknown;
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
  setupMode?: boolean;
  setupStepKey?: SetupStepKey | null;
  onSetupAdvance?: () => void;
}

export function renderOverviewSection({ branches, locations, snapshots, settings }: SharedSettingsSectionProps) {
  return (
    <div className="page-stack settings-overview-section">
      <SettingsOverviewStats
        branchesCount={branches.length}
        locationsCount={locations.length}
        snapshotsCount={snapshots.length}
        autoBackupEnabled={settings?.autoBackup !== 'off'}
        isUatReady={false}
        isSupportReady={false}
      />
    </div>
  );
}

export function renderCoreSection(props: SharedSettingsSectionProps) {
  return (
    <SettingsCoreSection
      settings={props.settings}
      branches={props.branches}
      locations={props.locations}
      settingsQuery={props.settingsQuery}
      branchesQuery={props.branchesQuery}
      canManageSettings={props.canManageSettings}
      setupMode={props.setupMode}
      onSetupAdvance={props.onSetupAdvance}
      onUpdateBranch={props.onUpdateBranch}
    />
  );
}

export function renderReferenceSection(props: SharedSettingsSectionProps) {
  return (
    <SettingsReferenceSection
      branches={props.branches}
      locations={props.locations}
      filteredBranches={props.filteredBranches}
      filteredLocations={props.filteredLocations}
      branchSearch={props.branchSearch}
      locationSearch={props.locationSearch}
      branchFilter={props.branchFilter}
      locationFilter={props.locationFilter}
      setBranchSearch={props.setBranchSearch}
      setLocationSearch={props.setLocationSearch}
      setBranchFilter={props.setBranchFilter}
      setLocationFilter={props.setLocationFilter}
      resetBranchFilters={props.resetBranchFilters}
      resetLocationFilters={props.resetLocationFilters}
      copyVisibleBranches={props.copyVisibleBranches}
      copyVisibleLocations={props.copyVisibleLocations}
      branchesQuery={props.branchesQuery}
      locationsQuery={props.locationsQuery}
      canManageSettings={props.canManageSettings}
      onUpdateBranch={props.onUpdateBranch}
      onDeleteBranch={props.onDeleteBranch}
      onUpdateLocation={props.onUpdateLocation}
      onDeleteLocation={props.onDeleteLocation}
      branchActionBusy={props.branchActionBusy}
      locationActionBusy={props.locationActionBusy}
      branchActionError={props.branchActionError}
      locationActionError={props.locationActionError}
      setupMode={props.setupMode}
      onSetupAdvance={props.onSetupAdvance}
    />
  );
}

export function renderBackupSection(props: SharedSettingsSectionProps) {
  return (
    <SettingsBackupImportSection
      snapshots={props.snapshots}
      autoBackupEnabled={props.settings?.autoBackup !== 'off'}
      canManageBackups={props.canManageBackups}
      canDownloadSupportBundle={props.canManageBackups || props.canManageSettings}
      backupBusy={props.backupBusy}
      backupConfigQuery={props.backupConfigQuery}
      backupFolderPathDraft={props.backupFolderPathDraft}
      setBackupFolderPathDraft={props.setBackupFolderPathDraft}
      backupAutoEnabledDraft={props.backupAutoEnabledDraft}
      setBackupAutoEnabledDraft={props.setBackupAutoEnabledDraft}
      backupFrequencyDraft={props.backupFrequencyDraft}
      setBackupFrequencyDraft={props.setBackupFrequencyDraft}
      backupTimeDraft={props.backupTimeDraft}
      setBackupTimeDraft={props.setBackupTimeDraft}
      backupWeeklyDayDraft={props.backupWeeklyDayDraft}
      setBackupWeeklyDayDraft={props.setBackupWeeklyDayDraft}
      backupSelectedFileName={props.backupSelectedFileName}
      backupMessage={props.backupMessage}
      backupMessageKind={props.backupMessageKind}
      backupResult={props.backupResult}
      restoreSnapshotId={props.restoreSnapshotId}
      handleBackupDownload={props.handleBackupDownload}
      handleSupportBundleDownload={props.handleSupportBundleDownload}
      saveBackupConfig={props.saveBackupConfig}
      testBackupFolder={props.testBackupFolder}
      saveBackupFileToFolderNow={props.saveBackupFileToFolderNow}
      handleBackupFile={props.handleBackupFile}
      handleSnapshotDownload={props.handleSnapshotDownload}
      onRequestRestoreFile={props.onRequestRestoreFile}
      onRequestRestoreSnapshot={props.onRequestRestoreSnapshot}
      importProductsPending={props.importProductsPending}
      importCustomersPending={props.importCustomersPending}
      importSuppliersPending={props.importSuppliersPending}
      importOpeningStockPending={props.importOpeningStockPending}
      importProducts={props.importProducts}
      importCustomers={props.importCustomers}
      importSuppliers={props.importSuppliers}
      importOpeningStock={props.importOpeningStock}
      downloadTemplate={props.downloadTemplate}
      onExportData={props.onExportData}
    />
  );
}

export function renderUsersSection(props: SharedSettingsSectionProps) {
  if (props.currentUserRole !== 'super_admin' && props.currentUserRole !== 'admin') return null;
  return <UserManagementSection branches={props.branches} setupMode={props.setupMode} setupStepKey={props.setupStepKey || null} onSetupAdvance={props.onSetupAdvance} />;
}

export function renderLanNetworkSection() {
  return <SettingsLanModesSection />;
}

export function renderTaxIntegrationSection() {
  return <TaxIntegrationSection />;
}
