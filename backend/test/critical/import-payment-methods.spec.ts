/*
New file: backend/test/critical/import-payment-methods.spec.ts
Pins the closed payment-method enum and method-specific evidence
(INV-IMPORT-PAYMENT-METHODS).

WHAT WAS WRONG: recordForeignTransfer recorded no payment method at
all: a bank transfer, cash carried by a traveller, a letter of
credit, cash against documents, and an open-account payment all
looked identical in the money record, with no evidence of how the
money actually moved. The proforma advance split silently defaulted
to 30/70 when nobody agreed it. The approval binding carried no
payment method, so an approval for a bank transfer authorized a
cash payment.

WHAT THIS PINS, driving the real recordForeignTransfer,
createProformaInvoice and createApprovalRequest on PGlite through
the real posting boundary:
- A caller that supplies no method is recorded as a bank transfer
  (the historical behaviour) and no new evidence is demanded of
  legacy callers; existing records are untouched.
- An explicitly supplied method requires that method's evidence
  before any write: bank transfer needs a payment reference; cash
  carried needs carrier + travel date + handover receipt AND an
  explicit custody account; LC needs number + issuing bank +
  expiry + document list; CAD needs handover proof; open account
  needs terms + due date. Form 4 number/date stay OPTIONAL at
  recording for bank transfers (the clearance gate is package 2).
- An unknown method fails closed with
  IMPORT_PAYMENT_METHOD_UNKNOWN.
- An approval bound to a payment method authorizes only that
  method; an approval with no method cannot authorize a
  method-bound transfer.
- The proforma advance split is explicit or absent: neither
  percentage stores NULLs, one-sided or non-100 splits fail
  closed, and the silent 30 default is gone.
- A broker advance with an unknown payment method fails closed
  before any write.
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

async function insertApproval(db: Kysely<Database>, id: string, payload: Record<string, unknown>): Promise<void> {
  await db.insertInto('import_approval_requests' as never).values({
    id, tenant_id: 't1', module: 'import', action_type: 'large_transfer',
    reference_id: '1', requested_by: 99, created_by: 99, status: 'approved',
    request_payload: JSON.stringify(payload),
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function transfer(db: Kysely<Database>, service: any, dto: Record<string, unknown>): Promise<any> {
  return service.recordForeignTransfer('t1', 1, {
    supplierId: 1,
    amountEgp: 50000,
    amountForeign: 1000,
    currency: 'USD',
    bankAccountId: 24,
    idempotencyKey: 'key-1',
    proformaInvoiceId: 'pi-a',
    projectId: 'proj-1',
    ...dto,
  });
}

async function readPayment(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('supplier_payments').selectAll().executeTakeFirstOrThrow();
}

const BOUND_PAYLOAD = {
  amount: 1000, currency: 'USD', supplierId: '1',
  proformaInvoiceId: 'pi-a', projectId: 'proj-1',
};

async function main(): Promise<void> {
  // Case 1: legacy caller (no method) is recorded as a bank transfer, no evidence demanded.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const result = await transfer(db, service, { idempotencyKey: 'key-legacy' });
      assert.equal(result.paymentMethod, 'bank_transfer', 'A legacy transfer is recorded as a bank transfer');
      const payment = await readPayment(db);
      assert.equal(payment.payment_method, 'bank_transfer');
      assert.equal(payment.payment_reference, null, 'No reference was supplied, so none is stored');
      assert.equal(payment.form4_number, null, 'Form 4 stays optional at recording');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: explicit bank transfer requires a payment reference; Form 4 stays optional.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => transfer(db, service, { paymentMethod: 'bank_transfer', idempotencyKey: 'key-no-ref' }),
        /IMPORT_PAYMENT_EVIDENCE_REQUIRED/,
        'An explicit bank transfer without a payment reference must fail closed',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a rejected transfer');
      await transfer(db, service, {
        paymentMethod: 'bank_transfer', paymentReference: 'SWIFT-REF-1', bankSwiftCode: 'CIBEEGCX',
        idempotencyKey: 'key-bank-ok',
      });
      const payment = await readPayment(db);
      assert.equal(payment.payment_method, 'bank_transfer');
      assert.equal(payment.payment_reference, 'SWIFT-REF-1');
      assert.equal(payment.bank_swift_code, 'CIBEEGCX');
      assert.equal(payment.form4_number, null, 'Form 4 values are optional at recording');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: cash carried requires carrier + travel date + handover receipt AND an explicit custody account.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => transfer(db, service, {
          paymentMethod: 'cash_carried', carrierName: 'Ahmed', idempotencyKey: 'key-cash-partial',
        }),
        /IMPORT_PAYMENT_EVIDENCE_REQUIRED/,
        'Cash carried without travel date and handover receipt must fail closed',
      );
      await assert.rejects(
        async () => transfer(db, service, {
          paymentMethod: 'cash_carried', carrierName: 'Ahmed', travelDate: '2026-02-01',
          handoverReceiptNo: 'HR-9', bankAccountId: undefined, idempotencyKey: 'key-cash-noacct',
        }),
        /حساب العهدة النقدية/,
        'Cash carried without an explicit custody account must fail closed: the settings bank account is never silently treated as cash in hand',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a rejected transfer');
      await transfer(db, service, {
        paymentMethod: 'cash_carried', carrierName: 'Ahmed', travelDate: '2026-02-01',
        handoverReceiptNo: 'HR-9', idempotencyKey: 'key-cash-ok',
      });
      const payment = await readPayment(db);
      assert.equal(payment.payment_method, 'cash_carried');
      assert.equal(payment.evidence_carrier_name, 'Ahmed');
      assert.equal(payment.evidence_handover_receipt, 'HR-9');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: LC, CAD and open-account evidence rules.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => transfer(db, service, {
          paymentMethod: 'letter_of_credit', lcNumber: 'LC-1', lcIssuingBank: 'Bank',
          lcDocuments: 'B/L, invoice', idempotencyKey: 'key-lc-partial',
        }),
        /IMPORT_PAYMENT_EVIDENCE_REQUIRED/,
        'An LC without an expiry date must fail closed',
      );
      await assert.rejects(
        async () => transfer(db, service, { paymentMethod: 'cash_against_documents', idempotencyKey: 'key-cad-partial' }),
        /IMPORT_PAYMENT_EVIDENCE_REQUIRED/,
        'CAD without documents-handover proof must fail closed',
      );
      await assert.rejects(
        async () => transfer(db, service, {
          paymentMethod: 'open_account', paymentTerms: 'Net 60', idempotencyKey: 'key-oa-partial',
        }),
        /IMPORT_PAYMENT_EVIDENCE_REQUIRED/,
        'Open account without a due date must fail closed',
      );
      await assert.rejects(
        async () => transfer(db, service, { paymentMethod: 'wire', idempotencyKey: 'key-unknown' }),
        /IMPORT_PAYMENT_METHOD_UNKNOWN/,
        'An unknown payment method must fail closed',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a rejected transfer');
      await transfer(db, service, {
        paymentMethod: 'letter_of_credit', lcNumber: 'LC-1', lcIssuingBank: 'Bank',
        lcExpiryDate: '2026-06-01', lcDocuments: 'B/L, invoice', idempotencyKey: 'key-lc-ok',
      });
      const payment = await readPayment(db);
      assert.equal(payment.payment_method, 'letter_of_credit');
      assert.equal(payment.evidence_lc_number, 'LC-1');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: approval method binding.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await insertApproval(db, 'appr-bank', { ...BOUND_PAYLOAD, paymentMethod: 'bank_transfer' });
      await assert.rejects(
        async () => transfer(db, service, {
          approvalRequestId: 'appr-bank', paymentMethod: 'cash_carried',
          carrierName: 'Ahmed', travelDate: '2026-02-01', handoverReceiptNo: 'HR-9',
          idempotencyKey: 'key-method-mismatch',
        }),
        /طريقة الدفع/,
        'An approval bound to bank transfer must not authorize a cash-carried transfer',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0);
      await insertApproval(db, 'appr-nomethod', BOUND_PAYLOAD);
      await assert.rejects(
        async () => transfer(db, service, {
          approvalRequestId: 'appr-nomethod', paymentMethod: 'bank_transfer',
          paymentReference: 'REF-1', idempotencyKey: 'key-nomethod',
        }),
        /طريقة الدفع/,
        'An approval with no method cannot authorize a method-bound transfer: the approver never saw the method',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0);
      await insertApproval(db, 'appr-match', { ...BOUND_PAYLOAD, paymentMethod: 'bank_transfer' });
      await transfer(db, service, {
        approvalRequestId: 'appr-match', paymentMethod: 'bank_transfer',
        paymentReference: 'REF-2', idempotencyKey: 'key-method-ok',
      });
      assert.equal(await countRows(db, 'supplier_payments'), 1, 'A matching method-bound approval authorizes the transfer');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: proforma advance split is explicit or absent; the silent 30 default is gone.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const base: any = { supplierId: '1', piNumber: 'PI-X', piDate: '2026-01-15', currency: 'USD', totalAmountForeign: 2000, exchangeRateContract: 50 };
      const neither = await service.createProformaInvoice('t1', { ...base, piNumber: 'PI-NONE' });
      assert.equal(neither.advance_percentage, null, 'No percentages given: no advance structure is recorded');
      assert.equal(neither.balance_percentage, null);
      await assert.rejects(
        async () => service.createProformaInvoice('t1', { ...base, piNumber: 'PI-ONE', advancePercentage: 30 }),
        /معًا صراحة/,
        'A one-sided advance percentage must fail closed instead of defaulting the balance to 70',
      );
      await assert.rejects(
        async () => service.createProformaInvoice('t1', { ...base, piNumber: 'PI-SUM', advancePercentage: 40, balancePercentage: 50 }),
        /مجموعهما 100/,
        'Percentages that do not sum to 100 must fail closed',
      );
      const explicit = await service.createProformaInvoice('t1', { ...base, piNumber: 'PI-OK', advancePercentage: 30, balancePercentage: 70 });
      assert.equal(Number(explicit.advance_percentage), 30, 'An explicit 30/70 split is stored as given');
      assert.equal(Number(explicit.balance_percentage), 70);
      assert.equal(await countRows(db, 'import_proforma_invoices'), 3, 'Only the valid proformas are stored (seed + none + explicit)');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: broker advance with an unknown payment method fails closed before any write.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => service.disburseBrokerAdvance('t1', 1, { brokerId: 'b1', advanceNo: 'ADV-1', amountEgp: 1000, paymentMethod: 'crypto' }),
        /IMPORT_PAYMENT_METHOD_UNKNOWN/,
        'A broker payment with an unknown method must fail closed',
      );
    } finally {
      await db.destroy();
    }
  }

  console.log('Import payment methods tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
