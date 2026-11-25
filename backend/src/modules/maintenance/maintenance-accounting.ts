import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';

/** Cash / stock mutations and their GL entries must share the caller's DB transaction. */
export async function postMaintenanceJournal(
  trx: Kysely<Database>,
  foundation: AccountingTenantFoundationService,
  posting: AccountingPostingService,
  auth: AuthContext,
  sourceType:
    | 'maintenance_advance'
    | 'maintenance_advance_refund'
    | 'maintenance_delivery'
    | 'maintenance_part_issue'
    | 'maintenance_part_return',
  sourceId: number,
  branchId: number | null,
  locationId: number | null,
  lines: Array<{ code: string; debit?: number; credit?: number; description: string }>,
): Promise<number | null> {
  const scope = requireTenantScope(auth);
  const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
  const normalized = lines
    .map((line) => ({
      ...line,
      debit: roundMoney(Number(line.debit || 0), digits),
      credit: roundMoney(Number(line.credit || 0), digits),
    }))
    .filter((line) => line.debit !== 0 || line.credit !== 0);
  if (!normalized.length) return null;
  if (
    normalized.some(
      (line) => !Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0,
    )
  ) {
    throw new AppError('Invalid maintenance accounting amount', 'MAINTENANCE_AMOUNT_INVALID', 422);
  }
  await foundation.ensureForAuth(trx, auth);
  const accounts = await trx
    .selectFrom('accounting_accounts')
    .select(['id', 'code', 'is_active'])
    .where('tenant_id', '=', scope.tenantId)
    .where('code', 'in', [...new Set(normalized.map((line) => line.code))])
    .execute();
  const byCode = new Map(accounts.filter((a) => a.is_active).map((a) => [a.code, Number(a.id)]));
  if (normalized.some((line) => !byCode.has(line.code))) {
    throw new AppError('Required maintenance ledger account missing', 'MAINTENANCE_ACCOUNT_MISSING', 409);
  }
  return posting.postDomainJournal(trx, {
    sourceType,
    sourceId,
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    entryDate: new Date(),
    description: `Maintenance source ${sourceType} #${sourceId}`,
    branchId,
    locationId,
    createdBy: auth.userId,
    postedBy: auth.userId,
    lines: normalized.map((line) => ({
      accountId: byCode.get(line.code)!,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      partnerType: 'none' as const,
      partnerId: null,
    })),
  });
}
