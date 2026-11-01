import { BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { lockAccountingPeriod } from './accounting-period-lock';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';

export async function assertBusinessAccountingDate(db: Kysely<Database>, tenantId: string, date: Date, taxable = false): Promise<void> {
  await lockAccountingPeriod(db, tenantId);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('تاريخ الترحيل غير صالح.');
  const day = await resolveBusinessDateKey(db, tenantId, date);
  const settings = await db.selectFrom('accounting_settings').select(['lock_date_all', 'lock_date_non_adviser', 'lock_date_tax'])
    .where('tenant_id', '=', tenantId).where('id', '=', 1).executeTakeFirst();
  for (const lock of [settings?.lock_date_all, settings?.lock_date_non_adviser, ...(taxable ? [settings?.lock_date_tax] : [])]) {
    const raw: unknown = lock;
    const lockDay = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw || '').slice(0, 10);
    if (lockDay && day <= lockDay) throw new BadRequestException(`الفترة المحاسبية مقفلة حتى ${lockDay}.`);
  }
  const closed = await db.selectFrom('accounting_fiscal_periods').select('id')
    .where('tenant_id', '=', tenantId).where('status', '=', 'closed')
    .where('start_date', '<=', day).where('end_date', '>=', day).executeTakeFirst();
  if (closed) throw new BadRequestException('الفترة المحاسبية الشهرية مقفلة.');
}

export async function assertHierarchyParent(db: Kysely<Database>, table: 'accounting_accounts' | 'cost_centers', tenantId: string, id: number | null, parentId: number | null): Promise<void> {
  if (parentId == null) return;
  if (!Number.isSafeInteger(parentId) || parentId <= 0 || parentId === id) throw new BadRequestException('الأب غير صالح أو يسبب دورة في الشجرة.');
  const result = await sql<{ id: number; parent_id: number | null }>`
    with recursive ancestors as (
      select id, parent_id, array[id] as visited from ${sql.table(table)} where tenant_id = ${tenantId} and id = ${parentId}
      union all
      select p.id, p.parent_id, a.visited || p.id from ${sql.table(table)} p join ancestors a on p.id = a.parent_id
      where p.tenant_id = ${tenantId} and not p.id = any(a.visited)
    ) select id, parent_id from ancestors
  `.execute(db);
  const ancestorIds = new Set(result.rows.map(row => Number(row.id)));
  if (!result.rows.length || result.rows.some(row => Number(row.id) === id || Number(row.parent_id) === parentId || (row.parent_id != null && !ancestorIds.has(Number(row.parent_id))))) {
    throw new BadRequestException('الأب لا يتبع المنشأة أو يسبب دورة في الشجرة.');
  }
}
