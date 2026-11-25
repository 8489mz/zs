import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { ContractingService } from '../../src/modules/contracting/contracting.service';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatLocalCalendarDay, todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../src/common/utils/client-date-bounds.util';

/*
 * Clock B4-P3 (RC-3/RC-5 low items): the five remaining low clock defects
 * from the re-review, plus the two planning-date bounds.
 *
 * THE DEFECTS:
 * - S1 maritime createCargoInsurance: `issue_date` defaulted to
 *   `new Date().toISOString().split('T')[0]` — the UTC day, one day early
 *   00:00-02:00 Cairo. Fix: resolveBusinessDateKey(trx, tenantId, now).
 * - S2 maritime addJobMilestone: `return_deadline` from a host-local
 *   `now + freeDays` instant sliced in UTC — same one-day-early trap.
 *   Fix: resolveBusinessDateKey(this.db, tenantId, deadline).
 * - S3 supplier firstDueDate: parse-only (INVALID_DUE_DATE on NaN), no
 *   range check. Fix: P6 checkClientBusinessDay window [today-7, today+5y].
 * - S4 purchase requiredDate: unbounded (a requested delivery date).
 *   Fix: P6 checkClientBusinessDay window [today, today+365].
 * - S5 contracting createDocument: omits issued_date, so the 0120
 *   CURRENT_DATE default fires. Fix: issued_date: todayTenantDate(businessTz),
 *   matching the sibling revision inserts.
 * - S6 tariff seed: omits effective_date, so the 0233 CURRENT_DATE default
 *   fires on every seeded row. Fix: resolveBusinessDateKey(this.db, tenantId, now).
 *
 * THE WINDOWS (why these, not others):
 * - S3 [today-7, today+5y] mirrors the P6 installment family exactly:
 *   the startDate past tolerance is 7 days and the schedule horizon is
 *   5 years (CLIENT_INSTALLMENT_SCHEDULE_YEARS). A supplier schedule is
 *   for an EXISTING payable, so there is no plan startDate to anchor on;
 *   the window anchors on the tenant today. A first due date months in
 *   the past is not a planning date — the merchant schedules forward.
 * - S4 [today, today+365] mirrors the P6 sales-order deliveryDate window:
 *   requiredDate is a requested DELIVERY date, future-facing.
 *
 * RED DESIGN (this VM is UTC, PGlite returns DATE as UTC-midnight):
 * - §0 is the mechanism proof (Cairo child, B4-P1 pattern): the UTC slice
 *   of a host-local-midnight Date yields the previous day, while
 *   formatLocalCalendarDay / todayTenantDate yield the stored day. It
 *   passes on pristine AND fixed — it proves WHY the slices are wrong.
 * - §A/§B are source pins (the maritime derivations are inline in their
 *   service methods, not exported helpers): the fixed call must be
 *   present and the UTC slice absent. They fail on pristine.
 * - §C/§D are service-driven on PGlite and hour-independent: an
 *   out-of-window input MUST be rejected with the OUT_OF_RANGE code.
 *   On pristine there is no check, so the call succeeds (or fails
 *   downstream) and the rejection assertion fails. They fail on pristine.
 * - §E/§F pair a source pin with a service-driven value check run for
 *   TWO tenants — Pacific/Midway (UTC-11) and Pacific/Kiritimati
 *   (UTC+14). At any hour at least one of them is discordant with the
 *   UTC day the DB default stamps, so on pristine at least one tenant's
 *   value assertion fails; on the fixed tree both equal their tenant day.
 *
 * HONEST LIMITS: S1/S2 are source-pinned, not service-driven (fixture
 * cost disproportionate; the derivation IS resolveBusinessDateKey,
 * already tested by P4/P6). The §D Midway pin proves the normalization
 * does not over-block west-of-UTC tenants; it passes on pristine too
 * (guard pin, not a RED). A live-Postgres rehearsal on a Cairo host is
 * still owed for the end-to-end DATE paths, as for B4-P1/P2.
 */

const SRC = path.resolve(__dirname, '../../src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function fnSlice(src: string, signature: string, len = 3000): string {
  const i = src.indexOf(signature);
  assert.ok(i >= 0, `method ${signature} must exist`);
  return src.slice(i, i + len);
}

function codeOf(e: unknown): string {
  const err = e as any;
  return `${err?.code ?? ''} ${err?.message ?? ''}`;
}

