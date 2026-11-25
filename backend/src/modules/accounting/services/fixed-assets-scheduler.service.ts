import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AccountingService } from '../accounting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

@Injectable()
export class FixedAssetsSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FixedAssetsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingService: AccountingService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting Automated Fixed Assets Depreciation Scheduler...');

    // Initial check 30 seconds after launch
    setTimeout(() => {
      this.checkAndRunAutoDepreciation().catch((err) => {
        this.logger.warn(`Initial auto depreciation check error: ${err?.message}`);
      });
    }, 30000);

    // Run every 12 hours
    this.timer = setInterval(
      () => {
        this.checkAndRunAutoDepreciation().catch((err) => {
          this.logger.warn(`Periodic auto depreciation check error: ${err?.message}`);
        });
      },
      12 * 60 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic check that iterates over all tenants that have enabled auto-depreciation
   */
  async checkAndRunAutoDepreciation() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Find all tenants that have fixed_assets_auto_depreciate_enabled = 'true'
      const enabledSettings = await this.db
        .selectFrom('settings')
        .select(['tenant_id', 'value'])
        .where('key', '=', 'fixed_assets_auto_depreciate_enabled')
        .execute();

      const now = new Date();
      // Check if today is the end of the month or within the last 2 days of the month
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const currentDay = now.getDate();
      const isEndOfMonth = currentDay >= daysInMonth - 1;

      for (const setting of enabledSettings) {
        if (setting.value === 'true') {
          const tenantId = setting.tenant_id;
          // Check if already ran for this year-month
          const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const lastRun = await this.db
            .selectFrom('settings')
            .select(['value'])
            .where('tenant_id', '=', tenantId)
            .where('key', '=', 'fixed_assets_last_auto_depreciate_month')
            .executeTakeFirst();

          if (lastRun?.value !== yearMonth && isEndOfMonth) {
            this.logger.log(`Executing automated monthly depreciation for tenant ${tenantId} (${yearMonth})...`);
            await this.executeDepreciationForTenant(tenantId, yearMonth);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in checkAndRunAutoDepreciation: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async executeDepreciationForTenant(tenantId: string, yearMonth: string) {
    const mockActor: AuthContext = {
      userId: 0,
      sessionId: 'auto-scheduler-session',
      username: 'النظام الآلي (Auto Scheduler)',
      tenantId: tenantId,
      accountId: tenantId,
      role: 'admin',
      permissions: ['*'],
    };

    try {
      const res = await this.accountingService.depreciateAllFixedAssets(
        { months: 1, note: `إهلاك شهري آلي مجدول لشهر ${yearMonth}` },
        mockActor,
      );

      const hasFailures = Array.isArray((res as any)?.results) && (res as any).results.some((r: any) => r.error);

      // Save last run month ONLY when all assets succeeded without failure (ZS-056)
      if (!hasFailures) {
        await this.db
          .insertInto('settings')
          .values({
            tenant_id: tenantId,
            key: 'fixed_assets_last_auto_depreciate_month',
            value: yearMonth,
          } as any)
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'key'] as never).doUpdateSet({
              value: yearMonth,
            } as any),
          )
          .execute();
      } else {
        this.logger.warn(
          `Fixed assets auto-depreciation for tenant ${tenantId} had partial failures, not marking month ${yearMonth} as complete`,
        );
      }

      return res;
    } catch (err: any) {
      this.logger.error(`Auto depreciation execution failed for ${tenantId}: ${err?.message}`);
      throw err;
    }
  }

  async getSchedulerStatus(tenantId: string) {
    const enabledSetting = await this.db
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'fixed_assets_auto_depreciate_enabled')
      .executeTakeFirst();

    const lastRunSetting = await this.db
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'fixed_assets_last_auto_depreciate_month')
      .executeTakeFirst();

    const activeAssetsCount = await this.db
      .selectFrom('fixed_assets')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const nextRunDate = new Date(now.getFullYear(), now.getMonth(), daysInMonth).toLocaleDateString('ar-EG');

    return {
      enabled: enabledSetting?.value === 'true',
      lastRunMonth: lastRunSetting?.value || null,
      nextScheduledDate: nextRunDate,
      activeAssetsCount: activeAssetsCount?.count || 0,
    };
  }

  async setAutoDepreciationEnabled(tenantId: string, enabled: boolean) {
    await this.db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'fixed_assets_auto_depreciate_enabled',
        value: enabled ? 'true' : 'false',
      } as any)
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'key'] as never).doUpdateSet({
          value: enabled ? 'true' : 'false',
        } as any),
      )
      .execute();

    return { ok: true, enabled };
  }

  async triggerImmediateRun(tenantId: string, actor: AuthContext) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return await this.executeDepreciationForTenant(tenantId, yearMonth);
  }
}
