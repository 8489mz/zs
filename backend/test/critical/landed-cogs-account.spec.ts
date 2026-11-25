/*
New file: backend/test/critical/landed-cogs-account.spec.ts
PGlite spec: drives the production landed-cost application end-to-end
on a tenant whose configured COGS account is 5100, and asserts the
sold portion lands there — not on the old hard-coded 5110.

WHAT THIS PINS (INV-LANDED-COGS-ACCOUNT): applyPurchaseLandedCosts
split a receipt's landed cost between inventory still held and units
already sold, and posted the sold portion to a hard-coded 5110 while
every sale posts COGS to settings.cogs_account_id (5100 by
foundation). Same cost of goods sold, two accounts, different groups
(5100: cogs, 5110: expenses), so any report summing 5100 alone
understated COGS by the landed sold portion, and gross margin was
overstated by exactly that amount.

THE FIXTURE, WORKED ONCE: buy 10 units, sell 5 (stock now 5), then
apply 100 of landed cost. The stock-flow split keeps half the cost
in inventory (5 surviving of 10) and sends half to COGS: journal
1140 debit 50, COGS debit 50, supplier payable credit 100. The old
code posted that 50 to a newly created 5110 account; the new code
posts it to the configured 5100 account, and no 5110 account is
created at all.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PurchaseLandedCostsService } from '../../src/modules/purchases/services/purchase-landed-costs.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const landed = new PurchaseLandedCostsService(db as any, posting);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
        is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false,
        account_type text DEFAULT '', normal_balance text DEFAULT '', is_system boolean DEFAULT false,
        created_at timestamptz, updated_at timestamptz);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text,
        stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, updated_at timestamptz, item_type text);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
        branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
      INSERT INTO suppliers VALUES (9,'t1','Supplier 9',0,NULL);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, doc_no text, supplier_id bigint,
        payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
        grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted',
        landed_cost_total numeric, landed_cost_allocation_method text, landed_cost_notes text, landed_cost_applied_at timestamptz);
      CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, purchase_id bigint, product_id bigint, product_name text,
        qty numeric, unit_cost numeric, line_total numeric, unit_name text, unit_multiplier numeric DEFAULT 1,
        category_id bigint, location_id bigint, received_qty numeric, serials text, batch_number text,
        grn_line_id bigint, allocated_landed_cost numeric, landed_unit_cost numeric, account_id text);
      CREATE TABLE purchase_landed_costs (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint, cost_type text,
        description text, amount numeric, vendor_id bigint, allocation_method text);
      CREATE TABLE stock_movements (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
        movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
        reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE goods_receipt_lines (id bigint PRIMARY KEY, tenant_id text, grn_id bigint, product_id bigint, accepted_qty numeric);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO products VALUES (10,'t1','a1','Product 10',5,0,10,NULL,NULL);
      INSERT INTO purchases VALUES (1,'t1','PUR-1',9,'cash',100,0,0,100,NULL,NULL,1,'2026-10-01',NULL,NULL,NULL,NULL,'posted',NULL,NULL,NULL,NULL);
      INSERT INTO purchase_items VALUES (1,'t1',1,10,'Product 10',10,10,100,NULL,1,NULL,NULL,10,'[]',NULL,NULL,NULL,NULL,'a1');
      INSERT INTO stock_movements VALUES (1,'t1','a1',10,'purchase',10,0,10,10,100,'purchase','PUR-1','purchase',1,NULL,NULL,1);
      INSERT INTO stock_movements VALUES (2,'t1','a1',10,'sale',-5,10,5,10,-50,'sale','SALE-1','sale',1,NULL,NULL,1);
    `);
    for (const code of [1110, 1120, 1130, 1140, 2110, 2120, 4100, 4300, 5100, 5190, 7290]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        '',
      ]);
    }
    await landed.applyPurchaseLandedCosts(
      1,
      {
        costs: [{ costType: 'freight', description: 'Freight', amount: 100, vendorId: 9 }],
        allocationMethod: 'value',
      } as any,
      auth,
    );

    const entry = await pg.query<{ id: string }>(
      `SELECT id FROM journal_entries WHERE source_type='purchase_landed_cost' AND source_id=1`,
    );
    assert.equal(entry.rows.length, 1);
    const entryId = Number(entry.rows[0].id);
    const amount = async (code: number, side: 'debit' | 'credit') => {
      const rows = await pg.query<{ amount: string }>(
        `SELECT coalesce(sum(l.${side}),0) AS amount FROM journal_entry_lines l JOIN accounting_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1 AND a.code=$2`,
        [entryId, String(code)],
      );
      return Number(rows.rows[0].amount);
    };
    assert.equal(await amount(1140, 'debit'), 50);
    assert.equal(await amount(5100, 'debit'), 50);
    assert.equal(await amount(2110, 'credit'), 100);
    // No 5110 account is created, and no line posts to it.
    const acc5110 = await pg.query(`SELECT id FROM accounting_accounts WHERE tenant_id='t1' AND code='5110'`);
    assert.equal(acc5110.rows.length, 0);

    console.log('Landed COGS account tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
