import { Injectable, Inject } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { KYSELY_DB } from '../../../database/database.constants';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../../core/audit/audit.service';
import { SettingsBackupService } from './settings-backup.service';
import type { SeedDemoDataDto, DemoCredential } from './demo-data/settings-demo-data-shared';
import { SettingsDemoDataGuards } from './demo-data/settings-demo-data-guards';
import { SettingsDemoDataStatus } from './demo-data/settings-demo-data-status';
import { SettingsDemoDataWipe } from './demo-data/settings-demo-data-wipe';
import { SettingsDemoDataTenant } from './demo-data/settings-demo-data-tenant';
import { SettingsDemoDataSeed } from './demo-data/settings-demo-data-seed';
import { SettingsDemoDataClear } from './demo-data/settings-demo-data-clear';

// PIN (demo-data-safety.spec.ts): demo users get randomBytes(18) temporary
// passwords with must_change_password: true; the wipe slice calls
// resetTenantStockToZero(trx, tenantId) (direct-mutation-allowlist.spec.ts).

@Injectable()
export class SettingsDemoDataService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly backupService: SettingsBackupService,
  ) {}

  private _guards: SettingsDemoDataGuards | null = null;
  private _status: SettingsDemoDataStatus | null = null;
  private _wipe: SettingsDemoDataWipe | null = null;
  private _tenant: SettingsDemoDataTenant | null = null;
  private _seed: SettingsDemoDataSeed | null = null;
  private _clear: SettingsDemoDataClear | null = null;

  private get guards(): SettingsDemoDataGuards {
    return (this._guards ??= new SettingsDemoDataGuards(this.db, this.backupService));
  }

  private get status(): SettingsDemoDataStatus {
    return (this._status ??= new SettingsDemoDataStatus(this.db, {
      scope: (actor) => this.guards.scope(actor),
    }));
  }

  private get wipe(): SettingsDemoDataWipe {
    return (this._wipe ??= new SettingsDemoDataWipe(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      assertSuperAdminAndPassword: (password, actor) => this.guards.assertSuperAdminAndPassword(password, actor),
      assertAdminAndPassword: (password, actor) => this.guards.assertAdminAndPassword(password, actor),
      takeAutoBackup: (actor, reason) => this.guards.takeAutoBackup(actor, reason),
      clearVanSettlementRows: (trx, tenantId) => this.guards.clearVanSettlementRows(trx, tenantId),
    }));
  }

  private get tenant(): SettingsDemoDataTenant {
    return (this._tenant ??= new SettingsDemoDataTenant(this.db, this.audit, {
      assertSuperAdminAndPassword: (password, actor) => this.guards.assertSuperAdminAndPassword(password, actor),
      takeAutoBackup: (actor, reason) => this.guards.takeAutoBackup(actor, reason),
      seedComprehensiveDemoData: (dtoOrPassword, actor) => this.seed.seedComprehensiveDemoData(dtoOrPassword, actor),
    }));
  }

  private get seed(): SettingsDemoDataSeed {
    return (this._seed ??= new SettingsDemoDataSeed(this.db, this.audit, {
      getDemoDataStatus: (actor) => this.status.getDemoDataStatus(actor),
      scope: (actor) => this.guards.scope(actor),
      assertSuperAdminAndPassword: (password, actor) => this.guards.assertSuperAdminAndPassword(password, actor),
      takeAutoBackup: (actor, reason) => this.guards.takeAutoBackup(actor, reason),
      wipeAllData: (password, actor) => this.wipe.wipeAllData(password, actor),
    }));
  }

  private get clear(): SettingsDemoDataClear {
    return (this._clear ??= new SettingsDemoDataClear(this.db, this.audit, {
      scope: (actor) => this.guards.scope(actor),
      assertSuperAdminAndPassword: (password, actor) => this.guards.assertSuperAdminAndPassword(password, actor),
      takeAutoBackup: (actor, reason) => this.guards.takeAutoBackup(actor, reason),
    }));
  }

  async getDemoDataStatus(
    actor: AuthContext,
  ): Promise<{ isEmpty: boolean; productCount: number; saleCount: number; isSuperAdmin: boolean }> {
    return this.status.getDemoDataStatus(actor);
  }
  listActivities() {
    return this.status.listActivities();
  }

  async wipeAllData(password: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    return this.wipe.wipeAllData(password, actor);
  }
  async resetStockBalances(
    password: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; message: string; productsCount: number }> {
    return this.wipe.resetStockBalances(password, actor);
  }
  async wipeCatalogAndStock(password: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    return this.wipe.wipeCatalogAndStock(password, actor);
  }

  async wipeTenantData(
    tenantId: string,
    password: string,
    platformActor: AuthContext,
    skipPasswordCheck = false,
  ): Promise<{ ok: boolean; message: string }> {
    return this.tenant.wipeTenantData(tenantId, password, platformActor, skipPasswordCheck);
  }
  async seedTenantDemoData(
    tenantId: string,
    options: { activityType?: string; wipeExisting?: boolean; seedSales?: boolean; seedOnlineOrders?: boolean },
    platformActor: AuthContext,
  ): Promise<{
    ok: boolean;
    message: string;
    activity?: string;
    productsCount?: number;
    salesCount?: number;
    onlineOrdersCount?: number;
    demoCredentials?: DemoCredential[];
  }> {
    return this.tenant.seedTenantDemoData(tenantId, options, platformActor);
  }

  async seedComprehensiveDemoData(
    dtoOrPassword: string | SeedDemoDataDto,
    actor: AuthContext,
  ): Promise<{
    ok: boolean;
    message: string;
    activity?: string;
    productsCount?: number;
    salesCount?: number;
    onlineOrdersCount?: number;
    demoCredentials?: DemoCredential[];
  }> {
    return this.seed.seedComprehensiveDemoData(dtoOrPassword, actor);
  }

  async clearDemoData(
    password: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; message: string; deletedProductsCount: number }> {
    return this.clear.clearDemoData(password, actor);
  }
}
