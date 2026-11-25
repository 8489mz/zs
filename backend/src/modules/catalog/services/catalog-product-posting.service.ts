/**
 * CatalogProductPostingService — slice P1 of the catalog-product split.
 * Pure move of 3 methods from CatalogProductService (posting: the
 * opening-stock accounts guard, the book-digits resolver, and the
 * opening-stock journal poster). No behavior change: the bodies are
 * byte-identical except the 3 private methods are PUBLIC in this slice
 * only (the facade keeps private delegates with the same names/signatures,
 * and P4/P6/P7/P8 call them via bound deps at their merges).
 * Deps: db + accountingPosting? + accountingFoundation? (both optional,
 * guarded by the OPENING_STOCK_LEDGER_UNAVAILABLE throw in
 * ensureOpeningStockAccounts — the posting fallback is the optional dep
 * itself, never required, never defaulted) + kernel tenantId / accountId
 * (stay REAL private methods in the facade, passed bound via the HR
 * kernel pattern). The `!` on this.accountingPosting in postOpeningStock
 * is safe by construction: every caller runs ensureOpeningStockAccounts
 * first (prep §3.1).
 * Clock pin travels verbatim: entryDate: new Date() in postOpeningStock
 * (journal timestamp, no instant comparison, no UTC-slice normalizer).
 * INV-CATALOG-STOCK-TOTALS-BOOK-DIGITS travels with bookDigits.
 * This slice also creates catalog-product-types.ts (the 9 type aliases)
 * — it is the first merge.
 * Driving spec: catalog-product-save / book-digits (postOpeningStock).
 * No spec repoint travels in this patch — prep §7.3 rules all six
 * source-text repoints MERGE-OWNED.
 * MERGE NOTE: at P4/P6/P7/P8's merge, their this.bookDigits( /
 * this.postOpeningStock( / this.ensureOpeningStockAccounts( calls must
 * resolve through bound deps wired from this slice instance in the
 * facade ctor (HR H1 pattern: this.postingService.<method>.bind(this.postingService));
 * the facade's private delegates keep them working until then.
 */

import { Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { ProductWriteExecutor } from './catalog-product-types';

export interface CatalogProductPostingDeps {
  db: Kysely<Database>;
  accountingPosting?: AccountingPostingService;
  accountingFoundation?: AccountingTenantFoundationService;
  tenantId: (actor: AuthContext) => string;
  accountId: (actor: AuthContext) => string;
}

@Injectable()
export class CatalogProductPostingService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly accountingFoundation?: AccountingTenantFoundationService;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly accountId: (actor: AuthContext) => string;

  constructor(deps: CatalogProductPostingDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.accountingFoundation = deps.accountingFoundation;
    this.tenantId = deps.tenantId;
    this.accountId = deps.accountId;
  }

  public async ensureOpeningStockAccounts(actor: AuthContext): Promise<void> {
    if (!this.accountingPosting || !this.accountingFoundation) {
      throw new AppError('Accounting services are required for opening stock', 'OPENING_STOCK_LEDGER_UNAVAILABLE', 500);
    }
    await this.accountingFoundation.ensureForAuth(this.db, actor);
  }

  // INV-CATALOG-STOCK-TOTALS-BOOK-DIGITS: book digits resolved on the
  // caller's own handle (the open transaction inside write flows),
  // fail closed on a base-currency/rate mismatch via tenantBaseCurrency.
  public async bookDigits(executor: ProductWriteExecutor, actor: AuthContext): Promise<MoneyDigits> {
    return currencyMoneyDigits(await tenantBaseCurrency(executor, this.tenantId(actor)));
  }

  public async postOpeningStock(
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ): Promise<void> {
    const amount = stockMovementTotal(qty, unitCost, await this.bookDigits(trx, actor));
    if (amount <= 0) return;
    const accounts = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', this.tenantId(actor))
      .where('code', 'in', ['1140', '3100'])
      .where('is_active', '=', true)
      .execute();
    const byCode = new Map(accounts.map((account) => [account.code, Number(account.id)]));
    if (!byCode.get('1140') || !byCode.get('3100')) {
      throw new AppError('Inventory or opening capital account is unavailable', 'OPENING_STOCK_ACCOUNT_MISSING', 422);
    }
    await this.accountingPosting!.postDomainJournal(trx, {
      sourceType: 'catalog_opening_stock',
      sourceId: productId,
      tenantId: this.tenantId(actor),
      accountId: this.accountId(actor),
      entryDate: new Date(),
      description: `رصيد افتتاحي للصنف ${productId}`,
      createdBy: actor.userId,
      lines: [
        {
          accountId: byCode.get('1140')!,
          debit: amount,
          credit: 0,
          description: 'إثبات مخزون افتتاحي',
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId,
        },
        {
          accountId: byCode.get('3100')!,
          debit: 0,
          credit: amount,
          description: 'مقابل المخزون الافتتاحي ضمن رأس المال',
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId,
        },
      ],
    });
  }
}
