import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { currencyMoneyDigits, fromMinorUnits, toMinorUnits } from '../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';

/** Post an actual received pharmacy fee, or roll back its source and cash movement. */
export async function postPharmacyCashReceipt(
  trx: Kysely<Database>,
  foundation: AccountingTenantFoundationService,
  posting: AccountingPostingService,
  auth: AuthContext,
  sourceType: 'pharmacy_clinical_service' | 'pharmacy_prescription_cash',
  sourceId: number,
  amount: number,
): Promise<number | null> {
  const scope = requireTenantScope(auth);
  const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
  let value: number;
  try {
    value = fromMinorUnits(toMinorUnits(amount, digits), digits);
  } catch {
    throw new AppError(
      'Pharmacy cash amount exceeds tenant currency precision',
      'PHARMACY_CURRENCY_PRECISION_INVALID',
      422,
    );
  }
  if (value < 0)
    throw new AppError('Pharmacy collected amount cannot be negative', 'PHARMACY_CASH_AMOUNT_INVALID', 422);
  if (value === 0) return null;
  await foundation.ensureForAuth(trx, auth);
  const accounts = await trx
    .selectFrom('accounting_accounts')
    .select(['id', 'code', 'is_active'])
    .where('tenant_id', '=', scope.tenantId)
    .where('code', 'in', ['1110', '4200'])
    .execute();
  const byCode = new Map(accounts.filter((row) => row.is_active).map((row) => [row.code, Number(row.id)]));
  if (!byCode.has('1110') || !byCode.has('4200')) {
    throw new AppError(
      'Required pharmacy cash or service revenue account is missing',
      'PHARMACY_LEDGER_ACCOUNT_MISSING',
      409,
    );
  }
  return posting.postDomainJournal(trx, {
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    sourceType,
    sourceId,
    entryDate: new Date(),
    description: `Pharmacy cash receipt ${sourceType} #${sourceId}`,
    createdBy: auth.userId,
    postedBy: auth.userId,
    lines: [
      {
        accountId: byCode.get('1110')!,
        debit: value,
        credit: 0,
        description: 'Pharmacy cash collected',
        partnerType: 'none',
        partnerId: null,
      },
      {
        accountId: byCode.get('4200')!,
        debit: 0,
        credit: value,
        description: 'Pharmacy service cash revenue',
        partnerType: 'none',
        partnerId: null,
      },
    ],
  });
}
