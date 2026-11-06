import { http, resolveRequestUrl } from '@/lib/http';

const BACKUP_RESTORE_TIMEOUT_MS = 300_000;
const CSV_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
import { unwrapArray, unwrapByKey, type PaginationMeta } from '@/lib/api/contracts';
import type { AppSettings, Branch, Location } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface ManagedUserRecord {
  id?: string | null;
  username: string;
  phone?: string | null;
  password?: string;
  role: 'super_admin' | 'admin' | 'cashier';
  permissions: string[];
  name: string;
  branchIds: string[];
  defaultBranchId: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  failedLoginCount?: number;
  lockedUntil?: string | null;
  lastLoginAt?: string | null;
}

export interface ManagedUsersSummary {
  totalItems: number;
  superAdmins: number;
  admins: number;
  cashiers: number;
  inactive: number;
  locked: number;
  activePrivilegedUsers: number;
}

export interface BulkDisableUsersResponse {
  ok: boolean;
  disabledCount: number;
  skippedCount: number;
  skipped: Array<{ id: string; username: string; reason: string }>;
  message?: string;
}

export interface ManagedUsersQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'super-admins' | 'admins' | 'cashiers' | 'inactive' | 'locked';
}

export interface BackupSnapshotRecord {
  id: string;
  createdAt: string;
  reason?: string | null;
  payload?: Record<string, unknown>;
}

export interface BackupAutomationConfig {
  // False on cloud: the scheduler only ever runs on desktop (see
  // SettingsBackupService.onModuleInit). Optional so older payloads still type-check.
  schedulerAvailable?: boolean;
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  time: string;
  weeklyDay: number;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastAttemptStatus?: 'success' | 'failed' | '';
  lastError?: string;
  lastScheduledFor?: string;
  lastSavedPath?: string;
}

export interface TenantImportReport {
  ok: boolean;
  rows: number;
  tables: number;
  warnings: string[];
  sourceTenant: { id: string; slug: string; businessName: string };
}

export interface TenantPickOption {
  tenantId: string;
  slug: string;
  businessName: string;
  rows: number;
}

export interface BackupConfigResponse {
  ok: boolean;
  defaultFolderPath: string;
  folderPath: string;
  automation: BackupAutomationConfig;
}

export interface PlanLimitInfo {
  maxUsers: number | null; // null = unlimited
  isUnlimited: boolean;
  isLimitReached: boolean;
  activeUsersCount: number;
  planName: string;
  planCode?: string | null;
}

interface ManagedUsersResponse {
  users?: ManagedUserRecord[];
  pagination?: PaginationMeta;
  summary?: ManagedUsersSummary;
  planLimit?: PlanLimitInfo;
}

interface CreateBranchResponse {
  ok: boolean;
  branchId?: string;
  branch?: Branch;
  branches: Branch[];
}

interface CreateLocationResponse {
  ok: boolean;
  locationId?: string;
  location?: Location;
  locations: Location[];
}

function sanitizeUserPayload(payload: ManagedUserRecord) {
  const password = String(payload.password || '').trim();
  const phone = String(payload.phone || '').trim();

  return {
    ...(payload.id ? { id: payload.id } : {}),
    username: String(payload.username || '').trim(),
    phone,
    ...(password ? { password } : {}),
    role: payload.role === 'super_admin' ? 'super_admin' : payload.role === 'admin' ? 'admin' : 'cashier',
    permissions: Array.isArray(payload.permissions) ? payload.permissions.map((entry) => String(entry)).filter(Boolean) : [],
    name: String(payload.name || '').trim(),
    branchIds: Array.isArray(payload.branchIds) ? payload.branchIds.map((entry) => String(entry)).filter(Boolean) : [],
    defaultBranchId: String(payload.defaultBranchId || ''),
    isActive: payload.isActive !== false,
    mustChangePassword: payload.mustChangePassword === true,
  };
}

