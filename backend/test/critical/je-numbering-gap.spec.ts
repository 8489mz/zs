/*
 * JE numbering gap (INV-JE-NUMBERING-GAP): journal numbers must be
 * gapless for new journals.
 *
 * The visible number used to be the row identity itself
 * (entry_no = 'JE-' + journal_entries.id). Postgres identity values are
 * consumed by failed inserts and never reclaimed on rollback, so a
 * failed or rolled-back posting burned a number forever -- the
 * duplicate-posting race is the proven in-code path (both racers pass
 * the SELECT dedup check, both insert, the loser fails on the partial
 * unique index only after its identity value is gone). A missing number
 * such as JE-00014975 is a consumed identity, not a deleted journal:
 * there is no delete path for journal entries in production code.
 *
 * The fix allocates the visible number from the highest VISIBLE number
 * (MAX(entry_no) + 1) under a global transaction advisory lock inside
 * insertPostedJournal: the lock is held until the posting transaction
 * ends, so a concurrent allocator waits until the first posting
 * commits and then sees its row, and a rollback leaves nothing behind
 * to skip over -- no counter ever advances, so a failed posting leaves
 * no gap. No new table and no migration: entry_no already carries a
 * unique index, and the range predicate keeps the MAX read on it.
 *
 * WHAT THIS PINS, driving the REAL posting service on PGlite:
 * 1. Two sequential postings take two consecutive numbers.
 * 2. A posting whose outer transaction rolls back after the journal
 *    insert consumes NO number: the next posting takes the
 *    immediately-next number (this is the gap the old code left).
 * 3. A duplicate posting of the same source returns the existing
 *    journal without consuming a number; the next new source is
 *    consecutive.
 * 4. Already-posted journals keep their numbers exactly (no
 *    renumbering), and the highest visible number agrees with the last
 *    allocated number.
 * 5. The number is decoupled from the identity id: the first new
 *    number starts above the legacy identity-derived maximum, while
 *    the new row keeps a small identity id.
 *
 * Deliberately NOT driven here: two concurrent transactions racing for
 * the same number (PGlite is single-connection; the advisory lock is
 * the serialisation, the same mechanism the daily-sequence spec relies
 * on for its advisory lock). The reversal and draft creation paths use
 * the same allocator and are covered by construction; their call sites
 * are one-line changes verified by typecheck and inspection.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const ENTRY_DATE = new Date('2026-10-01T12:00:00Z');

const num = (entryNo: string): number => Number(entryNo.replace('JE-', ''));

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const inTx = <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
        is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false);
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
      -- A legacy journal posted by the old identity-derived numbering
      -- sits in the table: the first new number must start above it.
      INSERT INTO journal_entries(id, tenant_id, account_id, entry_no, entry_date, description, source_type, source_id, status)
        VALUES (5000, 't1', 'a1', 'JE-00005000', '2026-10-01', 'legacy journal', 'expense', 500, 'posted');
      INSERT INTO settings VALUES ('t1', 'currency', 'EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1);
      INSERT INTO accounting_settings VALUES
        (1, 't1', 1110, 1120, 1130, 2110, 1140, 4100, 4300, 5100, 2120, 1150, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    for (const code of [1110, 6900, 7290]) {
      await pg.query('INSERT INTO accounting_accounts(id, tenant_id, code, is_tax) VALUES ($1, $2, $3, $4)',
        [code, 't1', String(code), false]);
    }

    const entryNoOf = async (id: number): Promise<string> => {
      const row = await db.selectFrom('journal_entries').select('entry_no').where('id', '=', id).executeTakeFirstOrThrow();
      return String(row.entry_no);
    };
    const postExpense = async (sourceId: number, amount = 100): Promise<number> =>
      inTx((trx) => posting.postDomainJournal(trx, {
        sourceType: 'expense',
        sourceId,
        tenantId: 't1',
        accountId: 'a1',
        entryDate: ENTRY_DATE,
        description: `expense #${sourceId}`,
        createdBy: 1,
        lines: [
          { accountId: 6900, description: 'expense', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
          { accountId: 1110, description: 'cash', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
        ],
      }));

    // 1. Two sequential postings take two consecutive numbers.
    const firstId = await postExpense(1);
    const firstNo = await entryNoOf(firstId);
    assert.match(firstNo, /^JE-\d{8}$/, 'first journal number has the JE-00000000 shape');
    const secondId = await postExpense(2);
    const secondNo = await entryNoOf(secondId);
    assert.equal(num(secondNo), num(firstNo) + 1, 'second journal takes the immediately-next number');

    // 2. A posting rolled back by its caller consumes NO number.
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await posting.postDomainJournal(trx, {
          sourceType: 'expense',
          sourceId: 99,
          tenantId: 't1',
          accountId: 'a1',
          entryDate: ENTRY_DATE,
          description: 'expense #99 (rolled back)',
          createdBy: 1,
          lines: [
            { accountId: 6900, description: 'expense', debit: 100, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
            { accountId: 1110, description: 'cash', debit: 0, credit: 100, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
          ],
        });
        throw new Error('simulated caller failure after posting');
      }),
      /simulated caller failure after posting/,
    );
    const rolledBack = await db.selectFrom('journal_entries').select('id').where('source_type', '=', 'expense').where('source_id', '=', 99).execute();
    assert.deepEqual(rolledBack, [], 'rolled-back journal row is gone');
    const thirdId = await postExpense(3);
    const thirdNo = await entryNoOf(thirdId);
    assert.equal(num(thirdNo), num(secondNo) + 1, 'posting after a rollback takes the immediately-next number, no gap');

    // 3. A duplicate posting returns the existing journal and consumes nothing.
    const fourthId = await postExpense(4);
    const fourthNo = await entryNoOf(fourthId);
    const duplicateId = await postExpense(4);
    assert.equal(duplicateId, fourthId, 'duplicate source returns the existing journal id');
    assert.equal(await entryNoOf(duplicateId), fourthNo, 'duplicate source returns the existing journal number');
    const fifthId = await postExpense(5);
    assert.equal(num(await entryNoOf(fifthId)), num(fourthNo) + 1, 'next new source after a duplicate is consecutive');

    // 4. Old journals keep their numbers; the highest visible number agrees with the last allocation.
    assert.equal(await entryNoOf(firstId), firstNo, 'first journal number is unchanged by later postings');
    assert.equal(await entryNoOf(secondId), secondNo, 'second journal number is unchanged by later postings');
    assert.equal(await entryNoOf(5000), 'JE-00005000', 'legacy journal number is unchanged by later postings');
    const maxNo = await db.selectFrom('journal_entries').select((eb) => eb.fn.max('entry_no').as('max_no')).executeTakeFirstOrThrow();
    assert.equal(String(maxNo.max_no), await entryNoOf(fifthId), 'highest visible number equals the last allocated number');

    // 5. The number is decoupled from the identity id: the first new
    // number is 5001 -- one above the legacy identity-derived maximum
    // (5000) -- while the new row keeps a small identity id, and a
    // later journal still carries a small identity id while its number
    // keeps counting from the highest visible number.
    assert.equal(firstId, 1, 'the first new journal keeps its small identity id');
    assert.equal(num(firstNo), 5001, 'first number starts above the legacy maximum: MAX(entry_no) + 1');
    const sixthId = await postExpense(6);
    assert.ok(sixthId < 100, 'identity id stays small');
    assert.equal(num(await entryNoOf(sixthId)), num(await entryNoOf(fifthId)) + 1, 'number keeps counting from the highest visible number, not the id');

    console.log('je-numbering-gap: sequential numbers, rollback leaves no gap, duplicate consumes nothing, old numbers untouched, number decoupled from id');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('je-numbering-gap checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
