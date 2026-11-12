/*
New file: backend/test/critical/services-treasury-append-only.spec.ts
Pins INV-SERVICES-TREASURY-APPEND-ONLY (S2: F2+F4, one root cause — the
service treasury history was rewritable).

THE GAP: syncServiceTreasuryTransaction began with an UNCONDITIONAL
`delete from treasury_transactions where reference_type='service' ...`
and re-inserted a cash_in leg dated at service_date (not the creation
moment), and deleteService deleted the treasury legs outright — with no
closed-shift guard. After a rewrite/delete, the stored expected_cash of
a closed shift diverged from the live treasury rows, and treasury
reports by date disagreed with shift reports on backdated rows.

THE RULES (driving the REAL ServicesService on PGlite, with the REAL
posting engine — postService/reverseService — so the journal legs are
real too):
1. APPEND-ONLY: an update never DELETEs a treasury leg. It posts a
   reversal leg (txn_type 'cash_out', amount NEGATIVE — the established
   cash_out sign: sales-write posts cash_out legs as -Math.abs(amount),
   and computeShiftCashDrawerMovements counts amount < 0 as cash out)
   for the live cash balance, then inserts the new cash_in leg. The
   original leg keeps its id, amount and created_at.
2. created_at IS NOW: both the reversal leg and the new cash_in leg are
   dated at the creation moment, never at the backdated service_date
   (F4). Shift attribution windows on created_at.
3. CLOSED-SHIFT GUARD: update/delete of a service whose cash entered
   inside a CLOSED shift is refused with SERVICE_SHIFT_CLOSED (422) —
   checked inside the transaction AFTER the FOR UPDATE lock, BEFORE
   reverseService, so a refused call changes nothing (no reversal leg,
   no journal, service row unchanged). The window is the shift window
   [cashier_shifts.created_at, closed_at] with null-tolerant
   branch/location match — the same window computeShiftServiceBreakdown
   uses. Two predicates: (a) any cash_in leg of the service dated
   inside the window (reversal legs excluded — they record the update
   moment, not the cash entry); (b) the service row itself, because
   the shift service detail reads the services table (created_by +
   created_at window), so changing the amount rewrites the closed
   shift's reported cash even though services.created_at never moves.
   (b) is also what protects card services, which have no treasury leg.
   No pre-existing treasury-reversal convention for reference_type=
   'service' existed anywhere in the repo (the only hits were the two
   DELETEs and a migration cleanup), so the reversal leg follows the
   sales-write cash_out convention above.

WHAT THIS PINS:
- update a cash service (100, backdated service_date) -> 150: the
  original leg still exists untouched (same id, 100, same created_at);
  a cash_out -100 leg exists; a new cash_in 150 leg exists with
  created_at ~= now (days after the service_date); legs net to 150;
  journal has the rev-1 entry, a reversal entry and the rev-2 entry.
- delete a cash service (200): both legs remain (+200 and -200,
  net 0), the service row is gone, the journal has a reversal entry.
- update of a service in an OPEN shift succeeds (amount + revision).
- update AND delete of a service whose cash_in leg sits in a CLOSED
  shift -> refused with code SERVICE_SHIFT_CLOSED / 422 and NOTHING
  changes (no reversal leg, no journal, service row unchanged).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ServicesService } from '../../src/modules/services/services.service';
import { migration as auditKeyMigration } from '../../src/database/migrations/2040000000293_audit_logs_idempotency_key';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const OLD_SERVICE_DATE = '2026-11-05T12:00:00.000Z';

function realPosting(): AccountingPostingService {
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  return new AccountingPostingService(foundation);
}

type TreasuryLeg = { id: number; txn_type: string; amount: string | number; created_at: Date | string };

async function treasuryLegs(db: Kysely<Database>, serviceId: number): Promise<TreasuryLeg[]> {
  const rows = await sql<TreasuryLeg>`SELECT id, txn_type, amount, created_at FROM treasury_transactions WHERE tenant_id = 't1' AND reference_type = 'service' AND reference_id = ${serviceId} ORDER BY id`.execute(db);
  return rows.rows;
}

async function journalCounts(db: Kysely<Database>): Promise<{ service: number; reversal: number }> {
  const rows = await sql<{ source_type: string; n: string }>`SELECT source_type, count(*)::text AS n FROM journal_entries WHERE tenant_id = 't1' AND source_type IN ('service', 'service_reversal') GROUP BY source_type`.execute(db);
  const out = { service: 0, reversal: 0 };
  for (const row of rows.rows) {
    if (row.source_type === 'service') out.service = Number(row.n);
    if (row.source_type === 'service_reversal') out.reversal = Number(row.n);
  }
  return out;
}

async function serviceRow(db: Kysely<Database>, serviceId: number): Promise<{ id: number; amount: string | number; revision: number } | null> {
  const rows = await sql<{ id: number; amount: string | number; revision: number }>`SELECT id, amount, revision FROM services WHERE tenant_id = 't1' AND id = ${serviceId}`.execute(db);
  return rows.rows?.[0] || null;
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Africa/Cairo');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (4200,'t1','a1','4200','revenue',true);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, code text NOT NULL DEFAULT '', is_active boolean NOT NULL DEFAULT TRUE);
      INSERT INTO branches VALUES (1, 't1', 'Main', '', true);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text NOT NULL DEFAULT '', is_active boolean NOT NULL DEFAULT TRUE);
      INSERT INTO stock_locations VALUES (1, 't1', 1, 'Store', '', true);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, password_hash text NOT NULL DEFAULT '', password_salt text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'admin', is_active boolean NOT NULL DEFAULT TRUE);
      INSERT INTO users VALUES (1, 't1', 'admin', '', '', 'admin', true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric DEFAULT 0, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, updated_at timestamptz);
      CREATE TABLE services (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', service_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), payment_channel TEXT NOT NULL DEFAULT 'cash', branch_id BIGINT NULL, location_id BIGINT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);
    await auditKeyMigration.up(db as never);

    const service = new ServicesService(db as never, new TransactionHelper(), new AuditService(db as never), {} as never, realPosting());

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await sql`INSERT INTO cashier_shifts (id, tenant_id, account_id, doc_no, opened_by, status, branch_id, location_id, opening_cash, expected_cash, created_at) VALUES (1, 't1', 'a1', 'SHIFT-A', 1, 'open', 1, 1, 0, 0, ${twoHoursAgo})`.execute(db);

    const payload = (name: string, amount: number, date = OLD_SERVICE_DATE) => ({
      service: { name, amount, notes: '', date, paymentChannel: 'cash' },
    }) as never;

    // Case 1: update append-only + created_at is NOW, not service_date.
    const created1 = await service.createService(payload('توصيل', 100), AUTH) as { ok: boolean };
    assert.equal(created1.ok, true, 'case 1 create ok');
    const svc1 = await sql<{ id: number }>`SELECT id FROM services WHERE name = 'توصيل' ORDER BY id DESC LIMIT 1`.execute(db);
    const id1 = Number(svc1.rows[0].id);
    const legsBefore = await treasuryLegs(db, id1);
    assert.equal(legsBefore.length, 1, 'case 1: one leg after create');
    const originalLeg = legsBefore[0];
    assert.equal(originalLeg.txn_type, 'cash_in');
    assert.equal(Number(originalLeg.amount), 100);
    const originalCreatedAtMs = toMs(originalLeg.created_at);
    const journalsBefore = await journalCounts(db);
    assert.equal(journalsBefore.service, 1, 'case 1: one service journal after create');
    assert.equal(journalsBefore.reversal, 0, 'case 1: no reversal journal after create');

    const updateBefore = new Date();
    const updated1 = await service.updateService(id1, payload('توصيل', 150), AUTH) as { ok: boolean };
    const updateAfter = new Date();
    assert.equal(updated1.ok, true, 'case 1 update ok');
    const row1 = await serviceRow(db, id1);
    assert.equal(Number(row1?.amount), 150, 'case 1: service amount is the new 150');
    assert.equal(row1?.revision, 2, 'case 1: revision bumped to 2');
    const legsAfter = await treasuryLegs(db, id1);
    assert.equal(legsAfter.length, 3, 'case 1: three legs after update (original + reversal + new)');
    const kept = legsAfter.find((leg) => leg.id === originalLeg.id);
    assert.ok(kept, 'case 1: original leg still exists');
    assert.equal(Number(kept?.amount), 100, 'case 1: original leg amount untouched');
    assert.equal(toMs(kept!.created_at), originalCreatedAtMs, 'case 1: original leg created_at untouched');
    const reversal = legsAfter.find((leg) => leg.txn_type === 'cash_out');
    assert.ok(reversal, 'case 1: a cash_out reversal leg exists');
    assert.equal(Number(reversal?.amount), -100, 'case 1: reversal is -100');
    assert.ok(toMs(reversal!.created_at) >= updateBefore.getTime() - 1000 && toMs(reversal!.created_at) <= updateAfter.getTime() + 1000, 'case 1: reversal created_at is now');
    const fresh = legsAfter.find((leg) => leg.txn_type === 'cash_in' && leg.id !== originalLeg.id);
    assert.ok(fresh, 'case 1: a new cash_in leg exists');
    assert.equal(Number(fresh?.amount), 150, 'case 1: new leg is 150');
    assert.ok(toMs(fresh!.created_at) >= updateBefore.getTime() - 1000 && toMs(fresh!.created_at) <= updateAfter.getTime() + 1000, 'case 1: new leg created_at is now');
    assert.ok(toMs(fresh!.created_at) - new Date(OLD_SERVICE_DATE).getTime() > 24 * 60 * 60 * 1000, 'case 1: new leg is NOT backdated to service_date');
    assert.equal(legsAfter.reduce((sum, leg) => sum + Number(leg.amount), 0), 150, 'case 1: legs net to 150');
    const journalsAfter = await journalCounts(db);
    assert.equal(journalsAfter.service, 2, 'case 1: rev-2 service journal posted');
    assert.equal(journalsAfter.reversal, 1, 'case 1: one reversal journal posted');
    console.log('case 1 (update append-only, created_at now) passed');

    // Case 2: delete keeps the treasury legs, reverses the journal.
    const created2 = await service.createService(payload('تنظيف', 200), AUTH) as { ok: boolean };
    assert.equal(created2.ok, true, 'case 2 create ok');
    const svc2 = await sql<{ id: number }>`SELECT id FROM services WHERE name = 'تنظيف' ORDER BY id DESC LIMIT 1`.execute(db);
    const id2 = Number(svc2.rows[0].id);
    const journalsBeforeDelete = await journalCounts(db);
    const deleted2 = await service.deleteService(id2, AUTH) as { ok: boolean };
    assert.equal(deleted2.ok, true, 'case 2 delete ok');
    assert.equal(await serviceRow(db, id2), null, 'case 2: service row is gone');
    const legs2 = await treasuryLegs(db, id2);
    assert.equal(legs2.length, 2, 'case 2: both legs remain after delete');
    assert.deepEqual(legs2.map((leg) => Number(leg.amount)).sort((a, b) => a - b), [-200, 200], 'case 2: original +200 and reversal -200');
    assert.equal(legs2.reduce((sum, leg) => sum + Number(leg.amount), 0), 0, 'case 2: legs net to 0');
    const journalsAfterDelete = await journalCounts(db);
    assert.equal(journalsAfterDelete.service, journalsBeforeDelete.service, 'case 2: no new service journal on delete');
    assert.equal(journalsAfterDelete.reversal, journalsBeforeDelete.reversal + 1, 'case 2: one reversal journal on delete');
    console.log('case 2 (delete keeps legs, reverses journal) passed');

    // Case 4: update inside an OPEN shift succeeds.
    const created4 = await service.createService(payload('صيانة', 50), AUTH) as { ok: boolean };
    assert.equal(created4.ok, true, 'case 4 create ok');
    const svc4 = await sql<{ id: number }>`SELECT id FROM services WHERE name = 'صيانة' ORDER BY id DESC LIMIT 1`.execute(db);
    const id4 = Number(svc4.rows[0].id);
    const updated4 = await service.updateService(id4, payload('صيانة', 60), AUTH) as { ok: boolean };
    assert.equal(updated4.ok, true, 'case 4: update in an open shift succeeds');
    const row4 = await serviceRow(db, id4);
    assert.equal(Number(row4?.amount), 60, 'case 4: amount updated to 60');
    assert.equal(row4?.revision, 2, 'case 4: revision bumped to 2');
    console.log('case 4 (open-shift update succeeds) passed');

    // Case 3: update AND delete inside a CLOSED shift are refused, nothing changes.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await sql`INSERT INTO cashier_shifts (id, tenant_id, account_id, doc_no, opened_by, status, branch_id, location_id, opening_cash, expected_cash, created_at) VALUES (2, 't1', 'a1', 'SHIFT-B', 1, 'open', 1, 1, 0, 0, ${oneHourAgo})`.execute(db);
    const created3 = await service.createService(payload('تركيب', 300), AUTH) as { ok: boolean };
    assert.equal(created3.ok, true, 'case 3 create ok');
    const svc3 = await sql<{ id: number }>`SELECT id FROM services WHERE name = 'تركيب' ORDER BY id DESC LIMIT 1`.execute(db);
    const id3 = Number(svc3.rows[0].id);
    // The service must have taken shift B's scope (latest open shift).
    const legs3Before = await treasuryLegs(db, id3);
    assert.equal(legs3Before.length, 1, 'case 3: one leg after create');
    assert.equal(Number(legs3Before[0].amount), 300);
    await sql`UPDATE cashier_shifts SET status = 'closed', closed_at = ${new Date()} WHERE id = 2`.execute(db);
    const journalsBeforeGuard = await journalCounts(db);

    let thrownUpdate: any = null;
    try {
      await service.updateService(id3, payload('تركيب', 350), AUTH);
    } catch (error) {
      thrownUpdate = error;
    }
    assert.ok(thrownUpdate, 'case 3: closed-shift update throws');
    assert.equal(thrownUpdate.code, 'SERVICE_SHIFT_CLOSED', 'case 3: update error code is SERVICE_SHIFT_CLOSED');
    assert.equal(thrownUpdate.statusCode, 422, 'case 3: update error status is 422');
    const row3AfterUpdate = await serviceRow(db, id3);
    assert.equal(Number(row3AfterUpdate?.amount), 300, 'case 3: refused update leaves the amount at 300');
    assert.equal(row3AfterUpdate?.revision, 1, 'case 3: refused update leaves revision at 1');
    assert.equal((await treasuryLegs(db, id3)).length, 1, 'case 3: refused update posts no reversal leg');
    const journalsAfterGuardUpdate = await journalCounts(db);
    assert.deepEqual(journalsAfterGuardUpdate, journalsBeforeGuard, 'case 3: refused update posts no journal');

    let thrownDelete: any = null;
    try {
      await service.deleteService(id3, AUTH);
    } catch (error) {
      thrownDelete = error;
    }
    assert.ok(thrownDelete, 'case 3: closed-shift delete throws');
    assert.equal(thrownDelete.code, 'SERVICE_SHIFT_CLOSED', 'case 3: delete error code is SERVICE_SHIFT_CLOSED');
    assert.equal(thrownDelete.statusCode, 422, 'case 3: delete error status is 422');
    const row3AfterDelete = await serviceRow(db, id3);
    assert.ok(row3AfterDelete, 'case 3: refused delete leaves the service row');
    assert.equal(Number(row3AfterDelete?.amount), 300, 'case 3: refused delete leaves the amount at 300');
    assert.equal((await treasuryLegs(db, id3)).length, 1, 'case 3: refused delete posts no reversal leg');
    const journalsAfterGuardDelete = await journalCounts(db);
    assert.deepEqual(journalsAfterGuardDelete, journalsBeforeGuard, 'case 3: refused delete posts no journal');
    console.log('case 3 (closed-shift guard refuses update + delete, nothing changes) passed');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => {
    console.log('services treasury append-only checks passed');
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
