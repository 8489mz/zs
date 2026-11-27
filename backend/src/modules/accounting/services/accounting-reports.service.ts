import { tenantBaseCurrency } from '../accounting-currency';
import { type MoneyDigits, currencyMoneyDigits } from '../engines/money-minor-units.engine';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { type Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  CashMovementQueryDto,
  FinancialSummaryQueryDto,
  InventoryValueQueryDto,
  ReceivablesPayablesQueryDto,
} from '../dto/accounting.dto';
import { nextAccountingDay } from '../engines/accounting-date.engine';

/**
 * AccountingReportsService — slice S6 of the accounting split.
 * Pure move of 5 methods from AccountingService (the money reports:
 * financial summary, receivables/payables, cash movement, inventory
 * value, cost-center report). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are kernel only (db + the five bound kernel
 * helpers); no cross-slice deps. Date handling travels verbatim:
 * nextAccountingDay x5 for the dateTo bounds + filter-date parsing
 * via new Date(x) x6 (parsing user-supplied filter values, not "now"
 * — no bare new Date() in this slice); tenantBaseCurrency x4 for the
 * book digits. No toFixed / inlineRound / direct roundMoney here.
 * All 5 methods are controller-only (0 driving specs — the riskiest
 * unpinned set in the file per prep §7); the merge proof for S6 is
 * the merged-tree critical run + ci-fast, not a RED. The
 * tenant-scoped-reads pin MT-16 (getInventoryValue pls.tenant_id
 * join) is merge-owned (repoint to a multi-file read).
 */

export interface AccountingReportsDeps {
  db: Kysely<Database>;
  // Bound kernel helpers (same names as the facade members, so the
  // moved bodies are byte-identical). assertAccountingAccess +
  // inCodes + mapPeriod + tenantPredicate + toMoney stay in the
  // facade forever.
  assertAccountingAccess: (auth: AuthContext) => void;
  inCodes: (code: string, codes: string[]) => boolean;
  mapPeriod: (dateFrom?: string, dateTo?: string) => { from: string | null; to: string | null };
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
}

@Injectable()
export class AccountingReportsService {
  private readonly db: Kysely<Database>;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly inCodes: (code: string, codes: string[]) => boolean;
  private readonly mapPeriod: (dateFrom?: string, dateTo?: string) => { from: string | null; to: string | null };
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;

  constructor(deps: AccountingReportsDeps) {
    this.db = deps.db;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.inCodes = deps.inCodes;
    this.mapPeriod = deps.mapPeriod;
    this.tenantPredicate = deps.tenantPredicate;
    this.toMoney = deps.toMoney;
  }

