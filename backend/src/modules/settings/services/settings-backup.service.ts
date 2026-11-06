import { ForbiddenException, Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { findOrphanedReferences, listTenantTables, PLATFORM_TENANT_TABLES } from '../../../core/tenant-transfer/tenant-package';
import { encryptBundle } from '../../../core/tenant-transfer/backup-bundle';
import { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { SettingsService } from '../settings.service';
import { isDesktopRuntimeMode } from '../../../config/app-mode';
import { isProtectedTenantDataTarget } from '../../../core/tenant-transfer/protected-tenant-target';

type BackupTableName = Exclude<keyof Database, 'backup_snapshots'> | (string & {});

interface BackupManifest { formatVersion: string; appVersion: string; createdAt: string; backupType: string; includesDatabase: boolean; includesFiles: boolean; databaseChecksumSha256: string; backupSchemaVersion?: string; legacyFormat?: boolean; }
interface BackupEnvelope { meta: { version: string; exportedAt: string; source: string; tenantId?: string; accountId?: string }; tables: Partial<Record<BackupTableName, unknown[]>> }
interface BackupAutomationState { schedulerAvailable: boolean; enabled: boolean; frequency: 'daily' | 'weekly'; time: string; weeklyDay: number; lastSuccessAt?: string; lastAttemptAt?: string; lastAttemptStatus?: 'success' | 'failed' | ''; lastError?: string; lastScheduledFor?: string; lastSavedPath?: string }
interface BackupConfigState { folderPath: string; automation: BackupAutomationState }

const BACKUP_TABLES: BackupTableName[] = [
  '_phase1_bootstrap', 'tenants', 'trial_signups', 'settings',
  'branches', 'stock_locations', 'users', 'user_branches', 'audit_logs',
  'cost_centers', 'accounting_accounts', 'accounting_settings',
  'partner_contacts', 'partner_addresses', 'suppliers', 'customers', 'customer_loyalty_logs',
  'product_categories', 'products', 'product_units', 'product_offers',
  'product_pricing_profiles', 'pricing_rules', 'product_customer_prices',
  'product_location_stock',
  'purchases', 'purchase_items', 'purchase_attachments',
  'supplier_payments', 'supplier_payment_schedules', 'supplier_payment_schedule_logs', 'supplier_ledger',
  'sales', 'sale_items', 'sale_line_stock_allocations', 'sale_payments', 'held_sales', 'held_sale_items',
  'customer_payments', 'customer_ledger', 'online_orders', 'quotations', 'quotation_items',
  'expenses', 'return_documents', 'return_items',
  'stock_transfers', 'stock_transfer_items', 'stock_count_sessions', 'stock_count_items',
  'damaged_stock_records', 'stock_movements', 'price_change_runs', 'price_change_items',
  'cashier_shifts', 'treasury_transactions',
  'journal_entries', 'journal_entry_lines',
  'projects',
  'manufacturing_boms', 'manufacturing_bom_lines', 'manufacturing_work_orders', 'manufacturing_wo_consumptions',
  'hr_departments', 'hr_job_titles', 'hr_positions', 'hr_employees',
  'hr_employee_contacts', 'hr_employee_documents', 'hr_employment_contracts',
  'hr_compensation_packages', 'hr_employee_loans', 'hr_employee_loan_installments',
  'hr_employee_ledger', 'hr_attendance_records', 'hr_attendance_exceptions',
  'hr_leave_types', 'hr_leave_requests', 'hr_employee_assets', 'hr_payroll_runs',
  'hr_payroll_run_items', 'hr_payroll_item_adjustments', 'hr_hr_settings',
  // Additional transactional tables must be exported and restored together with
  // invoices, inventory and journal entries. Incomplete backups lose real business data.
  'daily_financial_summaries', 'operation_executions', 'bank_statements', 'bank_statement_lines', 'accounting_cheques', 'accounting_fiscal_years', 'accounting_fiscal_periods', 'withholding_tax_transactions', 'crm_deals', 'crm_activities', 'accounting_posting_failures', 'product_serials', 'sale_pharmacy_batch_allocations', 'treasury_transfers', 'pos_audit_events', 'goods_receipt_notes', 'goods_receipt_lines', 'purchase_three_way_matches', 'purchase_landed_costs', 'purchase_orders', 'purchase_order_items', 'sales_orders', 'sales_order_items', 'manufacturing_unbuild_orders', 'services', 'hr_payroll_loan_deduction_allocations', 'hr_holidays', 'delivery_representatives', 'fleet_vehicles', 'van_sales_trips', 'van_field_returns', 'van_trip_expenses', 'van_trip_packaging_movements', 'delivery_rep_targets', 'van_load_requisitions', 'van_rep_financial_settlements'
];
// Platform billing, session state and offline ID leases are server-owned data.
// A tenant's backup must never grant entitlements or resurrect credentials.
export function isTenantBackupDataTable(name: string): boolean {
  return name !== 'tenants' && !PLATFORM_TENANT_TABLES.has(name);
}
const CLEAR_ORDER: (BackupTableName | 'services')[] = ['services', ...[...BACKUP_TABLES].reverse()]
  .filter((name) => isTenantBackupDataTable(String(name)));
const RESTORE_CONFIRMATION_TEXT = 'RESTORE BACKUP';
// Never require a D: drive on a customer's standalone Windows computer.
const DEFAULT_BACKUP_FOLDER = process.env.IS_ELECTRON === 'true' && process.env.Z_DATA_DIR
  ? path.resolve(process.env.Z_DATA_DIR, '..', 'backups')
  : path.resolve(process.cwd(), 'backups');
const BACKUP_FOLDER_SETTING_KEY = 'backupFolderPath';
const BACKUP_AUTOMATION_SETTING_KEY = 'backupAutomation';

function isObjectRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
// account_id is the tenancy column on most tables and is forced to the restoring tenant — unless the
// table declares it as a foreign key (journal_entry_lines.account_id -> accounting_accounts).
function normalizeRowForInsert(row: Record<string, unknown>, scope: { tenantId: string; accountId: string }, fkColumns: Set<string>): Record<string, unknown> { const normalized: Record<string, unknown> = {}; for (const [key, value] of Object.entries(row)) normalized[key] = key.endsWith('_json') && typeof value !== 'string' && value != null ? JSON.stringify(value) : value; normalized.tenant_id = scope.tenantId; if (!fkColumns.has('account_id')) normalized.account_id = scope.accountId; return normalized; }
// Only tenant_id is skipped. account_id is *not* skipped by name: it is the tenancy column on most
// tables (no FK there, so it never reaches this map), but on journal_entry_lines it is the FK to
// accounting_accounts. Skipping it by name left every restored journal line pointing at the old
// chart-of-accounts ids (O65 in ARCHITECTURE_INVARIANTS.md).
export function remapForeignKeys(
  row: Record<string, unknown>,
  fkMap: { column_name: string; foreign_table_name: string }[],
  idMap: Map<string, Map<string, string>>,
): void {
  for (const fk of fkMap) {
    if (fk.column_name === 'tenant_id') continue;
    const oldFkVal = row[fk.column_name];
    if (oldFkVal == null) continue;
    const newFkVal = idMap.get(fk.foreign_table_name)?.get(String(oldFkVal));
    if (newFkVal !== undefined) row[fk.column_name] = newFkVal;
  }
}

const sortSelfReferencing =(rows: any[], parentCol: string) => { const sorted = []; const inserted = new Set(); const pending = [...rows]; let iterations = 0; while (pending.length > 0 && iterations < 1000) { for (let i = pending.length - 1; i >= 0; i--) { const row = pending[i]; if (row[parentCol] == null || inserted.has(String(row[parentCol]))) { sorted.push(row); if (row.id != null) inserted.add(String(row.id)); pending.splice(i, 1); } } iterations++; } sorted.push(...pending); return sorted; };

function remapPolymorphicReferences(
  tableName: string,
  row: Record<string, unknown>,
  idMap: Map<string, Map<string, string>>
): void {
  if (tableName === 'customer_ledger') {
    const refType = String(row.reference_type || '').toLowerCase();
    const refId = row.reference_id != null ? String(row.reference_id) : null;
    if (refId) {
      if ((refType === 'sale' || refType === 'invoice') && idMap.has('sales')) {
        const newId = idMap.get('sales')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if ((refType === 'payment' || refType === 'customer_payment') && idMap.has('customer_payments')) {
        const newId = idMap.get('customer_payments')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'return' && idMap.has('return_documents')) {
        const newId = idMap.get('return_documents')!.get(refId);
        if (newId) row.reference_id = newId;
      }
    }
  }

  if (tableName === 'supplier_ledger') {
    const refType = String(row.reference_type || '').toLowerCase();
    const refId = row.reference_id != null ? String(row.reference_id) : null;
    if (refId) {
      if ((refType === 'purchase' || refType === 'bill') && idMap.has('purchases')) {
        const newId = idMap.get('purchases')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if ((refType === 'payment' || refType === 'supplier_payment') && idMap.has('supplier_payments')) {
        const newId = idMap.get('supplier_payments')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'return' && idMap.has('return_documents')) {
        const newId = idMap.get('return_documents')!.get(refId);
        if (newId) row.reference_id = newId;
      }
    }
  }

  if (tableName === 'treasury_transactions') {
    const refType = String(row.reference_type || '').toLowerCase();
    const refId = row.reference_id != null ? String(row.reference_id) : null;
    if (refId) {
      if (refType === 'sale' && idMap.has('sales')) {
        const newId = idMap.get('sales')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'purchase' && idMap.has('purchases')) {
        const newId = idMap.get('purchases')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'expense' && idMap.has('expenses')) {
        const newId = idMap.get('expenses')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'customer_payment' && idMap.has('customer_payments')) {
        const newId = idMap.get('customer_payments')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'supplier_payment' && idMap.has('supplier_payments')) {
        const newId = idMap.get('supplier_payments')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType === 'return' && idMap.has('return_documents')) {
        const newId = idMap.get('return_documents')!.get(refId);
        if (newId) row.reference_id = newId;
      }
    }
  }

  if (tableName === 'stock_movements') {
    const refType = String(row.reference_type || row.movement_type || '').toLowerCase();
    const refId = row.reference_id != null ? String(row.reference_id) : null;
    if (refId) {
      if (refType.includes('sale') && idMap.has('sales')) {
        const newId = idMap.get('sales')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType.includes('purchase') && idMap.has('purchases')) {
        const newId = idMap.get('purchases')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType.includes('transfer') && idMap.has('stock_transfers')) {
        const newId = idMap.get('stock_transfers')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType.includes('count') && idMap.has('stock_count_sessions')) {
        const newId = idMap.get('stock_count_sessions')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType.includes('damaged') && idMap.has('damaged_stock_records')) {
        const newId = idMap.get('damaged_stock_records')!.get(refId);
        if (newId) row.reference_id = newId;
      } else if (refType.includes('return') && idMap.has('return_documents')) {
        const newId = idMap.get('return_documents')!.get(refId);
        if (newId) row.reference_id = newId;
      }
    }
  }

  if (tableName === 'journal_entries') {
    const srcType = String(row.source_type || '').toLowerCase();
    const srcId = row.source_id != null ? String(row.source_id) : null;
    if (srcId) {
      if (srcType === 'sale' && idMap.has('sales')) {
        const newId = idMap.get('sales')!.get(srcId);
        if (newId) row.source_id = newId;
      } else if (srcType === 'purchase' && idMap.has('purchases')) {
        const newId = idMap.get('purchases')!.get(srcId);
        if (newId) row.source_id = newId;
      } else if (srcType === 'expense' && idMap.has('expenses')) {
        const newId = idMap.get('expenses')!.get(srcId);
        if (newId) row.source_id = newId;
      } else if (srcType === 'customer_payment' && idMap.has('customer_payments')) {
        const newId = idMap.get('customer_payments')!.get(srcId);
        if (newId) row.source_id = newId;
      } else if (srcType === 'supplier_payment' && idMap.has('supplier_payments')) {
        const newId = idMap.get('supplier_payments')!.get(srcId);
        if (newId) row.source_id = newId;
      } else if (srcType === 'return' && idMap.has('return_documents')) {
        const newId = idMap.get('return_documents')!.get(srcId);
        if (newId) row.source_id = newId;
      }
    }
  }

  if (tableName === 'journal_entry_lines') {
    const partnerType = String(row.partner_type || '').toLowerCase();
    const partnerId = row.partner_id != null ? String(row.partner_id) : null;
    if (partnerId) {
      if (partnerType === 'customer' && idMap.has('customers')) {
        const newId = idMap.get('customers')!.get(partnerId);
        if (newId) row.partner_id = newId;
      } else if (partnerType === 'supplier' && idMap.has('suppliers')) {
        const newId = idMap.get('suppliers')!.get(partnerId);
        if (newId) row.partner_id = newId;
      }
    }
  }
}

@Injectable()
export class SettingsBackupService implements OnModuleInit, OnModuleDestroy {
  private backupScheduler?: NodeJS.Timeout;
  private schedulerBusy = false;
  private backupInFlight: Promise<Record<string, unknown>> | null = null;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    // Background backups must not require the shop owner to open Settings every day.
    // Never run a local-file scheduler in cloud SaaS or for another tenant.
    if (!isDesktopRuntimeMode(process.env.APP_MODE)) return;
    this.backupScheduler = setInterval(() => { void this.checkUnattendedBackup(); }, 5 * 60 * 1000);
    this.backupScheduler.unref?.();
    // Bootstrap migrations happen after provider init; the first scheduled poll will
    // see the fully migrated database and is safer than querying tables immediately.
  }

  onModuleDestroy(): void {
    if (this.backupScheduler) clearInterval(this.backupScheduler);
  }

  private async checkUnattendedBackup(): Promise<void> {
    if (this.schedulerBusy) return;
    this.schedulerBusy = true;
    try {
      const tenantId = String(process.env.TENANT_ID || 'default');
      const accountId = String(process.env.ACCOUNT_ID || tenantId);
      const admin = await this.db.selectFrom('users')
        .select(['id', 'username', 'role'])
        .where('tenant_id', '=', tenantId)
        .where('role', '=', 'admin')
        .where('is_active', '=', true)
        .orderBy('id', 'asc').executeTakeFirst();
      if (!admin) return;
      // Internal-only context; no permission or session is exposed to an HTTP caller.
      const actor: AuthContext = {
        userId: Number(admin.id),
        username: String(admin.username),
        role: 'admin',
        permissions: ['canManageSettings'],
        sessionId: 'system-backup',
        tenantId,
        accountId,
      };
      const result = await this.runAutoBackupIfDue(actor);
      if (result.ok === false) console.error('[DesktopBackup] Auto-backup failed:', result.error);
    } catch (error) {
      console.error('[DesktopBackup] Auto-backup scheduler error:', error);
    } finally {
      this.schedulerBusy = false;
    }
  }

  assertAdmin(auth?: AuthContext | null): asserts auth is AuthContext { if (!auth) throw new ForbiddenException('Authentication required'); const canManage = auth.role === 'super_admin' || auth.permissions.includes('settings') || auth.permissions.includes('canManageSettings'); if (!canManage) throw new ForbiddenException('Missing required permissions'); requireTenantScope(auth); }
  private assertCanRestoreBackup(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    // A restore wipes and rewrites the whole tenant. Same rule as the UI (SettingsBackupImportSection)
    // and as the original hardening (01ab7902): an explicit canManageBackups grant, not just any
    // admin or anyone with the settings screen. Tenant owners get it with SUPER_ADMIN_PERMISSIONS.
    const canRestore = auth.role === 'super_admin' || auth.permissions.includes('canManageBackups');
    if (!canRestore) throw new ForbiddenException('عملية استعادة النسخة الاحتياطية محصورة بحساب الإدارة المعتمد فقط لحماية البيانات');
    requireTenantScope(auth);
  }
  private scope(auth: AuthContext) { return requireTenantScope(auth); }
  private assertRestoreConfirmation(payload: unknown): void { const confirmation = isObjectRecord(payload) ? String(payload.confirmation || payload.restoreConfirmation || '').trim() : ''; if (confirmation !== RESTORE_CONFIRMATION_TEXT) throw new AppError(`Type ${RESTORE_CONFIRMATION_TEXT} to confirm backup restore`, 'BACKUP_RESTORE_CONFIRMATION_REQUIRED', 400); }
  private normalizeEnvelope(payload: unknown): BackupEnvelope {
    if (!isObjectRecord(payload)) throw new AppError('Backup payload must be an object', 'BACKUP_INVALID', 400);
    const meta = isObjectRecord(payload.meta)
      ? { version: String(payload.meta.version || '1.0.0'), exportedAt: String(payload.meta.exportedAt || payload.meta.exported_at || ''), source: String(payload.meta.source || 'manual'), tenantId: String(payload.meta.tenantId || ''), accountId: String(payload.meta.accountId || '') }
      : { version: '1.0.0', exportedAt: '', source: 'manual' };
    if (!isObjectRecord(payload.tables)) {
      throw new AppError('Backup has no tables object', 'BACKUP_INVALID_TABLES', 400);
    }
    const raw = payload.tables;
    const tables: Partial<Record<BackupTableName, unknown[]>> = {};
    for (const [name, rows] of Object.entries(raw)) {
      // Old backups may contain billing/session tables. Ignore them for compatibility,
      // but never allow their contents to cross the restore boundary.
      if (isTenantBackupDataTable(name) && /^[a-z][a-z0-9_]*$/.test(name) && Array.isArray(rows)) tables[name] = rows;
    }
    // Never synthesize missing tables as empty arrays: an incomplete/legacy file
    // must not masquerade as a full backup and silently clear absent tables.
    if (!Object.keys(tables).length) {
      throw new AppError('Backup has no restorable tenant tables', 'BACKUP_NO_TENANT_DATA', 400);
    }
    return { meta, tables };
  }
  private normalizeFolderPath(value: unknown): string {
    const candidate = String(value || '').trim();
    if (!candidate || candidate === '\\\\?' || candidate === '\\?' || /[?*<>"|]/.test(candidate)) {
      return DEFAULT_BACKUP_FOLDER;
    }
    return candidate;
  }
  private normalizeFrequency(value: unknown): 'daily' | 'weekly' { return String(value || '').toLowerCase() === 'weekly' ? 'weekly' : 'daily'; }
  private normalizeTime(value: unknown): string { const raw = String(value || '').trim(); const match = raw.match(/^(\d{1,2}):(\d{2})$/); if (!match) return '03:00'; const hours = Math.min(23, Math.max(0, Number(match[1] || 0))); const minutes = Math.min(59, Math.max(0, Number(match[2] || 0))); return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`; }
  private normalizeWeeklyDay(value: unknown): number { const day = Number(value); return Number.isFinite(day) ? Math.min(6, Math.max(0, Math.floor(day))) : 0; }
  private parseSettingValue<T>(rawValue: string | null | undefined, fallback: T): T { if (rawValue == null) return fallback; try { return JSON.parse(rawValue) as T; } catch { return fallback; } }
  private assertDesktopMode(): void {
    if (!isDesktopRuntimeMode(process.env.APP_MODE)) {
      throw new AppError('Local backup folders are only available in the desktop version', 'FEATURE_NOT_AVAILABLE', 400);
    }
  }

  /** Persist a recoverable backup before destructive demo-data operations. Fail closed. */
  async savePreMutationBackup(actor: AuthContext, reason: string): Promise<void> {
    this.assertAdmin(actor);
    const scope = this.scope(actor);
    const { zipBuffer, manifest } = await this.exportBackup(actor);
    const now = new Date();
    let filePath: string;
    if (process.env.APP_MODE === 'CLOUD_SAAS') {
      const passphrase = (await fs.readFile('/etc/zsystems/backup-passphrase', 'utf8')).trim();
      if (!passphrase) throw new AppError('Backup encryption key is missing', 'BACKUP_KEY_MISSING', 503);
      const folder = '/var/backups/zsystems';
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      filePath = path.join(folder, `pre-mutation-${scope.tenantId.replace(/[^A-Za-z0-9_-]/g, '-')}-${now.getTime()}-${crypto.randomBytes(4).toString('hex')}.zip.enc`);
      await fs.writeFile(filePath, encryptBundle(zipBuffer, passphrase), { mode: 0o600, flag: 'wx' });
    } else {
      const state = await this.getBackupConfigState(actor);
      const result = await this.saveBackupToFolder(state.folderPath, 'demo-data-guard', actor);
      filePath = result.filePath;
    }
    await sql`insert into backup_snapshots (label, source, payload_json, tenant_id, account_id) values (${'auto-' + reason + '-' + now.toISOString()}, ${'demo-data-guard'}, ${JSON.stringify({ manifest, filePath })}::jsonb, ${scope.tenantId}, ${scope.accountId})`.execute(this.db);
  }

  private async tableExists(table: string, db: Kysely<Database> = this.db): Promise<boolean> { const result = await sql<{ exists: boolean }>`select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = ${table}) as exists`.execute(db); return Boolean(result.rows[0]?.exists); }
  private async tableHasColumn(table: string, column: string, db: Kysely<Database> = this.db): Promise<boolean> { const result = await sql<{ exists: boolean }>`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = ${column}) as exists`.execute(db); return Boolean(result.rows[0]?.exists); }
  private async getSettingValue<T>(key: string, fallback: T, actor: AuthContext): Promise<T> { const scope = this.scope(actor); const row = await this.db.selectFrom('settings').select(['value']).where('key', '=', key).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst(); return this.parseSettingValue<T>(row?.value, fallback); }
  private async saveSettingValue(key: string, value: unknown, actor: AuthContext): Promise<void> { const scope = this.scope(actor); await sql`insert into settings (key, value, tenant_id, account_id) values (${key}, ${JSON.stringify(value)}, ${scope.tenantId}, ${scope.accountId}) on conflict (tenant_id, key) do update set value = excluded.value, account_id = excluded.account_id`.execute(this.db); }
  private async getBackupConfigState(actor: AuthContext): Promise<BackupConfigState> { const folderPath = this.normalizeFolderPath(await this.getSettingValue<string>(BACKUP_FOLDER_SETTING_KEY, DEFAULT_BACKUP_FOLDER, actor)); const automationRaw = await this.getSettingValue<Record<string, unknown>>(BACKUP_AUTOMATION_SETTING_KEY, {}, actor); const legacyAutoBackup = await this.getSettingValue<string>('autoBackup', 'on', actor); return { folderPath, automation: { schedulerAvailable: isDesktopRuntimeMode(process.env.APP_MODE), enabled: typeof automationRaw.enabled === 'boolean' ? automationRaw.enabled : legacyAutoBackup !== 'off', frequency: this.normalizeFrequency(automationRaw.frequency), time: this.normalizeTime(automationRaw.time), weeklyDay: this.normalizeWeeklyDay(automationRaw.weeklyDay), lastSuccessAt: String(automationRaw.lastSuccessAt || '').trim() || undefined, lastAttemptAt: String(automationRaw.lastAttemptAt || '').trim() || undefined, lastAttemptStatus: String(automationRaw.lastAttemptStatus || '').trim() === 'failed' ? 'failed' : String(automationRaw.lastAttemptStatus || '').trim() === 'success' ? 'success' : '', lastError: String(automationRaw.lastError || '').trim() || undefined, lastScheduledFor: String(automationRaw.lastScheduledFor || '').trim() || undefined, lastSavedPath: String(automationRaw.lastSavedPath || '').trim() || undefined } }; }
  private async saveBackupConfigState(state: BackupConfigState, actor: AuthContext): Promise<void> { await this.saveSettingValue(BACKUP_FOLDER_SETTING_KEY, this.normalizeFolderPath(state.folderPath), actor); await this.saveSettingValue(BACKUP_AUTOMATION_SETTING_KEY, { enabled: state.automation.enabled, frequency: this.normalizeFrequency(state.automation.frequency), time: this.normalizeTime(state.automation.time), weeklyDay: this.normalizeWeeklyDay(state.automation.weeklyDay), lastSuccessAt: state.automation.lastSuccessAt || null, lastAttemptAt: state.automation.lastAttemptAt || null, lastAttemptStatus: state.automation.lastAttemptStatus || '', lastError: state.automation.lastError || '', lastScheduledFor: state.automation.lastScheduledFor || null, lastSavedPath: state.automation.lastSavedPath || null }, actor); await this.saveSettingValue('autoBackup', state.automation.enabled ? 'on' : 'off', actor); }
  private getLastScheduledDate(now: Date, automation: BackupAutomationState): Date { const [hoursRaw, minutesRaw] = this.normalizeTime(automation.time).split(':'); const scheduled = new Date(now); scheduled.setSeconds(0, 0); scheduled.setHours(Number(hoursRaw || 3), Number(minutesRaw || 0), 0, 0); if (automation.frequency === 'weekly') { const delta = (scheduled.getDay() - this.normalizeWeeklyDay(automation.weeklyDay) + 7) % 7; scheduled.setDate(scheduled.getDate() - delta); if (scheduled > now) scheduled.setDate(scheduled.getDate() - 7); return scheduled; } if (scheduled > now) scheduled.setDate(scheduled.getDate() - 1); return scheduled; }
  private async buildBackupFileName(actor: AuthContext, now: Date): Promise<string> {
    const pad = (value: number) => String(value).padStart(2, '0');
    const scope = this.scope(actor);
    const storeSetting = await this.db.selectFrom('settings')
      .select('value')
      .where('key', '=', 'storeName')
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
      
    const storeNameStr = (storeSetting?.value as string) || scope.tenantId || 'store';
    const userNameStr = actor.username || 'user';
    
    const storeSlug = storeNameStr.replace(/[^\w\s\u0600-\u06FF-]/g, '').trim().replace(/\s+/g, '-');
    const userSlug = userNameStr.replace(/[^\w\s\u0600-\u06FF-]/g, '').trim().replace(/\s+/g, '-');

    return `ZERP-${storeSlug}-${userSlug}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${now.getMilliseconds().toString().padStart(3, '0')}.zip`;
  }
  private async ensureWritableFolder(folderPath: string): Promise<void> {
    const raw = String(folderPath || '').trim();
    if (!raw || raw === '\\\\?' || raw === '\\?' || /[?*<>"|]/.test(raw)) {
      throw new AppError('مسار المجلد غير صالح أو يحتوي على رموز غير مسموحة', 'INVALID_BACKUP_PATH', 400);
    }
    try {
      await fs.mkdir(raw, { recursive: true });
      const probeFile = path.join(raw, `.zs-write-test-${Date.now()}.tmp`);
      await fs.writeFile(probeFile, 'ok', 'utf8');
      await fs.unlink(probeFile);
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `تعذر الوصول أو الكتابة في المجلد المحدد (${folderPath}): ${err?.message || 'تأكد من صحة المسار وصلاحيات الكتابة'}`,
        'BACKUP_FOLDER_NOT_WRITABLE',
        400,
      );
    }
  }
  private async rotateOldBackups(folderPath: string, maxRetention: number = 30): Promise<void> {
    try {
      const files = await fs.readdir(folderPath);
      const backupFiles: { fullPath: string; mtime: number }[] = [];
      for (const file of files) {
        if (file.startsWith('ZERP-') && file.endsWith('.zip')) {
          const fullPath = path.join(folderPath, file);
          const stat = await fs.stat(fullPath);
          backupFiles.push({ fullPath, mtime: stat.mtimeMs });
        }
      }
      if (backupFiles.length > maxRetention) {
        backupFiles.sort((a, b) => b.mtime - a.mtime);
        const toDelete = backupFiles.slice(maxRetention);
        for (const item of toDelete) {
          await fs.unlink(item.fullPath).catch(() => undefined);
        }
      }
    } catch {
      // Rotation failures should not interrupt the backup process
    }
  }
  private async saveBackupToFolder(folderPath: string, source: string, actor: AuthContext): Promise<{ filePath: string; fileName: string }> {
    const resolvedFolder = this.normalizeFolderPath(folderPath);
    await this.ensureWritableFolder(resolvedFolder);
    const { zipBuffer, manifest } = await this.exportBackup(actor);
    const now = new Date();
    const fileName = await this.buildBackupFileName(actor, now);
    const filePath = path.join(resolvedFolder, fileName);
    const scope = this.scope(actor);
    const tempPath = filePath + '.writing';
    try {
      await fs.writeFile(tempPath, zipBuffer, { flag: 'wx' });
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
    await sql`insert into backup_snapshots (label, source, payload_json, tenant_id, account_id) values (${'file-' + now.toISOString()}, ${source}, ${JSON.stringify({ manifest })}::jsonb, ${scope.tenantId}, ${scope.accountId})`.execute(this.db).catch(() => undefined);
    await this.rotateOldBackups(resolvedFolder, 30);
    return { filePath, fileName };
  }

  async runAutoBackupIfDue(actor?: AuthContext | null): Promise<Record<string, unknown>> {
    if (this.backupInFlight) return this.backupInFlight;
    const attempt = this.performAutoBackupIfDue(actor);
    this.backupInFlight = attempt;
    try { return await attempt; }
    finally { if (this.backupInFlight === attempt) this.backupInFlight = null; }
  }

  private async performAutoBackupIfDue(actor?: AuthContext | null): Promise<Record<string, unknown>> { if (!actor) return { ok: true, ran: false, reason: 'no-actor' }; this.assertAdmin(actor); try { this.assertDesktopMode(); } catch { return { ok: true, ran: false, reason: 'disabled' }; } const state = await this.getBackupConfigState(actor); if (!state.automation.enabled) return { ok: true, ran: false, reason: 'disabled', config: state }; const now = new Date(); const scheduledAt = this.getLastScheduledDate(now, state.automation); const scheduledIso = scheduledAt.toISOString(); if (String(state.automation.lastScheduledFor || '').trim() === scheduledIso) return { ok: true, ran: false, reason: 'already-attempted', config: state }; const lastSuccessAt = state.automation.lastSuccessAt ? new Date(state.automation.lastSuccessAt) : null; if (lastSuccessAt && lastSuccessAt.getTime() >= scheduledAt.getTime()) { state.automation.lastScheduledFor = scheduledIso; await this.saveBackupConfigState(state, actor); return { ok: true, ran: false, reason: 'already-succeeded', config: state }; } state.automation.lastAttemptAt = now.toISOString(); state.automation.lastScheduledFor = scheduledIso; try { const result = await this.saveBackupToFolder(state.folderPath, 'auto-scheduled', actor); state.automation.lastAttemptStatus = 'success'; state.automation.lastSuccessAt = now.toISOString(); state.automation.lastError = ''; state.automation.lastSavedPath = result.filePath; await this.saveBackupConfigState(state, actor); await this.audit.log('نسخ احتياطي تلقائي', `تم إنشاء نسخة احتياطية تلقائية في ${result.filePath}`, actor).catch(() => undefined); return { ok: true, ran: true, success: true, filePath: result.filePath, config: state }; } catch (error) { state.automation.lastAttemptStatus = 'failed'; state.automation.lastError = error instanceof Error ? error.message : 'تعذر تنفيذ النسخ التلقائي'; state.automation.lastScheduledFor = undefined; await this.saveBackupConfigState(state, actor); return { ok: false, ran: true, success: false, error: state.automation.lastError, config: state }; } }
  async getBackupConfig(actor: AuthContext): Promise<Record<string, unknown>> { this.assertCanRestoreBackup(actor); await this.runAutoBackupIfDue(actor); const state = await this.getBackupConfigState(actor); return { ok: true, defaultFolderPath: DEFAULT_BACKUP_FOLDER, folderPath: state.folderPath || DEFAULT_BACKUP_FOLDER, automation: state.automation, scope: this.scope(actor) }; }
  async saveBackupConfig(payload: unknown, actor: AuthContext): Promise<Record<string, unknown>> { this.assertCanRestoreBackup(actor); this.assertDesktopMode(); const input = isObjectRecord(payload) ? payload : {}; const current = await this.getBackupConfigState(actor); const automationInput = isObjectRecord(input.automation) ? input.automation : {}; current.folderPath = this.normalizeFolderPath(input.folderPath ?? current.folderPath ?? DEFAULT_BACKUP_FOLDER); current.automation.enabled = typeof automationInput.enabled === 'boolean' ? automationInput.enabled : typeof input.autoBackupEnabled === 'boolean' ? Boolean(input.autoBackupEnabled) : current.automation.enabled; current.automation.frequency = this.normalizeFrequency(automationInput.frequency ?? input.frequency ?? current.automation.frequency); current.automation.time = this.normalizeTime(automationInput.time ?? input.time ?? current.automation.time); current.automation.weeklyDay = this.normalizeWeeklyDay(automationInput.weeklyDay ?? input.weeklyDay ?? current.automation.weeklyDay); await this.saveBackupConfigState(current, actor); await this.audit.log('تعديل إعدادات النسخ الاحتياطي', `تم تعديل إعدادات النسخ الاحتياطي بواسطة ${actor.username}`, actor).catch(() => undefined); return { ok: true, config: current, message: 'تم حفظ إعدادات النسخ الاحتياطي' }; }
  async testBackupFolder(payload: unknown, actor: AuthContext): Promise<Record<string, unknown>> { this.assertCanRestoreBackup(actor); this.assertDesktopMode(); const input = isObjectRecord(payload) ? payload : {}; const folderPath = this.normalizeFolderPath(input.folderPath); try { await this.ensureWritableFolder(folderPath); return { ok: true, success: true, folderPath, message: `تم اختبار المسار بنجاح: ${folderPath}` }; } catch (error) { return { ok: false, success: false, folderPath, message: error instanceof Error ? error.message : 'تعذر الوصول إلى المجلد المحدد' }; } }
  async saveBackupToConfiguredFolder(actor: AuthContext): Promise<Record<string, unknown>> { this.assertCanRestoreBackup(actor); this.assertDesktopMode(); const state = await this.getBackupConfigState(actor); const result = await this.saveBackupToFolder(state.folderPath, 'manual-save-to-folder', actor); state.automation.lastAttemptAt = new Date().toISOString(); state.automation.lastAttemptStatus = 'success'; state.automation.lastError = ''; state.automation.lastSuccessAt = state.automation.lastAttemptAt; state.automation.lastSavedPath = result.filePath; await this.saveBackupConfigState(state, actor); await this.audit.log('نسخ احتياطي إلى مجلد', `تم حفظ نسخة احتياطية في ${result.filePath} بواسطة ${actor.username}`, actor).catch(() => undefined); return { ok: true, folderPath: state.folderPath, fileName: result.fileName, filePath: result.filePath, message: `تم حفظ النسخة في: ${result.filePath}` }; }

  /** Include new tenant-owned module tables without having to remember a hard-coded list. */
  private async getAllTenantBackupTables(db: Kysely<Database> = this.db): Promise<BackupTableName[]> {
    const discovered = await sql<{ table_name: string }>`
      SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
        AND table_name <> 'backup_snapshots'
      ORDER BY table_name
    `.execute(db);
    return [...new Set<BackupTableName>([...BACKUP_TABLES, ...discovered.rows.map((r) => r.table_name)])]
      .filter((name) => isTenantBackupDataTable(String(name)));
  }

  async exportBackup(actor: AuthContext): Promise<{ zipBuffer: Buffer; manifest: BackupManifest; envelope: BackupEnvelope }> {
    this.assertCanRestoreBackup(actor);
    const scope = this.scope(actor);
    // Every table must be read from one consistent PostgreSQL snapshot. Without
    // REPEATABLE READ, a sale may appear in one table without its journal/items.
    const tables = await this.db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      const snapshot = {} as Partial<Record<BackupTableName, unknown[]>>;
      for (const table of await this.getAllTenantBackupTables(trx)) {
        const name = String(table);
        if (!(await this.tableExists(name, trx)) || !(await this.tableHasColumn(name, 'tenant_id', trx))) continue;
        const baseQuery = (trx as Kysely<any>).selectFrom(name).selectAll().where(sql<boolean>`tenant_id = ${scope.tenantId}`);
        const hasId = await this.tableHasColumn(name, 'id', trx);
        const hasCreatedAt = !hasId && await this.tableHasColumn(name, 'created_at', trx);
        snapshot[table] = hasId
          ? await baseQuery.orderBy('id', 'asc').execute()
          : hasCreatedAt
            ? await baseQuery.orderBy('created_at', 'asc').execute()
            : await baseQuery.execute();
      }
      return snapshot;
    });
    const envelope: BackupEnvelope = {
      meta: { version: '1.2.0', exportedAt: new Date().toISOString(), source: 'manual-export', tenantId: scope.tenantId, accountId: scope.accountId },
      tables,
    };
    const dbJson = JSON.stringify(envelope);
    const hash = crypto.createHash('sha256').update(dbJson).digest('hex');
    const manifest: BackupManifest = {
      formatVersion: '1.0', appVersion: process.env.npm_package_version || '1.0.0',
      createdAt: new Date().toISOString(), backupType: 'full', includesDatabase: true,
      includesFiles: false, databaseChecksumSha256: hash, backupSchemaVersion: '1.2.0',
    };
    const zip = new AdmZip();
    zip.addFile('database.json', Buffer.from(dbJson, 'utf8'));
    zip.addFile('backup-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    return { zipBuffer: zip.toBuffer(), manifest, envelope };
  }
  async listSnapshots(actor: AuthContext): Promise<Record<string, unknown>> { this.assertCanRestoreBackup(actor); const scope = this.scope(actor); const result = await sql<{ id: number; created_at: string; label: string; source: string; payload_json: unknown }>`select id, created_at, label, source, payload_json from backup_snapshots where tenant_id = ${scope.tenantId} order by created_at desc, id desc limit 20`.execute(this.db); return { snapshots: result.rows.map((row) => ({ id: String(row.id), createdAt: row.created_at, reason: row.label || row.source || '', payload: row.payload_json })), scope }; }
  
  private async parseAndVerifyPayload(fileOrPayload: unknown): Promise<{ envelope: BackupEnvelope; manifest: BackupManifest }> {
    let rawEnvelope: unknown;
    let manifest: BackupManifest;
    
    if (Buffer.isBuffer(fileOrPayload) || (fileOrPayload && typeof (fileOrPayload as any).buffer !== 'undefined')) {
      const buffer = Buffer.isBuffer(fileOrPayload) ? fileOrPayload : (fileOrPayload as any).buffer;
      
      let zip;
      try {
        zip = new AdmZip(buffer);
        if (zip.getEntries().length === 0) throw new Error('Not a zip');
      } catch (e) {
        return this.parseAndVerifyPayload(JSON.parse(buffer.toString('utf8')));
      }

      const manifestEntry = zip.getEntry('backup-manifest.json');
      const dbEntry = zip.getEntry('database.json');
      
      if (!manifestEntry || !dbEntry) {
        throw new AppError('ملف النسخة الاحتياطية غير صالح (ينقصه manifest أو database)', 'BACKUP_INVALID_ZIP', 400);
      }
      
      const manifestContent = manifestEntry.getData().toString('utf8');
      manifest = JSON.parse(manifestContent);
      
      const dbContent = dbEntry.getData().toString('utf8');
      const hash = crypto.createHash('sha256').update(dbContent).digest('hex');
      
      if (hash !== manifest.databaseChecksumSha256) {
        throw new AppError('النسخة الاحتياطية تالفة (Checksum mismatch)', 'BACKUP_CORRUPTED', 400);
      }
      
      rawEnvelope = JSON.parse(dbContent);
    } else {
      const payloadStr = typeof fileOrPayload === 'string' ? fileOrPayload : JSON.stringify(fileOrPayload);
      try {
        rawEnvelope = typeof fileOrPayload === 'string' ? JSON.parse(payloadStr) : fileOrPayload;
      } catch (e) {
        throw new AppError('صيغة النسخة الاحتياطية غير مدعومة (يجب أن تكون ZIP صالحة أو JSON قديم صالح)', 'BACKUP_INVALID_FORMAT', 400);
      }
      
      manifest = {
        formatVersion: 'legacy',
        appVersion: 'unknown',
        createdAt: 'unknown',
        backupType: 'full',
        includesDatabase: true,
        includesFiles: false,
        databaseChecksumSha256: '',
        legacyFormat: true
      };
    }
    
    return { envelope: this.normalizeEnvelope(rawEnvelope), manifest };
  }

  async verifyBackup(payload: unknown): Promise<Record<string, unknown>> { const { envelope, manifest } = await this.parseAndVerifyPayload(payload);  const summary: Record<string, unknown> = { version: envelope.meta.version, exportedAt: envelope.meta.exportedAt || 'unknown', source: envelope.meta.source, tenantId: envelope.meta.tenantId || '' }; for (const table of Object.keys(envelope.tables)) summary[table] = Array.isArray(envelope.tables[table]) ? envelope.tables[table]!.length : 0; return { ok: true, summary, manifest, tablesPresent: Object.keys(envelope.tables).filter((table) => Array.isArray(envelope.tables[table]) && (envelope.tables[table]?.length || 0) > 0).length }; }
  private async tableHasId(trx: Kysely<Database>, table: string): Promise<boolean> { const result = await sql<{ exists: boolean }>`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = 'id') as exists`.execute(trx); return Boolean(result.rows[0]?.exists); }
  private async resetIdentity(trx: Kysely<Database>, table: string): Promise<void> { const hasId = await this.tableHasId(trx, table); if (!hasId) return; const seqResult = await sql<{ seq_name: string | null }>`select pg_get_serial_sequence(${table}, 'id') as seq_name`.execute(trx); const seqName = seqResult.rows[0]?.seq_name; if (!seqName) return; await sql`select setval(${seqName}, coalesce((select max(id)::bigint from ${sql.table(table)}), 0) + 1, false)`.execute(trx); }
  private async getTableColumns(trx: Kysely<Database>, table: string): Promise<Map<string, { data_type: string, column_default: string | null, identity_generation: string | null }>> { const result = await sql<{ column_name: string, data_type: string, column_default: string | null, identity_generation: string | null }>`select column_name, data_type, column_default, identity_generation from information_schema.columns where table_schema = 'public' and table_name = ${table}`.execute(trx); return new Map(result.rows.map(r => [r.column_name, r])); }
  private async getAlwaysIdentityColumns(trx: Kysely<Database>, table: string): Promise<Set<string>> { const result = await sql<{ column_name: string }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and identity_generation = 'ALWAYS'`.execute(trx).catch(() => ({ rows: [] })); return new Set(result.rows.map(r => r.column_name)); }

  // Runs after the tenant's rows were cleared, so any id still present belongs to another tenant.
  private async canKeepOriginalIds(trx: Kysely<Database>, envelope: BackupEnvelope): Promise<boolean> {
    for (const table of Object.keys(envelope.tables)) {
      if (String(table) === 'sessions') continue;
      const tableName = String(table);
      const rows = (envelope.tables[table] || []).filter(isObjectRecord);
      if (!rows.length || !(await this.tableExists(tableName))) continue;
      const colMeta = await this.getTableColumns(trx, tableName);
      const idMeta = colMeta.get('id');
      if (!idMeta || !colMeta.has('tenant_id')) continue;
      const ids = rows.map((row) => row.id);
      if (ids.some((id) => id == null)) return false;
      const taken = await sql<{ taken: boolean }>`
        select exists (
          select 1 from ${sql.table(tableName)}
          where id::text = any(${ids.map(String)}::text[])
        ) as taken
      `.execute(trx);
      if (taken.rows[0]?.taken) return false;
    }
    return true;
  }

  // Same gate as tenant packages (src/core/tenant-transfer): every FK of every tenant table is
  // checked for this tenant — missing parents AND parents that belong to another tenant.
  private async assertNoOrphanedReferences(trx: Kysely<Database>, tableNames: string[], tenantId: string): Promise<void> {
    if (!tableNames.length) return;
    const specs = await listTenantTables(trx);
    // tables restored here that tenant packages treat as platform/session tables (sessions, trial_signups)
    const extra = tableNames.filter((name) => !specs.has(name) && name !== 'sessions');
    const problems = await findOrphanedReferences(trx, specs, tenantId, extra);
    if (problems.length) {
      throw new AppError(
        `تم إلغاء الاسترجاع ولم يتغير شيء: بعد الاسترجاع ستبقى سطور تشير إلى سجلات غير موجودة أو تابعة لمنشأة أخرى (${problems.join(' | ')})`,
        'RESTORE_ORPHANED_REFERENCES',
        400,
      );
    }
  }


  async restoreBackup(payload: unknown, actor: AuthContext, dryRun = false): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    if (isProtectedTenantDataTarget(scope.tenantId)) {

      throw new ForbiddenException(
        'ممنوع منعاً باتاً استرجاع أي نسخة احتياطية على منشأة المنصة المركزية السحابية (zs). المنصة المركزية مخصصة للإدارة فقط ولا تقبل استرجاع بيانات تجارية.',
      );
    }

    if (!dryRun) {
      this.assertCanRestoreBackup(actor);
      this.assertRestoreConfirmation(payload);
    } else {
      this.assertAdmin(actor);
    }
    const { envelope, manifest } = await this.parseAndVerifyPayload(payload);
    // A destructive restore cannot infer ownership from an unbound legacy file:
    // checking only when tenantId exists previously let missing metadata pass.
    if (!envelope.meta?.tenantId) {
      throw new AppError('Backup has no tenant identity; destructive restore is not safe', 'BACKUP_TENANT_ID_MISSING', 400);
    }
    if (envelope.meta.tenantId !== scope.tenantId) {
      throw new AppError(
        `النسخة الاحتياطية مأخوذة من منشأة أخرى (${envelope.meta.tenantId})، ولا يمكن استرجاعها فوق هذه المنشأة (${scope.tenantId}). لمنع تداخل البيانات`,
        'TENANT_MISMATCH',
        400,
      );
    }
    const verification = await this.verifyBackup(payload);
    if (dryRun) return { ok: true, dryRun: true, summary: verification.summary, manifest, scope };

    try {
      const idMap = new Map<string, Map<string, string>>();

      await this.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
        await sql`SET LOCAL statement_timeout = 0`.execute(trx);

        // 1. Clear existing tenant data in reverse dependency order
        // Discovered dynamically: clear child tables first, then CLEAR_ORDER, then any remaining tenant tables
        const tenantSpecs = await listTenantTables(trx as unknown as Kysely<any>);

        // Preflight ALL live tenant tables before a single DELETE. Missing rows
        // in a legacy archive are not proof the target had no data. PostgreSQL
        // rejects the entire transaction instead of destroying newer modules.
        for (const spec of tenantSpecs.values()) {
          if (spec.kind === 'child') {
            // The older manual ZIP format did not export unscoped child tables
            // or re-map their parent IDs. Refuse rather than silently drop them.
            const present = await sql<{ exists: boolean }>`
              select exists (
                select 1 from ${sql.table(spec.name)}
                where ${sql.ref(spec.fkColumn!)} in (
                  select ${sql.ref(spec.parentColumn!)}
                  from ${sql.table(spec.parent!)}
                  where tenant_id = ${scope.tenantId}
                )
              ) as exists
            `.execute(trx);
            if (present.rows[0]?.exists || (envelope.tables[spec.name]?.length ?? 0) > 0) {
              throw new AppError(
                `Backup format cannot safely restore dependent table ${spec.name}; use tenant package transfer instead`,
                'BACKUP_CHILD_TABLE_UNSUPPORTED',
                409,
              );
            }
            continue;
          }

          if (Object.prototype.hasOwnProperty.call(envelope.tables, spec.name)) continue;
          const live = await sql<{ exists: boolean }>`
            select exists (select 1 from ${sql.table(spec.name)} where tenant_id = ${scope.tenantId}) as exists
          `.execute(trx);
          if (live.rows[0]?.exists) {
            throw new AppError(
              `Backup omits table ${spec.name} with existing tenant records. Restore refused to prevent data loss.`,
              'BACKUP_INCOMPLETE_TABLES',
              409,
            );
          }
        }

        const childSpecs = [...tenantSpecs.values()].filter((s) => s.kind === 'child');
        for (const child of childSpecs) {
          await sql`delete from ${sql.table(child.name)} where ${sql.ref(child.fkColumn!)} in (
            select parent.${sql.ref(child.parentColumn!)} from ${sql.table(child.parent!)} as parent where parent.tenant_id = ${scope.tenantId}
          )`.execute(trx);
        }

        for (const table of CLEAR_ORDER) {
          if (!(await this.tableExists(String(table))) || !(await this.tableHasColumn(String(table), 'tenant_id'))) continue;
          await sql`delete from ${sql.table(table)} where tenant_id = ${scope.tenantId}`.execute(trx);
        }

        for (const [name, spec] of tenantSpecs) {
          if (spec.kind === 'tenant' && !CLEAR_ORDER.includes(name as any)) {
            await sql`delete from ${sql.table(name)} where tenant_id = ${scope.tenantId}`.execute(trx);
          }
        }
        await sql`delete from sessions where tenant_id = ${scope.tenantId}`.execute(trx);

        // 2. Keep the backup's own ids whenever none of them is taken by another tenant (the normal
        // case: a tenant restoring its own backup on the same server). Then every FK, every
        // polymorphic reference_id/source_id, and rows in tables outside BACKUP_TABLES that point
        // at restored rows stay valid with no remapping at all. Remapping is only the fallback for
        // backups from another database, and step 4 refuses it if it cannot keep references whole.
        const keepOriginalIds = await this.canKeepOriginalIds(trx as unknown as Kysely<Database>, envelope);

        // 3. Insertion for all tables
        const restoredTables: string[] = [];
        const pendingBranchDefaultLocations = new Map<string, string>();

        for (const table of [...new Set([...BACKUP_TABLES, ...Object.keys(envelope.tables)])]) {
          if (!isTenantBackupDataTable(String(table))) continue;
          const tableName = String(table);
          if (!(await this.tableExists(tableName))) continue;
          const colMeta = await this.getTableColumns(trx as unknown as Kysely<Database>, tableName);
          const hasTenant = colMeta.has('tenant_id');
          if (!hasTenant) continue;
          restoredTables.push(tableName);

          let rows = Array.isArray(envelope.tables[table]) ? envelope.tables[table]! : [];
          if (!rows.length) continue;

          if (!keepOriginalIds && colMeta.has('parent_id') && colMeta.has('id')) {
            rows = sortSelfReferencing(rows, 'parent_id');
          }

          const fksResult = await sql<{ column_name: string; foreign_table_name: string }>`
            SELECT kcu.column_name, ccu.table_name AS foreign_table_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ${tableName}
          `.execute(trx);
          const fkMap = fksResult.rows;
          const fkColumns = new Set(fkMap.map((fk) => fk.column_name));

          if (!idMap.has(tableName)) idMap.set(tableName, new Map());
          const tableIdMap = idMap.get(tableName)!;

          const idMeta = colMeta.get('id');
          const isIdAutoGenerated = Boolean(
            idMeta && (idMeta.column_default !== null || idMeta.identity_generation !== null)
          ) && !keepOriginalIds;
          const overridingIdentity = keepOriginalIds && idMeta?.identity_generation === 'ALWAYS'
            ? sql`overriding system value`
            : sql``;

          const preparedRows: { oldId: unknown; row: Record<string, unknown> }[] = [];
          for (const rawRow of rows) {
            if (!isObjectRecord(rawRow)) continue;
            const row: Record<string, unknown> = { ...rawRow };

            if (tableName === 'users') {
              if (String(row.username || '').trim().toLowerCase() === 'zs') continue;
              if (row.role === 'super_admin') row.role = 'admin';
            }

            if (!keepOriginalIds) {
              remapForeignKeys(row, fkMap, idMap);

              // Circular FK resolution: defer branch default_stock_location_id until stock_locations is inserted
              if (tableName === 'branches' && row.default_stock_location_id != null) {
                if (rawRow.id != null) {
                  pendingBranchDefaultLocations.set(String(rawRow.id), String(rawRow.default_stock_location_id));
                }
                row.default_stock_location_id = null;
              }

              // Remap Self-referencing parent_id
              if (colMeta.has('parent_id') && row.parent_id != null) {
                const newParentId = tableIdMap.get(String(row.parent_id));
                if (newParentId !== undefined) {
                  row.parent_id = newParentId;
                }
              }

              // Remap Polymorphic References
              remapPolymorphicReferences(tableName, row, idMap);
            }

            // Normalize for Tenant
            const normalized = normalizeRowForInsert(row, scope, fkColumns);
            const filteredRow: Record<string, unknown> = {};
            for (const key of Object.keys(normalized)) {
              if (colMeta.has(key)) {
                filteredRow[key] = normalized[key];
              }
            }

            const oldId = filteredRow.id;
            if (isIdAutoGenerated) {
              delete filteredRow.id;
            }

            if (Object.keys(filteredRow).length > 0) {
              preparedRows.push({ oldId, row: filteredRow });
            }
          }

          if (!preparedRows.length) continue;

          const insertCols = Array.from(colMeta.keys()).filter((col) =>
            isIdAutoGenerated ? col !== 'id' : true
          ).filter((col) => preparedRows.some((p) => p.row[col] !== undefined));

          if (!insertCols.length) continue;

          if (isIdAutoGenerated) {
            if (colMeta.has('parent_id')) {
              for (const item of preparedRows) {
                if (item.row.parent_id != null) {
                  const newParentId = tableIdMap.get(String(item.row.parent_id));
                  if (newParentId !== undefined) item.row.parent_id = newParentId;
                }
                const activeKeys = insertCols.filter((k) => item.row[k] !== undefined);
                const colsSql = sql.join(activeKeys.map((k) => sql.ref(k)));
                const valsSql = sql.join(activeKeys.map((k) => sql`${item.row[k]}`));
                const inserted = await sql<{ id: string | number }>`
                  insert into ${sql.table(tableName)} (${colsSql}) values (${valsSql}) returning id
                `.execute(trx);
                if (item.oldId != null && inserted.rows[0]?.id != null) {
                  tableIdMap.set(String(item.oldId), String(inserted.rows[0].id));
                }
              }
            } else {
              const CHUNK_SIZE = 200;
              for (let i = 0; i < preparedRows.length; i += CHUNK_SIZE) {
                const chunk = preparedRows.slice(i, i + CHUNK_SIZE);
                if (!chunk.length) continue;

                const colsSql = sql.join(insertCols.map((k) => sql.ref(k)));
                const valsSql = sql.join(
                  chunk.map(
                    (item) =>
                      sql`(${sql.join(
                        insertCols.map((k) => sql`${item.row[k] !== undefined ? item.row[k] : null}`)
                      )})`
                  )
                );

                const inserted = await sql<{ id: string | number }>`
                  insert into ${sql.table(tableName)} (${colsSql}) values ${valsSql} returning id
                `.execute(trx);

                for (let idx = 0; idx < inserted.rows.length; idx++) {
                  const item = chunk[idx];
                  const newId = inserted.rows[idx]?.id;
                  if (item && item.oldId != null && newId != null) {
                    tableIdMap.set(String(item.oldId), String(newId));
                  }
                }
              }
            }
          } else {
            const CHUNK_SIZE = 200;
            for (let i = 0; i < preparedRows.length; i += CHUNK_SIZE) {
              const chunk = preparedRows.slice(i, i + CHUNK_SIZE);
              if (!chunk.length) continue;

              const colsSql = sql.join(insertCols.map((k) => sql.ref(k)));
              const valsSql = sql.join(
                chunk.map(
                  (item) =>
                    sql`(${sql.join(
                      insertCols.map((k) => sql`${item.row[k] !== undefined ? item.row[k] : null}`)
                    )})`
                )
              );

              await sql`
                insert into ${sql.table(tableName)} (${colsSql}) ${overridingIdentity} values ${valsSql}
              `.execute(trx);
            }
          }

          await this.resetIdentity(trx as unknown as Kysely<Database>, tableName);

          // Circular FK Phase 2: After stock_locations is inserted, link branches.default_stock_location_id
          if (!keepOriginalIds && tableName === 'stock_locations' && pendingBranchDefaultLocations.size > 0) {
            const branchIdMap = idMap.get('branches');
            const locIdMap = idMap.get('stock_locations');
            if (branchIdMap && locIdMap) {
              for (const [oldBranchId, oldLocId] of pendingBranchDefaultLocations.entries()) {
                const newBranchId = branchIdMap.get(oldBranchId);
                const newLocId = locIdMap.get(oldLocId);
                if (newBranchId && newLocId) {
                  await sql`update branches set default_stock_location_id = ${newLocId} where id = ${newBranchId} and tenant_id = ${scope.tenantId}`.execute(trx);
                }
              }
            }
          }
        }

        // 4. replica mode above disables FK enforcement, so nothing would stop a bad remap from
        // committing. Check every FK of the restored tables ourselves before the commit.
        await this.assertNoOrphanedReferences(trx as unknown as Kysely<Database>, restoredTables, scope.tenantId);
        // A failed restore snapshot record must rollback the restored rows as well.
        await sql`insert into backup_snapshots (label, source, payload_json, tenant_id, account_id) values (${`restore-${new Date().toISOString()}`}, ${'restore'}, ${JSON.stringify(envelope)}::jsonb, ${scope.tenantId}, ${scope.accountId})`.execute(trx);
      });
    } catch (error: any) {
      throw new AppError(
        `فشل الاستعادة: ${error.message} - ${error.detail || ''} - Table: ${error.table || ''} - Constraint: ${error.constraint || ''}`,
        'RESTORE_ERROR',
        400
      );
    }

    // Restore replaces the users, roles and settings but old auth/session and UI
    // caches would otherwise keep the pre-restore tenant alive for up to 60s.
    // Invalidate immediately after a committed transaction, never on a dry run.
    this.authCache.invalidateTenant(scope.tenantId);
    this.settings.invalidateSettingsCache(scope.tenantId);
    this.settings.invalidateBranchesCache(scope.tenantId);
    this.settings.invalidatePlanFeaturesCache(scope.tenantId);

    // Ensure audit log uses a valid user id from the restored users or null if the restoring actor was replaced
    let auditActor = actor;
    if (actor.userId) {
      const userStillExists = await sql<{ ok: boolean }>`
        select exists(select 1 from users where id = ${actor.userId} and tenant_id = ${scope.tenantId}) as ok
      `.execute(this.db).then(r => Boolean(r.rows[0]?.ok)).catch(() => false);
      if (!userStillExists) {
        const matchingUser = await sql<{ id: number }>`
          select id from users where username = ${actor.username} and tenant_id = ${scope.tenantId} limit 1
        `.execute(this.db).then(r => r.rows[0]?.id).catch(() => undefined);
        auditActor = { ...actor, userId: matchingUser ?? (null as any) };
      }
    }
    await this.audit.log('استعادة نسخة احتياطية', `تمت استعادة نسخة احتياطية بواسطة ${actor.username}`, auditActor).catch(() => undefined);
    return { ok: true, restoredAt: new Date().toISOString(), restoredTables: BACKUP_TABLES.length, summary: verification.summary, scope };
  }
}
