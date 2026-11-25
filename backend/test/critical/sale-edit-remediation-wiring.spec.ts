/*
 * Rank 7, sub-package 7d: the remediation engines were complete but
 * had no caller. This spec drives the REAL wiring — the service over
 * the REAL posting service and the REAL engines on PGlite — through
 * the exact double-counted fixture the engine spec pins: discovery
 * is a pure dry run that writes nothing; apply without confirmation
 * or with an empty list throws and writes nothing; apply with a
 * reviewed list reverses exactly the stale journal; a second
 * discovery finds nothing left; and a re-apply of the same list
 * writes no second reversal.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SaleEditRemediationService } from '../../src/modules/accounting/services/sale-edit-remediation.service';

const AUTH = { userId: 1, tenantId: 't1', accountId: 't1:main' } as unknown as AuthContext;

async function setupDb(): Promise<{ pg: PGlite; db: Kysely<Database>; service: SaleEditRemediationService }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
      name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
      allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
      is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false,
      account_type text DEFAULT 'asset');
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
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
      subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total numeric,
      paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, exchange_return_id bigint,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0,
      tip_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, sale_origin text,
      payment_type text DEFAULT 'cash', collection_status text, status text DEFAULT 'posted');
    CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, qty numeric, cost_price numeric);
  `);
  const accountTypes: Record<number, string> = {
    2110: 'liability',
    2120: 'liability',
    2150: 'liability',
    4300: 'contra_revenue',
    5100: 'expense',
  };
  for (const code of [1110, 1120, 1130, 1140, 2110, 2120, 2150, 4100, 4300, 5100]) {
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, is_tax, account_type) VALUES (${code}, 't1', ${String(code)}, false, ${accountTypes[code] || 'asset'})`.execute(
      db,
    );
  }
  await sql`INSERT INTO accounting_settings VALUES (1, 't1', 1110, 1120, 1130, 2110, 1140, 4100, 4300, 5100, 2120, 1150, NULL, NULL, NULL, NULL, NULL, NULL)`.execute(
    db,
  );
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1)`.execute(db);

  // Double-counted sale 1 (matching sale journal + stale edit journal),
  // clean sale 2 — the engine spec's pinned fixture.
  await sql`INSERT INTO sales(id, tenant_id, doc_no, subtotal, discount, tax_amount, total, paid_amount) VALUES (1, 't1', 'S1', 100, 10, 14, 104, 104)`.execute(
    db,
  );
  await sql`INSERT INTO sale_items VALUES (1, 't1', 1, 10, 2, 30)`.execute(db);
  await sql`INSERT INTO journal_entries(id, tenant_id, account_id, source_type, source_id, status, entry_no, entry_date) VALUES (1, 't1', 't1:main', 'sale', 1, 'posted', 'JE-1', NOW())`.execute(
    db,
  );
  await sql`INSERT INTO journal_entry_lines(journal_entry_id, tenant_id, account_id, debit, credit) VALUES (1, 't1', 1110, 104, 0), (1, 't1', 4100, 0, 100), (1, 't1', 4300, 10, 0), (1, 't1', 2120, 0, 14), (1, 't1', 5100, 60, 0), (1, 't1', 1140, 0, 60)`.execute(
    db,
  );
  await sql`INSERT INTO journal_entries(id, tenant_id, account_id, source_type, source_id, status, entry_no, entry_date) VALUES (2, 't1', 't1:main', 'sale_edit', 1, 'posted', 'JE-2', NOW())`.execute(
    db,
  );
  await sql`INSERT INTO journal_entry_lines(journal_entry_id, tenant_id, account_id, debit, credit) VALUES (2, 't1', 1110, 150, 0), (2, 't1', 4100, 0, 150)`.execute(
    db,
  );
  await sql`INSERT INTO sales(id, tenant_id, doc_no, subtotal, discount, tax_amount, total) VALUES (2, 't1', 'S2', 50, 0, 7, 57)`.execute(
    db,
  );
  await sql`INSERT INTO journal_entries(id, tenant_id, account_id, source_type, source_id, status, entry_no, entry_date) VALUES (3, 't1', 't1:main', 'sale', 2, 'posted', 'JE-3', NOW())`.execute(
    db,
  );
  await sql`SELECT setval(pg_get_serial_sequence('journal_entries', 'id'), 10)`.execute(db);

  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new SaleEditRemediationService(db, posting);
  return { pg, db, service };
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const res = await sql<{ n: string }>`SELECT count(*) AS n FROM journal_entries`.execute(db);
  return Number(res.rows[0].n);
}

async function staleJournal(db: Kysely<Database>): Promise<{ reversed_by_entry_id: number | null }> {
  const res = await sql<{
    reversed_by_entry_id: number | null;
  }>`SELECT reversed_by_entry_id FROM journal_entries WHERE id = 2`.execute(db);
  return res.rows[0];
}

async function main(): Promise<void> {
  // --- 1. Discovery is a pure dry run ---
  {
    const { db, service } = await setupDb();
    try {
      const report = await service.discover(AUTH);
      assert.equal(report.mode, 'dry_run', 'discovery always runs dry');
      assert.equal(report.items.length, 1, 'one candidate');
      assert.equal(report.items[0].saleId, 1, 'candidate is sale 1');
      assert.equal(report.items[0].status, 'would_reverse', 'stale journal would be reversed');
      assert.equal(report.counts.wouldReverse, 1);
      assert.equal(await journalCount(db), 3, 'discovery wrote no journals');
      assert.equal((await staleJournal(db)).reversed_by_entry_id, null, 'stale journal untouched');
    } finally {
      await db.destroy();
    }
  }

  // --- 2. Apply gates: no confirmation / empty list / unreviewed sale ---
  {
    const { db, service } = await setupDb();
    try {
      await assert.rejects(
        () => service.apply(AUTH, { saleIds: [1], confirm: false }),
        /confirmation/,
        'confirm:false must throw',
      );
      await assert.rejects(
        () => service.apply(AUTH, { saleIds: [1], confirm: undefined }),
        /confirmation/,
        'missing confirm must throw',
      );
      await assert.rejects(
        () => service.apply(AUTH, { saleIds: [], confirm: true }),
        /non-empty/,
        'empty saleIds must throw',
      );
      await assert.rejects(
        () => service.apply(AUTH, { saleIds: [0], confirm: true }),
        /positive integers/,
        'non-positive saleId must throw',
      );
      assert.equal(await journalCount(db), 3, 'rejected applies wrote nothing');
      const clean = await service.apply(AUTH, { saleIds: [2], confirm: true, runId: 'run-clean' });
      assert.deepEqual(clean.unmatchedSaleIds, [2], 'clean sale is unmatched');
      assert.equal(clean.counts.reversed, 0, 'nothing reversed for a clean sale');
      assert.equal(await journalCount(db), 3, 'clean apply wrote nothing');
    } finally {
      await db.destroy();
    }
  }

  // --- 3. Confirmed apply reverses exactly the stale journal, once ---
  {
    const { db, service } = await setupDb();
    try {
      const report = await service.apply(AUTH, { saleIds: [1], confirm: true, runId: 'run-7d' });
      assert.equal(report.mode, 'apply');
      assert.equal(report.counts.reversed, 1, 'one reversal posted');
      assert.equal(report.items[0].status, 'reversed');
      assert.deepEqual(report.unmatchedSaleIds, [], 'reviewed sale matched');
      const stale = await staleJournal(db);
      assert.ok(stale.reversed_by_entry_id != null, 'stale journal now points at its reversal');
      const reversal = await sql<{ id: number; source_type: string; reversal_of_entry_id: number }>`
        SELECT id, source_type, reversal_of_entry_id FROM journal_entries WHERE id = ${stale.reversed_by_entry_id}
      `.execute(db);
      assert.equal(reversal.rows[0].source_type, 'sale_reversal', 'reversal journal type');
      assert.equal(reversal.rows[0].reversal_of_entry_id, 2, 'reversal targets the stale journal');
      assert.equal(await journalCount(db), 4, 'exactly one journal added');

      const rediscovery = await service.discover(AUTH);
      assert.equal(rediscovery.items.length, 0, 'nothing left to repair');
      const reapply = await service.apply(AUTH, { saleIds: [1], confirm: true, runId: 'run-7d-again' });
      assert.deepEqual(reapply.unmatchedSaleIds, [1], 'repaired sale is unmatched on re-apply');
      assert.equal(await journalCount(db), 4, 're-apply wrote no second reversal');
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('sale-edit-remediation-wiring.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
