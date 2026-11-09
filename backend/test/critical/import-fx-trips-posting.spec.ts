/*
New file: backend/test/critical/import-fx-trips-posting.spec.ts
Pins FX acquisitions and sourcing-trip expenses as posted ledger
events, not memo rows (INV-IMPORT-FX-TRIPS-POSTING).

WHAT WAS WRONG: recordFxAcquisition inserted a reference-only
row — no journal, no treasury movement, the destination bank
account validated but otherwise unused, the DTO exchangeRate
ignored, and the currency stored exactly as typed, so 'usd'
and 'USD' formed two portfolio buckets. Sourcing-trip
actual_cost_egp was record-only, yet the profit report summed
every trip as an expense — an unpaid estimate overstated
costs before posting, and the moment a trip ever posted it
would double-count. Profit did not equal the GL.

WHAT THIS PINS, driving the real recordFxAcquisition,
getFxPortfolio, postSourcingTripExpense and
generatePeriodProfitReport on PGlite through the real posting
boundary:
- FX: one transaction resolves the LIVE registered rate through
  resolveFxRate (never from the amounts), derives the EGP cost as
  foreignAmount x live rate, inserts the acquisition (currency
  uppercased at write), posts one balanced journal Dr
  destination / Cr source for the EGP cost, and writes two
  treasury legs (+destination / -source) keyed by the
  acquisition serial. The journal is linked on the row, and
  an optional transfer link is recorded only when the
  transfer belongs to the tenant and its currency matches
  (case-insensitively) — the link is attribution, never a
  settlement. A supplied rate or cost must agree with the live
  rate (rate 0.0001, cost one piastre) or the acquisition
  rejects with IMPORT_FX_RATE_MISMATCH; with no rate
  registered for the currency it fails closed.
- Currency normalisation: a legacy 'usd' row and a new 'USD'
  acquisition unify under one 'USD' portfolio key with the
  correct weighted average; no 'usd' key survives.
- Fail-closed: a supplied exchangeRate that disagrees with the
  live registered rate, the same source and destination account
  (including the resolver-default single-account case), a
  transfer link with a mismatched currency, and a missing
  account with no resolver default — each writes nothing.
- Trips: posting is approval-gated (token bound to the trip,
  amount ceiling and supplier), rejects a missing token, a
  non-expense account and an unknown supplier WITHOUT
  consuming the token, posts one journal Dr expense / Cr
  supplier payable (mirrored into the supplier subledger),
  one expenses row, links the trip, and conflicts on a
  second posting.
- Profit equals GL: the project profit report excludes an
  unposted trip (totalExpenses 0) and counts a posted trip
  exactly once (totalExpenses == the single journal/expense
  amount, never twice).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, currency text, amount_foreign numeric, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text);
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('ref-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_fx_acquisitions (id text PRIMARY KEY DEFAULT ('fx-' || md5(random()::text)), serial_id bigserial, tenant_id text, currency text, foreign_amount numeric, egp_cost numeric, effective_exchange_rate numeric, acquisition_date text, source text, bank_account_id bigint, notes text, journal_entry_id bigint, supplier_payment_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, trip_title text, destination_city text, start_date text, end_date text, budget_egp numeric, actual_cost_egp numeric, notes text, findings text, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_share_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, amount_egp numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false), ('t1', 'EUR', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1120', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (27, 't1', 't1', '1110', 'خزينة', 'Cash', 'asset', 'assets', true, true, false, false, false, false),
      (28, 't1', 't1', '5200', 'مصروف رحلات', 'Trip expense', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 10, 0, 2000, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', entryId).execute();
}

async function insertApproval(db: Kysely<Database>, id: string, actionType: string, referenceId: string, payload: any): Promise<void> {
  await db.insertInto('import_approval_requests' as never).values({
    id, tenant_id: 't1', module: 'import', action_type: actionType,
    reference_id: referenceId, requested_by: 99, created_by: 99, status: 'approved',
    request_payload: JSON.stringify(payload),
  } as never).execute();
}

async function approvalStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any).selectFrom('import_approval_requests').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return row.status;
}

async function expectReject(promise: Promise<any>, pattern: RegExp, message: string): Promise<void> {
  await assert.rejects(async () => promise, pattern, message);
}

async function main(): Promise<void> {
  // Case 1: an FX acquisition posts a balanced journal and two
  // treasury legs in one transaction, with the currency
  // uppercased at write and the journal linked on the row.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const acquisition: any = await service.recordFxAcquisition('t1', 1, {
        currency: 'usd', foreignAmount: 10000, egpCost: 500000,
        acquisitionDate: '2026-01-10', source: 'bank',
        bankAccountId: '24', sourceAccountId: '27', notes: 'auction',
      });
      assert.equal(acquisition.currency, 'USD', 'Currency is stored normalised');
      assert.equal(Number(acquisition.effective_exchange_rate), 50, 'Rate is the live registered rate, not computed from the amounts');
      assert.ok(acquisition.journal_entry_id, 'The journal is linked on the acquisition row');
      assert.ok(Number(acquisition.serial_id) > 0, 'The serial exists for journal/treasury references');
      assert.equal(acquisition.supplier_payment_id, null, 'Unlinked by default');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', acquisition.journal_entry_id).executeTakeFirstOrThrow();
      assert.equal(entry.source_type, 'import_fx_acquisition');
      assert.equal(Number(entry.source_id), Number(acquisition.serial_id));
      const lines = await journalLines(db, acquisition.journal_entry_id);
      assert.equal(lines.length, 2, 'Exactly two journal lines');
      const debits = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
      const credits = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
      assert.equal(debits, 500000);
      assert.equal(credits, 500000, 'The journal balances');
      const dest = lines.find((l: any) => Number(l.account_id) === 24);
      const src = lines.find((l: any) => Number(l.account_id) === 27);
      assert.equal(Number(dest.debit), 500000, 'Destination is debited');
      assert.equal(Number(src.credit), 500000, 'Source is credited');
      const legs: any[] = await (db as any).selectFrom('treasury_transactions').selectAll().execute();
      assert.equal(legs.length, 2, 'Two treasury legs');
      assert.equal(legs.reduce((s: number, l: any) => s + Number(l.amount), 0), 0, 'Treasury legs net to zero in EGP book value');
      assert.ok(legs.some((l: any) => Number(l.amount) === 500000 && Number(l.reference_id) === Number(acquisition.serial_id)));
      assert.ok(legs.some((l: any) => Number(l.amount) === -500000 && Number(l.reference_id) === Number(acquisition.serial_id)));
      assert.ok(legs.every((l: any) => l.txn_type === 'import_fx_acquisition'));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: 'usd' and 'USD' unify under one portfolio key, with
  // legacy memo rows (no journal link) included in the read.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db.insertInto('import_fx_acquisitions' as never).values({
        tenant_id: 't1', currency: 'usd', foreign_amount: 5000, egp_cost: 250000,
        effective_exchange_rate: 50, acquisition_date: '2026-01-05', source: 'bank',
        bank_account_id: 24, notes: 'legacy memo row',
      } as never).execute();
      await service.recordFxAcquisition('t1', 1, {
        currency: 'USD', foreignAmount: 10000, egpCost: 500000,
        acquisitionDate: '2026-01-10', source: 'bank',
        bankAccountId: '24', sourceAccountId: '27',
      });
      const portfolio: any = await service.getFxPortfolio('t1');
      assert.deepEqual(Object.keys(portfolio.portfolio), ['USD'], 'One bucket, not two');
      assert.equal(portfolio.portfolio.USD.totalForeign, 15000);
      assert.equal(portfolio.portfolio.USD.totalEgp, 750000);
      assert.equal(portfolio.portfolio.USD.weightedAvgRate, 50, 'Weighted average across both spellings');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a supplied rate that disagrees with the LIVE rate
  // fails closed and writes nothing; a supplied rate matching
  // the live rate is accepted. (INV-IMPORT-FX-TREASURY-LIVE-RATE:
  // the old "disagrees with the amounts" rule is gone — the rate
  // is never derived from the amounts. The trial's exact pre-fill
  // 10,000 / 485,000 now rejects against the live 50; see
  // import-fx-treasury-live-rate.spec.ts.)
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const base = {
        currency: 'USD', foreignAmount: 10000, egpCost: 500000,
        acquisitionDate: '2026-01-10', source: 'bank',
        bankAccountId: '24', sourceAccountId: '27',
      };
      await expectReject(
        service.recordFxAcquisition('t1', 1, { ...base, exchangeRate: 99 }),
        /IMPORT_FX_RATE_MISMATCH/, 'A mismatched supplied rate must fail closed',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'Nothing written on rejection');
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'treasury_transactions'), 0);
      const ok: any = await service.recordFxAcquisition('t1', 1, { ...base, exchangeRate: 50 });
      assert.equal(Number(ok.effective_exchange_rate), 50, 'A supplied rate matching the live rate is accepted');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: the same source and destination account fails
  // closed — explicitly, and through the resolver default when
  // the caller passes only one account.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const base = {
        currency: 'USD', foreignAmount: 10000, egpCost: 500000,
        acquisitionDate: '2026-01-10', source: 'bank',
      };
      await expectReject(
        service.recordFxAcquisition('t1', 1, { ...base, bankAccountId: '24', sourceAccountId: '24' }),
        /IMPORT_FX_SAME_ACCOUNT/, 'Moving money to itself is rejected',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0);
      await (db as any).updateTable('accounting_settings').set({ bank_account_id: 24 }).where('id', '=', 1).execute();
      await expectReject(
        service.recordFxAcquisition('t1', 1, { ...base, bankAccountId: '24' }),
        /IMPORT_FX_SAME_ACCOUNT/, 'A single-account caller hits the same fail-closed, never a silent default',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the transfer link validates the transfer's tenant
  // and currency (case-insensitively) and is attribution only.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db.insertInto('supplier_payments' as never).values({
        id: 900, tenant_id: 't1', currency: 'eur', amount_foreign: 5000,
      } as never).execute();
      const linked: any = await service.recordFxAcquisition('t1', 1, {
        currency: 'EUR', foreignAmount: 5000, egpCost: 250000,
        acquisitionDate: '2026-01-10', source: 'bank',
        bankAccountId: '24', sourceAccountId: '27', transferId: 900,
      });
      assert.equal(Number(linked.supplier_payment_id), 900, 'The link is recorded');
      await expectReject(
        service.recordFxAcquisition('t1', 1, {
          currency: 'USD', foreignAmount: 5000, egpCost: 250000,
          acquisitionDate: '2026-01-10', source: 'bank',
          bankAccountId: '24', sourceAccountId: '27', transferId: 900,
        }),
        /IMPORT_FX_TRANSFER_CURRENCY_MISMATCH/, 'A currency-mismatched link fails closed',
      );
      await expectReject(
        service.recordFxAcquisition('t1', 1, {
          currency: 'USD', foreignAmount: 5000, egpCost: 250000,
          acquisitionDate: '2026-01-10', source: 'bank',
          bankAccountId: '24', sourceAccountId: '27', transferId: 999,
        }),
        /غير تابعة للمنشأة/, 'An unknown transfer fails closed',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 1, 'Only the valid link wrote a row');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: trip posting is approval-gated, validates before
  // consuming the token, posts one journal + one expenses row,
  // mirrors the supplier subledger, and conflicts twice.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const trip: any = await service.createSourcingTrip('t1', {
        projectId: 'proj-1', tripTitle: 'Canton Fair', destinationCity: 'Guangzhou',
        startDate: '2026-01-15', endDate: '2026-01-20', budgetEgp: 20000, actualCostEgp: 30000,
      });
      assert.equal(trip.journal_entry_id, null, 'A new trip is an unposted estimate');
      await expectReject(
        service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: '', supplierId: 1, expenseAccountId: 28 }),
        /موافقة Maker-Checker/, 'No token, no posting',
      );
      assert.equal(await countRows(db, 'journal_entries'), 0);
      await insertApproval(db, 'tok-1', 'sourcing_trip_expense', trip.id, { tripId: trip.id, amount: 30000, supplierId: 1 });
      await expectReject(
        service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: 'tok-1', supplierId: 1, expenseAccountId: 24 }),
        /حساب مصروف/, 'A non-expense account fails closed',
      );
      assert.equal(await approvalStatus(db, 'tok-1'), 'approved', 'The token is not consumed on a validation failure');
      await expectReject(
        service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: 'tok-1', supplierId: 999, expenseAccountId: 28 }),
        /غير تابع للمنشأة/, 'An unknown supplier fails closed',
      );
      assert.equal(await approvalStatus(db, 'tok-1'), 'approved', 'The token survives the second validation failure too');
      const posted: any = await service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: 'tok-1', supplierId: 1, expenseAccountId: 28 });
      assert.ok(posted.journal_entry_id, 'The trip is linked to its journal');
      assert.equal(await approvalStatus(db, 'tok-1'), 'executed', 'The token is consumed exactly once, on success');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', posted.journal_entry_id).executeTakeFirstOrThrow();
      assert.equal(entry.source_type, 'import_sourcing_trip_expense');
      const lines = await journalLines(db, posted.journal_entry_id);
      assert.equal(lines.length, 2);
      const expenseLine = lines.find((l: any) => Number(l.account_id) === 28);
      const payableLine = lines.find((l: any) => Number(l.account_id) === 22);
      assert.equal(Number(expenseLine.debit), 30000);
      assert.equal(Number(payableLine.credit), 30000);
      assert.equal(payableLine.partner_type, 'supplier');
      assert.equal(Number(payableLine.partner_id), 1, 'The payable leg carries its supplier partner');
      assert.equal(await countRows(db, 'expenses'), 1, 'Exactly one expenses mirror row');
      const expenseRow: any = await (db as any).selectFrom('expenses').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(expenseRow.amount), 30000);
      const supplier: any = await (db as any).selectFrom('suppliers').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(supplier.balance), 30000, 'The supplier subledger mirrors the payable');
      const ledger: any[] = await (db as any).selectFrom('supplier_ledger').selectAll().execute();
      assert.equal(ledger.length, 1);
      assert.equal(Number(ledger[0].amount), 30000);
      assert.equal(ledger[0].reference_type, 'journal_entry');
      await insertApproval(db, 'tok-2', 'sourcing_trip_expense', trip.id, { tripId: trip.id, amount: 30000, supplierId: 1 });
      await expectReject(
        service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: 'tok-2', supplierId: 1, expenseAccountId: 28 }),
        /تم ترحيل مصروف هذه الرحلة مسبقاً/, 'A second posting conflicts',
      );
      assert.equal(await countRows(db, 'journal_entries'), 1, 'No second journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: profit equals GL — an unposted trip is excluded
  // from the report, a posted trip is counted exactly once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const trip: any = await service.createSourcingTrip('t1', {
        projectId: 'proj-1', tripTitle: 'Canton Fair', destinationCity: 'Guangzhou',
        startDate: '2026-01-15', endDate: '2026-01-20', budgetEgp: 20000, actualCostEgp: 30000,
      });
      const before: any = await service.generatePeriodProfitReport('t1', '2026-01-01', '2026-12-31', 'proj-1');
      assert.equal(Number(before.data.totalExpenses), 0, 'An unposted estimate is a memo, excluded from financial reports');
      await insertApproval(db, 'tok-1', 'sourcing_trip_expense', trip.id, { tripId: trip.id, amount: 30000, supplierId: 1 });
      await service.postSourcingTripExpense('t1', 1, trip.id, { approvalRequestId: 'tok-1', supplierId: 1, expenseAccountId: 28 });
      const after: any = await service.generatePeriodProfitReport('t1', '2026-01-01', '2026-12-31', 'proj-1');
      assert.equal(Number(after.data.totalExpenses), 30000, 'The posted expense is counted exactly once — never twice');
      assert.equal(await countRows(db, 'journal_entries'), 1, 'One journal for the trip');
      assert.equal(await countRows(db, 'expenses'), 1, 'One expenses row for the trip');
    } finally {
      await db.destroy();
    }
  }

  // Case 8: with no account and no resolver default, the
  // acquisition fails closed — never a silent default account.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordFxAcquisition('t1', 1, {
          currency: 'USD', foreignAmount: 10000, egpCost: 500000,
          acquisitionDate: '2026-01-10', source: 'bank',
        }),
        /حساب/, 'No account anywhere must fail closed',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('import-fx-trips-posting: all cases passed');
    process.exit(0);
  },
  (error) => {
    console.error('import-fx-trips-posting FAILED:', error);
    process.exit(1);
  },
);
