import { BadRequestException } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';

/** Settings.currency is the display/book denomination; rate metadata must agree. */
export async function tenantBaseCurrency(db: Kysely<Database>, tenantId: string): Promise<string> {
  const setting = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', 'currency')
    .executeTakeFirst();
  let value: unknown = setting?.value || 'EGP';
  try {
    value = JSON.parse(String(value));
  } catch {
    /* Legacy unquoted setting. */
  }
  const code = String(value).trim().toUpperCase();
  const bases = await db
    .selectFrom('currency_exchange_rates')
    .select(['currency_code', 'exchange_rate'])
    .where('tenant_id', '=', tenantId)
    .where('is_base', '=', true)
    .execute();
  if (
    !/^[A-Z]{3}$/.test(code) ||
    bases.length > 1 ||
    bases.some((row) => row.currency_code !== code || Number(row.exchange_rate) !== 1)
  ) {
    throw new BadRequestException(
      'إعداد عملة الأساس لا يطابق أسعار الصرف؛ تلزم مطابقة الإعدادات قبل أي ترحيل أو تحويل.',
    );
  }
  return code;
}
