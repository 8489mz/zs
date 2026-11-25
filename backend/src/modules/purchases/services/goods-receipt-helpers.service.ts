import { Injectable, UnprocessableEntityException } from '@nestjs/common';

/**
 * GoodsReceiptHelpersService — slice S0 of the goods-receipt split.
 * Pure move of one private account-resolution helper from
 * GoodsReceiptService. No behavior change: the body is byte-identical;
 * the facade keeps a thin private delegate with the same name and
 * signature. The helper takes every input as a parameter (including
 * the transaction handle), so this slice has no constructor deps and
 * the facade builds it with no arguments. The method is public here
 * (private in the facade delegate) — the facade, a different class,
 * cannot call a private slice method (tsc TS2341); the facade
 * delegate stays private, so the facade public surface is unchanged.
 */

@Injectable()
export class GoodsReceiptHelpersService {
  /**
   * Resolve a system account by code, creating it when the tenant's chart lacks it.
   * The previous `if (account) { ...post... }` pattern silently skipped the whole journal when an
   * account was missing, while the stock side had already been written.
   */
  async resolveAccountByCode(trx: any, tenantId: string, accountId: string, code: string): Promise<number | null> {
    const existing = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) {
      if (!existing.is_active)
        throw new UnprocessableEntityException(`الحساب المحاسبي ${code} معطل؛ يلزم تفعيله قبل الترحيل`);
      return Number(existing.id);
    }

    const known: Record<string, { ar: string; en: string; type: string; group: string; balance: string }> = {
      '2125': {
        ar: 'بضاعة مستلمة غير مفوترة',
        en: 'Goods Received Not Invoiced',
        type: 'liability',
        group: 'current_liabilities',
        balance: 'credit',
      },
      '1140': {
        ar: 'مخزون بضاعة ومواد خام',
        en: 'Inventory',
        type: 'asset',
        group: 'current_assets',
        balance: 'debit',
      },
      '5190': {
        ar: 'فروق أسعار مشتريات',
        en: 'Purchase Price Variance',
        type: 'expense',
        group: 'expenses',
        balance: 'debit',
      },
    };
    const spec = known[code];
    if (!spec) return null;

    const [created] = await trx
      .insertInto('accounting_accounts')
      .values({
        tenant_id: tenantId,
        account_id: accountId || tenantId,
        code,
        name_ar: spec.ar,
        name_en: spec.en,
        account_type: spec.type,
        account_group: spec.group,
        normal_balance: spec.balance,
        is_active: true,
        is_system: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .execute();
    return created ? Number(created.id) : null;
  }
}
