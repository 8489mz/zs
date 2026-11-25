import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatLocalCalendarDay, todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { CustomerInstallmentsService } from '../../src/modules/sales/services/customer-installments.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AgedDebtsService } from '../../src/modules/accounting/services/aged-debts.service';
import { ContractingService } from '../../src/modules/contracting/contracting.service';
import { ZatcaPhase2Service } from '../../src/modules/tax-integration/services/zatca/zatca-phase2.service';

/*
 * Clock P4 (INV-SINGLE-SERVER-CLOCK-TENANT-TZ): UTC day keys, money-critical subset.
 *
 * THE DEFECT: four money paths derived their business day from UTC
 * instead of the tenant day —
 * - installments compared a UTC-sliced "today" against UTC-sliced
 *   due dates, so due-today flipped to overdue at 02:00 Cairo and
 *   due-yesterday stayed current until 02:00;
 * - ZATCA issued e-invoices on the UTC day (a 00:30 Cairo sale was
 *   issued on the previous day);
 * - aged-debts counted invoice age with `at time zone 'UTC'`, so a
 *   00:30 Cairo invoice was 1 day old on its own day;
 * - contracting rendered PG DATE columns (guarantee issue/expiry/
 *   claim, invoice period_end, task start/end) with a UTC slice, so
 *   every date displayed as the previous day on any host east of UTC.
 *
 * THE FIX: every day key comes from the tenant day — todayTenantDate
 * for instants, formatLocalCalendarDay for PG DATE columns, and the
 * tenant zone as a bound parameter in the aged-debts SQL; the
 * installment SQL filters compare DATE to DATE (a plain date string,
 * never a UTC-midnight instant) so they cannot depend on the database
 * session's timezone. Two audit entries were REFUTED, not fixed:
 * contracting release-due (:1477) already derives its base day via
 * resolveBusinessDateKey, and the warranty (:6127), +durationDays
 * (:2395) and week-boundary (:2567-2568) slices are UTC-calendar math
 * on date strings, which is correct.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - §0 pure helpers: a local-midnight Date keys to its own calendar
 *   day; a frozen instant keys to the Kuwait / Cairo day.
 * - §A installments on PGlite (real service, Kuwait tenant): due
 *   yesterday is overdue, due today is not, due tomorrow is not —
 *   in getPlanDetails, in the list overdue/due_now filters, and in
 *   getSummaryMetrics.
 * - §B ZATCA (real buildZatcaInvoice, mock DB): a sale at
 *   2026-11-13T22:30:00Z (00:30 Cairo 11-14) is issued
 *   2026-11-14.
 * - §C aged-debts on PGlite (real report): a ledger invoice at
 *   2026-11-13T22:30:00Z is 0 days old on as-of 2026-11-14 and its
 *   oldest-invoice date is 2026-11-14.
 * - §D contracting guarantees on PGlite (real getGuaranteesRaw +
 *   getGuarantees): stored DATEs display as their stored calendar
 *   days.
 *
 * TIMEZONE NOTES (read before re-running): the VM host is UTC, so the
 * DATE-display sites (§A due dates, §D) are INVISIBLE on a UTC host —
 * a local-midnight Date UTC-slices to its own day there. PGlite
 * CANNOT reproduce them at all: a probe shows PGlite returns DATE
 * columns as Dates at UTC midnight (not local midnight), so the old
 * UTC slice always equals the stored day in this harness, under any
 * TZ. The production defect is real anyway — node-postgres returns
 * DATE columns as LOCAL-midnight Dates, and on a Cairo host that
 * UTC-slices to the previous day (verified: new Date(2026, 10, 14)
 * under TZ=Africa/Cairo -> toISOString slice '2026-11-13'). So
 * §A/§D pin the fixed behaviour and prove the fix does not break
 * the comparison, but they are GREEN-on-both-trees in PGlite; their
 * RED is the probe + the §0 helper pin, and a live-Postgres
 * rehearsal on a Cairo host is the remaining proof for them (noted
 * as a follow-up, not a blocker — the fix uses the canonical helper
 * Cat 1-a already proved). §B and §C use frozen instants and fail
 * on unfixed code under ANY timezone: §C failed on pristine under
 * both TZ=UTC and TZ=Africa/Cairo, §B failed on pristine with
 * IssueDate 2026-11-13. The fixed tree is host-independent: this
 * spec is GREEN under both TZ=UTC and TZ=Africa/Cairo. The
 * installments today-side also only differs from UTC 00:00-03:00
 * UTC (Kuwait day ahead); outside that window the today side
 * agrees and only the due-date side carries the defect.
 */

