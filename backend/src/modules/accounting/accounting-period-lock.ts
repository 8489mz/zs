import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { accountingDateKey, assertTaxPeriodOpen } from './accounting-tax-lock';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';

/** Serialize a tenant's postings and fiscal-period transitions in one transaction. */
export async function lockAccountingPeriod(queryable: Kysely<Database>, tenantId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':accounting-period'))`.execute(queryable);
}

/** Also used by legacy domain writers that insert their own journal headers. */
export async function assertAutomatedJournalPeriodOpen(
  queryable: Kysely<Database>, tenantId: string, entryDate: Date | string, accountIds: number[],
): Promise<void> {
  await lockAccountingPeriod(queryable, tenantId);
  const date = await resolveBusinessDateKey(queryable, tenantId, entryDate);
  const settings = await queryable.selectFrom('accounting_settings')
    .select(['lock_date_all', 'lock_date_non_adviser'])
    .where('tenant_id', '=', tenantId).where('id', '=', 1).executeTakeFirst();
  if (settings?.lock_date_all && date <= accountingDateKey(settings.lock_date_all)) {
    throw new AppError('الفترة المحاسبية مقفلة نهائياً. لا يمكن الترحيل في فترة مغلقة.', 'ACCOUNTING_PERIOD_LOCKED', 422);
  }
  if (settings?.lock_date_non_adviser && date <= accountingDateKey(settings.lock_date_non_adviser)) {
    throw new AppError('الفترة المحاسبية مقفلة للعمليات التشغيلية. يرجى مراجعة الإدارة المالية.', 'ACCOUNTING_PERIOD_LOCKED_OPERATIONAL', 422);
  }
  await assertTaxPeriodOpen(queryable, tenantId, entryDate, accountIds);
  const closedPeriod = await queryable.selectFrom('accounting_fiscal_periods').select('name')
    .where('tenant_id', '=', tenantId).where('status', '=', 'closed')
    .where('start_date', '<=', date).where('end_date', '>=', date).executeTakeFirst();
  if (closedPeriod) {
    throw new AppError(`الفترة المحاسبية الشهرية [${closedPeriod.name}] مقفلة.`, 'ACCOUNTING_PERIOD_LOCKED', 422);
  }
}
