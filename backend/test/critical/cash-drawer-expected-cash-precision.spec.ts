/*
New file: backend/test/critical/cash-drawer-expected-cash-precision.spec.ts
Style follows backend/test/critical/cash-drawer-variance.spec.ts
(PGlite + Kysely, imports production service code, no duplicated formulas).

WHAT THIS PINS: the expected-cash COMPUTATION carries full book
precision. Before this package, computeShiftExpectedCashFromShift and
its helpers rounded every component through the service's private
toMoney (2dp), so a KWD shift computed 125.25 where the true expected
cash was 125.248: opening 100.123 was truncated to 100.12, and the
cash-out total 5.005 was truncated to 5.00, manufacturing a phantom
variance before the P1 variance fix ever saw the numbers. This spec
drives the production aggregator and the movements helper directly
(private methods via `as any`, as the codebase's specs do for
production internals) on a KWD tenant and asserts exact 3dp results.
Every other component (sales, services, supplier payments, expenses,
collections, returns, cancelled receipts) is left empty on purpose:
they return coalesced zeros, so the spec isolates the two truncation
points (opening cash and drawer movements) without a 200-line fixture.
A fuller fixture with cash sales is welcome, but it is not needed to
prove the defect is gone: any component that still truncated would
move these totals.

SCOPE NOTE: this spec tests the computation, not the close flow: the
close flow's password assertion and blind-close declared totals are
deliberately untouched by the package and are not exercised here.
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
      INSERT INTO settings VALUES ('t1','currency','KWD');
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO currency_exchange_rates VALUES ('t1','KWD',true,1);
      CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint,
        opened_by bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, status text,
        created_at timestamptz, closed_at timestamptz, closed_by bigint, variance numeric, close_note text, doc_no text);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, txn_type text, amount numeric,
        note text, reference_type text, reference_id bigint, payment_channel text, return_document_id bigint,
        branch_id bigint, location_id bigint, created_by bigint, account_id bigint);
      CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz,
        created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_by bigint, created_at timestamptz,
        branch_id bigint, location_id bigint, total numeric, paid_amount numeric, payment_type text,
        payment_channel text, collection_status text, delivery_fee numeric, delivery_fee_mode text, tip_amount numeric);
      CREATE TABLE sale_payments (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, payment_channel text, amount numeric);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_by bigint,
        created_at timestamptz, branch_id bigint, location_id bigint, total numeric, settlement_mode text,
        refund_method text, refund_allocations jsonb);
      CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz,
        branch_id bigint, location_id bigint, payment_channel text, amount numeric);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz,
        created_at timestamptz, branch_id bigint, location_id bigint, amount numeric, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
      CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz,
        branch_id bigint, location_id bigint, payment_channel text, amount numeric);
      INSERT INTO cashier_shifts (id, tenant_id, branch_id, location_id, opened_by, opening_cash, status, created_at, closed_at, doc_no)
        VALUES (1,'t1',NULL,NULL,1,100.123,'open','2026-10-01 00:00:00+00',NULL,'SHIFT-1');
      INSERT INTO cashier_shifts (id, tenant_id, branch_id, location_id, opened_by, opening_cash, status, created_at, closed_at, doc_no)
        VALUES (2,'t1',NULL,NULL,0,50.005,'open','2026-10-01 00:00:00+00',NULL,'SHIFT-2');
      INSERT INTO treasury_transactions (tenant_id, txn_type, amount, note, reference_type, reference_id, payment_channel, return_document_id, created_by)
        VALUES ('t1','cash_in',10.123,'cash in','cashier_shift',1,NULL,NULL,1);
      INSERT INTO treasury_transactions (tenant_id, txn_type, amount, note, reference_type, reference_id, payment_channel, return_document_id, created_by)
        VALUES ('t1','cash_in',20.007,'manual','cashier_shift',1,NULL,NULL,1);
      INSERT INTO treasury_transactions (tenant_id, txn_type, amount, note, reference_type, reference_id, payment_channel, return_document_id, created_by)
        VALUES ('t1','cash_out',-5.005,'cash out','cashier_shift',1,NULL,NULL,1);
    `);

    // Movements component at full precision: cash-in 30.13, cash-out
    // exactly 5.005 (the old toMoney truncated it to 5.00), net 25.125.
    const movements = await (drawer as any).computeShiftCashDrawerMovements(1, auth);
    assert.deepEqual(movements, {
      cashInTotal: 30.13,
      deliveryCashInTotal: 0,
      manualCashInTotal: 30.13,
      cashOutTotal: 5.005,
      netMovementTotal: 25.125,
    });

    // Full aggregation: 100.123 opening + 25.125 net = 125.248 exactly.
    // The old computation produced 125.25 (100.12 + 30.13 - 5.00).
    const shift1 = {
      id: 1, tenant_id: 't1', branch_id: null, location_id: null, opened_by: 1,
      opening_cash: 100.123, created_at: new Date('2026-10-01T00:00:00.000Z'), closed_at: null, status: 'open',
    };
    const expected1 = await (drawer as any).computeShiftExpectedCashFromShift(shift1, auth);
    assert.equal(expected1, 125.248);

    // Opening-only path (no opener, no movements): 50.005 survives whole.
    // The old computation produced 50.00.
    const shift2 = {
      id: 2, tenant_id: 't1', branch_id: null, location_id: null, opened_by: 0,
      opening_cash: 50.005, created_at: new Date('2026-10-01T00:00:00.000Z'), closed_at: null, status: 'open',
    };
    const expected2 = await (drawer as any).computeShiftExpectedCashFromShift(shift2, auth);
    assert.equal(expected2, 50.005);

    console.log('Cash drawer expected cash precision tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
