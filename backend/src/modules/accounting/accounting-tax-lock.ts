import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';

/**
 * Day key for STORED calendar dates (lock dates, fiscal period
 * bounds): a DATE column already is a calendar day, so slicing its
 * UTC rendering is exact. Entry INSTANTS must never use this --
 * resolve them with resolveBusinessDateKey in the tenant's timezone
 * (INV-BUSINESS-DATE-TENANT-LOCAL).
 */
export function accountingDateKey(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Infer tax impact from ledger accounts, never from a caller-controlled flag. */
export async function assertTaxPeriodOpen(
  queryable: Kysely<Database>, tenantId: string, entryDate: Date | string, accountIds: number[],
): Promise<void> {
  const settings = await queryable.selectFrom('accounting_settings')
    .select(['lock_date_tax', 'purchase_tax_account_id', 'sales_tax_account_id'])
    .where('tenant_id', '=', tenantId).where('id', '=', 1).executeTakeFirst();
  if (!settings?.lock_date_tax || !accountIds.length) return;
  const date = await resolveBusinessDateKey(queryable, tenantId, entryDate);
  const lock = accountingDateKey(settings.lock_date_tax);
  if (date > lock) return;
  const configuredTaxIds = [settings.purchase_tax_account_id, settings.sales_tax_account_id]
    .map(Number).filter((id) => id > 0);
  const taxAccount = await queryable.selectFrom('accounting_accounts').select('id')
    .where('tenant_id', '=', tenantId).where('id', 'in', accountIds)
    .where((eb) => eb.or([
      eb('is_tax', '=', true),
      ...(configuredTaxIds.length ? [eb('id', 'in', configuredTaxIds)] : []),
    ])).executeTakeFirst();
  if (taxAccount) {
    throw new AppError(`الفترة الضريبية مقفلة حتى تاريخ ${lock}. لا يمكن ترحيل قيد يؤثر على حسابات الضريبة.`,
      'ACCOUNTING_TAX_PERIOD_LOCKED', 422);
  }
}
