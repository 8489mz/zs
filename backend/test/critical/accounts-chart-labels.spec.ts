/* Accounts chart labels (INV-ACCOUNTS-CHART-LABELS): the standard chart
 * seeds the root groups as 'assets' (1000) and 'liabilities' (2000) —
 * not the subgroup values 'fixed_assets' / 'current_liabilities' that
 * the old seed wrote — and 5100 seeds as 'cogs'; the subgroups 1200 /
 * 2100 keep their subgroup values, and the posting fallback uses the
 * single standard group 'cogs' (no 'cost_of_sales' spelling anywhere).
 * Drives the REAL AccountingTenantFoundationService.ensureForAuth on
 * PGlite, plus a source pin on the posting service.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: [],
  tenantId: TENANT,
  accountId: 'a1',
};

const SRC = join(__dirname, '..', '..', 'src');

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE accounting_accounts (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, account_type TEXT, account_group TEXT, parent_id INTEGER, normal_balance TEXT NOT NULL DEFAULT 'debit', is_active BOOLEAN NOT NULL DEFAULT true, is_system BOOLEAN NOT NULL DEFAULT false, allow_manual_entries BOOLEAN NOT NULL DEFAULT true, is_control_account BOOLEAN NOT NULL DEFAULT false, is_cash_bank BOOLEAN NOT NULL DEFAULT false, is_receivable BOOLEAN NOT NULL DEFAULT false, is_payable BOOLEAN NOT NULL DEFAULT false, is_inventory BOOLEAN NOT NULL DEFAULT false, is_tax BOOLEAN NOT NULL DEFAULT false, is_monetary BOOLEAN NOT NULL DEFAULT false, revaluation_currency TEXT, description_ar TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(tenant_id, code))`.execute(db);
    await sql`CREATE TABLE accounting_settings (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, cash_account_id INTEGER, bank_account_id INTEGER, customer_receivable_account_id INTEGER, supplier_payable_account_id INTEGER, inventory_account_id INTEGER, sales_revenue_account_id INTEGER, sales_discount_account_id INTEGER, cogs_account_id INTEGER, purchase_account_id INTEGER, expenses_account_id INTEGER, sales_tax_account_id INTEGER, purchase_tax_account_id INTEGER, manufacturing_overhead_account_id INTEGER, updated_at TIMESTAMPTZ, UNIQUE(tenant_id, id))`.execute(db);

    const service = new AccountingTenantFoundationService();
    await service.ensureForAuth(db as never, ACTOR);

    const rows = await db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'account_group', 'parent_id'])
      .where('tenant_id', '=', TENANT)
      .execute();
    const byCode = new Map<string, any>(rows.map((r: any) => [r.code, r]));

    assert.equal(byCode.get('1000')?.account_group, 'assets', 'root 1000 must seed as assets, not fixed_assets');
    assert.equal(byCode.get('2000')?.account_group, 'liabilities', 'root 2000 must seed as liabilities, not current_liabilities');
    assert.equal(byCode.get('5100')?.account_group, 'cogs', '5100 must seed as cogs');
    assert.equal(byCode.get('1200')?.account_group, 'fixed_assets', '1200 keeps the fixed-assets subgroup value');
    assert.equal(byCode.get('2100')?.account_group, 'current_liabilities', '2100 keeps the current-liabilities subgroup value');
    assert.equal(byCode.get('1100')?.parent_id, byCode.get('1000')?.id, '1100 must hang under root 1000');
    assert.equal(byCode.get('1200')?.parent_id, byCode.get('1000')?.id, '1200 must hang under root 1000');
    assert.equal(byCode.get('2100')?.parent_id, byCode.get('2000')?.id, '2100 must hang under root 2000');
    assert.equal(byCode.get('5100')?.parent_id, byCode.get('5000')?.id, '5100 must hang under root 5000');

    const settings = await db
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', TENANT)
      .executeTakeFirst();
    assert.equal(settings?.cogs_account_id, byCode.get('5100')?.id, 'settings cogs_account_id must point at 5100');

    const posting = readFileSync(join(SRC, 'modules', 'accounting', 'accounting-posting.service.ts'), 'utf8');
    assert.ok(!posting.includes("'cost_of_sales'"), "posting fallback must use the single standard group 'cogs', not 'cost_of_sales'");
    const seed = readFileSync(join(SRC, 'modules', 'accounting', 'accounting-tenant-foundation.service.ts'), 'utf8');
    assert.ok(!seed.includes("'cost_of_sales'"), "seed must not contain the 'cost_of_sales' spelling");

    console.log('accounts-chart-labels backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
