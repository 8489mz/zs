import { BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { missingSourcePostingIssues } from './accounting-integrity';
import { nextAccountingDay } from './engines/accounting-date.engine';

/** Caller holds accounting-period lock; deferred postings must settle before sign-off. */
export async function assertAccountingCloseReady(
  db: Kysely<Database>,
  tenantId: string,
  start: string,
  end: string,
): Promise<void> {
  const interest = await sql<{
    id: number;
  }>`select id from accounting_installment_interest where tenant_id = ${tenantId} and journal_entry_id is null and recognition_date <= ${end}::date limit 1`.execute(
    db,
  );
  if (interest.rows.length)
    throw new BadRequestException('توجد فوائد تمويل مستحقة لم ترحل؛ يلزم استكمال الاستحقاق قبل الإقفال.');
  const pending = await db
    .selectFrom('accounting_posting_failures')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('resolved_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  if (pending) throw new BadRequestException('توجد قيود فاشلة بانتظار الاسترداد؛ يجب تسويتها قبل إقفال الدفاتر.');
  const missing =
    await sql`SELECT * FROM (${missingSourcePostingIssues(tenantId, start, nextAccountingDay(end))}) AS missing_sources LIMIT 1`.execute(
      db,
    );
  if (missing.rows.length)
    throw new BadRequestException('توجد فواتير مرحلة بدون قيد محاسبي نشط؛ يلزم استكمال الترحيل قبل الإقفال.');
}
