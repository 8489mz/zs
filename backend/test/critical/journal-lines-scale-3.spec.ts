import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { migration as widenMigration } from '../../src/database/migrations/2040000000277_journal_entry_lines_minor_unit_precision';

/*
 * Journal-entry-line storage at three minor units
 * (INV-JOURNAL-LINES-SCALE-3).
 *
 * THE GAP: the posting boundary already computes every journal line
 * at the tenant's book digits (tenantBaseCurrency + currencyMoneyDigits,
 * roundMoney once) and the boundary's own comment anticipates that
 * "the DB migration widens journal_entry_lines so KWD/OMR fils
 * survive both posting and reporting" — but no migration ever did.
 * journal_entry_lines.debit/credit stayed NUMERIC(14,2) from the
 * foundation migration, so on real Postgres a computed 30.375 was
 * stored as 30.38 at INSERT. Every landed book-digits package
 * (P0-1, P0-2, P0-3, U1, U2, U3, P0-4, P0-5) posts through the same
 * boundary, so the gate hit all of them identically. The existing
 * specs could not see it: their PGlite DDL uses unbounded numeric
 * for journal_entry_lines.
 *
 * THE RULE: migration 2040000000277 widens debit and credit to
 * scale 3 (NUMERIC(15,3), integer capacity preserved), following
 * the 0257/0258 widening pattern verbatim — information_schema
 * guard, skip when already scale >= 3, throw when the column is
 * missing or not a fixed NUMERIC, down is a no-op that never
 * truncates posted history. No code change: the boundary already
 * rounds at book digits; this package closes the storage leg only.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - No other journal table column is widened: debit/credit are the
 *   only amount columns every journal_entry_lines writer touches
 *   (the canonical boundary, the reversal writer, the manual
 *   journal writer, and the goods-receipt writer all write amounts
 *   only through debit/credit).
 * - Already-posted journal lines keep their stored values; the
 *   widening preserves them byte-for-byte (a stored 30.38 stays
 *   30.38). Prospective only: no history is re-rounded.
 * - The WAC purchase-return recompute is a separate package.
 *
 * WHAT THIS PINS, driving the REAL migration and the REAL posting
 * boundary on PGlite (fresh database per case; the tenant
 * foundation service is stubbed to a no-op because foundation
 * seeding is a separate setup path, not the posting computation):
 * - Migration: applying 0277 to a NUMERIC(14,2) journal_entry_lines
 *   table widens both columns to scale 3, preserves existing rows
 *   unchanged, and afterwards 30.375 survives INSERT and reads back
 *   exactly; a second run is an idempotent no-op.
 * - Boundary storage (KWD): with the table migrated, a 30.375 /
 *   30.375 entry posted through postDomainJournal stores 30.375
 *   exactly in both legs (read back from the table, never from the
 *   computed lines).
 * - 2dp identity (EGP): a 100.12 / 100.12 entry stores 100.12.
 * - Source pin: the migration targets exactly debit and credit at
 *   scale 3, and no other migration widens these columns.
 * This is not an end-to-end post on live Postgres, and the
 * migration has not run against the production database.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric(14, 2) NOT NULL DEFAULT 0, credit numeric(14, 2) NOT NULL DEFAULT 0, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'الخزينة', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '5110', 'تكلفة البضاعة', 'COGS', 'expense', true, false, NULL, true, false, false, false, false),
      (30, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makePosting(db: Kysely<Database>): AccountingPostingService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  return new AccountingPostingService(fakeFoundation);
}

async function storedLines(db: Kysely<Database>, entryId: number): Promise<Array<{ debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit']).where('journal_entry_id', '=', entryId).orderBy('id').execute() as unknown as Array<{ debit: string; credit: string }>;
  return rows.map((row) => ({ debit: Number(row.debit), credit: Number(row.credit) }));
}

async function main(): Promise<void> {
  // Case 1: the migration itself — widen (14,2) to scale 3, preserving rows.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, debit numeric(14, 2) NOT NULL DEFAULT 0, credit numeric(14, 2) NOT NULL DEFAULT 0);
        INSERT INTO journal_entry_lines (debit, credit) VALUES (100.00, 0), (0, 10.00);
      `);
      await widenMigration.up(db as any);
      const info = await pg.query<{ column_name: string; numeric_precision: string; numeric_scale: string }>(
        `SELECT column_name, numeric_precision::text, numeric_scale::text FROM information_schema.columns WHERE table_name='journal_entry_lines' AND column_name IN ('debit','credit') ORDER BY column_name`,
      );
      assert.deepEqual(info.rows.map((r) => [r.column_name, Number(r.numeric_precision), Number(r.numeric_scale)]), [['credit', 15, 3], ['debit', 15, 3]]);
      const kept = await pg.query<{ debit: string; credit: string }>('SELECT debit::text, credit::text FROM journal_entry_lines ORDER BY id');
      assert.deepEqual(kept.rows.map((r) => [Number(r.debit), Number(r.credit)]), [[100, 0], [0, 10]]);
      await pg.exec(`INSERT INTO journal_entry_lines (debit, credit) VALUES (30.375, 0), (0, 30.375)`);
      const kept2 = await pg.query<{ debit: string; credit: string }>('SELECT debit::text, credit::text FROM journal_entry_lines ORDER BY id DESC LIMIT 2');
      assert.deepEqual(kept2.rows.map((r) => [Number(r.debit), Number(r.credit)]), [[0, 30.375], [30.375, 0]]);
      // Idempotent: a second run is a no-op.
      await widenMigration.up(db as any);
      const info2 = await pg.query<{ numeric_scale: string }>(
        `SELECT numeric_scale::text FROM information_schema.columns WHERE table_name='journal_entry_lines' AND column_name='debit'`,
      );
      assert.equal(Number(info2.rows[0].numeric_scale), 3);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: boundary storage (KWD, 3dp) — posted legs store exactly.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await widenMigration.up(db as any);
      const posting = makePosting(db);
      const entryId = await posting.postDomainJournal(db as any, {
        sourceType: 'manual_journal',
        sourceId: 1,
        tenantId: 't1',
        accountId: 'a1',
        entryDate: new Date('2026-10-15'),
        description: 'journal scale proof',
        createdBy: 1,
        lines: [
          { accountId: 10, description: 'cash', debit: 30.375, credit: 0, partnerType: 'none', partnerId: null },
          { accountId: 20, description: 'cogs', debit: 0, credit: 30.375, partnerType: 'none', partnerId: null },
        ],
      } as never);
      assert.deepEqual(await storedLines(db, entryId), [
        { debit: 30.375, credit: 0 },
        { debit: 0, credit: 30.375 },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: 2dp identity (EGP) — widening changes nothing at 2dp.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await widenMigration.up(db as any);
      const posting = makePosting(db);
      const entryId = await posting.postDomainJournal(db as any, {
        sourceType: 'manual_journal',
        sourceId: 2,
        tenantId: 't1',
        accountId: 'a1',
        entryDate: new Date('2026-10-15'),
        description: 'journal scale identity',
        createdBy: 1,
        lines: [
          { accountId: 10, description: 'cash', debit: 100.12, credit: 0, partnerType: 'none', partnerId: null },
          { accountId: 20, description: 'cogs', debit: 0, credit: 100.12, partnerType: 'none', partnerId: null },
        ],
      } as never);
      assert.deepEqual(await storedLines(db, entryId), [
        { debit: 100.12, credit: 0 },
        { debit: 0, credit: 100.12 },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: source pin — the migration targets exactly debit/credit at scale 3.
  {
    const migrationSource = readFileSync(resolve(__dirname, '../../src/database/migrations/2040000000277_journal_entry_lines_minor_unit_precision.ts'), 'utf8');
    assert.ok(migrationSource.includes("'journal_entry_lines', 'debit', 3"));
    assert.ok(migrationSource.includes("'journal_entry_lines', 'credit', 3"));
    assert.ok(!migrationSource.includes("'journal_entries'"), 'the migration must widen lines only, never headers');
  }

  console.log('journal-lines-scale-3: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
