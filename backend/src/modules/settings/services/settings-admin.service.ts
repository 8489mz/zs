import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope, TenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';

@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  assertAdmin(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    const canManage = auth.role === 'super_admin' || auth.permissions.includes('settings') || auth.permissions.includes('canManageSettings');
    if (!canManage) throw new ForbiddenException('Missing required permissions');
  }

  private assertDestructiveAdminPermission(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    const canRunDestructiveAdminOperation = auth.role === 'super_admin' || auth.permissions.includes('canManageBackups');
    if (!canRunDestructiveAdminOperation) throw new ForbiddenException('Destructive admin operations require super_admin or canManageBackups permission');
  }

  private withScope(payload: Record<string, unknown>, actor: AuthContext): Record<string, unknown> {
    return {
      ...payload,
      scope: requireTenantScope(actor) as TenantScope,
    };
  }

  private scope(actor: AuthContext): TenantScope {
    return requireTenantScope(actor);
  }

  private async count(table: keyof Database, actor: AuthContext): Promise<number> {
    const { tenantId } = this.scope(actor);
    const row = await this.db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirstOrThrow();

    return Number(row.count || 0);
  }

  private async sumRaw(table: string, column: string, actor: AuthContext): Promise<number> {
    const { tenantId } = this.scope(actor);
    const result = await sql<{ total: number }>`
      select coalesce(sum(${sql.ref(column)}), 0) as total
      from ${sql.table(table)}
      where tenant_id = ${tenantId}
    `.execute(this.db);
    return Number(result.rows[0]?.total || 0);
  }

  private handoffFileState() {
    const backendRoot = process.cwd();
    const files = [
      'PRODUCTION_CHECKLIST.md',
      'BACKUP_RESTORE.md',
      'MONITORING_READINESS.md',
      'DEPLOYMENT_RUNBOOK.md',
      'GO_LIVE_GATE.md',
      'PRE_SALE_HARDENING.md',
      '.env.example',
    ];

    const present = files.filter((file) => existsSync(join(backendRoot, file)));
    return {
      present: present.length,
      expected: files.length,
      missing: files.filter((file) => !present.includes(file)).join(', ') || 'none',
      ready: present.length === files.length ? 'yes' : 'no',
    };
  }

  async getDiagnostics(actor: AuthContext): Promise<Record<string, unknown>> {
    this.assertAdmin(actor);
    const scope = this.scope(actor);
    const [
      users,
      activeUsers,
      sessions,
      expiredSessions,
      branches,
      locations,
      customers,
      suppliers,
      products,
      sales,
      purchases,
      returns,
      expenses,
      treasury,
      snapshots,
      auditLogs,
      customerBalance,
      supplierBalance,
      treasuryNet,
    ] = await Promise.all([
      this.count('users', actor),
      this.db.selectFrom('users').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.count('sessions', actor),
      this.db.selectFrom('sessions').select((eb) => eb.fn.countAll<number>().as('count')).where('expires_at', '<', new Date()).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.db.selectFrom('branches').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.db.selectFrom('stock_locations').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.db.selectFrom('customers').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.db.selectFrom('suppliers').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirstOrThrow().then((row) => Number(row.count || 0)),
      this.count('sales', actor),
      this.count('purchases', actor),
      this.count('return_documents', actor),
      this.count('expenses', actor),
      this.count('treasury_transactions', actor),
      this.count('backup_snapshots' as keyof Database, actor),
      this.count('audit_logs', actor),
      this.sumRaw('customers', 'balance', actor),
      this.sumRaw('suppliers', 'balance', actor),
      this.sumRaw('treasury_transactions', 'amount', actor),
    ]);

    return {
      counts: {
        users,
        activeUsers,
        sessions,
        expiredSessions,
        branches,
        locations,
        customers,
        suppliers,
        products,
        sales,
        purchases,
        returns,
        expenses,
        treasuryTransactions: treasury,
        backupSnapshots: snapshots,
        auditLogs,
      },
      finance: {
        customerBalance: Number(customerBalance.toFixed(2)),
        supplierBalance: Number(supplierBalance.toFixed(2)),
        treasuryNet: Number(treasuryNet.toFixed(2)),
      },
      scope,
    };
  }

  async getMaintenanceReport(actor: AuthContext): Promise<Record<string, unknown>> {
    const diagnostics = await this.getDiagnostics(actor);
    const handoff = this.handoffFileState();
    return this.withScope({
      summary: {
        expiredSessions: Number((diagnostics.counts as Record<string, unknown>).expiredSessions || 0),
        backupSnapshots: Number((diagnostics.counts as Record<string, unknown>).backupSnapshots || 0),
        auditLogs: Number((diagnostics.counts as Record<string, unknown>).auditLogs || 0),
        docsReady: handoff.ready,
        docsCoverage: `${handoff.present}/${handoff.expected}`,
        missingDocs: handoff.missing,
      },
    }, actor);
  }

  async getLaunchReadiness(actor: AuthContext): Promise<Record<string, unknown>> {
    const diagnostics = await this.getDiagnostics(actor);
    const handoff = this.handoffFileState();
    const expiredSessions = Number((diagnostics.counts as Record<string, unknown>).expiredSessions || 0);
    const snapshots = Number((diagnostics.counts as Record<string, unknown>).backupSnapshots || 0);

    return this.withScope({
      summary: {
        envTemplateReady: handoff.ready,
        backupSnapshotsAvailable: snapshots > 0 ? 'yes' : 'no',
        expiredSessionsOpen: expiredSessions,
        bootstrapAdminExpectedOffInProduction: process.env.ENABLE_BOOTSTRAP_ADMIN === 'true' ? 'no' : 'yes',
        csrfConfigured: process.env.SESSION_CSRF_SECRET ? 'yes' : 'no',
        cookiesSecureFlag: process.env.SESSION_COOKIE_SECURE === 'true' ? 'yes' : 'no',
      },
    }, actor);
  }

  async getOperationalReadiness(actor: AuthContext): Promise<Record<string, unknown>> {
    const diagnostics = await this.getDiagnostics(actor);
    return this.withScope({
      summary: {
        activeUsers: Number((diagnostics.counts as Record<string, unknown>).activeUsers || 0),
        branches: Number((diagnostics.counts as Record<string, unknown>).branches || 0),
        locations: Number((diagnostics.counts as Record<string, unknown>).locations || 0),
        products: Number((diagnostics.counts as Record<string, unknown>).products || 0),
        treasuryNet: Number((diagnostics.finance as Record<string, unknown>).treasuryNet || 0),
        customerBalance: Number((diagnostics.finance as Record<string, unknown>).customerBalance || 0),
        supplierBalance: Number((diagnostics.finance as Record<string, unknown>).supplierBalance || 0),
      },
    }, actor);
  }

  async getUatReadiness(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope({
      summary: {
        backendBuild: 'run npm run build',
        backendInfraTests: 'run npm run test:infra',
        frontendQa: 'run npm run qa:commercial-ready',
        backupRestoreDrill: 'verify from settings backup workspace',
        smokeFlow: 'sale + purchase + return + reports sanity',
      },
    }, actor);
  }

  async getSupportSnapshot(actor: AuthContext): Promise<Record<string, unknown>> {
    const diagnostics = await this.getDiagnostics(actor);
    return this.withScope({
      generatedAt: new Date().toISOString(),
      appHost: process.env.APP_HOST || 'unset',
      appPort: process.env.APP_PORT || 'unset',
      businessTimezone: process.env.BUSINESS_TIMEZONE || 'UTC',
      activeUsers: Number((diagnostics.counts as Record<string, unknown>).activeUsers || 0),
      products: Number((diagnostics.counts as Record<string, unknown>).products || 0),
      sales: Number((diagnostics.counts as Record<string, unknown>).sales || 0),
      purchases: Number((diagnostics.counts as Record<string, unknown>).purchases || 0),
      returns: Number((diagnostics.counts as Record<string, unknown>).returns || 0),
      expiredSessions: Number((diagnostics.counts as Record<string, unknown>).expiredSessions || 0),
      backupSnapshots: Number((diagnostics.counts as Record<string, unknown>).backupSnapshots || 0),
    }, actor);
  }

  async cleanupExpiredSessions(actor: AuthContext): Promise<Record<string, unknown>> {
    this.assertDestructiveAdminPermission(actor);
    const { tenantId } = this.scope(actor);
    const result = await this.db.deleteFrom('sessions').where('expires_at', '<', new Date()).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    const removed = Number(result.numDeletedRows || 0);
    await this.audit.log('تنظيف الجلسات', `تم حذف ${removed} جلسة منتهية بواسطة ${actor.username}`, actor);
    return { ok: true, removed };
  }

  /**
   * Reconcile one partner side (customers or suppliers) against its
   * ledger inside the caller's transaction. The ledger sum is rounded
   * ONCE at tenant book digits through minor units, and the stored
   * balance is compared EXACTLY: no skip band, no second rounding of
   * either side. A partner with no ledger rows and a non-zero stored
   * balance is fail-closed: skipped and reported, never zeroed,
   * because a ledger-less balance may be a genuine opening balance.
   * Currency settings are resolved on the caller's transaction handle
   * and fail closed on mismatch, like every other posting path.
   */
  private async reconcilePartners(
    db: Kysely<Database>,
    tenantId: string,
    kind: 'customer' | 'supplier',
  ): Promise<{ updated: number; skipped: number }> {
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(db, tenantId));
    const partnerTable = kind === 'customer' ? 'customers' : 'suppliers';
    const ledgerTable = kind === 'customer' ? 'customer_ledger' : 'supplier_ledger';
    const partnerIdColumn = kind === 'customer' ? 'customer_id' : 'supplier_id';
    const rows = await (db as any)
      .selectFrom(`${partnerTable} as p`)
      .leftJoin(`${ledgerTable} as l`, `l.${partnerIdColumn}`, 'p.id')
      .select(['p.id', 'p.balance'])
      .select((eb: any) => sql<number>`coalesce(sum(l.amount), 0)`.as('ledger_balance'))
      .select((eb: any) => sql<number>`count(l.id)`.as('ledger_rows'))
      .where(sql<boolean>`p.tenant_id = ${tenantId}`)
      .where(sql<boolean>`(l.id is null or l.tenant_id = ${tenantId})`)
      .groupBy(['p.id', 'p.balance'])
      .execute();

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const currentBalance = Number(row.balance || 0);
      if (Number(row.ledger_rows || 0) === 0 && currentBalance !== 0) {
        skipped += 1;
        continue;
      }
      const nextBalance = fromMinorUnits(toMinorUnits(Number(row.ledger_balance || 0), bookDigits), bookDigits);
      if (nextBalance === currentBalance) continue;
      await (db as any).updateTable(partnerTable).set({ balance: nextBalance, updated_at: sql`NOW()` }).where('id', '=', Number(row.id)).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
      updated += 1;
    }
    return { updated, skipped };
  }

  async reconcileCustomers(actor: AuthContext): Promise<Record<string, unknown>> {
    this.assertDestructiveAdminPermission(actor);
    const { tenantId } = this.scope(actor);
    const result = await this.db.transaction().execute((trx) => this.reconcilePartners(trx, tenantId, 'customer'));
    await this.audit.log('مطابقة أرصدة العملاء', `تمت مطابقة ${result.updated} عميل بواسطة ${actor.username}`, actor);
    return { ok: true, updated: result.updated, skipped: result.skipped };
  }

  async reconcileSuppliers(actor: AuthContext): Promise<Record<string, unknown>> {
    this.assertDestructiveAdminPermission(actor);
    const { tenantId } = this.scope(actor);
    const result = await this.db.transaction().execute((trx) => this.reconcilePartners(trx, tenantId, 'supplier'));
    await this.audit.log('مطابقة أرصدة الموردين', `تمت مطابقة ${result.updated} مورد بواسطة ${actor.username}`, actor);
    return { ok: true, updated: result.updated, skipped: result.skipped };
  }

  async reconcileAll(actor: AuthContext): Promise<Record<string, unknown>> {
    this.assertDestructiveAdminPermission(actor);
    const { tenantId } = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      const customers = await this.reconcilePartners(trx, tenantId, 'customer');
      const suppliers = await this.reconcilePartners(trx, tenantId, 'supplier');
      return { customers, suppliers };
    });
    await this.audit.log('مطابقة أرصدة العملاء', `تمت مطابقة ${result.customers.updated} عميل بواسطة ${actor.username}`, actor);
    await this.audit.log('مطابقة أرصدة الموردين', `تمت مطابقة ${result.suppliers.updated} مورد بواسطة ${actor.username}`, actor);
    return {
      ok: true,
      customersUpdated: result.customers.updated,
      suppliersUpdated: result.suppliers.updated,
      customersSkipped: result.customers.skipped,
      suppliersSkipped: result.suppliers.skipped,
    };
  }
}