export const settingsApi = {
  settings: async () => unwrapByKey<AppSettings>(await http<AppSettings | { settings: AppSettings }>('/api/settings'), 'settings', {} as AppSettings),
  industryProfiles: () =>
    http<{ profiles: Array<{ key: string; pillar: string; labelAr: string; labelEn: string; descriptionAr: string; defaultRoute: string }> }>(
      '/api/settings/industry-profiles',
    ),
  setActivityProfile: (activityType: string) =>
    http<{ ok: boolean; activityType: string; pillar: string; message: string; settingsPatch?: Record<string, boolean> }>('/api/settings/activity-profile', {
      method: 'PUT',
      body: JSON.stringify({ activityType }),
    }),
  branches: async () => unwrapArray<Branch>(await http<Branch[] | { branches: Branch[] }>('/api/branches'), 'branches'),
  locations: async () => unwrapArray<Location>(await http<Location[] | { locations: Location[] }>('/api/settings/locations'), 'locations'),
  update: async (payload: unknown) => {
    const isWrapped = Boolean(payload && typeof payload === 'object' && 'settings' in payload && (payload as any).settings && typeof (payload as any).settings === 'object');
    const body = isWrapped ? payload : { settings: payload };
    return unwrapByKey<AppSettings>(
      await http<AppSettings | { settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
      'settings',
      {} as AppSettings,
    );
  },
  createBranch: (payload: unknown) => http<CreateBranchResponse>('/api/branches', { method: 'POST', body: JSON.stringify(payload) }),
  updateBranch: (branchId: string, payload: unknown) => http<{ ok: boolean; branchId: string; branches: Branch[] }>(`/api/branches/${branchId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteBranch: (branchId: string) => http<{ ok: boolean; removedBranchId: string; branches: Branch[] }>(`/api/branches/${branchId}`, { method: 'DELETE' }),
  createLocation: (payload: unknown) => http<CreateLocationResponse>('/api/settings/locations', { method: 'POST', body: JSON.stringify(payload) }),
  updateLocation: (locationId: string, payload: unknown) => http<{ ok: boolean; locationId: string; locations: Location[] }>(`/api/settings/locations/${locationId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteLocation: (locationId: string) => http<{ ok: boolean; removedLocationId: string; locations: Location[] }>(`/api/settings/locations/${locationId}`, { method: 'DELETE' }),
  diagnostics: () => http<Record<string, unknown>>('/api/admin/diagnostics'),
  maintenanceReport: () => http<Record<string, unknown>>('/api/admin/maintenance-report'),
  launchReadiness: () => http<Record<string, unknown>>('/api/admin/launch-readiness'),
  operationalReadiness: () => http<Record<string, unknown>>('/api/admin/operational-readiness'),
  supportSnapshot: () => http<Record<string, unknown>>('/api/admin/support-snapshot'),
  uatReadiness: () => http<Record<string, unknown>>('/api/admin/uat-readiness'),
  cleanupExpiredSessions: () => http<Record<string, unknown>>('/api/admin/maintenance/cleanup-expired-sessions', { method: 'POST' }),
  reconcileBalances: () => http<Record<string, unknown>>('/api/admin/maintenance/reconcile-balances', { method: 'POST' }),
  reconcileCustomers: () => http<Record<string, unknown>>('/api/admin/maintenance/reconcile-customers', { method: 'POST' }),
  reconcileSuppliers: () => http<Record<string, unknown>>('/api/admin/maintenance/reconcile-suppliers', { method: 'POST' }),
  verifyBackup: (payload: unknown) => {
    if (payload instanceof File) {
      const formData = new FormData();
      formData.append('file', payload);
      return http<Record<string, unknown>>('/api/backup/verify', { method: 'POST', body: formData, timeoutMs: BACKUP_RESTORE_TIMEOUT_MS });
    }
    return http<Record<string, unknown>>('/api/backup/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: BACKUP_RESTORE_TIMEOUT_MS });
  },
  restoreBackup: (payload: unknown, dryRun = false) => {
    const isFile = payload instanceof File;
    const isObjectWithFile = payload && typeof payload === 'object' && 'file' in payload && (payload as any).file instanceof File;
    
    if (isFile || isObjectWithFile) {
      const formData = new FormData();
      if (isFile) {
        formData.append('file', payload as File);
      } else {
        formData.append('file', (payload as any).file);
        if ((payload as any).confirmation) formData.append('confirmation', (payload as any).confirmation);
      }
      return http<Record<string, unknown>>(`/api/backup/restore${dryRun ? '?dryRun=true' : ''}`, { method: 'POST', body: formData, timeoutMs: BACKUP_RESTORE_TIMEOUT_MS });
    }
    
    return http<Record<string, unknown>>(`/api/backup/restore${dryRun ? '?dryRun=true' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: BACKUP_RESTORE_TIMEOUT_MS });
  },
  backupConfig: () => http<BackupConfigResponse>('/api/backup/config'),
  saveBackupConfig: (payload: unknown) => http<BackupConfigResponse>('/api/backup/config', { method: 'POST', body: JSON.stringify(payload) }),
  testBackupFolder: (payload: unknown) => http<Record<string, unknown>>('/api/backup/folder/test', { method: 'POST', body: JSON.stringify(payload) }),
  saveBackupFileToFolder: () => http<Record<string, unknown>>('/api/backup/save-file', { method: 'POST' }),
  cloudBackupConfig: () => http<any>('/api/backup/cloud/config'),
  saveCloudBackupConfig: (payload: unknown) => http<any>('/api/backup/cloud/config', { method: 'POST', body: JSON.stringify(payload) }),
  testCloudConnection: () => http<{ success: boolean; message: string }>('/api/backup/cloud/test', { method: 'POST' }),
  triggerCloudBackupNow: () => http<{ success: boolean; fileName: string; cloudUrl: string }>('/api/backup/cloud/trigger', { method: 'POST' }),

  importProducts: (rows: unknown) => http<Record<string, unknown>>('/api/import/products', { method: 'POST', body: JSON.stringify({ rows }), timeoutMs: CSV_IMPORT_TIMEOUT_MS }),
  importCustomers: (rows: unknown) => http<Record<string, unknown>>('/api/import/customers', { method: 'POST', body: JSON.stringify({ rows }), timeoutMs: CSV_IMPORT_TIMEOUT_MS }),
  importSuppliers: (rows: unknown) => http<Record<string, unknown>>('/api/import/suppliers', { method: 'POST', body: JSON.stringify({ rows }), timeoutMs: CSV_IMPORT_TIMEOUT_MS }),
  importOpeningStock: (rows: unknown) => http<Record<string, unknown>>('/api/import/opening-stock', { method: 'POST', body: JSON.stringify({ rows }), timeoutMs: CSV_IMPORT_TIMEOUT_MS }),
  users: async () => unwrapArray<ManagedUserRecord>(await http<ManagedUserRecord[] | { users: ManagedUserRecord[] }>('/api/users'), 'users'),
  usersPage: async (params: ManagedUsersQueryParams = {}) => {
    const response = await http<ManagedUsersResponse>(`/api/users${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.users) ? response.users : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 10,
        totalItems: Array.isArray(response.users) ? response.users.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.users) && response.users.length ? 1 : 0,
        rangeEnd: Array.isArray(response.users) ? response.users.length : 0,
      },
      summary: response.summary || { totalItems: 0, superAdmins: 0, admins: 0, cashiers: 0, inactive: 0, locked: 0, activePrivilegedUsers: 0 },
      planLimit: response.planLimit,
    };
  },
  listAllUsers: async (params: Omit<ManagedUsersQueryParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await settingsApi.usersPage({ ...params, page: 1, pageSize: 100 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await settingsApi.usersPage({ ...params, page, pageSize: 100 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination, planLimit: firstPage.planLimit };
  },
  backupSnapshots: async () => unwrapArray<BackupSnapshotRecord>(await http<BackupSnapshotRecord[] | { snapshots: BackupSnapshotRecord[] }>('/api/backup-snapshots'), 'snapshots'),
  createUser: (payload: ManagedUserRecord) => http<{ ok: boolean; user: ManagedUserRecord | null; users: ManagedUserRecord[] }>('/api/users', { method: 'POST', body: JSON.stringify(sanitizeUserPayload(payload)) }),
  deleteUser: (payload: { userId: string, managerPin?: string }) => http<{ ok: boolean; removedUserId: string; users: ManagedUserRecord[] }>(`/api/users/${payload.userId}`, { method: 'DELETE', body: JSON.stringify({ managerPin: payload.managerPin }) }),
  updateUser: (userId: string, payload: ManagedUserRecord) => http<{ ok: boolean; user: ManagedUserRecord | null; users: ManagedUserRecord[] }>(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(sanitizeUserPayload(payload)) }),
  unlockUser: (userId: string) => http<{ ok: boolean; user: ManagedUserRecord | null; users: ManagedUserRecord[] }>(`/api/users/${userId}/unlock`, { method: 'POST' }),
  bulkDisableUsers: (userIds: string[]) =>
    http<BulkDisableUsersResponse>('/api/users/bulk-disable', {
      method: 'POST',
      body: JSON.stringify({
        userIds: (userIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
      }),
    }),
  saveUsers: (users: ManagedUserRecord[]) => http<{ ok: boolean; users: ManagedUserRecord[] }>('/api/users', { method: 'PUT', body: JSON.stringify({ users: users.map(sanitizeUserPayload) }) }),
  backupDownloadUrl: () => resolveRequestUrl('/api/backup'),
  tenantTransferInfo: () => http<{ mode: 'desktop' | 'cloud' }>('/api/tenant-transfer/info'),
  tenantTransferExportUrl: () => resolveRequestUrl('/api/tenant-transfer/export'),
  importTenantPackage: (file: File, options: { confirmation: string; passphrase?: string; pick?: string }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirmation', options.confirmation);
    if (options.passphrase) formData.append('passphrase', options.passphrase);
    if (options.pick) formData.append('pick', options.pick);
    return http<TenantImportReport>('/api/tenant-transfer/import', { method: 'POST', body: formData, timeoutMs: BACKUP_RESTORE_TIMEOUT_MS * 5 });
  },
  supportBundleDownloadUrl: () => resolveRequestUrl('/api/support-bundle/download'),
  sendSupportBundleToServer: () =>
    http<{ success: boolean; message: string }>('/api/support-bundle/send-to-server', {
      method: 'POST',
    }),

  // ─── Operational Inventory & Catalog Reset ──────────────────────────────
  resetStockBalances: (password: string) =>
    http<{ ok: boolean; message: string; productsCount: number }>('/api/admin/reset-stock-balances', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  wipeCatalogProducts: (password: string) =>
    http<{ ok: boolean; message: string }>('/api/admin/wipe-catalog-products', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // ─── Offline Releases ────────────────────────────────────────────────────
  offlineReleases: {
    list: () => http<OfflineRelease[]>('/api/admin/offline-releases'),
    create: (body: { version: string; changelog: string; patchUrl: string }) =>
      http<{ ok: boolean }>('/api/admin/offline-releases', { method: 'POST', body: JSON.stringify(body) }),
    promote: (id: number) =>
      http<{ ok: boolean; message: string }>(`/api/admin/offline-releases/${id}/promote`, { method: 'POST' }),
    deactivate: (id: number) =>
      http<{ ok: boolean; message: string }>(`/api/admin/offline-releases/${id}/deactivate`, { method: 'POST' }),
    triggerUpdate: () =>
      http<{ ok: boolean; message: string; version: string }>('/api/admin/offline-releases/trigger-update', { method: 'POST' }),
  },
};

export interface OfflineRelease {
  id: number;
  version: string;
  changelog: string;
  patchUrl: string;
  isActive: boolean;
  promotedBy: string | null;
  promotedAt: string | null;
  createdAt: string;
}

