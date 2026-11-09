/*
New file: backend/test/critical/import-fx-rate-registration.spec.ts
Pins the FX rate registration path (INV-IMPORT-FX-RATE-REGISTRATION, I9-E, R11).

WHAT WAS WRONG (live re-test on deployed 4d811676, R11): confirming a
$10,000 FX arrangement was blocked with "سعر صرف USD غير مسجل؛ سجّل
السعر من شاشة العملات قبل تسجيل التدبير" — the live resolver had no
USD rate, and no currency-rates screen was found via the global menu
search for "سعر الصرف". 0 FX operations recorded.

GROUNDING (from the code at 4c2db076 — NOT a missing backend):
- POST /api/accounting/currencies (AccountingService.upsertCurrency)
  exists and correctly upserts currency_exchange_rates, and
  forexApi.upsertCurrency exists in the frontend API layer — but it
  had ZERO callers anywhere in the frontend, and no spec covered it.
- /accounting/forex ("تقييم العملات وفروق الصرف (IAS 21)") only
  LISTED the registered rates read-only; its wizard only enters a
  closing rate for revaluation. No screen could ever write a live rate.
- The seed (listCurrencies) seeds ONLY the base currency (EGP, rate
  1); no USD/EUR/CNY row is ever seeded. So a fresh tenant has no USD
  rate and no way to add one — the treasury error named a "شاشة
  العملات" that did not exist.
- The global search and the sidebar search matched only the nav
  item's label; the forex label contains "فروق الصرف", not
  "سعر الصرف", so searching "سعر الصرف" found nothing even though
  the screen existed.

THE FIX (no rate invented, no rate seeded — the admin enters the real
bank/central-bank rate once):
- /accounting/forex gains a "تسجيل / تحديث سعر الصرف" card that calls
  forexApi.upsertCurrency and invalidates the forex + accounting
  currency queries — that page IS the "شاشة العملات" now.
- The FX treasury dialog, with no live rate, still stays blocked
  (fail-closed) but offers the unblocking action: a "تسجيل سعر الصرف"
  button navigating to /accounting/forex, and the toast names the real
  screen path (المحاسبة ← تقييم العملات وفروق الصرف).
- Navigation items gain optional `keywords`; the forex item carries
  "سعر الصرف" / "أسعار الصرف" / "تسجيل سعر الصرف" / "سعر الدولار" /
  "العملات", and one shared matchesNavigationSearch predicate (label
  OR keywords) drives both the global search modal and the sidebar
  search, so "سعر الصرف" finds the screen.

WHAT THIS PINS, driving the REAL upsertCurrency and the REAL
recordFxAcquisition on PGlite (fixture USD rate 60 — deliberately NOT
the trial's 48.5):
- Case 1 (R11 reproduction): tenant with no USD rate — the $10,000
  arrangement fails closed with the resolver's message, writes nothing.
- Case 2 (the R11 proof): registering USD 60 through upsertCurrency,
  then confirming the $10,000 arrangement posts at the live rate —
  egp_cost 600,000, effective_exchange_rate 60, one balanced JE
  Dr 1120 / Cr 1110 600,000, two treasury legs +600,000 / -600,000,
  journal linked on the row.
- Case 3: re-registering USD at 55 moves the next arrangement to 55
  (550,000) — the admin can update a moved rate through the same path.
- Case 4: upsertCurrency rejects a non-positive rate and a malformed
  code, and writes nothing.
- Case 5 (frontend wiring, source pins): the forex page calls
  forexApi.upsertCurrency and invalidates both currency queries; the
  treasury dialog navigates to /accounting/forex when no live rate;
  the forex nav item carries a "سعر الصرف" keyword; both search sites
  match through matchesNavigationSearch.

FAIL-ON-BASE: case 5 fails on base — on base the forex page never
calls upsertCurrency, the treasury dialog never navigates to
/accounting/forex, the nav item has no keywords, and
matchesNavigationSearch does not exist. Cases 1–4 pass on base too
(upsertCurrency + recordFxAcquisition already existed); they are
regression pins of the path the new UI now depends on, not
fail-on-base proofs.
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
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      currency_code text, currency_name text, exchange_rate numeric,
      is_base boolean, symbol text,
      created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(),
      CONSTRAINT uq_tenant_currency UNIQUE (tenant_id, currency_code)
    );
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, currency text, amount_foreign numeric, payment_method text, form4_number text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_fx_acquisitions (id text PRIMARY KEY DEFAULT ('fx-' || md5(random()::text)), serial_id bigserial, tenant_id text, currency text, foreign_amount numeric, egp_cost numeric, effective_exchange_rate numeric, acquisition_date text, source text, bank_account_id bigint, notes text, journal_entry_id bigint, supplier_payment_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    -- t1 carries ONLY the base currency: no USD row, exactly the live
    -- R11 state — the resolver must fail closed until a rate is
    -- registered through upsertCurrency.
    INSERT INTO currency_exchange_rates (tenant_id, account_id, currency_code, currency_name, exchange_rate, is_base, symbol) VALUES ('t1', 't1', 'EGP', 'الجنيه المصري', 1, true, 'ج.م');
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (24, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (27, 't1', 't1', '1110', 'الخزينة', 'Cash', 'asset', 'cash_bank', true, true, false, false, false, false);
  `);
  return db;
}

function makeServices(db: Kysely<Database>): { accounting: any; importSales: any } {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  const accounting = new (AccountingService as any)(db, fakeFoundation);
  const importSales = new (ImportSalesService as any)(db, posting);
  return { accounting, importSales };
}

const auth: any = { tenantId: 't1', accountId: 't1', role: 'admin', permissions: ['accounting'] };

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
  // Case 1: R11 reproduction — no USD rate registered, the $10,000
  // arrangement fails closed with the resolver's message and writes
  // nothing. (Regression pin; passes on base too.)
  {
    const db = await makeDb();
    try {
      const { importSales } = makeServices(db);
      await expectReject(
        importSales.recordFxAcquisition('t1', 1, trialDto()),
        /سعر صرف USD غير متاح/,
        'A missing live rate fails closed with the resolver message',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 0, 'Nothing written on rejection');
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'treasury_transactions'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the R11 proof — register USD 60 through the REAL
  // upsertCurrency (the path the new forex-page card calls), then the
  // $10,000 arrangement confirms at the live rate. (Regression pin;
  // passes on base too — the backend path already existed; the UI
  // calling it is what case 5 pins.)
  {
    const db = await makeDb();
    try {
      const { accounting, importSales } = makeServices(db);
      const res: any = await accounting.upsertCurrency(
        { currencyCode: 'USD', currencyName: 'الدولار الأمريكي', exchangeRate: 60 },
        auth,
      );
      assert.equal(res.ok, true, 'Registration returns ok');
      assert.equal(Number(res.currency.exchange_rate), 60, 'The registered rate is stored');
      const acquisition: any = await importSales.recordFxAcquisition('t1', 1, trialDto());
      assert.equal(acquisition.currency, 'USD', 'Currency is stored normalised');
      assert.equal(Number(acquisition.effective_exchange_rate), 60, 'Rate is the live registered rate, never derived from amounts');
      assert.equal(Number(acquisition.egp_cost), 600000, 'EGP cost is foreignAmount x live rate (10,000 x 60)');
      assert.ok(acquisition.journal_entry_id, 'The journal is linked on the acquisition row');
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
    } finally {
      await db.destroy();
    }
  }

  // Case 3: re-registering the rate moves the next arrangement —
  // the admin updates a moved rate through the same path, no stale
  // rate survives. (Regression pin; passes on base too.)
  {
    const db = await makeDb();
    try {
      const { accounting, importSales } = makeServices(db);
      await accounting.upsertCurrency({ currencyCode: 'USD', currencyName: 'الدولار الأمريكي', exchangeRate: 60 }, auth);
      const updated: any = await accounting.upsertCurrency({ currencyCode: 'usd', currencyName: 'الدولار الأمريكي', exchangeRate: 55 }, auth);
      assert.equal(Number(updated.currency.exchange_rate), 55, 'The re-registered rate overwrites in place (code normalised)');
      assert.equal(await countRows(db, 'currency_exchange_rates'), 2, 'Still one row per currency (EGP + USD), never two USD buckets');
      const acquisition: any = await importSales.recordFxAcquisition('t1', 1, trialDto());
      assert.equal(Number(acquisition.effective_exchange_rate), 55, 'The next arrangement reads the updated rate');
      assert.equal(Number(acquisition.egp_cost), 550000, 'EGP cost follows the updated rate (10,000 x 55)');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: registration itself fails closed — a non-positive rate
  // or a malformed code registers nothing. (Regression pin.)
  {
    const db = await makeDb();
    try {
      const { accounting } = makeServices(db);
      await expectReject(
        accounting.upsertCurrency({ currencyCode: 'USD', currencyName: 'الدولار الأمريكي', exchangeRate: 0 }, auth),
        /سعر الصرف يجب أن يكون موجباً/,
        'A zero rate is rejected',
      );
      await expectReject(
        accounting.upsertCurrency({ currencyCode: 'USD', currencyName: 'الدولار الأمريكي', exchangeRate: -5 }, auth),
        /سعر الصرف يجب أن يكون موجباً/,
        'A negative rate is rejected',
      );
      await expectReject(
        accounting.upsertCurrency({ currencyCode: 'US', currencyName: 'دولار', exchangeRate: 60 }, auth),
        /رمز العملة مطلوب/,
        'A two-letter code is rejected',
      );
      assert.equal(await countRows(db, 'currency_exchange_rates'), 1, 'Only the seeded EGP row exists after the rejections');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: frontend wiring (source pins) — FAILS ON BASE.
  {
    const forexPage = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/accounting/pages/AccountingForexRevaluationPage.tsx'),
      'utf8',
    );
    assert.ok(forexPage.includes('forexApi.upsertCurrency'), 'The currencies screen calls the registration endpoint');
    assert.ok(forexPage.includes('currencyCode: rateCurrency'), 'Registration sends the selected currency code');
    assert.ok(forexPage.includes('exchangeRate: rate'), 'Registration sends the admin-entered rate (never an invented one)');
    assert.ok(forexPage.includes("invalidateQueries({ queryKey: ['forex-currencies'] })"), 'Registration refreshes the listed rates');
    assert.ok(forexPage.includes("invalidateQueries({ queryKey: ['accounting-currencies'] })"), 'Registration refreshes the treasury rate read');

    const treasuryPage = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/import-sales/ImportFxTreasuryManager.tsx'),
      'utf8',
    );
    assert.ok(treasuryPage.includes("navigate('/accounting/forex')"), 'With no live rate the dialog navigates to the currencies screen');
    assert.ok(treasuryPage.includes('تسجيل سعر الصرف'), 'The dialog offers the registration action by name');
    assert.ok(treasuryPage.includes('تقييم العملات وفروق الصرف'), 'The blocked toast names the real screen path, not an unfindable one');

    const accountingRoutes = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/accounting/routes.tsx'),
      'utf8',
    );
    assert.ok(accountingRoutes.includes("keywords: ['سعر الصرف'"), 'The forex nav item carries a "سعر الصرف" search keyword');

    const access = readFileSync(
      resolve(__dirname, '../../../frontend/src/app/router/access.ts'),
      'utf8',
    );
    assert.ok(access.includes('export function matchesNavigationSearch'), 'One shared search predicate exists for navigation items');
    assert.ok(access.includes('item.keywords'), 'The predicate matches item keywords, not just the label');

    const globalSearch = readFileSync(
      resolve(__dirname, '../../../frontend/src/shared/components/GlobalSearchModal.tsx'),
      'utf8',
    );
    assert.ok(globalSearch.includes('matchesNavigationSearch(item, normalizedQuery)'), 'Global search matches through the shared predicate');

    const appShell = readFileSync(
      resolve(__dirname, '../../../frontend/src/shared/layout/app-shell.tsx'),
      'utf8',
    );
    assert.ok(appShell.includes('matchesNavigationSearch(item, normalizedSidebarQuery)'), 'Sidebar search matches through the shared predicate');
  }
}

main().then(
  () => {
    console.log('import-fx-rate-registration: all cases passed');
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
