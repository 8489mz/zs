/**
New file: backend/test/critical/pdc-cheque-recycle.spec.ts
Style follows backend/test/critical/accounting-commercial-posting.spec.ts
(PGlite + Kysely, imports production posting code, no duplicated formulas).

WHAT THIS PINS (read before touching the PDC index):
  A receivable cheque may legitimately cycle deposit -> bounce -> restore ->
  re-deposit -> bounce. Migration 2040000000252_arch02_accounting_foundation
  narrowed idx_journal_entries_pdc_and_wht_uniq to once-per-cheque events
  (receive, collect, endorse, issue, clear) + WHT, deliberately EXCLUDING
  deposit / bounce / payable_bounce, and created uq_arch02_journal_event on
  (tenant_id, dedup_key) where a PDC dedup_key is type:id:posting_sequence.
  Uniqueness is therefore per ACTION OCCURRENCE (sequence), not per action
  type. The old 0247 definition (one active journal per action type) blocked
  re-deposit/re-bounce with 23505, which the posting methods caught and
  returned as a soft skip -- status advancing with no journal. Under the
  narrowed index + sequence dedup, every step below posts a DISTINCT journal
  and the three PDC/AR accounts net to exactly zero at the end.
  If any assertion here fails after an index change, the change reintroduced
  the 0247 defect: stop and restore the 0252 definition, do not "fix" the
  spec by widening tolerances.

  The restore journal after an under-collection bounce is INTENTIONALLY
  unlinked (reversal_of_entry_id IS NULL): it unwinds receive + bounce
  across 1122/AR, not the 1121 deposit leg, so it is not the exact opposite
  of the bounce journal. The 0252 comment states this explicitly: do not
  falsify reversal links merely to free an index slot.

  The spec drives the posting methods directly and simulates the service's
  two ordering rules: (1) posting_sequence is incremented BEFORE posting,
  (2) cheque status is updated AFTER posting (so postPdcChequeBounce still
  sees the pre-action status and picks the correct credit account).
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
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset',
        account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
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
      CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0);
      CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, account_id text, type text,
        cheque_number text, bank_name text, branch_name text, drawer_name text, partner_type text,
        partner_id bigint, partner_name text, amount numeric, currency text, base_amount numeric,
        base_currency text, exchange_rate numeric, issue_date date, due_date date, status text,
        deposit_bank_id bigint, deposit_date date, cleared_date date, bounced_date date,
        bounced_reason text, bounced_fee numeric, endorsed_to_supplier_id bigint,
        endorsed_to_supplier_name text, journal_entry_id bigint, last_action_date date,
        settlement_base_amount numeric, posting_sequence bigint DEFAULT 0, created_by bigint,
        notes text, created_at timestamptz, updated_at timestamptz);
      -- Production index definitions at HEAD (0252): the narrowed source-level
      -- index (deposit/bounce/payable_bounce deliberately absent) plus the
      -- per-occurrence dedup_key index. Under the old 0247 definition the
      -- re-deposit step below would 23505 and soft-return the first deposit
      -- journal, failing the distinct-journal assertions.
      CREATE UNIQUE INDEX uq_arch02_journal_event ON journal_entries (tenant_id, dedup_key) WHERE dedup_key IS NOT NULL;
      CREATE UNIQUE INDEX idx_journal_entries_pdc_and_wht_uniq ON journal_entries (tenant_id, source_type, source_id)
        WHERE source_type IN ('pdc_cheque_receive', 'pdc_cheque_collect', 'pdc_cheque_endorse',
          'pdc_cheque_issue', 'pdc_cheque_clear', 'withholding_tax_remittance')
          AND reversed_by_entry_id IS NULL;
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO customers VALUES (25,'t1',0);
    `);
    for (const code of [1110, 1120, 1121, 1122, 1130, 7290]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code) VALUES ($1,$2,$3)', [
        code,
        't1',
        String(code),
      ]);
    }

    const linesOf = async (entryId: number) => {
      const r = await pg.query<{ account_id: string; debit: string; credit: string }>(
        'SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id=$1 ORDER BY account_id',
        [entryId],
      );
      return r.rows.map((row) => [Number(row.account_id), Number(row.debit), Number(row.credit)] as const);
    };
    const assertBalanced = async () => {
      const result = await pg.query(
        `SELECT journal_entry_id FROM journal_entry_lines GROUP BY journal_entry_id HAVING sum(debit) <> sum(credit)`,
      );
      assert.deepEqual(result.rows, [], 'every saved journal balances exactly');
    };
    // Mirrors updateChequeStatus ordering: sequence increments BEFORE posting,
    // status changes AFTER posting (posting methods read the pre-action status).
    const preStep = async (sequence: number, actionDate: string) => {
      await pg.query('UPDATE accounting_cheques SET posting_sequence=$1, last_action_date=$2 WHERE id=1', [
        sequence,
        actionDate,
      ]);
    };
    const setStatus = async (status: string) => {
      await pg.query('UPDATE accounting_cheques SET status=$1 WHERE id=1', [status]);
    };

    await pg.query(`INSERT INTO accounting_cheques
      (id, tenant_id, type, cheque_number, bank_name, partner_type, partner_id, partner_name,
       amount, currency, base_amount, base_currency, exchange_rate,
       issue_date, due_date, status, posting_sequence, created_by)
      VALUES (1,'t1','receivable','CHQ-1','Test Bank','customer',25,'Customer 25',
       100,'EGP',100,'EGP',1,'2026-10-01','2026-11-01','in_safe',0,1)`);

    // 1. Receive (sequence 0, creation): Dr 1122 / Cr 1130.
    const j1 = await inTx((trx) => posting.postPdcChequeReceive(trx, 1, auth));
    assert.equal(j1.posted, true);
    assert.deepEqual(await linesOf(Number(j1.journalEntryId)), [
      [1122, 100, 0],
      [1130, 0, 100],
    ]);

    // 2. Deposit (sequence 1): Dr 1121 / Cr 1122.
    await preStep(1, '2026-10-05');
    const j2 = await inTx((trx) => posting.postPdcChequeDeposit(trx, 1, auth));
    assert.equal(j2.posted, true);
    assert.notEqual(Number(j2.journalEntryId), Number(j1.journalEntryId));
    assert.deepEqual(await linesOf(Number(j2.journalEntryId)), [
      [1121, 100, 0],
      [1122, 0, 100],
    ]);
    await setStatus('under_collection');

    // 3. Bounce from under_collection (sequence 2): Dr 1130 / Cr 1121.
    await preStep(2, '2026-10-10');
    const j3 = await inTx((trx) => posting.postPdcChequeBounce(trx, 1, 0, null, auth));
    assert.equal(j3.posted, true);
    assert.deepEqual(await linesOf(Number(j3.journalEntryId)), [
      [1121, 0, 100],
      [1130, 100, 0],
    ]);
    await setStatus('bounced');

    // 4. Restore to safe (sequence 3): Dr 1122 / Cr 1130. Intentionally
    // unlinked: it is not the exact opposite of the bounce journal (which
    // credited 1121), and that is accepted by design, not a defect.
    await preStep(3, '2026-10-12');
    const j4 = await inTx((trx) => posting.postPdcChequeRestore(trx, 1, 'bounced', auth));
    assert.equal(j4.posted, true);
    assert.deepEqual(await linesOf(Number(j4.journalEntryId)), [
      [1122, 100, 0],
      [1130, 0, 100],
    ]);
    const j4row = await pg.query<{ reversal_of_entry_id: string | null }>(
      'SELECT reversal_of_entry_id FROM journal_entries WHERE id=$1',
      [Number(j4.journalEntryId)],
    );
    assert.equal(
      j4row.rows[0].reversal_of_entry_id,
      null,
      'restore after under-collection bounce stays unlinked by design',
    );
    await setStatus('in_safe');

    // 5. RE-DEPOSIT (sequence 4): the step the old 0247 index broke. It must
    // post a NEW journal, not soft-return the first deposit's id.
    await preStep(4, '2026-10-15');
    const j5 = await inTx((trx) => posting.postPdcChequeDeposit(trx, 1, auth));
    assert.equal(j5.posted, true);
    assert.notEqual(
      Number(j5.journalEntryId),
      Number(j2.journalEntryId),
      're-deposit must post a new journal, not the first deposit',
    );
    assert.deepEqual(await linesOf(Number(j5.journalEntryId)), [
      [1121, 100, 0],
      [1122, 0, 100],
    ]);
    await setStatus('under_collection');

    // 6. RE-BOUNCE (sequence 5): likewise a new journal, not the first bounce.
    await preStep(5, '2026-10-20');
    const j6 = await inTx((trx) => posting.postPdcChequeBounce(trx, 1, 0, null, auth));
    assert.equal(j6.posted, true);
    assert.notEqual(
      Number(j6.journalEntryId),
      Number(j3.journalEntryId),
      're-bounce must post a new journal, not the first bounce',
    );
    assert.deepEqual(await linesOf(Number(j6.journalEntryId)), [
      [1121, 0, 100],
      [1130, 100, 0],
    ]);
    await setStatus('bounced');

    // 7. Whole-cycle GL nets to exactly zero on every touched account.
    const nets = await pg.query<{ account_id: string; net: string }>(`
      SELECT jel.account_id, coalesce(sum(jel.debit - jel.credit), 0) AS net
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.tenant_id='t1' AND je.source_type LIKE 'pdc_cheque_%' AND je.source_id=1
      GROUP BY jel.account_id ORDER BY jel.account_id`);
    assert.deepEqual(
      nets.rows.map((r) => [Number(r.account_id), Number(r.net)]),
      [
        [1121, 0],
        [1122, 0],
        [1130, 0],
      ],
    );
    await assertBalanced();
    const count = await pg.query<{ count: string }>(
      `SELECT count(*) AS count FROM journal_entries WHERE tenant_id='t1' AND source_type LIKE 'pdc_cheque_%' AND source_id=1`,
    );
    assert.equal(Number(count.rows[0].count), 6);

    // 8. Occurrence uniqueness still holds: replaying the re-deposit with its
    // ORIGINAL sequence returns the re-deposit journal and posts nothing new.
    await preStep(4, '2026-10-15');
    const replay = await inTx((trx) => posting.postPdcChequeDeposit(trx, 1, auth));
    assert.equal(Number(replay.journalEntryId), Number(j5.journalEntryId));
    const countAfter = await pg.query<{ count: string }>(
      `SELECT count(*) AS count FROM journal_entries WHERE tenant_id='t1' AND source_type LIKE 'pdc_cheque_%' AND source_id=1`,
    );
    assert.equal(Number(countAfter.rows[0].count), 6, 'same-sequence replay must not post a duplicate journal');

    // 9. The two deposit journals carry different dedup keys (the mechanism).
    const keys = await pg.query<{ dedup_key: string }>(
      'SELECT dedup_key FROM journal_entries WHERE id IN ($1,$2) ORDER BY id',
      [Number(j2.journalEntryId), Number(j5.journalEntryId)],
    );
    assert.notEqual(keys.rows[0].dedup_key, keys.rows[1].dedup_key);
    assert.match(keys.rows[0].dedup_key, /^pdc_cheque_deposit:1:1$/);
    assert.match(keys.rows[1].dedup_key, /^pdc_cheque_deposit:1:4$/);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
