import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../accounting-posting.service';
import { resolveBusinessDateKey } from '../engines/accounting-date.engine';

@Injectable()
export class InstallmentInterestSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InstallmentInterestSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private startup?: ReturnType<typeof setTimeout>;
  private running = false;
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>, private readonly posting: AccountingPostingService) {}
  onApplicationBootstrap(): void {
    this.startup = setTimeout(() => { void this.accrueDue(); }, 30_000);
    this.timer = setInterval(() => { void this.accrueDue(); }, 60 * 60 * 1000);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startup) clearTimeout(this.startup);
  }
  async accrueDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Candidate pre-filter bound: the UTC date + 1 day, so a tenant whose
      // local day is already tomorrow is never missed. The accrual bound
      // below is each tenant's own local business day, never this horizon.
      const horizonDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const horizon = `${horizonDate.getUTCFullYear()}-${String(horizonDate.getUTCMonth() + 1).padStart(2, '0')}-${String(horizonDate.getUTCDate()).padStart(2, '0')}`;
      const tenants = await sql<{ tenant_id: string }>`select distinct tenant_id from accounting_installment_interest
        where journal_entry_id is null and recognition_date <= ${horizon}::date`.execute(this.db);
      for (const row of tenants.rows) {
        try {
          const today = await resolveBusinessDateKey(this.db, row.tenant_id, new Date());
          await this.posting.recognizeInstallmentInterest(this.db, row.tenant_id, today);
        }
        catch (error) { this.logger.error(`Interest accrual requires reconciliation for tenant ${row.tenant_id}: ${(error as Error).message}`); }
      }
    } catch (error) { this.logger.error(`Interest accrual failed: ${(error as Error).message}`); }
    finally { this.running = false; }
  }
}
