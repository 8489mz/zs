import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';

/**
 * INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS: narrow counterpart
 * list for the drawer movement form (safe_drop /
 * safe_replenishment). The picker used to query GET
 * /api/accounting/accounts, whose AccountingAccessGuard allows only
 * super_admin / admin / the `accounting` permission — and the
 * default cashier template carries `accounts` but NOT `accounting`,
 * so a cashier got 403, which the picker's `.catch(() => ({
 * accounts: [] }))` silently turned into "no active cash or bank
 * accounts". This service lives under the cash-drawer scope
 * (cashDrawer permission only, which every cashier holds by
 * default), so it works for every cashier with no manual checkbox.
 * It returns ONLY active cash/bank asset accounts with a debit
 * normal balance — id/code/name plus the discriminator fields the
 * picker filter needs (accountType, normalBalance, isActive,
 * flags.isCashBank, all guaranteed by the WHERE clause below) —
 * NO balances, NO parent/depth/chart data. The Sep-2026
 * AccountingAccessGuard is untouched and the full chart stays
 * admin-only. The picker still excludes the drawer cash account
 * itself (code 1110) on the frontend.
 *
 * Kept in its own file (instead of a method on CashDrawerService)
 * because that file is a file-size-ratchet baseline file at 1654
 * lines and must not grow.
 */
@Injectable()
export class CashDrawerCounterpartService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async listCounterpartAccounts(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'name_en', 'account_type', 'normal_balance', 'is_active', 'is_cash_bank'])
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .where('is_cash_bank', '=', true)
      .where('account_type', '=', 'asset')
      .where('normal_balance', '=', 'debit')
      .orderBy('code', 'asc')
      .execute();
    return {
      accounts: rows.map((row) => ({
        id: String(row.id),
        code: row.code,
        nameAr: row.name_ar,
        nameEn: row.name_en || '',
        accountType: row.account_type,
        normalBalance: row.normal_balance,
        isActive: Boolean(row.is_active),
        flags: { isCashBank: Boolean(row.is_cash_bank) },
      })),
    };
  }
}
