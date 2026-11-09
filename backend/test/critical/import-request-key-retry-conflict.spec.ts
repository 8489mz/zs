/*
New file: backend/test/critical/import-request-key-retry-conflict.spec.ts
Pins the import request-key retry behaviour (INV-REQUEST-KEY-RETRY-CONFLICT).

WHAT WAS GROUNDED (no fix was needed — this spec pins behaviour that
already holds on base 42c20173):
- The trial item "same-request-key retry returning Conflict" lives in
  ImportSalesService.recordForeignTransfer, NOT in the global
  x-idempotency-key interceptor. The interceptor
  (core/idempotency/idempotency.interceptor.ts) REPLAYS the stored
  success response for a same-key/same-payload retry after success
  (Conflict only while the first call is still 'processing'); the
  treasury DTO requestKey path likewise returns the original document
  for a same-key/same-payload retry and reserves 409 for a same key
  with DIFFERENT data. The import foreign-transfer path is the one
  place where a retry after success with the SAME key is a 409:
  import-sales.service.ts L5104-L5113 looks the key up in
  supplier_payments and throws ConflictException citing the original
  doc_no, and L5155-L5165 maps a concurrent same-key unique
  violation (idx_supplier_payments_tenant_idempotency) to the same
  Conflict. The whole transfer (PI paid update, payment row,
  treasury transaction, supplier ledger, supplier balance, ONE
  journal) runs in one transaction, so the Conflict rolls every
  partial effect back.
- The API path is real: POST /foreign-transfer
  (import-sales.controller.ts L505-L514) passes dto.idempotencyKey
  through, falling back to the x-idempotency-key header when the body
  carries no key. No UI exposes a key — API-level only.

WHAT THIS PINS, driving the real recordForeignTransfer on PGlite
through the real posting boundary (fixture copied from the passing
import-payment-methods.spec.ts):
- Case 1: a first transfer with key K posts exactly once — one
  supplier_payments row, one journal (Dr supplier AP 50,000 /
  Cr bank 50,000, balanced), PI paid 1,000 foreign, supplier
  balance -50,000 EGP.
- Case 2: a retry with the SAME key K and the identical payload
  throws ConflictException (HTTP 409) whose message cites the
  original doc_no — and posts NOTHING: still one payment, one
  journal, one treasury transaction, one ledger row, PI paid still
  1,000, supplier balance still -50,000.
- Case 3: the same payload with a FRESH key posts a second transfer
  — proving the key, not the payload, is the gate: two payments,
  two journals, PI paid 2,000, supplier balance -100,000.
- Case 4: a missing key fails closed with BadRequestException and
  writes nothing.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ConflictException, BadRequestException } from '@nestjs/common';
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
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY DEFAULT ('pi-' || md5(random()::text)), tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text, pi_date text, incoterm text, delivery_port text, payment_terms text, advance_percentage numeric, balance_percentage numeric, status text, items text, notes text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES
      ('t1', 'EGP', 1, true),
      ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '5190', 'خسائر فروق عملة', 'Forex Loss', 'expense', 'expenses', true, false, false, false, false, false),
      (26, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES
      (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO import_proforma_invoices VALUES
      ('pi-a', 't1', 'PI-A', 1, 'proj-1', 'USD', 5000, 0, 50, 'open', '2026-01-01', 'FOB', NULL, NULL, NULL, NULL, 'draft', '[]', NULL);
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

async function transfer(db: Kysely<Database>, service: any, key: string): Promise<any> {
  return service.recordForeignTransfer('t1', 1, {
    supplierId: 1,
    amountEgp: 50000,
    amountForeign: 1000,
    currency: 'USD',
    bankAccountId: 24,
    idempotencyKey: key,
    proformaInvoiceId: 'pi-a',
    projectId: 'proj-1',
  });
}

async function readPiPaid(db: Kysely<Database>): Promise<number> {
  const pi: any = await (db as any).selectFrom('import_proforma_invoices').select('paid_amount_foreign').where('id', '=', 'pi-a').executeTakeFirstOrThrow();
  return Number(pi.paid_amount_foreign);
}

async function readSupplierBalance(db: Kysely<Database>): Promise<number> {
  const s: any = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
  return Number(s.balance);
}

async function journalTotals(db: Kysely<Database>): Promise<{ entries: number; lines: number; debits: number; credits: number }> {
  const entries = await countRows(db, 'journal_entries');
  const lines: any[] = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit']).execute();
  return {
    entries,
    lines: lines.length,
    debits: lines.reduce((s, l) => s + Number(l.debit), 0),
    credits: lines.reduce((s, l) => s + Number(l.credit), 0),
  };
}

async function main(): Promise<void> {
  // Case 1: first transfer with key K posts exactly once.
  // Case 2: retry with the SAME key K and identical payload -> 409 Conflict, nothing posted.
  // Case 3: same payload with a FRESH key posts a second transfer (the key is the gate).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await transfer(db, service, 'reqkey-retry-1');
      assert.equal(first.success, true, 'The first transfer must succeed');
      const docNo = String(first.docNo);
      assert.ok(docNo.startsWith('FT-'), `The first transfer must carry an FT- doc number, got ${docNo}`);
      assert.equal(await countRows(db, 'supplier_payments'), 1, 'One payment row after the first transfer');
      const je = await journalTotals(db);
      assert.equal(je.entries, 1, 'Exactly one journal entry after the first transfer');
      assert.equal(je.lines, 2, 'Two journal lines: Dr supplier AP / Cr bank, no forex variance at the contract rate');
      assert.equal(je.debits, 50000, 'Journal debits are 50,000 EGP');
      assert.equal(je.credits, 50000, 'Journal credits are 50,000 EGP');
      assert.equal(await countRows(db, 'treasury_transactions'), 1, 'One treasury transaction after the first transfer');
      assert.equal(await countRows(db, 'supplier_ledger'), 1, 'One supplier ledger row after the first transfer');
      assert.equal(await readPiPaid(db), 1000, 'PI paid is 1,000 foreign after the first transfer');
      assert.equal(await readSupplierBalance(db), -50000, 'Supplier balance is -50,000 EGP after the first transfer');

      await assert.rejects(
        async () => transfer(db, service, 'reqkey-retry-1'),
        (err: any) => {
          assert.ok(err instanceof ConflictException, `Expected ConflictException, got ${err?.constructor?.name}: ${err?.message}`);
          assert.equal(err.getStatus(), 409, 'A same-key retry after success is HTTP 409 Conflict');
          assert.ok(
            String(err.message || '').includes(docNo),
            `The Conflict must cite the original document ${docNo}, got: ${err?.message}`,
          );
          return true;
        },
        'A retry with the same request key after success must be rejected with Conflict, never a second posting',
      );

      assert.equal(await countRows(db, 'supplier_payments'), 1, 'Still one payment row after the rejected retry');
      const jeAfterRetry = await journalTotals(db);
      assert.equal(jeAfterRetry.entries, 1, 'Still one journal entry after the rejected retry — no second posting');
      assert.equal(jeAfterRetry.lines, 2, 'Still two journal lines after the rejected retry');
      assert.equal(jeAfterRetry.debits, 50000, 'Journal debits unchanged after the rejected retry');
      assert.equal(jeAfterRetry.credits, 50000, 'Journal credits unchanged after the rejected retry');
      assert.equal(await countRows(db, 'treasury_transactions'), 1, 'Still one treasury transaction after the rejected retry');
      assert.equal(await countRows(db, 'supplier_ledger'), 1, 'Still one supplier ledger row after the rejected retry');
      assert.equal(await readPiPaid(db), 1000, 'PI paid is still 1,000 foreign: the retry rolled its PI update back');
      assert.equal(await readSupplierBalance(db), -50000, 'Supplier balance is still -50,000 EGP after the rejected retry');

      const second = await transfer(db, service, 'reqkey-retry-2');
      assert.equal(second.success, true, 'The same payload with a fresh key must post');
      assert.notEqual(String(second.docNo), docNo, 'The second transfer carries its own document number');
      assert.equal(await countRows(db, 'supplier_payments'), 2, 'Two payment rows after the fresh-key transfer');
      const jeAfterSecond = await journalTotals(db);
      assert.equal(jeAfterSecond.entries, 2, 'Two journal entries after the fresh-key transfer');
      assert.equal(jeAfterSecond.debits, 100000, 'Journal debits are 100,000 EGP after two transfers');
      assert.equal(jeAfterSecond.credits, 100000, 'Journal credits are 100,000 EGP after two transfers');
      assert.equal(await readPiPaid(db), 2000, 'PI paid is 2,000 foreign after the fresh-key transfer');
      assert.equal(await readSupplierBalance(db), -100000, 'Supplier balance is -100,000 EGP after the fresh-key transfer');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: a missing request key fails closed and writes nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => transfer(db, service, ''),
        (err: any) => {
          assert.ok(err instanceof BadRequestException, `Expected BadRequestException, got ${err?.constructor?.name}: ${err?.message}`);
          assert.equal(err.getStatus(), 400, 'A missing request key is HTTP 400');
          return true;
        },
        'A foreign transfer without a request key must fail closed',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a keyless transfer');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may be written by a keyless transfer');
      assert.equal(await readPiPaid(db), 0, 'PI paid is untouched by a keyless transfer');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import request-key retry-conflict tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