function codeIs(code: string): (err: any) => boolean {
  return (err: any) => err && err.code === code && err.statusCode === 400;
}

async function main(): Promise<void> {
  // §0 — Cairo child: the mechanism proof. Runs FIRST so the pristine
  // failure is diagnosed by the behavioural sections, not by this pin.
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b4p3-'));
  const childTmp = path.join(childDir, 'cairo-check.ts');
  try {
    fs.writeFileSync(
      childTmp,
      `import { formatLocalCalendarDay, todayTenantDate } from '../../../src/common/utils/tenant-timezone.util';
async function main(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== 'Africa/Cairo') { console.error('child zone is ' + zone + ', want Africa/Cairo'); process.exit(2); }
  const day = new Date(2026, 10, 14);
  if (day.toISOString().slice(0, 10) !== '2026-11-13') { console.error('expected the UTC slice to yield 2026-11-13 under Cairo TZ (the bug)'); process.exit(1); }
  if (formatLocalCalendarDay(day) !== '2026-11-14') { console.error('formatLocalCalendarDay must yield 2026-11-14 under Cairo TZ'); process.exit(1); }
  if (todayTenantDate('Africa/Cairo', day) !== '2026-11-14') { console.error('todayTenantDate(Cairo) must yield 2026-11-14'); process.exit(1); }
  console.log('CAIRO-CHILD-OK');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
`,
    );
    const out = execFileSync('npx', ['ts-node', childTmp], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
    assert.ok(out.includes('CAIRO-CHILD-OK'), `Cairo child must pass (got: ${out.trim()})`);
    console.log(
      '✓ §0 passed: the UTC slice yields the previous day under Cairo TZ; the tenant-day helpers yield the stored day',
    );
  } finally {
    try {
      fs.unlinkSync(childTmp);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(childDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }

  // §A — maritime S1: cargo-insurance issue_date derives from the tenant day.
  // Maritime split: createCargoInsurance lives in the insurance-warehouse slice.
  const insuranceWarehouse = read('modules/maritime-freight/maritime-freight-insurance-warehouse.service.ts');
  const cargo = fnSlice(insuranceWarehouse, 'async createCargoInsurance(');
  assert.ok(
    cargo.includes('resolveBusinessDateKey(trx, tenantId, new Date())'),
    'cargo insurance issue_date default derives via resolveBusinessDateKey',
  );
  assert.ok(
    !cargo.includes("new Date().toISOString().split('T')[0]"),
    'cargo insurance issue_date no longer uses the UTC slice',
  );
  console.log('✓ §A passed: cargo insurance defaults to the tenant day, not the UTC day');

  // §B — maritime S2: container return_deadline derives from the tenant day.
  // Maritime split: addJobMilestone lives in the jobs-milestones slice.
  const milestones = read('modules/maritime-freight/maritime-freight-jobs-milestones.service.ts');
  const milestone = fnSlice(milestones, 'async addJobMilestone(', 6000);
  assert.ok(
    milestone.includes('resolveBusinessDateKey(this.db, tenantId, deadline)'),
    'return_deadline derives via resolveBusinessDateKey',
  );
  assert.ok(
    !milestone.includes("deadline.toISOString().split('T')[0]"),
    'return_deadline no longer uses the UTC slice',
  );
  console.log('✓ §B passed: container return_deadline keys on the tenant day of the same instant');

  // ---- shared PGlite fixture for §C-§F (one db, distinct tenants per tz) ----
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const txHelper = new TransactionHelper();
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const financeService = new PurchasesFinanceService();
  const idempotency = {
    reserveOperation: async () => null,
    commitOperation: async () => {},
    recordFailure: async () => {},
  } as unknown as IdempotencyService;
  const schedService = new SupplierPaymentSchedulesService(db, txHelper, financeService, posting, idempotency);
  const writeService = new PurchasesWriteService(db, txHelper, {} as any, {} as any, {} as any, {} as any, {} as any);
  const contracting = new ContractingService(db, {} as any);
  const importSales = new ImportSalesService(db, undefined);

  const authFor = (tenantId: string): AuthContext =>
    ({
      tenantId,
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      username: 'admin',
      permissions: ['purchases', 'accounting'],
    }) as unknown as AuthContext;

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t-b4p3'), ('t-b4p3-pur'), ('t-b4p3-mid'), ('t-b4p3-kir');
      CREATE TABLE settings (tenant_id text, key text, value text);
      INSERT INTO settings VALUES
        ('t-b4p3','timezone','Africa/Cairo'),
        ('t-b4p3-pur','timezone','Africa/Cairo'),
        ('t-b4p3-mid','timezone','Pacific/Midway'),
        ('t-b4p3-kir','timezone','Pacific/Kiritimati');
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
      INSERT INTO suppliers (id, tenant_id, name, balance) VALUES
        (10, 't-b4p3', 'Supplier 10', 100),
        (11, 't-b4p3', 'Supplier 11', 100),
        (12, 't-b4p3', 'Supplier 12', 100);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text,
        supplier_id bigint, total numeric, paid_amount numeric DEFAULT 0, payment_type text DEFAULT 'credit',
        status text DEFAULT 'posted', branch_id bigint, location_id bigint, created_at timestamptz,
        three_way_match_status text DEFAULT 'matched', po_id bigint, grn_id bigint);
      INSERT INTO purchases (id, tenant_id, doc_no, supplier_id, total, paid_amount, payment_type, status)
      VALUES (1, 't-b4p3', 'BILL-001', 10, 100, 0, 'credit', 'posted'),
             (2, 't-b4p3', 'BILL-002', 11, 100, 0, 'credit', 'posted');
      CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint,
        supplier_id bigint, installment_no integer, due_date date, amount numeric, paid_amount numeric DEFAULT 0,
        status text DEFAULT 'pending', note text DEFAULT '', paid_at timestamptz, created_by bigint, updated_by bigint, updated_at timestamptz);
      CREATE TABLE supplier_payment_schedule_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, schedule_id bigint,
        supplier_id bigint, amount numeric, payment_channel text, instapay_address text, note text DEFAULT '', created_by bigint, created_by_name text, created_at timestamptz DEFAULT now());
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'liability',
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
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, invoice_id bigint, total numeric, return_type text, refund_allocations text);
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint, opened_by bigint, status text);
      CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric,
        payment_channel text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE contracting_documents (id bigserial PRIMARY KEY, tenant_id text, project_id text, doc_number text,
        title text, discipline text, doc_type text, status text, notes text, created_by bigint,
        current_revision_id bigint, issued_date date, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE contracting_document_revisions (id bigserial PRIMARY KEY, tenant_id text, document_id bigint,
        rev_code text, file_ref text, review_status text, issued_date date, created_by bigint,
        reviewed_by bigint, review_date date, review_comments text, notes text, created_at timestamptz DEFAULT now());
      CREATE TABLE import_customs_tariffs (id bigserial PRIMARY KEY, tenant_id text, hs_code varchar(50),
        description_ar varchar(255), description_en varchar(255), duty_rate_percent numeric,
        vat_rate_percent numeric, inspection_fees_percent numeric, regulatory_body varchar(100),
        sector text, category_ar text, official_source varchar(255), is_official boolean,
        data_version text, effective_date date, created_at timestamptz DEFAULT now(),
        CONSTRAINT uq_import_customs_tariffs UNIQUE (tenant_id, hs_code));
    `);

    const todayCairo = todayTenantDate('Africa/Cairo');
    const shiftDay = (days: number): string => {
      const key = addDaysToDayKey(todayCairo, days);
      assert.ok(key, 'todayCairo must be a valid day key');
      return key;
    };
    const auth = authFor('t-b4p3');

    // §C — S3 supplier firstDueDate bound [today-7, today+5y], service-driven.
    const schedPayload = (firstDueDate: string): any => ({
      mode: 'count',
      installmentCount: 1,
      scheduleAmount: 20,
      firstDueDate,
    });
    await assert.rejects(
      schedService.createForSupplier(10, schedPayload(shiftDay(-8)), auth),
      codeIs('SUPPLIER_SCHEDULE_FIRST_DUE_DATE_OUT_OF_RANGE'),
      'a first due date 8 days in the past must be rejected',
    );
    await assert.rejects(
      schedService.createForSupplier(10, schedPayload(shiftDay(5 * 365 + 1)), auth),
      codeIs('SUPPLIER_SCHEDULE_FIRST_DUE_DATE_OUT_OF_RANGE'),
      'a first due date past the 5-year horizon must be rejected',
    );
    await assert.rejects(
      schedService.createForSupplier(10, schedPayload('not-a-date'), auth),
      codeIs('INVALID_DUE_DATE'),
      'an unparseable first due date still throws INVALID_DUE_DATE (parseDate first)',
    );
    const createdToday = await schedService.createForSupplier(11, schedPayload(todayCairo), auth);
    assert.equal((createdToday as any).schedules.length, 1, 'today must be accepted for the supplier schedule');
    const dueToday = await pg.query('SELECT due_date FROM supplier_payment_schedules WHERE supplier_id = 11');
    assert.equal(
      (dueToday.rows[0] as any).due_date.toISOString().slice(0, 10),
      todayCairo,
      'stored first due date is the tenant today',
    );
    const createdPast = await schedService.createForSupplier(12, schedPayload(shiftDay(-7)), auth);
    assert.equal((createdPast as any).schedules.length, 1, 'today-7 (the past boundary) must be accepted');
    await assert.rejects(
      schedService.createForPurchase(
        1,
        { mode: 'count', installmentCount: 1, scheduleAmount: 20, firstDueDate: shiftDay(-8), intervalDays: 30 },
        auth,
      ),
      codeIs('SUPPLIER_SCHEDULE_FIRST_DUE_DATE_OUT_OF_RANGE'),
      'createForPurchase enforces the same bound',
    );
    await schedService.createForPurchase(
      2,
      { mode: 'count', installmentCount: 1, scheduleAmount: 20, firstDueDate: todayCairo, intervalDays: 30 },
      auth,
    );
    const duePurchase = await pg.query('SELECT due_date FROM supplier_payment_schedules WHERE purchase_id = 2');
    assert.equal(
      (duePurchase.rows[0] as any).due_date.toISOString().slice(0, 10),
      todayCairo,
      'purchase schedule stores the tenant today',
    );
    console.log('✓ §C passed: supplier firstDueDate is bounded [today-7, today+5y] on both create paths');

    // §D — S4 purchase requiredDate bound [today, today+365], service-driven.
    // The bound check runs first (right after scope), before idempotency /
    // the transaction, so a reject needs only auth + payload. An accepted
    // date proceeds downstream and fails later (no supplier tables in this
    // fixture) — the assertion is only that it is NOT the bound code.
    const authPur = authFor('t-b4p3-pur');
    const reqDate = (dayKey: string): Date => new Date(`${dayKey}T00:00:00.000Z`);
    await assert.rejects(
      writeService.createPurchase({ requiredDate: reqDate(shiftDay(400)) } as any, authPur),
      codeIs('PURCHASE_REQUIRED_DATE_OUT_OF_RANGE'),
      'a required date 400 days out must be rejected',
    );
    await assert.rejects(
      writeService.createPurchase({ requiredDate: reqDate(shiftDay(-1)) } as any, authPur),
      codeIs('PURCHASE_REQUIRED_DATE_OUT_OF_RANGE'),
      'a required date in the past must be rejected',
    );
    await assert.rejects(
      writeService.createPurchase({ requiredDate: 'not-a-date' } as any, authPur),
      codeIs('PURCHASE_REQUIRED_DATE_OUT_OF_RANGE'),
      'an unparseable required date must be rejected',
    );
    await assert.rejects(
      writeService.createPurchase({ requiredDate: shiftDay(400) } as any, authPur),
      codeIs('PURCHASE_REQUIRED_DATE_OUT_OF_RANGE'),
      'a date-only string 400 days out must be rejected',
    );
    try {
      await writeService.createPurchase({ requiredDate: reqDate(todayCairo) } as any, authPur);
      assert.fail(
        'an accepted required date must proceed past the bound (and fail downstream without supplier tables)',
      );
    } catch (e) {
      assert.ok(!/PURCHASE_REQUIRED_DATE_OUT_OF_RANGE/.test(codeOf(e)), `today must be accepted (got: ${codeOf(e)})`);
    }
    try {
      await writeService.createPurchase({ requiredDate: shiftDay(365) } as any, authPur);
      assert.fail('today+365 must proceed past the bound');
    } catch (e) {
      assert.ok(
        !/PURCHASE_REQUIRED_DATE_OUT_OF_RANGE/.test(codeOf(e)),
        `today+365 (the future boundary) must be accepted (got: ${codeOf(e)})`,
      );
    }
    await assert.rejects(
      writeService.updatePurchase(1, { requiredDate: reqDate(shiftDay(400)) } as any, authPur),
      codeIs('PURCHASE_REQUIRED_DATE_OUT_OF_RANGE'),
      'updatePurchase enforces the same bound before the edit-reason check',
    );
    try {
      await writeService.updatePurchase(1, { requiredDate: reqDate(todayCairo) } as any, authPur);
      assert.fail('an accepted required date on update must proceed past the bound');
    } catch (e) {
      assert.ok(
        /PURCHASE_EDIT_REASON_REQUIRED/.test(codeOf(e)),
        `update with a valid date must reach the edit-reason check (got: ${codeOf(e)})`,
      );
    }
    // Midway guard pin: a Date built from a UTC-midnight date-only string
    // carries the UTC day, not the tenant day. The normalization must not
    // over-block west-of-UTC tenants. (Passes on pristine too — guard, not RED.)
    const authMid = authFor('t-b4p3-mid');
    const utcToday = new Date().toISOString().slice(0, 10);
    try {
      await writeService.createPurchase({ requiredDate: new Date(`${utcToday}T00:00:00.000Z`) } as any, authMid);
      assert.fail('the Midway required date must proceed past the bound');
    } catch (e) {
      assert.ok(
        !/PURCHASE_REQUIRED_DATE_OUT_OF_RANGE/.test(codeOf(e)),
        `UTC-today must be accepted for a Midway tenant (got: ${codeOf(e)})`,
      );
    }
    console.log('✓ §D passed: purchase requiredDate is bounded [today, today+365] on create and update');

    // §E — S5 contracting createDocument issued_date, source pin + value check.
    const contractingSrc = read('modules/contracting/services/contracting-documents.service.ts');
    const createDoc = fnSlice(contractingSrc, 'async createDocument(', 3500);
    assert.ok(
      createDoc.includes('issued_date: todayTenantDate(businessTz)'),
      'createDocument supplies issued_date from the tenant day',
    );
    for (const [tenantId, tz] of [
      ['t-b4p3-mid', 'Pacific/Midway'],
      ['t-b4p3-kir', 'Pacific/Kiritimati'],
    ] as const) {
      const res = await contracting.createDocument(authFor(tenantId), 'proj-b4p3', {
        title: `B4-P3 doc ${tenantId}`,
      } as any);
      assert.ok(res?.document?.id, 'createDocument must return the created document');
      const want = todayTenantDate(tz);
      const yyMmDd = want.slice(2, 4) + want.slice(5, 7) + want.slice(8, 10);
      assert.ok(String(res.document.docNumber).includes(yyMmDd), `document number must embed the tenant day (${want})`);
      const row = await pg.query('SELECT issued_date FROM contracting_documents WHERE tenant_id = $1', [tenantId]);
      const stored = (row.rows[0] as any).issued_date.toISOString().slice(0, 10);
      assert.equal(
        stored,
        want,
        `contracting issued_date for ${tenantId} must be the tenant day (${want}), got ${stored}`,
      );
    }
    console.log('✓ §E passed: contracting documents are issued on the tenant day (Midway + Kiritimati)');

    // §F — S6 tariff seed effective_date, source pin + value check.
    // syncOfficialTariffs lives in the sourcing slice since the
    // import-sales split (slice S2); the pin follows the method, the
    // assertion text is unchanged.
    const importSrc = read('modules/import-sales/services/import-sourcing.service.ts');
    const seed = fnSlice(importSrc, 'async syncOfficialTariffs(', 3500);
    assert.ok(seed.includes('effective_date'), 'tariff seed supplies effective_date');
    assert.ok(
      seed.includes('resolveBusinessDateKey(this.db, tenantId, new Date())'),
      'tariff seed effective_date derives via resolveBusinessDateKey',
    );
    for (const [tenantId, tz] of [
      ['t-b4p3-mid', 'Pacific/Midway'],
      ['t-b4p3-kir', 'Pacific/Kiritimati'],
    ] as const) {
      await importSales.syncOfficialTariffs(tenantId);
      const row = await pg.query('SELECT effective_date FROM import_customs_tariffs WHERE tenant_id = $1 LIMIT 1', [
        tenantId,
      ]);
      assert.ok(row.rows.length > 0, `tariff seed must insert rows for ${tenantId}`);
      const stored = (row.rows[0] as any).effective_date.toISOString().slice(0, 10);
      const want = todayTenantDate(tz);
      assert.equal(
        stored,
        want,
        `tariff effective_date for ${tenantId} must be the tenant day (${want}), got ${stored}`,
      );
    }
    console.log('✓ §F passed: seeded tariffs carry the tenant day as effective_date (Midway + Kiritimati)');

    console.log('CLOCK-B4-P3 CHECKS PASSED');
  } finally {
    await pg.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
