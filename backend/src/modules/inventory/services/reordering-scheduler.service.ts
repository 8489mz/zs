import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely } from 'kysely';
import { Database } from '../../../database/database.types';
import { ReorderingRulesService } from './reordering-rules.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

@Injectable()
export class ReorderingSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReorderingSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly reorderingService: ReorderingRulesService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting Automated Reordering & PO Generation Scheduler...');

    // Initial evaluation 45 seconds after system startup
    setTimeout(() => {
      this.checkAndRunAutoReordering().catch((err) => {
        this.logger.warn(`Initial auto-reordering check error: ${err?.message}`);
      });
    }, 45000);

    // Periodic evaluation every 6 hours (matches enterprise procurement cycles)
    this.timer = setInterval(
      () => {
        this.checkAndRunAutoReordering().catch((err) => {
          this.logger.warn(`Periodic auto-reordering check error: ${err?.message}`);
        });
      },
      6 * 60 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Scans all tenants that have active reordering rules, evaluates stock deficits against
   * the virtual forecasted inventory, and generates consolidated Draft POs automatically.
   */
  async checkAndRunAutoReordering() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Find all distinct tenants that have active reordering rules
      const activeTenants = await this.db
        .selectFrom('reordering_rules')
        .select('tenant_id')
        .distinct()
        .where('is_active', '=', true)
        .execute();

      if (!activeTenants || activeTenants.length === 0) {
        return;
      }

      for (const row of activeTenants) {
        const tenantId = row.tenant_id;
        const systemActor: AuthContext = {
          userId: 0,
          sessionId: 'auto-reordering-scheduler',
          username: 'النظام الآلي لإعادة الطلب (Auto Reordering)',
          tenantId,
          accountId: tenantId,
          role: 'admin',
          permissions: ['*'],
        };

        try {
          const result = await this.reorderingService.runEvaluation({ autoCreateOrders: true }, systemActor);

          if (result.generatedOrdersCount > 0) {
            this.logger.log(
              `Auto-reordering generated ${result.generatedOrdersCount} Draft PO(s) for tenant ${tenantId} (${result.breachedRulesCount} breached items evaluated).`,
            );
          }
        } catch (err: any) {
          this.logger.warn(`Auto-reordering error for tenant ${tenantId}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in checkAndRunAutoReordering: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