  async getFinancialSummary(filters: FinancialSummaryQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));

    const dateFrom = filters.date_from ? new Date(filters.date_from) : null;
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;

    let query = this.db
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id'),
      )
      .innerJoin('accounting_accounts as a', (join: any) =>
        join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'),
      )
      .select([
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'a.account_type as account_type',
        'a.account_group as account_group',
        'je.source_type as source_type',
        sql<number>`COALESCE(SUM(l.debit), 0)`.as('debit'),
        sql<number>`COALESCE(SUM(l.credit), 0)`.as('credit'),
      ])
      .where('je.status', '=', 'posted')
      .where('je.source_type', 'not in', ['fiscal_year_closing', 'fiscal_year_reopen'])
      .where(this.tenantPredicate(auth, 'je'))
      .where(this.tenantPredicate(auth, 'l'));

    if (dateFrom) {
      query = query.where('je.entry_date', '>=', dateFrom);
    }
    if (dateTo) {
      query = query.where('je.entry_date', '<', nextAccountingDay(dateTo));
    }
    if (branchId) {
      query = query.where('je.branch_id', '=', branchId);
    }
    if (locationId) {
      query = query.where('je.location_id', '=', locationId);
    }

    const rows = await query
      .groupBy(['a.code', 'a.name_ar', 'a.account_type', 'a.account_group', 'je.source_type'])
      .execute();

    const REVENUE_CODES = ['4100', '4200'];
    const CONTRA_REVENUE_CODES = ['4300', '4400'];
    const COGS_CODES = ['5100', '5200', '5300'];
    const CASH_BANK_CODES = ['1110', '1120'];

    let grossSales = 0;
    let salesReturns = 0;
    let salesDiscounts = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    let customerCollections = 0;
    let supplierPayments = 0;
    let treasuryExpenses = 0;
    let cashDebits = 0;
    let cashCredits = 0;

    const revenueBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();
    const expenseBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();
    const cashBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();

    for (const row of rows) {
      const code = String(row.account_code || '');
      const accountNameAr = String(row.account_name_ar || '');
      const accountType = String(row.account_type || '');
      const accountGroup = String(row.account_group || '');
      const debit = this.toMoney(row.debit, digits);
      const credit = this.toMoney(row.credit, digits);
      const sourceType = String(row.source_type || '');
      const revenueMovement = this.toMoney(credit - debit, digits);
      const expenseMovement = this.toMoney(debit - credit, digits);

      if (this.inCodes(code, REVENUE_CODES) || accountType === 'revenue') {
        if (!this.inCodes(code, CONTRA_REVENUE_CODES) && accountType !== 'contra_revenue') {
          grossSales = this.toMoney(grossSales + revenueMovement, digits);
          const current = revenueBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
          current.amount = this.toMoney(current.amount + revenueMovement, digits);
          revenueBreakdown.set(code, current);
        }
      }

      if (code === '4400') {
        salesReturns = this.toMoney(salesReturns + expenseMovement, digits);
      }
      if (code === '4300') {
        salesDiscounts = this.toMoney(salesDiscounts + expenseMovement, digits);
      }
      if (accountType === 'contra_revenue' && !this.inCodes(code, ['4300', '4400'])) {
        salesReturns = this.toMoney(salesReturns + expenseMovement, digits);
      }

      if (this.inCodes(code, COGS_CODES) || accountGroup === 'cogs') {
        cogs = this.toMoney(cogs + expenseMovement, digits);
      }

      const isOperatingExpense =
        (accountType === 'expense' || accountType === 'contra_expense' || accountGroup === 'operating_expenses') &&
        !this.inCodes(code, COGS_CODES) &&
        accountGroup !== 'cogs';
      if (isOperatingExpense) {
        operatingExpenses = this.toMoney(operatingExpenses + expenseMovement, digits);
        const current = expenseBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + expenseMovement, digits);
        expenseBreakdown.set(code, current);
      }

      if (this.inCodes(code, CASH_BANK_CODES) || accountGroup === 'cash_bank') {
        cashDebits = this.toMoney(cashDebits + Math.max(0, debit), digits);
        cashCredits = this.toMoney(cashCredits + Math.max(0, credit), digits);
        const movement = this.toMoney(debit - credit, digits);
        const current = cashBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + movement, digits);
        cashBreakdown.set(code, current);

        if (sourceType === 'customer_payment' && debit > 0) {
          customerCollections = this.toMoney(customerCollections + debit, digits);
        }
        if (
          (sourceType === 'supplier_payment' || sourceType === 'supplier_payment_schedule_settlement') &&
          credit > 0
        ) {
          supplierPayments = this.toMoney(supplierPayments + credit, digits);
        }
        if ((sourceType === 'expense' || sourceType === 'treasury_expense') && credit > 0) {
          treasuryExpenses = this.toMoney(treasuryExpenses + credit, digits);
        }
      }
    }

    const netSales = this.toMoney(grossSales - salesReturns - salesDiscounts, digits);
    const grossProfit = this.toMoney(netSales - cogs, digits);
    const netProfit = this.toMoney(grossProfit - operatingExpenses, digits);
    // This is period movement only (not an opening/closing balance).
    const netCashMovement = this.toMoney(cashDebits - cashCredits, digits);

    const asArray = (map: Map<string, { accountCode: string; accountNameAr: string; amount: number }>) =>
      Array.from(map.values()).sort((a, b) => Number(a.accountCode || 0) - Number(b.accountCode || 0));

    return {
      period: this.mapPeriod(filters.date_from, filters.date_to),
      cards: {
        grossSales,
        salesReturns,
        salesDiscounts,
        netSales,
        cogs,
        grossProfit,
        operatingExpenses,
        netProfit,
        customerCollections,
        supplierPayments,
        treasuryExpenses,
        netCashMovement,
      },
      breakdowns: {
        revenueAccounts: asArray(revenueBreakdown),
        expenseAccounts: asArray(expenseBreakdown),
        cashMovements: asArray(cashBreakdown),
      },
    };
  }

  async getReceivablesPayables(
    filters: ReceivablesPayablesQueryDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;
    const showZero =
      String(filters.show_zero || '')
        .trim()
        .toLowerCase() === 'true';

    if (!dateTo && !branchId && !locationId) {
      const [customers, suppliers, customerLastRows, supplierLastRows] = await Promise.all([
        this.db
          .selectFrom('customers')
          .select(['id', 'name', 'phone', 'balance'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(auth))
          .orderBy('name', 'asc')
          .execute(),
        this.db
          .selectFrom('suppliers')
          .select(['id', 'name', 'phone', 'balance'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(auth))
          .orderBy('name', 'asc')
          .execute(),
        this.db
          .selectFrom('customer_ledger')
          .select(['customer_id', (eb) => eb.fn.max('created_at').as('last_movement_at')])
          .where(this.tenantPredicate(auth))
          .groupBy('customer_id')
          .execute(),
        this.db
          .selectFrom('supplier_ledger')
          .select(['supplier_id', (eb) => eb.fn.max('created_at').as('last_movement_at')])
          .where(this.tenantPredicate(auth))
          .groupBy('supplier_id')
          .execute(),
      ]);

      const customerLastMap = new Map(
        customerLastRows.map((row) => [
          String(row.customer_id || ''),
          row.last_movement_at ? String(row.last_movement_at) : '',
        ]),
      );
      const supplierLastMap = new Map(
        supplierLastRows.map((row) => [
          String(row.supplier_id || ''),
          row.last_movement_at ? String(row.last_movement_at) : '',
        ]),
      );

      const customerRows = customers
        .map((row) => ({
          customerId: String(row.id),
          customerName: row.name || '',
          phone: row.phone || '',
          balance: this.toMoney(row.balance, digits),
          lastMovementDate: customerLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const supplierRows = suppliers
        .map((row) => ({
          supplierId: String(row.id),
          supplierName: row.name || '',
          phone: row.phone || '',
          balance: this.toMoney(row.balance, digits),
          lastMovementDate: supplierLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const customerReceivables = this.toMoney(
        customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
        digits,
      );
      const supplierPayables = this.toMoney(
        supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
        digits,
      );

      return {
        totals: {
          customerReceivables,
          supplierPayables,
          netPosition: this.toMoney(customerReceivables - supplierPayables, digits),
        },
        customers: customerRows.sort((a, b) => b.balance - a.balance),
        suppliers: supplierRows.sort((a, b) => b.balance - a.balance),
      };
    }

    let customerLedgerQuery = this.db
      .selectFrom('customer_ledger')
      .select([
        'customer_id',
        (eb) => eb.fn.sum<number>('amount').as('balance_total'),
        (eb) => eb.fn.max('created_at').as('last_movement_at'),
      ])
      .where(this.tenantPredicate(auth));

    let supplierLedgerQuery = this.db
      .selectFrom('supplier_ledger')
      .select([
        'supplier_id',
        (eb) => eb.fn.sum<number>('amount').as('balance_total'),
        (eb) => eb.fn.max('created_at').as('last_movement_at'),
      ])
      .where(this.tenantPredicate(auth));

    if (dateTo) {
      customerLedgerQuery = customerLedgerQuery.where('created_at', '<', nextAccountingDay(dateTo));
      supplierLedgerQuery = supplierLedgerQuery.where('created_at', '<', nextAccountingDay(dateTo));
    }
    if (branchId) {
      customerLedgerQuery = customerLedgerQuery.where('branch_id', '=', branchId);
      supplierLedgerQuery = supplierLedgerQuery.where('branch_id', '=', branchId);
    }
    if (locationId) {
      customerLedgerQuery = customerLedgerQuery.where('location_id', '=', locationId);
      supplierLedgerQuery = supplierLedgerQuery.where('location_id', '=', locationId);
    }

    const [customerLedgers, supplierLedgers, customers, suppliers] = await Promise.all([
      customerLedgerQuery.groupBy('customer_id').execute(),
      supplierLedgerQuery.groupBy('supplier_id').execute(),
      this.db
        .selectFrom('customers')
        .select(['id', 'name', 'phone'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .execute(),
      this.db
        .selectFrom('suppliers')
        .select(['id', 'name', 'phone'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .execute(),
    ]);

    const customerInfo = new Map(customers.map((row) => [String(row.id), row]));
    const supplierInfo = new Map(suppliers.map((row) => [String(row.id), row]));

    const customerRows = customerLedgers
      .map((row) => {
        const customer = customerInfo.get(String(row.customer_id || ''));
        return {
          customerId: String(row.customer_id || ''),
          customerName: customer?.name || '',
          phone: customer?.phone || '',
          balance: this.toMoney(row.balance_total || 0, digits),
          lastMovementDate: row.last_movement_at ? String(row.last_movement_at) : '',
        };
      })
      .filter((row) => row.customerId)
      .filter((row) => showZero || Math.abs(row.balance) > 0.0001)
      .sort((a, b) => b.balance - a.balance);

    const supplierRows = supplierLedgers
      .map((row) => {
        const supplier = supplierInfo.get(String(row.supplier_id || ''));
        return {
          supplierId: String(row.supplier_id || ''),
          supplierName: supplier?.name || '',
          phone: supplier?.phone || '',
          balance: this.toMoney(row.balance_total || 0, digits),
          lastMovementDate: row.last_movement_at ? String(row.last_movement_at) : '',
        };
      })
      .filter((row) => row.supplierId)
      .filter((row) => showZero || Math.abs(row.balance) > 0.0001)
      .sort((a, b) => b.balance - a.balance);

    const customerReceivables = this.toMoney(
      customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
      digits,
    );
    const supplierPayables = this.toMoney(
      supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
      digits,
    );

    return {
      totals: {
        customerReceivables,
        supplierPayables,
        netPosition: this.toMoney(customerReceivables - supplierPayables, digits),
      },
      customers: customerRows,
      suppliers: supplierRows,
    };
  }

  async getCashMovement(filters: CashMovementQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    const dateFrom = filters.date_from ? new Date(filters.date_from) : null;
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;

    let query = this.db
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id'),
      )
      .innerJoin('accounting_accounts as a', (join: any) =>
        join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'),
      )
      .select([
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'je.source_type as source_type',
        sql<number>`COALESCE(SUM(l.debit), 0)`.as('debit'),
        sql<number>`COALESCE(SUM(l.credit), 0)`.as('credit'),
      ])
      .where('je.status', '=', 'posted')
      .where(this.tenantPredicate(auth, 'je'))
      .where(this.tenantPredicate(auth, 'l'))
      .where('a.code', 'in', ['1110', '1120']);

    if (dateFrom) query = query.where('je.entry_date', '>=', dateFrom);
    if (dateTo) query = query.where('je.entry_date', '<', nextAccountingDay(dateTo));
    if (branchId) query = query.where('je.branch_id', '=', branchId);
    if (locationId) query = query.where('je.location_id', '=', locationId);

    const rows = await query.groupBy(['a.code', 'a.name_ar', 'je.source_type']).execute();

    let totalDebit = 0;
    let totalCredit = 0;
    const byAccount = new Map<
      string,
      { accountCode: string; accountNameAr: string; debit: number; credit: number; net: number }
    >();
    const bySource = new Map<string, { sourceType: string; debit: number; credit: number; net: number }>();

    for (const row of rows) {
      const debit = this.toMoney(row.debit, digits);
      const credit = this.toMoney(row.credit, digits);
      const sourceType = String(row.source_type || 'other');
      const accountCode = String(row.account_code || '');
      const accountNameAr = String(row.account_name_ar || '');

      totalDebit = this.toMoney(totalDebit + debit, digits);
      totalCredit = this.toMoney(totalCredit + credit, digits);

      const accountItem = byAccount.get(accountCode) || { accountCode, accountNameAr, debit: 0, credit: 0, net: 0 };
      accountItem.debit = this.toMoney(accountItem.debit + debit, digits);
      accountItem.credit = this.toMoney(accountItem.credit + credit, digits);
      accountItem.net = this.toMoney(accountItem.debit - accountItem.credit, digits);
      byAccount.set(accountCode, accountItem);

      const sourceItem = bySource.get(sourceType) || { sourceType, debit: 0, credit: 0, net: 0 };
      sourceItem.debit = this.toMoney(sourceItem.debit + debit, digits);
      sourceItem.credit = this.toMoney(sourceItem.credit + credit, digits);
      sourceItem.net = this.toMoney(sourceItem.debit - sourceItem.credit, digits);
      bySource.set(sourceType, sourceItem);
    }

    return {
      period: this.mapPeriod(filters.date_from, filters.date_to),
      totals: {
        totalIn: totalDebit,
        totalOut: totalCredit,
        netMovement: this.toMoney(totalDebit - totalCredit, digits),
      },
      accounts: Array.from(byAccount.values()).sort((a, b) => Number(a.accountCode || 0) - Number(b.accountCode || 0)),
      sources: Array.from(bySource.values()).sort((a, b) => b.net - a.net),
    };
  }

  async getInventoryValue(filters: InventoryValueQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));

    const categoryId = Number(filters.category_id || 0) > 0 ? Number(filters.category_id) : null;
    const supplierId = Number(filters.supplier_id || 0) > 0 ? Number(filters.supplier_id) : null;
    const search = String(filters.search || '').trim();
    const lowStockOnly =
      String(filters.low_stock_only || '')
        .trim()
        .toLowerCase() === 'true';
    const zeroStockOnly =
      String(filters.zero_stock_only || '')
        .trim()
        .toLowerCase() === 'true';
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;
    const stockQty = locationId ? sql<number>`COALESCE(pls.qty, 0)` : sql<number>`p.stock_qty`;

    let query = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', (j) =>
        j.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'),
      )
      .leftJoin('suppliers as s', (j) => j.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('product_location_stock as pls', (join) => {
        const j = join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id');
        return locationId ? j.on('pls.location_id', '=', locationId) : j.on(sql<boolean>`false`);
      })
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        stockQty.as('stock_qty'),
        'p.min_stock_qty',
        'p.cost_price',
        'p.retail_price',
        'p.category_id',
        'p.supplier_id',
        'c.name as category_name',
        's.name as supplier_name',
      ])
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (categoryId) {
      query = query.where('p.category_id', '=', categoryId);
    }
    if (supplierId) {
      query = query.where('p.supplier_id', '=', supplierId);
    }
    if (search) {
      query = query.where((eb) =>
        eb.or([eb('p.name', 'ilike', `%${search}%`), eb('p.barcode', 'ilike', `%${search}%`)]),
      );
    }

    if (zeroStockOnly) query = query.where(sql<boolean>`ROUND(${stockQty}, 2) = 0`);
    if (lowStockOnly)
      query = query.where(
        sql<boolean>`ROUND(${stockQty}, 2) > 0 AND ROUND(${stockQty}, 2) <= ROUND(p.min_stock_qty, 2)`,
      );

    const totalsRow = await query
      .clearSelect()
      .select([
        sql<number>`COALESCE(SUM(ROUND(${stockQty} * COALESCE(p.cost_price, 0), ${digits})), 0)`.as(
          'total_inventory_value',
        ),
        sql<number>`COALESCE(SUM(ROUND(ROUND(${stockQty}, 2) * ROUND(COALESCE(p.retail_price, 0), ${digits}), ${digits})), 0)`.as(
          'total_retail_value',
        ),
        sql<number>`COUNT(*)::int`.as('item_count'),
        sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) > 0 AND ROUND(${stockQty}, 2) <= ROUND(p.min_stock_qty, 2))::int`.as(
          'low_stock_count',
        ),
        sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) = 0)::int`.as('zero_stock_count'),
        sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) < 0)::int`.as('negative_stock_count'),
      ])
      .executeTakeFirst();

    const rows = await query.orderBy('p.name', 'asc').execute();
    const items = rows.map((row) => {
      const quantityOnHand = Number(row.stock_qty);
      const minStockQty = this.toMoney(row.min_stock_qty, digits);
      const unitCost = Number(row.cost_price);
      const unitRetailPrice = this.toMoney(row.retail_price, digits);
      const inventoryValue = this.toMoney(quantityOnHand * unitCost, digits);
      const retailPotentialValue = this.toMoney(quantityOnHand * unitRetailPrice, digits);
      const potentialGrossMargin = this.toMoney(retailPotentialValue - inventoryValue, digits);

      let status: 'available' | 'low_stock' | 'out_of_stock' | 'negative_stock' = 'available';
      if (quantityOnHand < 0) status = 'negative_stock';
      else if (quantityOnHand === 0) status = 'out_of_stock';
      else if (quantityOnHand <= minStockQty) status = 'low_stock';

      return {
        productId: String(row.id),
        productName: String(row.name || ''),
        barcode: String(row.barcode || ''),
        categoryId: row.category_id ? String(row.category_id) : '',
        categoryName: String(row.category_name || ''),
        supplierId: row.supplier_id ? String(row.supplier_id) : '',
        supplierName: String(row.supplier_name || ''),
        quantityOnHand,
        minStockQty,
        unitCost,
        unitRetailPrice,
        inventoryValue,
        retailPotentialValue,
        potentialGrossMargin,
        status,
      };
    });

    const totals = {
      totalInventoryValue: this.toMoney(totalsRow?.total_inventory_value, digits),
      totalRetailPotentialValue: this.toMoney(totalsRow?.total_retail_value, digits),
      totalPotentialGrossMargin: this.toMoney(
        Number(totalsRow?.total_retail_value || 0) - Number(totalsRow?.total_inventory_value || 0),
        digits,
      ),
      itemCount: Number(totalsRow?.item_count || 0),
      lowStockCount: Number(totalsRow?.low_stock_count || 0),
      zeroStockCount: Number(totalsRow?.zero_stock_count || 0),
      negativeStockCount: Number(totalsRow?.negative_stock_count || 0),
    };

    return { totals, items };
  }

  async getCostCenterReport(costCenterId: number, auth: AuthContext, filters?: { fromDate?: string; toDate?: string }) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const costCenter = await this.db
      .selectFrom('cost_centers')
      .selectAll()
      .where('id', '=', costCenterId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!costCenter) {
      throw new NotFoundException('مركز التكلفة غير موجود.');
    }

    let query = (this.db as any)
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as e', (join: any) =>
        join.onRef('l.journal_entry_id', '=', 'e.id').onRef('l.tenant_id', '=', 'e.tenant_id'),
      )
      .innerJoin('accounting_accounts as a', (join: any) =>
        join.onRef('l.account_id', '=', 'a.id').onRef('l.tenant_id', '=', 'a.tenant_id'),
      )
      .select([
        'l.id as lineId',
        'e.id as entryId',
        'e.entry_no as entryNo',
        'e.entry_date as entryDate',
        'e.description as entryDescription',
        'l.description as lineDescription',
        'a.id as accountId',
        'a.code as accountCode',
        'a.name_ar as accountName',
        'a.account_type as accountType',
        'l.debit',
        'l.credit',
      ])
      .where('l.tenant_id', '=', scope.tenantId)
      .where('e.tenant_id', '=', scope.tenantId)
      .where('e.status', '=', 'posted')
      .where('l.cost_center_id', '=', costCenterId);

    if (filters?.fromDate) {
      query = query.where('e.entry_date', '>=', new Date(filters.fromDate));
    }
    if (filters?.toDate) {
      query = query.where('e.entry_date', '<', nextAccountingDay(filters.toDate));
    }

    const lines = await query.orderBy('e.entry_date', 'desc').execute();

    let totalDebit = 0;
    let totalCredit = 0;
    let totalExpenses = 0;
    let totalRevenues = 0;

    for (const line of lines) {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      totalDebit += debit;
      totalCredit += credit;
      if (line.accountType === 'expense' || line.accountType === 'contra_expense') {
        totalExpenses += debit - credit;
      } else if (line.accountType === 'revenue' || line.accountType === 'contra_revenue') {
        totalRevenues += credit - debit;
      }
    }

    const budgetAmount = Number(costCenter.budget_amount || 0);
    const variance = budgetAmount > 0 ? budgetAmount - totalExpenses : 0;
    const utilizationRate = budgetAmount > 0 ? Math.round((totalExpenses / budgetAmount) * 100) : 0;

    return {
      costCenter: {
        id: Number(costCenter.id),
        code: costCenter.code,
        name: costCenter.name,
        dimension: costCenter.dimension || 'operational',
        budgetAmount,
      },
      summary: {
        totalDebit,
        totalCredit,
        totalExpenses,
        totalRevenues,
        netProfit: totalRevenues - totalExpenses,
        budgetAmount,
        variance,
        utilizationRate,
        linesCount: lines.length,
      },
      lines,
    };
  }
}
