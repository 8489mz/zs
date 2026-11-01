import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { WithholdingTaxService } from '../../src/modules/accounting/services/withholding-tax.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { migration as widenMigration } from '../../src/database/migrations/2040000000276_withholding_tax_minor_unit_precision';

/*
 * Withholding-tax creation + subledger sync at book digits, with the
 * widening migration (INV-WITHHOLDING-TAX-BOOK-DIGITS).
 *
 * THE GAP: createTransaction ran on the pool handle with a hardcoded
 * two-decimal helper, so a KWD 10.001 of withholding was truncated
 * to 10.00 at creation, while postWithholdingTaxRemittance already
 * posted at book digits. syncPartnerSubLedger then moved the partner
 * balance by the 2dp value while the journal posted the full
 * book-digits value — a proven 0.001 GL-vs-subledger divergence.
 * Worse, the table itself was NUMERIC(15,2): on real Postgres the
 * third decimal was rounded away at INSERT, so code alone could
 * never store it. The old harness could not see this: it created
 * the table with unbounded numeric.
 *
 * THE RULE: creation resolves book digits on the transaction handle
 * (tenantBaseCurrency + currencyMoneyDigits, fail closed on a
 * mismatch) and rounds base and tax once with roundMoney; the
 * remittance posting re-rounds at book digits as before; the sync
 * moves the balance by the stored tax_amount rounded at book
 * digits on the same transaction, with balance_after as the exact
 * returned balance. Migration 2040000000276 widens base_amount and
 * tax_amount to scale 3, data-preserving, following the 0257/0258
 * pattern. Code and migration ship together.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Fail closed on currency mismatch for draft creation:
 *     tenantBaseCurrency throws on a settings/rate mismatch, the
 *     P0-1/P0-2/P0-3 pattern. No lenient 2dp fallback: a lenient
 *     draft would store totals the posting would refuse to book.
 * (2) Digits resolved separately on the transaction handle at each
 *     step: post already resolves on its handle, sync resolves on
 *     the same transaction and the same settings row, so the two
 *     resolutions cannot disagree.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - extractFromPurchases keeps its raw-settings digits resolution
 *   (currencyMoneyDigits on the raw settings value). Its spec has
 *   no currency_exchange_rates table; switching it would break that
 *   spec unchanged. The JSON-quoted settings.currency question
 *   stays open pending one live check. The consistency case below
 *   proves extraction and creation agree on the same inputs.
 * - Return/report records keep 2dp display shaping (this.toMoney);
 *   the pins below read STORED rows back from the table, never the
 *   returned records.
 * - PDC balance_after is a separate package (P1-1).
 *
 * FLOAT ORDER: roundMoney rounds the binary float product. The KWD
 * literals below are exact at 3dp (1000.125 = 1000 + 1/8). The EGP
 * case uses values whose 2dp rounding is unambiguous in binary.
 *
 * WHAT THIS PINS, driving the REAL WithholdingTaxService + the REAL
 * posting boundary on PGlite (fresh database per case; the tenant
 * foundation service is stubbed to a no-op because foundation
 * seeding is a separate setup path, not the posting computation;
 * the WHT table uses production-faithful NUMERIC(15,3) DDL):
 * - 3dp full chain (KWD): manual base 1000.125 at 1% stores base
 *   1000.125 and tax 10.001 (read back from the table), posts a
 *   10.001 journal, and syncs the supplier balance by -10.001 with
 *   balance_after exactly -10.001. GL and subledger agree.
 * - 2dp identity (EGP): base 200.55 at 1% stores base 200.55 and
 *   tax 2.01, posts and syncs 2.01 exactly.
 * - Fail-closed digits: a base-currency/rate mismatch rejects the
 *   creation with no stored row.
 * - Manual-vs-extracted consistency: the same inputs produce the
 *   same stored/posted/synced values on both paths.
 * - Migration: applying 0276 to a NUMERIC(15,2) table widens both
 *   columns to scale 3, preserves an existing 10.00 row unchanged,
 *   and afterwards 10.001 survives storage.
 * This is not an end-to-end post on live Postgres.
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
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, metadata jsonb, balance numeric DEFAULT 0, is_active boolean, updated_at timestamptz);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric DEFAULT 0, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, status text, created_at timestamptz, subtotal numeric, discount numeric, tax_amount numeric, prices_include_tax boolean, doc_no text);
    CREATE TABLE withholding_tax_transactions (id bigserial PRIMARY KEY, tenant_id text, direction text, source_type text, source_id bigint, extraction_key text, invoice_number text, invoice_date text, partner_type text, partner_id bigint, partner_name text, tax_id_number text, file_number text, tax_office_code text, partner_address text, wht_type text, wht_rate numeric, base_amount numeric(15, 3), tax_amount numeric(15, 3), quarter text, tax_year int, status text, payment_reference text, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'الخزينة', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '1120', 'البنك', 'Bank', 'asset', true, false, NULL, true, false, false, false, false),
      (30, 't1', '1130', 'عملاء', 'Receivables', 'asset', true, false, NULL, true, false, true, false, false),
      (50, 't1', '2110', 'موردون', 'Payables', 'liability', true, false, NULL, true, false, false, true, false),
      (60, 't1', '2126', 'أمانات ضريبة', 'WHT payable', 'liability', true, false, NULL, true, false, false, false, false),
      (65, 't1', '1155', 'ضريبة مستقطعة', 'WHT receivable', 'asset', true, false, NULL, true, false, false, false, false),
      (70, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
    INSERT INTO suppliers VALUES (5, 't1', 'Supplier Co', '{"companyName":"Supplier Co","taxNumber":"123"}'::jsonb, 0, true);
    INSERT INTO customers VALUES (7, 't1', 'Customer Co', 0, true);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  // Bare (unquoted) settings value: tenantBaseCurrency JSON-parses
  // with a legacy fallback, and extractFromPurchases reads the raw
  // value — both paths must agree on the same seeded form.
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): WithholdingTaxService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new WithholdingTaxService(db as any, posting as any);
}

async function storedRow(db: Kysely<Database>, id: number): Promise<{ base: number; tax: number; status: string }> {
  const row = await (db as any).selectFrom('withholding_tax_transactions').select(['base_amount', 'tax_amount', 'status']).where('id', '=', id).executeTakeFirstOrThrow() as unknown as { base_amount: string; tax_amount: string; status: string };
  return { base: Number(row.base_amount), tax: Number(row.tax_amount), status: row.status };
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).where('journal_entry_id', '=', entryId).orderBy('id').execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function main(): Promise<void> {
  // Case 1: KWD (3dp) full chain — stored, posted, synced exactly.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const created = await svc.createTransaction(auth, {
        direction: 'payable', source_type: 'manual', invoice_number: 'INV-1', invoice_date: '2026-10-15',
        partner_type: 'supplier', partner_id: 5, partner_name: 'Supplier Co',
        wht_type: 'goods', wht_rate: 1, base_amount: 1000.125,
      } as never);
      const stored = await storedRow(db, Number(created.id));
      assert.equal(stored.base, 1000.125);
      assert.equal(stored.tax, 10.001);
      assert.equal(stored.status, 'draft');

      const paid = await svc.updateStatus(auth, Number(created.id), { status: 'paid' }) as unknown as { status: string; payment_reference: string };
      assert.equal(paid.status, 'paid');
      assert.ok(String(paid.payment_reference).startsWith('JE-'));
      const entryId = Number(String(paid.payment_reference).replace('JE-', ''));
      const lines = await journalLines(db, entryId);
      assert.deepEqual(lines, [
        { accountId: 50, debit: 10.001, credit: 0 },
        { accountId: 60, debit: 0, credit: 10.001 },
        { accountId: 60, debit: 10.001, credit: 0 },
        { accountId: 20, debit: 0, credit: 10.001 },
      ]);
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 5).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), -10.001);
      const ledger = await (db as any).selectFrom('supplier_ledger').select(['amount', 'balance_after']).executeTakeFirstOrThrow() as unknown as { amount: string; balance_after: string };
      assert.equal(Number(ledger.amount), -10.001);
      assert.equal(Number(ledger.balance_after), -10.001);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: EGP (2dp) identity — 2dp storage, posting, and sync agree.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const svc = makeServices(db);
      const created = await svc.createTransaction(auth, {
        direction: 'payable', source_type: 'manual', invoice_number: 'INV-2', invoice_date: '2026-10-15',
        partner_type: 'supplier', partner_id: 5, partner_name: 'Supplier Co',
        wht_type: 'goods', wht_rate: 1, base_amount: 200.55,
      } as never);
      const stored = await storedRow(db, Number(created.id));
      assert.equal(stored.base, 200.55);
      assert.equal(stored.tax, 2.01);
      await svc.updateStatus(auth, Number(created.id), { status: 'paid' });
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 5).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), -2.01);
      const ledger = await (db as any).selectFrom('supplier_ledger').select(['amount', 'balance_after']).executeTakeFirstOrThrow() as unknown as { amount: string; balance_after: string };
      assert.equal(Number(ledger.amount), -2.01);
      assert.equal(Number(ledger.balance_after), -2.01);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: fail closed on a base-currency/rate mismatch — no stored row.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: 'KWD' } as never).execute();
      await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
      const svc = makeServices(db);
      await assert.rejects(
        svc.createTransaction(auth, {
          direction: 'payable', invoice_number: 'INV-3', invoice_date: '2026-10-15',
          partner_name: 'Supplier Co', wht_type: 'goods', wht_rate: 1, base_amount: 1000.125,
        } as never),
        /لا يطابق/,
      );
      const count = await (db as any).selectFrom('withholding_tax_transactions').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow() as unknown as { n: string };
      assert.equal(Number(count.n), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: manual and extracted paths agree on the same inputs.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      await db.insertInto('purchases' as never).values({
        id: 9, tenant_id: 't1', supplier_id: 5, status: 'posted', created_at: '2026-10-15',
        subtotal: 1114.125, discount: 0, tax_amount: 114, prices_include_tax: true, doc_no: 'PUR-9',
      } as never).execute();
      const extracted = await svc.extractFromPurchases(auth, { fromDate: '2026-10-01', toDate: '2026-10-31', defaultWhtType: 'goods', defaultWhtRate: 1 } as never);
      assert.equal(extracted.extracted_count, 1);
      assert.equal(extracted.total_tax_added, 10.001);
      const extRow = await (db as any).selectFrom('withholding_tax_transactions').select(['base_amount', 'tax_amount']).where('source_type', '=', 'purchase').executeTakeFirstOrThrow() as unknown as { base_amount: string; tax_amount: string };
      assert.equal(Number(extRow.base_amount), 1000.125);
      assert.equal(Number(extRow.tax_amount), 10.001);

      const created = await svc.createTransaction(auth, {
        direction: 'payable', source_type: 'manual', invoice_number: 'INV-4', invoice_date: '2026-10-15',
        partner_type: 'supplier', partner_id: 5, partner_name: 'Supplier Co',
        wht_type: 'goods', wht_rate: 1, base_amount: 1000.125,
      } as never);
      const stored = await storedRow(db, Number(created.id));
      assert.equal(stored.base, Number(extRow.base_amount));
      assert.equal(stored.tax, Number(extRow.tax_amount));
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the migration itself — widen (15,2) to scale 3, preserving rows.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE withholding_tax_transactions (id bigserial PRIMARY KEY, base_amount numeric(15, 2) NOT NULL, tax_amount numeric(15, 2) NOT NULL);
        INSERT INTO withholding_tax_transactions (base_amount, tax_amount) VALUES (1000.12, 10.00);
      `);
      await widenMigration.up(db as any);
      const info = await pg.query<{ column_name: string; numeric_scale: string }>(
        `SELECT column_name, numeric_scale::text FROM information_schema.columns WHERE table_name='withholding_tax_transactions' AND column_name IN ('base_amount','tax_amount') ORDER BY column_name`,
      );
      assert.deepEqual(info.rows.map((r) => [r.column_name, Number(r.numeric_scale)]), [['base_amount', 3], ['tax_amount', 3]]);
      const kept = await pg.query<{ base_amount: string; tax_amount: string }>('SELECT base_amount::text, tax_amount::text FROM withholding_tax_transactions');
      assert.deepEqual(kept.rows.map((r) => [Number(r.base_amount), Number(r.tax_amount)]), [[1000.12, 10]]);
      await pg.exec(`INSERT INTO withholding_tax_transactions (base_amount, tax_amount) VALUES (1000.125, 10.001)`);
      const kept2 = await pg.query<{ tax_amount: string }>('SELECT tax_amount::text FROM withholding_tax_transactions ORDER BY id DESC LIMIT 1');
      assert.equal(Number(kept2.rows[0].tax_amount), 10.001);
      // Idempotent: a second run is a no-op.
      await widenMigration.up(db as any);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: source pin — the create/post/sync slice uses book digits,
  // and the extraction path is untouched.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/accounting/services/withholding-tax.service.ts'), 'utf8');
    const createStart = source.indexOf('async createTransaction(');
    const extractStart = source.indexOf('async extractFromPurchases(');
    const syncStart = source.indexOf('private async syncPartnerSubLedger(');
    const deleteStart = source.indexOf('Delete transaction');
    assert.ok(createStart > 0 && extractStart > createStart && syncStart > 0 && deleteStart > syncStart);
    const createBody = source.slice(createStart, extractStart);
    assert.ok(createBody.includes('tenantBaseCurrency(trx, tenantId)'), 'creation must resolve digits on the transaction handle');
    assert.ok(createBody.includes('toBookMoney(bookBaseAmount'), 'creation must round the base at book digits');
    assert.ok(createBody.includes('base_amount: bookBaseAmount'), 'creation must store the book-digits base');
    assert.ok(!createBody.includes('this.toMoney(baseAmount *'), 'creation must not compute tax at 2dp');
    const syncBody = source.slice(syncStart, deleteStart);
    assert.ok(syncBody.includes('tenantBaseCurrency(trx, tenantId)'), 'sync must resolve digits on the transaction handle');
    assert.ok(syncBody.includes('toBookMoney(tx.tax_amount'), 'sync must move the stored amount at book digits');
    assert.ok(syncBody.includes('balance_after: Number(updated.balance)'), 'balance_after must be the exact returned balance');
    assert.ok(!syncBody.includes('.toFixed(2)'), 'sync must not re-round the snapshot at 2dp');
    assert.ok(!syncBody.includes('this.toMoney(tx.tax_amount)'), 'sync must not use the 2dp helper');
    const extractBody = source.slice(extractStart, source.indexOf('Update transaction status'));
    assert.ok(extractBody.includes('currencyMoneyDigits(currencyRow'), 'extraction keeps its raw-settings digits resolution');
    const migrationSource = readFileSync(resolve(__dirname, '../../src/database/migrations/2040000000276_withholding_tax_minor_unit_precision.ts'), 'utf8');
    assert.ok(migrationSource.includes("'withholding_tax_transactions', 'base_amount', 3"));
    assert.ok(migrationSource.includes("'withholding_tax_transactions', 'tax_amount', 3"));
  }

  console.log('withholding-tax-book-digits: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