const KW = 't-kw';
const CAIRO = 't-cairo';

function shiftDay(dayKey: string, delta: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // ---- §0 pure helpers (deterministic on any host) ----
  assert.equal(formatLocalCalendarDay(new Date(2026, 10, 14)), '2026-11-14');
  assert.equal(todayTenantDate('Asia/Kuwait', new Date('2026-10-31T21:30:00Z')), '2026-11-01');
  assert.equal(todayTenantDate('Africa/Cairo', new Date('2026-11-13T22:30:00Z')), '2026-11-14');

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE customers (id bigint, tenant_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric);
      CREATE TABLE customer_installment_plans (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_number text, sale_id bigint, customer_id bigint, total_amount numeric, down_payment numeric, financed_amount numeric, interest_rate_percent numeric, interest_amount numeric, total_with_interest numeric, installment_count int, monthly_amount numeric, start_date date, status text, notes text, branch_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_id bigint, sale_id bigint, customer_id bigint, installment_number int, due_date date, amount numeric, paid_amount numeric DEFAULT 0, status text, payment_method text, receipt_no text, notes text, paid_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_guarantees (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, subcontract_id bigint, subcontractor_id bigint, guarantee_number text, guarantee_type text, issuing_bank text, amount numeric, currency text, issue_date date, expiry_date date, claim_expiry_date date, reduction_schedule jsonb, status text, document_url text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_projects (id bigint, name text, code text);
      CREATE TABLE contracting_subcontracts (id bigint, contract_number text, scope_of_work text);
      CREATE TABLE contracting_subcontractors (id bigint, name text);
      CREATE TABLE sales (id bigint, doc_no text);
      INSERT INTO settings VALUES ('t-kw', 'currency', 'EGP');
      INSERT INTO settings VALUES ('t-kw', 'timezone', '"Asia/Kuwait"');
      INSERT INTO settings VALUES ('t-cairo', 'currency', 'EGP');
      INSERT INTO settings VALUES ('t-cairo', 'timezone', '"Africa/Cairo"');
      INSERT INTO currency_exchange_rates VALUES ('t-kw', 'EGP', true, 1);
      INSERT INTO currency_exchange_rates VALUES ('t-cairo', 'EGP', true, 1);
      INSERT INTO customers VALUES (2, 't-kw', 'KW Customer', '0101', 0, 1000);
      INSERT INTO customers VALUES (3, 't-cairo', 'Cairo Customer', '0102', 0, 1000);
    `);

    // ---- §A installments: due yesterday / today / tomorrow (Kuwait day) ----
    const tenantToday = todayTenantDate('Asia/Kuwait');
    const dueYesterday = shiftDay(tenantToday, -1);
    const dueTomorrow = shiftDay(tenantToday, 1);
    await pg.exec(`
      INSERT INTO customer_installment_plans VALUES (1, 't-kw', 'a1', 'INST-1', NULL, 2, 600, 0, 600, 0, 0, 600, 3, 200, '${tenantToday}', 'active', '', NULL, 1, NOW(), NOW());
      INSERT INTO customer_installments (id, tenant_id, account_id, plan_id, customer_id, installment_number, due_date, amount, paid_amount, status) VALUES
        (1, 't-kw', 'a1', 1, 2, 1, '${dueYesterday}', 100, 0, 'pending'),
        (2, 't-kw', 'a1', 1, 2, 2, '${tenantToday}', 200, 0, 'pending'),
        (3, 't-kw', 'a1', 1, 2, 3, '${dueTomorrow}', 300, 0, 'pending');
    `);
    const foundation = {
      ensureForAuth: async () => undefined,
      ensureForScope: async () => undefined,
    } as unknown as AccountingTenantFoundationService;
    const posting = new AccountingPostingService(foundation);
    const installments = new CustomerInstallmentsService(
      db,
      new TransactionHelper(),
      new SalesFinanceService(db),
      posting as any,
    );
    const authKw = {
      tenantId: KW,
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;

    const planDetails = (await installments.getPlanDetails(1, authKw)) as any;
    const byNumber = new Map<number, any>(planDetails.installments.map((r: any) => [Number(r.installment_number), r]));
    assert.equal(byNumber.get(1).display_status, 'overdue', 'due yesterday (tenant day) is overdue');
    assert.equal(byNumber.get(2).display_status, 'pending', 'due today (tenant day) is NOT overdue');
    assert.equal(byNumber.get(3).display_status, 'pending', 'due tomorrow is not overdue');

    const overdueList = (await installments.listInstallments({ status: 'overdue', pageSize: 100 }, authKw)) as any;
    assert.deepEqual(
      overdueList.installments.map((r: any) => Number(r.installment_number)),
      [1],
    );
    const dueNowList = (await installments.listInstallments({ status: 'due_now', pageSize: 100 }, authKw)) as any;
    assert.deepEqual(dueNowList.installments.map((r: any) => Number(r.installment_number)).sort(), [1, 2]);

    const summary = (await installments.getSummaryMetrics(authKw)) as any;
    assert.equal(Number(summary.overdue_count), 1, 'summary counts only the due-yesterday row as overdue');
    assert.equal(Number(summary.overdue_amount), 100);

    // ---- §C aged-debts: a 00:30 Cairo invoice is 0 days old on the Cairo as-of day ----
    await pg.exec(`
      INSERT INTO customer_ledger (id, tenant_id, customer_id, entry_type, amount, balance_after, note, created_at) VALUES
        (1, 't-cairo', 3, 'invoice', 100, 100, '', '2026-11-13T22:30:00Z');
    `);
    const aged = new AgedDebtsService(db);
    const authCairo = {
      tenantId: CAIRO,
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;
    const report = await aged.getAgedReceivables(authCairo, { asOfDate: '2026-11-14' });
    assert.equal(report.totalPartnersCount, 1);
    const partner = (report as any).partners[0];
    assert.equal(Number(partner.currentAmount), 100, 'invoice is current (0 days old), not 1-30');
    assert.equal(Number(partner.days1To30), 0);
    assert.equal(partner.oldestInvoiceDate, '2026-11-14');
    assert.equal(Number(partner.oldestInvoiceDays), 0);
    assert.equal(Number(report.totalCurrent), 100);
    assert.equal(Number(report.total1To30), 0);

    // ---- §D contracting guarantees: stored DATEs display as their stored days ----
    await pg.exec(`
      INSERT INTO contracting_guarantees (id, tenant_id, project_id, guarantee_number, guarantee_type, issuing_bank, amount, currency, issue_date, expiry_date, claim_expiry_date, status) VALUES
        (1, 't-g', 1, 'BG-1', 'advance_payment', 'Bank', 1000, 'EGP', '2026-01-01', '2026-11-14', '2026-12-01', 'active');
    `);
    const contracting = new ContractingService(db, {} as never);
    const raw = await contracting.getGuaranteesRaw('t-g', {});
    assert.equal(raw[0].issue_date, '2026-01-01');
    assert.equal(raw[0].expiry_date, '2026-11-14');
    assert.equal(raw[0].claim_expiry_date, '2026-12-01');
    const authG = {
      tenantId: 't-g',
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;
    const listed = await contracting.getGuarantees(authG, {});
    assert.equal(listed[0].issueDate, '2026-01-01');
    assert.equal(listed[0].expiryDate, '2026-11-14');
    assert.equal(listed[0].claimExpiryDate, '2026-12-01');
  } finally {
    await db.destroy();
  }

  // ---- §B ZATCA: a 00:30 Cairo sale is issued on the Cairo day (mock DB, real service) ----
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fakeUnit = {
    id: 5,
    private_key_pem: privateKey,
    public_key_pem: publicKey,
    status: 'unregistered',
    environment: 'sandbox',
    last_icv: 0,
    last_invoice_hash: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
  };
  function drive(sale: Record<string, unknown>, items: Array<Record<string, unknown>>) {
    function chainable(result: unknown) {
      const q: any = {
        select: () => q,
        selectAll: () => q,
        where: () => q,
        forUpdate: () => q,
        orderBy: () => q,
        values: () => q,
        returningAll: () => q,
        set: () => q,
        execute: async () => result,
        executeTakeFirst: async () => result,
        executeTakeFirstOrThrow: async () => {
          if (result == null) throw new Error('no row');
          return result;
        },
      };
      return q;
    }
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenants') return chainable({ id: 'tenant-1', business_name: 'Acme Trading Co' });
        if (table === 'settings') return chainable([{ key: 'companyName', value: '"Acme Trading Co"' }]);
        if (table === 'tenant_tax_settings')
          return chainable([{ provider: 'ZATCA_SAUDI', tax_id: '300000000000003', is_active: true }]);
        return chainable(null);
      },
      insertInto: () => chainable(fakeUnit),
      updateTable: () => chainable({}),
      // getTenantTimezone reads settings.timezone with a raw sql query;
      // the mock answers it the way the real settings row would.
      executeQuery: async () => ({ rows: [{ value: '"Africa/Cairo"' }] }),
      // Raw `sql` queries do NOT call trx.executeQuery directly:
      // Kysely's RawBuilder.execute() calls
      // executorProvider.getExecutor() first, and a mock without it
      // throws there — getTenantTimezone catches that and falls back
      // to process.env.BUSINESS_TIMEZONE, which CI sets to UTC, so
      // the invoice was issued on the UTC day (ci-full #50). The
      // mock must answer as a real Kysely transaction would.
      getExecutor: () => ({
        executeQuery: async () => ({ rows: [{ value: '"Africa/Cairo"' }] }),
        compileQuery: (node: any) => ({ query: node, parameters: [] }),
        transformQuery: (node: any) => node,
      }),
    };
    const svc: any = Object.create(ZatcaPhase2Service.prototype);
    svc.db = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
    svc.taxSettings = {
      getSettings: async () => ({ environment: 'sandbox', tax_id: '300000000000003' }),
    };
    return svc.buildZatcaInvoice('tenant-1', 7) as Promise<{ ublXml: string; icv: number }>;
  }
  const boundarySale = {
    id: 7,
    doc_no: 'INV-7',
    status: 'posted',
    branch_id: null,
    customer_id: null,
    customer_name: 'Cash',
    created_at: new Date('2026-11-13T22:30:00.000Z'),
    tax_rate: 15,
    prices_include_tax: false,
    tax_amount: 15,
    zatca_icv: null,
    zatca_hash: null,
    zatca_uuid: null,
    zatca_ubl_xml: null,
    zatca_qr: null,
    zatca_egs_id: null,
  };
  const signed = await drive(boundarySale, [
    {
      qty: 1,
      unit_price: 100,
      line_total: 100,
      product_name: 'Widget',
      net_line_total: 100,
      allocated_discount: 0,
      allocated_tax: 15,
    },
  ]);
  assert.equal(signed.icv, 1);
  assert.match(
    signed.ublXml,
    /<cbc:IssueDate>2026-11-14<\/cbc:IssueDate>/,
    '00:30 Cairo sale is issued on the Cairo day, not the UTC day',
  );

  console.log('clock-p4-utc-day-keys: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
