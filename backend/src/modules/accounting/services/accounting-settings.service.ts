import { assertAccountingCloseReady } from '../accounting-close-readiness';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { UpdateAccountingSettingsDto } from '../dto/accounting.dto';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { lockAccountingPeriod } from '../accounting-period-lock';

/**
 * AccountingSettingsService — slice S5 of the accounting split.
 * Pure move of 2 methods from AccountingService (accounting
 * settings read + write). No behavior change: the bodies are
 * byte-identical except for 1 pre-existing trailing-whitespace
 * blank line, normalized to an empty line (see below); the facade
 * keeps thin delegates with the same names and signatures. This
 * slice calls the facade's kernel helper assertAccountingAccess
 * through a bound dep — it never imports another slice service
 * and it does not post journals (no accountingPosting dep).
 * Trailing whitespace: the pristine file carries 1 blank line
 * with indentation spaces inside updateAccountingSettings
 * (L597, 4 spaces); moving it byte-identically would fail
 * `git diff --check` on the patch, so the slice normalizes it
 * to an empty line. The verify script proves this 1 is the only
 * differing line (WS-normalized byte-identity).
 */

export interface AccountingSettingsDeps {
  db: Kysely<Database>;
  accountingTenantFoundation: AccountingTenantFoundationService;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  assertAccountingAccess: (auth: AuthContext) => void;
}

@Injectable()
export class AccountingSettingsService {
  private readonly db: Kysely<Database>;
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;

  constructor(deps: AccountingSettingsDeps) {
    this.db = deps.db;
    this.accountingTenantFoundation = deps.accountingTenantFoundation;
    this.assertAccountingAccess = deps.assertAccountingAccess;
  }

  async getAccountingSettings(auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const scope = requireTenantScope(auth);
    const settings = await this.db
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!settings) {
      return { settings: null };
    }

    const accountIds = [
      settings.cash_account_id,
      settings.bank_account_id,
      settings.customer_receivable_account_id,
      settings.supplier_payable_account_id,
      settings.inventory_account_id,
      settings.sales_revenue_account_id,
      settings.sales_discount_account_id,
      settings.cogs_account_id,
      settings.purchase_account_id,
      settings.expenses_account_id,
      settings.sales_tax_account_id,
      settings.purchase_tax_account_id,
    ].filter((value): value is number => Number(value || 0) > 0);

    const accounts = accountIds.length
      ? await this.db
          .selectFrom('accounting_accounts')
          .select(['id', 'code', 'name_ar', 'name_en'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', accountIds)
          .execute()
      : [];

    const accountById = new Map(accounts.map((row) => [Number(row.id), row]));
    const mapRef = (id: number | null) => {
      if (!id) return null;
      const account = accountById.get(Number(id));
      if (!account) return { id: String(id) };
      return {
        id: String(account.id),
        code: account.code,
        nameAr: account.name_ar,
        nameEn: account.name_en || '',
      };
    };

    return {
      settings: {
        id: settings.id,
        cashAccount: mapRef(settings.cash_account_id),
        bankAccount: mapRef(settings.bank_account_id),
        customerReceivableAccount: mapRef(settings.customer_receivable_account_id),
        supplierPayableAccount: mapRef(settings.supplier_payable_account_id),
        inventoryAccount: mapRef(settings.inventory_account_id),
        salesRevenueAccount: mapRef(settings.sales_revenue_account_id),
        salesDiscountAccount: mapRef(settings.sales_discount_account_id),
        cogsAccount: mapRef(settings.cogs_account_id),
        purchaseAccount: mapRef(settings.purchase_account_id),
        expensesAccount: mapRef(settings.expenses_account_id),
        salesTaxAccount: mapRef(settings.sales_tax_account_id),
        purchaseTaxAccount: mapRef(settings.purchase_tax_account_id),
        lockDateAll: settings.lock_date_all ? String(settings.lock_date_all).slice(0, 10) : null,
        lockDateNonAdviser: settings.lock_date_non_adviser ? String(settings.lock_date_non_adviser).slice(0, 10) : null,
        lockDateTax: settings.lock_date_tax ? String(settings.lock_date_tax).slice(0, 10) : null,
        updatedAt: settings.updated_at,
      },
    };
  }

  async updateAccountingSettings(dto: UpdateAccountingSettingsDto, auth: AuthContext): Promise<{ success: boolean }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);

