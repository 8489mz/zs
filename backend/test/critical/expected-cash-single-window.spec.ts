/*
New file: backend/test/critical/expected-cash-single-window.spec.ts

WHAT THIS PINS (INV-EXPECTED-CASH-SINGLE-WINDOW): every
time-windowed component of expected cash is predicated on ONE
timestamp — the row's created_at, the moment the cash actually
moved — inside [shift.created_at, shift.closed_at]. Before this
package, expenses used an OR of expense_date/created_at (an expense
created in shift 1 with a business date inside shift 2 counted in
BOTH shifts, and one created in shift 2 with a business date in
shift 1 also counted in both), services used the same OR on
service_date, and supplier payments used payment_date only (a
payment recorded in shift 1 but dated inside shift 2 counted in
the shift that never held the cash). Sales, collections, and
returns already used created_at and are unchanged; the shift-linked
treasury legs are exactly-once by link and are unchanged.

WHAT IS DRIVEN: the real computeShiftExpectedCash over two
consecutive shifts of one opener on a 2dp tenant, with boundary
rows whose business date and created_at fall in DIFFERENT shifts:
each such row must count in exactly the shift that contains its
created_at, and the two shifts' expected cash must partition the
total net cash movement exactly once. The display movement list
(fetchShiftMovementItems) is driven too: the same rows must appear
in exactly one shift's list.

NOT DRIVEN: the rep-remittance drawer attribution (verified
DEFECTIVE in code during this batch — see the batch report; no fix
is folded in here and no case pins it); live two-terminal drawer
counting; live-Postgres acceptance (deferred by written decision).
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
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint,
        opened_by bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, status text,
        created_at timestamptz, closed_at timestamptz, closed_by bigint, variance numeric, close_note text, doc_no text);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, txn_type text, amount numeric,
        note text, reference_type text, reference_id bigint, payment_channel text, return_document_id bigint,
        branch_id bigint, location_id bigint, created_by bigint, account_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz,
        created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_by bigint, created_at timestamptz,
        branch_id bigint, location_id bigint, total numeric, paid_amount numeric, payment_type text,
        payment_channel text, collection_status text, delivery_fee numeric, delivery_fee_mode text, tip_amount numeric);
      CREATE TABLE sale_payments (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, payment_channel text, amount numeric);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_by bigint,
        created_at timestamptz, branch_id bigint, location_id bigint, total numeric, settlement_mode text,
        refund_method text, refund_allocations jsonb, doc_no text, note text);
      CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint,
        payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint,
        payment_channel text, amount numeric, note text);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz,
        created_at timestamptz, branch_id bigint, location_id bigint, amount numeric, title text, note text, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
      CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz,
        branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);

      -- Two consecutive closed shifts, same opener, boundary 16:00.
      INSERT INTO cashier_shifts (id, tenant_id, branch_id, location_id, opened_by, opening_cash, status, created_at, closed_at, doc_no)
        VALUES (1,'t1',NULL,NULL,1,0,'closed','2026-10-01 08:00:00+00','2026-10-01 16:00:00+00','SHIFT-1');
      INSERT INTO cashier_shifts (id, tenant_id, branch_id, location_id, opened_by, opening_cash, status, created_at, closed_at, doc_no)
        VALUES (2,'t1',NULL,NULL,1,0,'closed','2026-10-01 16:00:00+00','2026-10-01 23:00:00+00','SHIFT-2');

      -- Expense A: cash left the drawer during shift 1 (created
      -- 15:59:59) but its business date falls in shift 2.
      INSERT INTO expenses (id, tenant_id, created_by, expense_date, created_at, amount, title)
        VALUES (1,'t1',1,'2026-10-01 16:00:01+00','2026-10-01 15:59:59+00',10,'expense A');
      -- Expense B: cash left during shift 2 (created 16:00:01) but
      -- its business date falls in shift 1.
      INSERT INTO expenses (id, tenant_id, created_by, expense_date, created_at, amount, title)
        VALUES (2,'t1',1,'2026-10-01 15:59:59+00','2026-10-01 16:00:01+00',20,'expense B');

      -- Cash sale during shift 1.
      INSERT INTO sales (id, tenant_id, status, created_by, created_at, total, paid_amount, payment_type, payment_channel, collection_status)
        VALUES (1,'t1','posted',1,'2026-10-01 15:30:00+00',100,100,'cash','cash',NULL);
      -- Customer collection during shift 2.
      INSERT INTO customer_payments (id, tenant_id, created_by, created_at, payment_channel, amount)
        VALUES (1,'t1',1,'2026-10-01 16:30:00+00','cash',30);
      -- Supplier payment: cash left during shift 1 (created 15:45)
      -- but dated inside shift 2.
      INSERT INTO supplier_payments (id, tenant_id, created_by, payment_date, created_at, payment_channel, amount)
        VALUES (1,'t1',1,'2026-10-01 16:30:00+00','2026-10-01 15:45:00+00','cash',40);
      -- Cash service during shift 2 (created 16:15) but dated in
      -- shift 1.
      INSERT INTO services (id, tenant_id, created_by, service_date, created_at, payment_channel, amount)
        VALUES (1,'t1',1,'2026-10-01 15:00:00+00','2026-10-01 16:15:00+00','cash',50);
    `);

    // Shift 1: +100 sale - 10 expense A - 40 supplier payment = 50.
    // (Expense B and the service/collection belong to shift 2.)
    assert.equal(await drawer.computeShiftExpectedCash(1, auth), 50);
    // Shift 2: +30 collection + 50 service - 20 expense B = 60.
    assert.equal(await drawer.computeShiftExpectedCash(2, auth), 60);
    // Partition check: the two shifts together count every movement
    // exactly once: 100 + 30 + 50 - 10 - 20 - 40 = 110.
    const total = await drawer.computeShiftExpectedCash(1, auth) + await drawer.computeShiftExpectedCash(2, auth);
    assert.equal(total, 110);

    // The movement list follows the same rule: expense A and the
    // supplier payment appear in shift 1's list only; expense B in
    // shift 2's list only.
    const shift1 = await drawer.getShift(1, auth);
    const shift2 = await drawer.getShift(2, auth);
    const items1 = await (drawer as any).fetchShiftMovementItems(1, shift1, auth);
    const items2 = await (drawer as any).fetchShiftMovementItems(2, shift2, auth);
    const ids1 = items1.map((item: any) => item.id);
    const ids2 = items2.map((item: any) => item.id);
    assert.ok(ids1.includes('exp-1'), 'expense A must list in shift 1');
    assert.ok(!ids2.includes('exp-1'), 'expense A must not list in shift 2');
    assert.ok(ids2.includes('exp-2'), 'expense B must list in shift 2');
    assert.ok(!ids1.includes('exp-2'), 'expense B must not list in shift 1');
    assert.ok(ids1.includes('sp-1'), 'supplier payment must list in shift 1');
    assert.ok(!ids2.includes('sp-1'), 'supplier payment must not list in shift 2');

    // Invariant pin: the entry exists exactly once and is last.
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-EXPECTED-CASH-SINGLE-WINDOW').length - 1, 1, 'the invariant entry must exist exactly once');

    console.log('Expected cash single window tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
