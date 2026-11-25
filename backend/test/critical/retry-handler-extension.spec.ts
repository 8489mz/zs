/*
 * Rank 7, sub-package 7c: the retry worker in
 * AccountingRecoveryService must be total over every posting method
 * that can be replayed from (tenant, source_type, source_id) alone.
 * Before this package its switch covered 12 source types and threw
 * "No retry handler" for the rest — forever, once every five minutes.
 * This spec drives the REAL worker with the REAL posting service over
 * PGlite: a recorded food_waste failure and a recorded
 * pdc_cheque_receive failure are both recovered and their rows
 * resolved; a replayed food_waste failure is resolved by the worker's
 * own active-journal recheck instead of double-posting — the
 * handler's 23505 catch cannot do that job inside the worker's
 * transaction, because a 23505 aborts the transaction and the
 * catch's look-up then dies with "current transaction is aborted"
 * (reproduced here before the recheck existed); and a deliberately
 * excluded type (delivery_rep_settlement, which needs an amount the
 * failure row does not store) still fails loudly instead of
 * vanishing.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingRecoveryService } from '../../src/modules/accounting/services/accounting-recovery.service';
import { up as raceWindowMigrationUp } from '../../src/database/migrations/2040000000267_race_window_journal_uniqueness';

async function setupDb(): Promise<{ pg: PGlite; db: Kysely<Database>; recovery: AccountingRecoveryService }> {
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
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text NOT NULL,
      account_id text NOT NULL, source_type text NOT NULL, source_id bigint NOT NULL,
      error_message text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 1,
      first_failed_at timestamptz NOT NULL DEFAULT NOW(), last_attempt_at timestamptz NOT NULL DEFAULT NOW(),
      resolved_at timestamptz NULL,
      CONSTRAINT uq_accounting_posting_failures_source UNIQUE (tenant_id, source_type, source_id));
    CREATE TABLE restaurant_food_waste_logs (id bigint PRIMARY KEY, tenant_id text, total_cost numeric,
      reason text, branch_id bigint, created_at timestamptz, logged_by bigint);
    CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, type text, status text,
      journal_entry_id bigint, base_amount numeric, amount numeric, cheque_number text, bank_name text,
      partner_name text, partner_id bigint, created_by bigint, issue_date date, last_action_date date,
      posting_sequence integer DEFAULT 0);
  `);
  const accountTypes: Record<number, string> = { 2110: 'liability', 5300: 'expense', 5100: 'expense' };
  for (const code of [1110, 1120, 1122, 1130, 1140, 2110, 5300, 5100]) {
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, is_tax, account_type) VALUES (${code}, 't1', ${String(code)}, false, ${accountTypes[code] || 'asset'})`.execute(
      db,
    );
  }
  await sql`INSERT INTO accounting_settings VALUES (1, 't1', 1110, 1120, 1130, 2110, 1140, NULL, NULL, 5100, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`.execute(
    db,
  );
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1)`.execute(db);
  // The race-window index is production DDL: replayed failures must hit
  // the 23505 catch and return the existing journal.
  await raceWindowMigrationUp(db as any);

  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const recovery = new AccountingRecoveryService(db, foundation, posting);
  return { pg, db, recovery };
}

async function insertFailure(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<void> {
  // Same upsert shape as recordPostingFailure: a new failure for an
  // already-resolved source reopens the row instead of violating the
  // unique constraint.
  await sql`
    INSERT INTO accounting_posting_failures (tenant_id, account_id, source_type, source_id, error_message, attempts)
    VALUES ('t1', 't1:main', ${sourceType}, ${sourceId}, 'boom', 1)
    ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
    SET attempts = accounting_posting_failures.attempts + 1,
        error_message = EXCLUDED.error_message,
        last_attempt_at = NOW(),
        resolved_at = NULL
  `.execute(db);
}

async function failureRow(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<{ attempts: number; resolved: boolean; error_message: string }> {
  const res = await sql<{ attempts: number; resolved_at: string | null; error_message: string }>`
    SELECT attempts, resolved_at, error_message FROM accounting_posting_failures
    WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `.execute(db);
  const row = res.rows[0];
  return { attempts: Number(row.attempts), resolved: row.resolved_at != null, error_message: row.error_message };
}

async function journalCount(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<number> {
  const res = await sql<{ n: string }>`
    SELECT count(*) AS n FROM journal_entries WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `.execute(db);
  return Number(res.rows[0].n);
}

async function main(): Promise<void> {
  // --- 1. food_waste + pdc_cheque_receive failures are recovered ---
  {
    const { db, recovery } = await setupDb();
    try {
      await sql`INSERT INTO restaurant_food_waste_logs VALUES (11, 't1', 25.5, 'spoiled', NULL, NOW(), 1)`.execute(db);
      await sql`INSERT INTO accounting_cheques VALUES (5, 't1', 'receivable', 'pending', NULL, 100, 100, 'CHK-1', 'Bank', 'Customer', NULL, 1, CURRENT_DATE, NULL, 0)`.execute(
        db,
      );
      await insertFailure(db, 'food_waste', 11);
      await insertFailure(db, 'pdc_cheque_receive', 5);
      const result = await recovery.retryFailedPostings();
      assert.deepEqual(result, { attempted: 2, recovered: 2 }, 'both failures recovered');
      assert.equal(await journalCount(db, 'food_waste', 11), 1, 'one food_waste journal');
      assert.equal(await journalCount(db, 'pdc_cheque_receive', 5), 1, 'one cheque receive journal');
      assert.equal((await failureRow(db, 'food_waste', 11)).resolved, true, 'food_waste row resolved');
      assert.equal((await failureRow(db, 'pdc_cheque_receive', 5)).resolved, true, 'cheque row resolved');
      const second = await recovery.retryFailedPostings();
      assert.deepEqual(second, { attempted: 0, recovered: 0 }, 'resolved rows are not retried');
    } finally {
      await db.destroy();
    }
  }

  // --- 2. A replayed failure returns the existing journal, no double post ---
  {
    const { db, recovery } = await setupDb();
    try {
      await sql`INSERT INTO restaurant_food_waste_logs VALUES (12, 't1', 10, 'spoiled', NULL, NOW(), 1)`.execute(db);
      await insertFailure(db, 'food_waste', 12);
      await recovery.retryFailedPostings();
      assert.equal(await journalCount(db, 'food_waste', 12), 1, 'first retry posts once');
      await insertFailure(db, 'food_waste', 12);
      const result = await recovery.retryFailedPostings();
      assert.deepEqual(result, { attempted: 1, recovered: 1 }, 'replay counts as recovered');
      assert.equal(await journalCount(db, 'food_waste', 12), 1, 'replay did not double-post');
    } finally {
      await db.destroy();
    }
  }

  // --- 3. An excluded type still fails loudly, with attempts tracked ---
  {
    const { db, recovery } = await setupDb();
    try {
      await insertFailure(db, 'delivery_rep_settlement', 77);
      const result = await recovery.retryFailedPostings();
      assert.deepEqual(result, { attempted: 1, recovered: 0 }, 'excluded type is not recovered');
      const row = await failureRow(db, 'delivery_rep_settlement', 77);
      assert.equal(row.resolved, false, 'excluded row stays unresolved');
      assert.equal(row.attempts, 2, 'attempts bumped by the failed pass');
      assert.match(row.error_message, /No retry handler/, 'failure names the missing handler');
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('retry-handler-extension.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