    const updateData: Record<string, any> = {};
    if (dto.cashAccountId !== undefined) updateData.cash_account_id = dto.cashAccountId || null;
    if (dto.bankAccountId !== undefined) updateData.bank_account_id = dto.bankAccountId || null;
    if (dto.customerReceivableAccountId !== undefined)
      updateData.customer_receivable_account_id = dto.customerReceivableAccountId || null;
    if (dto.supplierPayableAccountId !== undefined)
      updateData.supplier_payable_account_id = dto.supplierPayableAccountId || null;
    if (dto.inventoryAccountId !== undefined) updateData.inventory_account_id = dto.inventoryAccountId || null;
    if (dto.salesRevenueAccountId !== undefined)
      updateData.sales_revenue_account_id = dto.salesRevenueAccountId || null;
    if (dto.salesDiscountAccountId !== undefined)
      updateData.sales_discount_account_id = dto.salesDiscountAccountId || null;
    if (dto.cogsAccountId !== undefined) updateData.cogs_account_id = dto.cogsAccountId || null;
    if (dto.purchaseAccountId !== undefined) updateData.purchase_account_id = dto.purchaseAccountId || null;
    if (dto.expensesAccountId !== undefined) updateData.expenses_account_id = dto.expensesAccountId || null;
    if (dto.salesTaxAccountId !== undefined) updateData.sales_tax_account_id = dto.salesTaxAccountId || null;
    if (dto.purchaseTaxAccountId !== undefined) updateData.purchase_tax_account_id = dto.purchaseTaxAccountId || null;
    if (dto.lockDateAll !== undefined) updateData.lock_date_all = dto.lockDateAll || null;
    if (dto.lockDateNonAdviser !== undefined) updateData.lock_date_non_adviser = dto.lockDateNonAdviser || null;
    if (dto.lockDateTax !== undefined) updateData.lock_date_tax = dto.lockDateTax || null;
    const referenceColumns = [
      'cash_account_id',
      'bank_account_id',
      'customer_receivable_account_id',
      'supplier_payable_account_id',
      'inventory_account_id',
      'sales_revenue_account_id',
      'sales_discount_account_id',
      'cogs_account_id',
      'purchase_account_id',
      'expenses_account_id',
      'sales_tax_account_id',
      'purchase_tax_account_id',
    ];
    const accountIds = Array.from(
      new Set(referenceColumns.map((column) => Number(updateData[column] || 0)).filter((id) => id > 0)),
    );
    if (accountIds.length) {
      const owned = await this.db
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', accountIds)
        .execute();
      if (owned.length !== accountIds.length) throw new BadRequestException('حساب الإعدادات لا ينتمي لهذه المنشأة.');
    }

    updateData.updated_at = new Date();

    if (Object.keys(updateData).length > 1) {
      // more than just updated_at
      await this.db.transaction().execute(async (trx) => {
        await lockAccountingPeriod(trx, scope.tenantId);
        const closingDates = [dto.lockDateAll, dto.lockDateNonAdviser, dto.lockDateTax]
          .filter((day): day is string => Boolean(day))
          .sort();
        if (closingDates.length)
          await assertAccountingCloseReady(trx, scope.tenantId, '1900-01-01', closingDates[closingDates.length - 1]);
        await trx
          .updateTable('accounting_settings')
          .set(updateData)
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', 1)
          .execute();
      });
    }

    return { success: true };
  }
}
