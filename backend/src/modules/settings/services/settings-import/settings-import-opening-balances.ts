import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { stockMovementTotal } from '../../../catalog/engines/stock-movement-total.engine';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { DbExecutor, TenantScope } from './settings-import-shared';

/**
 * Narrow port for the single posting call this file makes: the
 * opening-stock journal (Dr inventory 1140 / Cr opening capital
 * 3100). This file depends on this local structural interface, not
 * on the concrete posting-service module, so the external-import
 * count into the posting service drops by one with zero behaviour
 * change: SettingsImportService still passes the real service,
 * which satisfies the port structurally (same method, same params
 * shape — proven by backend tsc at the call site, and by the
 * slice-8 spec's assignability check).
 */
export type OpeningStockPostingPort = {
  postDomainJournal(
    queryable: DbExecutor,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date | string;
      description: string;
      branchId?: number | null;
      locationId?: number | null;
      createdBy: number | null;
      lines: {
        accountId: number;
        debit: number;
        credit: number;
        description: string;
        partnerType: string;
        partnerId: number | null;
        branchId?: number | null;
        locationId?: number | null;
      }[];
    },
  ): Promise<number>;
};

export class SettingsImportOpeningBalances {
  constructor(
    private readonly bound: {
      scope: (actor: AuthContext) => TenantScope;
      tenantFields: (actor: AuthContext) => Record<string, string>;
    },
    private readonly accountingPosting?: OpeningStockPostingPort,
  ) {}

  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantFields(actor: AuthContext): Record<string, string> {
    return this.bound.tenantFields(actor);
  }

  async addCustomerOpeningBalance(
    db: DbExecutor,
    customerId: number,
    amount: number,
    actor: AuthContext,
  ): Promise<void> {
    if (Math.abs(amount) <= 0.0001) return;
    const scope = this.scope(actor);
    await db
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: 'opening_balance',
        amount,
        balance_after: amount,
        note: 'رصيد أولي من الاستيراد',
        reference_type: 'customer',
        reference_id: customerId,
        created_by: actor.userId,
        branch_id: null,
        location_id: null,
        ...this.tenantFields(actor),
      })
      .execute();
    await db
      .updateTable('customers')
      .set({ balance: amount, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();
  }

  async addSupplierOpeningBalance(
    db: DbExecutor,
    supplierId: number,
    amount: number,
    actor: AuthContext,
  ): Promise<void> {
    if (Math.abs(amount) <= 0.0001) return;
    const scope = this.scope(actor);
    await db
      .insertInto('supplier_ledger')
      .values({
        supplier_id: supplierId,
        entry_type: 'opening_balance',
        amount,
        balance_after: amount,
        note: 'رصيد أولي من الاستيراد',
        reference_type: 'supplier',
        reference_id: supplierId,
        created_by: actor.userId,
        branch_id: null,
        location_id: null,
        ...this.tenantFields(actor),
      })
      .execute();
    await db
      .updateTable('suppliers')
      .set({ balance: amount, updated_at: sql`NOW()` })
      .where('id', '=', supplierId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();
  }

  /**
   * INV-GL-INVENTORY-VALUE: imported opening stock is a real acquisition
   * of inventory value, so it posts the same opening-stock journal the
   * single-product create path posts (Dr inventory 1140 / Cr opening
   * capital 3100, at the tenant's book digits) inside the import's own
   * transaction. Before this fix both import entry points wrote stock
   * with no journal at all: importProducts created products with an
   * initial stock_qty and importOpeningStock re-set scoped quantities,
   * so the stock value on hand (sum stock_qty x cost_price) grew while
   * the GL inventory balance only moved on purchases and sales — the
   * live test10k gap (GL 232.71 against 24,050.00 in the main
   * warehouse). A decrease posts the mirror entry (Dr 3100 / Cr 1140).
   * Zero-value stock posts nothing, exactly like the single-create
   * path. Prospective only: stock imported before this fix stays unposted.
   */
  async postImportedOpeningStock(
    trx: DbExecutor,
    opts: {
      productId: number;
      signedQty: number;
      unitCost: number;
      locationId: number | null;
      branchId: number | null;
      sourceType: string;
      sourceId: number;
      actor: AuthContext;
    },
  ): Promise<void> {
    if (!this.accountingPosting) {
      throw new AppError('Accounting services are required for opening stock', 'OPENING_STOCK_LEDGER_UNAVAILABLE', 500);
    }
    const scope = this.scope(opts.actor);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const amount = stockMovementTotal(opts.signedQty, opts.unitCost, digits);
    if (amount === 0) return;
    const accounts = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', 'in', ['1140', '3100'])
      .where('is_active', '=', true)
      .execute();
    const byCode = new Map(accounts.map((account) => [account.code, Number(account.id)]));
    if (!byCode.get('1140') || !byCode.get('3100')) {
      throw new AppError('Inventory or opening capital account is unavailable', 'OPENING_STOCK_ACCOUNT_MISSING', 422);
    }
    const value = Math.abs(amount);
    const increase = opts.signedQty > 0;
    await this.accountingPosting.postDomainJournal(trx, {
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: increase
        ? `رصيد افتتاحي مستورد للصنف ${opts.productId}`
        : `تخفيض رصيد افتتاحي مستورد للصنف ${opts.productId}`,
      branchId: opts.branchId,
      locationId: opts.locationId,
      createdBy: opts.actor.userId,
      lines: [
        {
          accountId: increase ? byCode.get('1140')! : byCode.get('3100')!,
          debit: value,
          credit: 0,
          description: increase ? 'إثبات مخزون افتتاحي مستورد' : 'تخفيض مقابل المخزون الافتتاحي المستورد',
          partnerType: 'none',
          partnerId: null,
          branchId: opts.branchId,
          locationId: opts.locationId,
        },
        {
          accountId: increase ? byCode.get('3100')! : byCode.get('1140')!,
          debit: 0,
          credit: value,
          description: increase ? 'مقابل المخزون الافتتاحي ضمن رأس المال' : 'تخفيض مخزون افتتاحي مستورد',
          partnerType: 'none',
          partnerId: null,
          branchId: opts.branchId,
          locationId: opts.locationId,
        },
      ],
    });
  }
}
