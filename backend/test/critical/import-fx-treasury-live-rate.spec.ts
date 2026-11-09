/*
New file: backend/test/critical/import-fx-treasury-live-rate.spec.ts
Pins the FX treasury desk to the live rate (INV-IMPORT-FX-TREASURY-LIVE-RATE, I4-D7).

WHAT WAS WRONG (live trial phase 2, problem D7): FX treasury
provisioning was unusable, two defects sharing one shape — the
rate had no live source anywhere, and the account picker offered
only accounts the backend must reject:
1. RATE: recordFxAcquisition computed the rate from user-entered
   amounts (effectiveRate = egpCost / foreignAmount) and the page
   pre-filled 10,000 / 485,000 -> a disabled 48.5000 field. The
   container's FX 50.0000 was likewise manually entered; 0 treasury
   operations exist. No call to the shared live resolver
   (resolveFxRate) existed anywhere on the treasury path.
2. ACCOUNTS: both dropdowns offered only 3 parent accounts
   (1100 "الأصول المتداولة" / 1160 "عهد وسلف موظفين" /
   1170 "مصروفات مدفوعة مقدمًا" — live ids 1537 / 1530 / 1538)
   and every one was rejected with "الحساب المحاسبي المحدد (id)
   غير صالح لدور (bank) أو معطل", and the unset defaults both
   resolved to the same settings bank account
   ([IMPORT_FX_SAME_ACCOUNT]). No operation recorded, no JE.

ROOT CAUSE (grounded, NOT the backend bank-role check — that check
is CORRECT and is deliberately left unchanged):
(a) The picker filter in ImportFxTreasuryManager read
    `a.isCashBank` top-level, but /api/accounting/accounts nests
    the flag as `flags.isCashBank` (accounting.service.ts
    listAccounts + the AccountingAccount type), so that arm never
    matched a real cash/bank account; and the other arm
    (`accountGroup === 'current_assets'`) admitted exactly the
    parent accounts, because real cash/bank leaves (1110 الخزينة /
    1120 البنك) carry accountGroup 'cash_bank', NOT
    'current_assets' (COA seed migration 20260529000300). The
    dropdown therefore offered precisely the three parents the
    backend must reject and never offered 1110/1120. The three
    trial accounts 1537/1530/1538 are parent current-asset
    accounts with is_cash_bank false: they must STAY rejected —
    accepting them as bank destinations would post journals to
    parent/group accounts. The fix offers only the real cash/bank
    accounts (active assets with flags.isCashBank true).
(b) The defaults: both selects started empty, so both resolved
    through settings bank_account_id to the same account. The
    page now defaults them to two DIFFERENT eligible accounts.
(c) The rate: recordFxAcquisition derived it from the amounts.
    It now resolves live through resolveFxRate (fail-closed when
    no rate is registered) and the EGP cost is the RESULT of the
    rate (foreignAmount x live rate). A supplied cost or rate must
    agree with the live rate (cost within one piastre, rate within
    0.0001) or the acquisition rejects with
    IMPORT_FX_RATE_MISMATCH. The page shows the live rate
    (GET /api/accounting/currencies) read-only and the EGP cost
    as a read-only derivation; it sends the live rate and the
    backend re-resolves it.

WHAT THIS PINS, driving the real recordFxAcquisition on PGlite
through the real posting boundary (fixture live USD rate 60 —
deliberately NOT the trial's 48.5 and NOT the old invented 50):
- Trial shape, no amounts supplied (10,000 USD, destination
  1120 / source 1110): posts the acquisition at the LIVE rate —
  egp_cost 600,000, effective_exchange_rate 60, one balanced JE
  Dr 1120 / Cr 1110 600,000, two treasury legs +600,000 /
  -600,000, journal linked on the row.
- The trial's exact pre-fill (10,000 / 485,000, implied 48.5)
  now REJECTS with IMPORT_FX_RATE_MISMATCH naming the live
  rate, and writes nothing.
- A supplied exchangeRate 48.5 against the live 60 rejects the
  same way; a supplied rate equal to the live rate (60) with a
  matching cost is accepted.
- No USD rate registered (tenant t2): rejects with the
  resolver's fail-closed message, writes nothing — no invented
  rate, no silent fallback.
- The three trial parents (1537 / 1530 / 1538) STAY rejected as
  bank destinations (and as the source leg), naming the account
  id and the (bank) role — the backend check was right.
- Frontend wiring (source pins): the page reads
  flags?.isCashBank, never offers 'current_assets' parents,
  fetches the live rate from /api/accounting/currencies, never
  computes a displayed rate from user amounts, never pre-fills
  485,000, and defaults the two legs to two different accounts.

FAIL-ON-BASE: cases 1, 2, 3 and 5 fail on base — on base the
rate is derived from the amounts (case 1 throws because egpCost
is required; cases 2 and 3 succeed at the invented 48.5; case 5
throws the amounts error instead of the resolver's message).
Cases 4 and 6 pass on base too (the matching-rate echo and the
bank-role rejections were already correct) and are regression
pins, not fail-on-base proofs. The frontend pins fail on base:
the old page contains 'current_assets', 'a.isCashBank',
'egpCost / foreignAmount' and '485000'.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely } from 'kysely';
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
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"'), ('t2', 'currency', '"EGP"');
    -- t1 carries a live USD rate of 60 on purpose: 60 is NOT the
    -- trial's 48.5 and NOT the old invented 50, so a stored 60 and a
    -- 600,000 cost prove live resolution. t2 has a base currency
    -- but NO foreign rate row: the resolver must fail closed.
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 60, false), ('t2', 'EGP', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW()), (2, 't2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (1537, 't1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', true, false, false, false, false, false),
      (1530, 't1', 't1', '1160', 'عهد وسلف موظفين', 'Employee Advances', 'asset', 'current_assets', true, false, false, false, false, false),
      (1538, 't1', 't1', '1170', 'مصروفات مدفوعة مقدمًا', 'Prepaid Expenses', 'asset', 'current_assets', true, false, false, false, false, false),
      (24, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (27, 't1', 't1', '1110', 'الخزينة', 'Cash', 'asset', 'cash_bank', true, true, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}', NULL, NOW());
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

async function expectReject(promise: Promise<any>, pattern: RegExp, message: string): Promise<void> {
  await assert.rejects(async () => promise, pattern, message);
}

function trialDto(overrides: Record<string, unknown> = {}): any {
  return {
    currency: 'USD',
    foreignAmount: 10000,
    acquisitionDate: '2026-01-10',
    source: 'bank',
    bankAccountId: '24',
    sourceAccountId: '27',
    ...overrides,
  };
}

async function main(): Promise<void> {
  // Case 1: trial shape, no amounts supplied — the live rate is the
  // source and the EGP cost is its result. Posts at live 60.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const acquisition: any = await service.recordFxAcquisition('t1', 1, trialDto());
      assert.equal(acquisition.currency, 'USD', 'Currency is stored normalised');
      assert.equal(Number(acquisition.effective_exchange_rate), 60, 'Rate is the live registered rate, never derived from amounts');
      assert.equal(Number(acquisition.egp_cost), 600000, 'EGP cost is foreignAmount x live rate (10,000 x 60)');
      assert.ok(acquisition.journal_entry_id, 'The journal is linked on the acquisition row');
      assert.ok(Number(acquisition.serial_id) > 0, 'The serial exists for journal/treasury references');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', acquisition.journal_entry_id).executeTakeFirstOrThrow();
      assert.equal(entry.source_type, 'import_fx_acquisition');
      assert.equal(Number(entry.source_id), Number(acquisition.serial_id));
      const lines = await journalLines(db, acquisition.journal_entry_id);
      assert.equal(lines.length, 2, 'Exactly two journal lines');
      const debits = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
      const credits = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
      assert.equal(debits, 600000);
      assert.equal(credits, 600000, 'The journal balances');
      const dest = lines.find((l: any) => Number(l.account_id) === 24);
      const src = lines.find((l: any) => Number(l.account_id) === 27);
      assert.equal(Number(dest.debit), 600000, 'Destination bank 1120 is debited');
      assert.equal(Number(src.credit), 600000, 'Source cash 1110 is credited');
      const legs: any[] = await (db as any).selectFrom('treasury_transactions').selectAll().execute();
      assert.equal(legs.length, 2, 'Two treasury legs');
      assert.equal(legs.reduce((s: number, l: any) => s + Number(l.amount), 0), 0, 'Treasury legs net to zero in EGP book value');
      assert.ok(legs.some((l: any) => Number(l.amount) === 600000 && Number(l.reference_id) === Number(acquisition.serial_id)));
      assert.ok(legs.some((l: any) => Number(l.amount) === -600000 && Number(l.reference_id) === Number(acquisition.serial_id)));
      assert.ok(legs.every((l: any) => l.txn_type === 'import_fx_acquisition'));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the trial's exact pre-fill (10,000 / 485,000, implied
  // 48.5) now REJECTS against the live 60 and writes nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordFxAcquisition('t1', 1, trialDto({ egpCost: 485000 })),
        /IMPORT_FX_RATE_MISMATCH/,
        'The trial pre-fill cost disagrees with the live rate and must fail closed',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'Nothing written on rejection');
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'treasury_transactions'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a supplied exchangeRate that disagrees with the live
  // rate rejects; a supplied rate equal to the live rate is
  // accepted as an echo (with a matching cost).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordFxAcquisition('t1', 1, trialDto({ egpCost: 485000, exchangeRate: 48.5 })),
        /IMPORT_FX_RATE_MISMATCH/,
        'A supplied rate disagreeing with the live rate must fail closed',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'Nothing written on rejection');
      const ok: any = await service.recordFxAcquisition('t1', 1, trialDto({ egpCost: 600000, exchangeRate: 60 }));
      assert.equal(Number(ok.effective_exchange_rate), 60, 'A supplied rate matching the live rate is accepted');
      assert.equal(Number(ok.egp_cost), 600000, 'The matching cost posts at the live rate');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: no USD rate registered (tenant t2) — the resolver fails
  // closed instead of inventing a rate; nothing is written.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordFxAcquisition('t2', 1, trialDto()),
        /سعر صرف USD غير متاح/,
        'A missing live rate fails closed with the resolver message',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'Nothing written on rejection');
      assert.equal(await countRows(db, 'journal_entries'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the three trial parents (1537 / 1530 / 1538) STAY
  // rejected as bank destinations — and as the source leg — naming
  // the account id and the (bank) role. The backend check was
  // right; the picker was the defect.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      for (const parentId of [1537, 1530, 1538]) {
        await expectReject(
          service.recordFxAcquisition('t1', 1, trialDto({ bankAccountId: String(parentId) })),
          new RegExp(`الحساب المحاسبي المحدد \\(${parentId}\\) غير صالح لدور \\(bank\\)`),
          `Parent account ${parentId} fails naming the account id and the bank role`,
        );
      }
      await expectReject(
        service.recordFxAcquisition('t1', 1, trialDto({ sourceAccountId: '1537' })),
        /الحساب المحاسبي المحدد \(1537\) غير صالح لدور \(bank\)/,
        'A parent account as the source leg fails the same way',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'A rejected acquisition records nothing');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'A rejected acquisition posts no journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: frontend wiring (source pins) — the page offers only
  // real cash/bank accounts, reads the live rate from the server,
  // and never derives a rate from user-entered amounts.
  {
    const page = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/import-sales/ImportFxTreasuryManager.tsx'),
      'utf8',
    );
    assert.ok(page.includes('flags?.isCashBank'), 'Picker reads the nested flags.isCashBank the accounts endpoint returns');
    assert.ok(!page.includes("accountGroup === 'current_assets'"), 'Picker never offers current_assets parents');
    assert.ok(!page.includes('|| a.isCashBank'), 'Picker never reads the top-level isCashBank that is always undefined');
    assert.ok(page.includes('/api/accounting/currencies'), 'Page fetches the live registered rate from the server');
    assert.ok(!page.includes('egpCost / foreignAmount'), 'No displayed rate is ever computed from user-entered amounts');
    assert.ok(!page.includes('485000'), 'The invented 48.5 pre-fill is gone');
    assert.ok(page.includes('exchangeRate: liveRate'), 'The mutation sends the live rate, never a user-typed one');
    assert.ok(page.includes('bankAccounts[1]'), 'The two legs default to two DIFFERENT eligible accounts');
  }
}

main().then(
  () => {
    console.log('import-fx-treasury-live-rate: all cases passed');
    process.exit(0);
  },
  (error) => {
    console.error('import-fx-treasury-live-rate FAILED:', error);
    process.exit(1);
  },
);
