/*
 * INV-7A (rank 7, sub-package a): the integrity registry must audit at
 * the tenant's book precision and must see every one-journal source.
 * Before this package the four ledger/subledger checks used a hard-coded
 * 0.005 tolerance (five fils of silent drift on a KWD tenant), the
 * duplicate check covered 7 of ~40 source types and counted reversed
 * originals, and no check ever verified a PDC cheque's journal chain.
 * This spec pins the new behaviour through inspectAccountingIntegrity
 * itself (never a re-implemented query) on PGlite fixtures.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { inspectAccountingIntegrity } from '../../src/modules/accounting/accounting-integrity';

async function setupDb(currency: string | null): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
        is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
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
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE products (id bigint PRIMARY KEY,tenant_id text,account_id text,name text,
        stock_qty numeric DEFAULT 0,reserved_qty numeric DEFAULT 0,cost_price numeric DEFAULT 0,updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY,tenant_id text,account_id text,product_id bigint,
        branch_id bigint,location_id bigint,qty numeric DEFAULT 0,reserved_qty numeric DEFAULT 0,updated_at timestamptz);
      CREATE TABLE customers (id bigint,tenant_id text,balance numeric DEFAULT 0);
      CREATE TABLE suppliers (id bigint,tenant_id text,balance numeric DEFAULT 0,updated_at timestamptz);
      INSERT INTO customers VALUES (25,'t1',0);
      INSERT INTO suppliers VALUES (9,'t1',0,NULL);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
        subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total numeric,
        paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, exchange_return_id bigint,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
        delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0,
        tip_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, sale_origin text,
        payment_type text DEFAULT 'cash', collection_status text, status text DEFAULT 'posted');
      CREATE TABLE sale_payments (tenant_id text, sale_id bigint, payment_channel text, amount numeric);
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, qty numeric, cost_price numeric);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, doc_no text, supplier_id bigint,
        payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
        grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted');
      CREATE TABLE purchase_items (tenant_id text, purchase_id bigint, qty numeric, unit_cost numeric,
        grn_line_id bigint, grni_amount numeric);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text,
        invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02');
      CREATE TABLE return_items (tenant_id text, return_document_id bigint, product_id bigint,
        sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
      CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, type text, status text, journal_entry_id bigint);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO cost_centers VALUES (7,'t1','CC7','Cost center');
    `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 2125, 2150, 4100, 4300, 4400, 5100, 5190, 7290, 9001]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)', [
      code,
      't1',
      String(code),
      code === 1150 || code === 2120,
    ]);
  }
  if (currency !== null) {
    await pg.query(`INSERT INTO settings VALUES ('t1','currency',$1)`, [currency]);
  }
  return { pg, db };
}

async function addJournal(
  pg: PGlite,
  entryNo: string,
  sourceType: string,
  sourceId: number,
  reversedBy: number | null,
): Promise<number> {
  const res = await pg.query<{ id: string }>(
    `INSERT INTO journal_entries (tenant_id, account_id, entry_no, source_type, source_id, status, reversed_by_entry_id)
     VALUES ('t1','a1',$1,$2,$3,'posted',$4) RETURNING id`,
    [entryNo, sourceType, sourceId, reversedBy],
  );
  const id = Number(res.rows[0].id);
  await pg.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, tenant_id, account_id, debit, credit) VALUES ($1,'t1',1110,10,0), ($1,'t1',4100,0,10)`,
    [id],
  );
  return id;
}

function check(report: Awaited<ReturnType<typeof inspectAccountingIntegrity>>, code: string) {
  const found = report.checks.find((c) => c.code === code);
  assert.ok(found, `${code} check exists in the report`);
  return found;
}

async function main(): Promise<void> {
  // --- 1. KWD tolerance: a 2-fils drift flags, a sub-half-fils drift does not ---
  {
    const { pg, db } = await setupDb('KWD');
    try {
      await pg.query(`INSERT INTO customers VALUES (26,'t1',100.002), (27,'t1',100.0004)`);
      await pg.query(`INSERT INTO customer_ledger VALUES ('t1',26,100,'sale',1,'sale'), ('t1',27,100,'sale',1,'sale')`);
      // Customer 25 (fixture row, balance 0, no ledger) stays clean.
      const report = await inspectAccountingIntegrity(db, 't1');
      const cache = check(report, 'CUSTOMER_LEDGER_CACHE');
      assert.equal(cache.count, 1, 'only the 0.002 drift flags at 3dp');
      assert.equal((cache.samples[0] as any).id, 26);
    } finally {
      await db.destroy();
    }
  }

  // --- 2. EGP tolerance and the no-currency fallback keep the old 0.005 ---
  for (const currency of ['EGP', null]) {
    const { pg, db } = await setupDb(currency);
    try {
      await pg.query(`INSERT INTO customers VALUES (28,'t1',100.004), (29,'t1',100.006)`);
      await pg.query(`INSERT INTO customer_ledger VALUES ('t1',28,100,'sale',1,'sale'), ('t1',29,100,'sale',1,'sale')`);
      const report = await inspectAccountingIntegrity(db, 't1');
      const cache = check(report, 'CUSTOMER_LEDGER_CACHE');
      assert.equal(cache.count, 1, `only the 0.006 drift flags at 2dp (currency=${currency})`);
      assert.equal((cache.samples[0] as any).id, 29);
    } finally {
      await db.destroy();
    }
  }

  // --- 3. Active duplicates: reversed originals do not flag; sale_edit pairs use SALE_EDIT_NET ---
  {
    const { pg, db } = await setupDb('EGP');
    try {
      await addJournal(pg, 'J1', 'manufacturing_work_order', 7, null);
      await addJournal(pg, 'J2', 'manufacturing_work_order', 7, null);
      await addJournal(pg, 'J3', 'purchase', 8, 999); // reversed original
      await addJournal(pg, 'J4', 'purchase', 8, null); // live replacement
      await addJournal(pg, 'J5', 'sale', 9, null);
      await addJournal(pg, 'J6', 'sale', 9, null);
      await addJournal(pg, 'J7', 'sale', 10, null);
      await addJournal(pg, 'J8', 'sale_edit', 10, null);
      const report = await inspectAccountingIntegrity(db, 't1');
      const dup = check(report, 'DUPLICATE_SOURCE_POSTINGS');
      assert.equal(dup.count, 2, 'manufacturing double + sale double flag');
      const dupKeys = dup.samples.map((r: any) => `${r.source_type}:${r.source_id}`).sort();
      assert.deepEqual(dupKeys, ['manufacturing_work_order:7', 'sale:9']);
      const net = check(report, 'SALE_EDIT_NET');
      assert.equal(net.count, 2, 'sale 9 double + sale 10 edit pair flag in SALE_EDIT_NET');
    } finally {
      await db.destroy();
    }
  }

  // --- 4. PDC chain: duplicates, stale links, orphans ---
  {
    const { pg, db } = await setupDb('EGP');
    try {
      const j1 = await addJournal(pg, 'P1', 'pdc_cheque_receive', 1, null);
      const j2a = await addJournal(pg, 'P2', 'pdc_cheque_deposit', 2, null);
      await addJournal(pg, 'P3', 'pdc_cheque_deposit', 2, null);
      const j3 = await addJournal(pg, 'P4', 'pdc_cheque_collect', 3, 999); // reversed
      const j4 = await addJournal(pg, 'P5', 'customer_payment', 4, null); // wrong type for a cheque link
      await addJournal(pg, 'P6', 'pdc_cheque_collect', 99, null); // orphan: no cheque 99
      await pg.query(`INSERT INTO accounting_cheques VALUES
        (1,'t1','receivable','in_safe',${j1}),
        (2,'t1','receivable','under_collection',${j2a}),
        (3,'t1','receivable','bounced',${j3}),
        (4,'t1','receivable','collected',${j4}),
        (5,'t1','receivable','in_safe',NULL)`);
      const report = await inspectAccountingIntegrity(db, 't1');
      const active = check(report, 'PDC_CHEQUE_ACTIVE_DUPLICATES');
      assert.equal(active.count, 1, 'cheque 2 has two active deposit journals');
      assert.equal((active.samples[0] as any).cheque_id, 2);
      const link = check(report, 'PDC_CHEQUE_JOURNAL_LINK');
      assert.equal(link.count, 2, 'cheque 3 (reversed link) + cheque 4 (wrong-type link) flag');
      const orphan = check(report, 'PDC_CHEQUE_ORPHAN_JOURNALS');
      assert.equal(orphan.count, 1, 'collect journal for missing cheque 99 flags');
      assert.equal((orphan.samples[0] as any).cheque_id, 99);
      const dup = check(report, 'DUPLICATE_SOURCE_POSTINGS');
      assert.equal(dup.count, 0, 'PDC events are owned by the PDC checks, not the duplicate check');
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('integrity-check-expansion.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
