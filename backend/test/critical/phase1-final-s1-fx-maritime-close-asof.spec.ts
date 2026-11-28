import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { MaritimeFreightCarrierInvoicesService } from '../../src/modules/maritime-freight/maritime-freight-carrier-invoices.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 final inspection, slice 1 — maritime close-time FX
 * resolves at the document date (INV-FX-MARITIME-CLOSE-ASOF).
 *
 * THE GAP: the seven close-time conversions in the maritime
 * split all resolved through the shared kernel
 * resolveFreightExchangeRate, which never accepted an as-of
 * moment — so a carrier invoice, settlement, sales invoice,
 * expense voucher or close-guard amount dated in the past was
 * converted at the LIVE registered rate. A rate that moved
 * between the document date and the posting date booked the
 * wrong local equivalent: the journal, the job roll-up and the
 * close check all read a rate the document never had.
 *
 * THE RULE: every close-time conversion resolves at its
 * document date. The kernel gains an optional fourth argument
 * `asOf`; precedence is supplied rate > asOf > live — a
 * caller-supplied contractual rate is an explicit rate choice
 * and stands (the resolver itself forbids supplied+asOf
 * together, so the kernel picks before calling it), asOf
 * applies only when the rate is resolved from the history,
 * and live stays the fallback when neither is given.
 * Date source per site (the document date, never today
 * unless the document is created now):
 * - agent settlement: the creation moment (the DTO carries
 *   no date field; the settlement is booked now).
 * - carrier-invoice journal: params.entryDate (the journal
 *   date); create: the invoice date (else now); override:
 *   the stored invoice date (else now).
 * - sales invoice / expense voucher: entryDate (now — the
 *   journal is posted now).
 * - close guard: the close moment (a now-validation; its
 *   inputs carry no per-charge dates — per-charge booking
 *   rates would need charge-to-journal linkage that does
 *   not exist, so that refinement is NOT built here).
 * Quotations stay live BY DESIGN (a quote is priced now;
 * the auto-quote and quotation INVs say so explicitly) and
 * are pinned excluded. The container-deposit poster calls
 * resolveFxRate directly at its own event, not through the
 * kernel — also not a close-time conversion, untouched.
 *
 * FAIL-CLOSED EDGE (intended, the convertCurrency as-of
 * precedent): a document dated before any rate was
 * registered for the currency now throws instead of
 * converting at a later live rate. Migration 0270
 * backfilled one history row per live rate at its last
 * update time, so existing rates work from day one.
 *
 * WHAT THIS PINS, driving the REAL maritime methods on
 * PGlite (EGP base tenant per section, USD history 48
 * from 2026-01-10 and 56 from 2026-02-10, live row 56):
 * - §1: the carrier-invoice journal poster, driven
 *   directly on its slice with db-as-trx (the poster's
 *   own old-spec pattern): dated 2026-01-15 it posts at
 *   48, not the live 56; dated 2026-03-01 it posts at
 *   56; a supplied rate of 50 wins over asOf; the base
 *   currency still resolves to 1.
 * - §2: createCarrierInvoice on the overcharge branch
 *   (no journal): a backdated invoice date resolves
 *   without throwing — with no supplied rate and with a
 *   supplied rate of 50 (no supplied+asOf contradiction)
 *   — and stores the invoice date; no journal is posted.
 *   The rate VALUE on this branch is unobservable (the
 *   audit never sees the rate and the row stores none),
 *   so the value is pinned by §1 + the static pin.
 * - §3: an overcharge override with a seeded journal id
 *   (the poster is skipped, solo-admin pattern): the
 *   override completes and stamps approved_override.
 *   The :588 resolution itself executes only on the
 *   journal-posting branch, which cannot run on PGlite
 *   (see the hang note below), so its rate is pinned by
 *   §1 + the static pin.
 * - §4: a settlement created now reads the history rate
 *   at its creation moment (56), not a live row moved to
 *   60 without history; a supplied rate of 50 still wins.
 * - §5: the sales invoice and the expense voucher post at
 *   the history rate at their entry moment (56) even
 *   when the live row was moved to 60 without history.
 * - §6: the close guard reads the history rate at the
 *   close moment — a $100 charge blocks the close when
 *   billed is 5000 (5600 > 5000) and passes when billed
 *   is 6000.
 * - §7: static pins — the kernel precedence, all seven
 *   call sites passing asOf, quotations still live, and
 *   the engine-map currency row.
 * - §8: the INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md and exactly once in the
 *   guard tail.
 * - §9: wiring 407 in both lists, this spec last,
 *   all earlier specs re-pinned (counts, last-entry).
 * - §10: the re-pin sweep is complete (no stale count,
 *   last-entry or guard INV remains).
 * - §11: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §12: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5).
 *
 * PGlite HANG NOTE (why §1 drives the poster directly
 * and §2/§3 avoid the posting branches): the journal
 * poster calls the pool-reading kernel and
 * resolveAccountId INSIDE the transaction opened by
 * create/override, and a pool read inside an open
 * transaction deadlocks PGlite's single connection —
 * Node then exits 0 silently, with no error at all.
 * That is the documented hang shape (the slice headers
 * warn about pool-handle reads inside transactions),
 * and it is why no existing spec drives the posting
 * branches. Threading the transaction through the kernel
 * and resolveAccountId is a separate fix, NOT this
 * slice. The poster itself is driven with db-as-trx
 * (no transaction open), exactly as its own old spec
 * did when the facade owned it.
 *
 * PGlite HONESTY NOTE: the test database has no trigger,
 * so the moved-live-row simulations (§4–§6) move the live
 * row without appending history to prove the read goes
 * through history. In production the 0270 trigger keeps
 * live and history in sync on every rate change, so the
 * now-sites (§4–§6) are behavior-preserving by
 * construction — the simulations pin the read path, not a
 * production state.
 *
 * Wiring: both critical lists carry 407 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const FACADE = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight.service.ts');
const AGENT_SETTLEMENTS = path.join(
  BACKEND,
  'src',
  'modules',
  'maritime-freight',
  'maritime-freight-agent-settlements.service.ts',
);
const CARRIER_INVOICES = path.join(
  BACKEND,
  'src',
  'modules',
  'maritime-freight',
  'maritime-freight-carrier-invoices.service.ts',
);
const INVOICING = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight-invoicing.service.ts');
const JOBS_CORE = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight-jobs-core.service.ts');
const QUOTATIONS = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight-quotations.service.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');

const NEW_INV = 'INV-FX-MARITIME-CLOSE-ASOF';
const NEW_SPEC_NAME = 'phase1-final-s1-fx-maritime-close-asof.spec.ts';

const authFor = (tenantId: string): AuthContext =>
  ({ tenantId, accountId: 'a1', role: 'admin', userId: 1, permissions: [] }) as unknown as AuthContext;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  let jeSeq = 0;
  const calls: Array<{ sourceType: string; lines: Array<{ debit: number; credit: number }> }> = [];
  // One posting stub for every section: it writes REAL journal rows
  // (so the invoicing flow can read its entry back) and records the
  // call, exactly like the job-journal template stub.
  const postingStub = {
    postDomainJournal: async (trx: any, input: any) => {
      const [row] = await trx
        .insertInto('journal_entries')
        .values({
          tenant_id: input.tenantId,
          status: 'posted',
          entry_date: input.entryDate,
          entry_no: `JE-TEST-${++jeSeq}`,
          source_type: input.sourceType,
          source_id: input.sourceId,
        })
        .returning('id')
        .execute();
      const id = Number(row.id);
      for (const line of input.lines) {
        await trx
          .insertInto('journal_entry_lines')
          .values({
            tenant_id: input.tenantId,
            journal_entry_id: id,
            account_id: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            cost_center_id: line.costCenterId ?? null,
          })
          .execute();
      }
      calls.push({ sourceType: input.sourceType, lines: input.lines });
      return id;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);
  // The journal poster lives in its slice (private, no facade
  // delegate), so §1 drives it on the slice directly with
  // db-as-trx and §3 drives the override on the same slice.
  // The kernel, account resolver and period guard are the
  // REAL production ones bound off the facade instance;
  // getJobById is canned (the override calls it inside its
  // transaction, and a pool read there would hit the same
  // hang shape) and mapRateCardRow is an inert dummy (the
  // poster and the override never audit a rate card).
  const carrierService = new MaritimeFreightCarrierInvoicesService({
    db: db as any,
    accountingPosting: postingStub as never,
    getJobById: (async (_auth: unknown, id: string) => ({ id: Number(id), job_number: 'JOB-1' })) as any,
    mapRateCardRow: (() => ({})) as any,
    resolveFreightExchangeRate: (service as any).resolveFreightExchangeRate.bind(service),
    resolveAccountId: (service as any).resolveAccountId.bind(service),
    assertMaritimeJournalPeriodOpen: (service as any).assertMaritimeJournalPeriodOpen.bind(service),
  });

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE currency_exchange_rate_history (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean, effective_from timestamptz, created_at timestamptz);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, is_active boolean, description text);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, customer_name text, customer_id text, status text, shipping_line_id bigint, shipping_line_name text, pol_code text, pod_code text, cost_center_id text, carrier_cost_total numeric, client_invoiced_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id text, return_deadline date, empty_returned_at timestamptz, demurrage_rate_per_day numeric);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_rate_cards (id bigint PRIMARY KEY, tenant_id text, pol_code text, pod_code text, status text, currency text, valid_from date, valid_until date, shipping_line_id bigint, container_type text, total_freight_cost numeric);
      CREATE TABLE maritime_carrier_invoices (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, shipping_line_id bigint, carrier_name text, invoice_number text, invoice_date date, currency text, total_invoiced_amount numeric, ocean_freight numeric, thc_charges numeric, baf_charges numeric, detention_demurrage numeric, other_charges numeric, rate_card_id bigint, contracted_amount numeric, variance_amount numeric, variance_pct numeric, audit_status text, override_approved_by bigint, override_approved_at timestamptz, override_reason text, journal_entry_id bigint, payment_status text, notes text, created_by bigint, updated_at timestamptz);
      CREATE TABLE maritime_job_charges (id bigserial PRIMARY KEY, tenant_id text, job_id text, charge_code text, charge_name_en text, sell_amount numeric, cost_amount numeric, currency text, is_invoiced boolean);
      CREATE TABLE shipping_lines (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, notes text, is_active boolean);
      CREATE TABLE accounting_supplier_links (tenant_id text, domain text, domain_id text, supplier_id bigint);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric, description text, partner_type text, partner_id bigint, cost_center_id bigint);
      CREATE TABLE maritime_agent_settlements (id bigserial PRIMARY KEY, tenant_id text, agent_id text, agent_name text, job_id text, job_number text, settlement_type text, currency text, amount numeric, profit_share_percent numeric, local_equivalent_amount numeric, exchange_rate numeric, reference_number text, status text, notes text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, role text, is_active boolean DEFAULT true);
      INSERT INTO settings VALUES ('t2','currency','EGP'),('t3','currency','EGP'),('t4','currency','EGP'),('t5','currency','EGP'),('t6','currency','EGP'),('t7','currency','EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES
        ('t2','EGP',1,true),('t2','USD',56,false),
        ('t3','EGP',1,true),('t3','USD',56,false),
        ('t4','EGP',1,true),('t4','USD',56,false),
        ('t5','EGP',1,true),('t5','USD',56,false),
        ('t6','EGP',1,true),('t6','USD',56,false),
        ('t7','EGP',1,true),('t7','USD',56,false);
      INSERT INTO currency_exchange_rate_history (tenant_id, currency_code, exchange_rate, is_base, effective_from) VALUES
        ('t2','USD',48,false,'2026-01-10 00:00:00+00'),('t2','USD',56,false,'2026-02-10 00:00:00+00'),
        ('t3','USD',48,false,'2026-01-10 00:00:00+00'),('t3','USD',56,false,'2026-02-10 00:00:00+00'),
        ('t4','USD',48,false,'2026-01-10 00:00:00+00'),('t4','USD',56,false,'2026-02-10 00:00:00+00'),
        ('t5','USD',48,false,'2026-01-10 00:00:00+00'),('t5','USD',56,false,'2026-02-10 00:00:00+00'),
        ('t6','USD',48,false,'2026-01-10 00:00:00+00'),('t6','USD',56,false,'2026-02-10 00:00:00+00'),
        ('t7','USD',48,false,'2026-01-10 00:00:00+00'),('t7','USD',56,false,'2026-02-10 00:00:00+00');
      INSERT INTO accounting_accounts VALUES
        (20,'t2','6400',true),(21,'t2','2110',true),
        (30,'t3','6400',true),(31,'t3','2110',true),
        (40,'t5','1130',true),(41,'t5','4200',true),(42,'t5','6400',true),(43,'t5','2110',true);
      INSERT INTO accounting_settings VALUES
        (2,'t2',NULL,NULL,NULL),(3,'t3',NULL,NULL,NULL),
        (4,'t4',NULL,NULL,NULL),(5,'t5',NULL,NULL,NULL),(6,'t6',NULL,NULL,NULL),(7,'t7',NULL,NULL,NULL);
      INSERT INTO shipping_lines VALUES (10,'t2'),(11,'t3');
      INSERT INTO maritime_rate_cards (id, tenant_id, pol_code, pod_code, status, currency, valid_from, valid_until, shipping_line_id, container_type, total_freight_cost) VALUES (1,'t2','AEDXB','EGALY','active','USD','2020-01-01','2099-01-01',10,'40HC',100.125);
      INSERT INTO maritime_jobs VALUES
        (2,'t2','JOB-1',NULL,NULL,'booked',10,'Line','AEDXB','EGALY',NULL,0,10000,0,10000,NULL),
        (3,'t3','JOB-1',NULL,NULL,'booked',11,'Line','AEDXB','EGALY',NULL,0,10000,0,10000,NULL),
        (5,'t5','JOB-1','Acme',NULL,'open',NULL,NULL,NULL,NULL,NULL,0,0,0,0,NULL);
    `);

    // 1. The journal poster, driven directly on its slice with
    // db-as-trx: the journal converts at the entry date, not
    // the live rate (48 on 2026-01-15, 56 on 2026-03-01); a
    // supplied rate of 50 wins over asOf; the base currency
    // still resolves to 1.
    const jobT2 = { id: 2, job_number: 'JOB-1', shipping_line_name: 'Line' };
    await (carrierService as any).postCarrierInvoiceJournal(db, 't2', {
      job: jobT2,
      invoiceNumber: 'MSCU-100',
      carrierName: 'Line',
      shippingLineId: 10,
      totalAmount: 100,
      currency: 'USD',
      entryDate: new Date('2026-01-15'),
      userId: 1,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceType, 'maritime_carrier_invoice');
    assert.equal(Number(calls[0].lines[0].debit), 4800, 'the backdated journal must post at 48, not live 56');
    assert.equal(Number(calls[0].lines[1].credit), 4800);
    await (carrierService as any).postCarrierInvoiceJournal(db, 't2', {
      job: jobT2,
      invoiceNumber: 'MSCU-101',
      carrierName: 'Line',
      shippingLineId: 10,
      totalAmount: 100,
      currency: 'USD',
      entryDate: new Date('2026-03-01'),
      userId: 1,
    });
    assert.equal(Number(calls[1].lines[0].debit), 5600, 'the later journal must post at the 56 rate');
    await (carrierService as any).postCarrierInvoiceJournal(db, 't2', {
      job: jobT2,
      invoiceNumber: 'MSCU-102',
      carrierName: 'Line',
      shippingLineId: 10,
      totalAmount: 100,
      currency: 'USD',
      exchangeRate: 50,
      entryDate: new Date('2026-01-15'),
      userId: 1,
    });
    assert.equal(Number(calls[2].lines[0].debit), 5000, 'a supplied contractual rate wins over the as-of moment');
    await (carrierService as any).postCarrierInvoiceJournal(db, 't2', {
      job: jobT2,
      invoiceNumber: 'MSCU-103',
      carrierName: 'Line',
      shippingLineId: 10,
      totalAmount: 100,
      currency: 'EGP',
      entryDate: new Date('2026-01-15'),
      userId: 1,
    });
    assert.equal(Number(calls[3].lines[0].debit), 100, 'the base currency still resolves to 1');
    const jobAfterT2 = await db
      .selectFrom('maritime_jobs' as any)
      .selectAll()
      .where('tenant_id', '=', 't2')
      .where('id', '=', 2)
      .executeTakeFirstOrThrow();
    assert.equal(Number((jobAfterT2 as any).carrier_cost_total), 4800 + 5600 + 5000 + 100);
    assert.equal(Number((jobAfterT2 as any).net_profit), 10000 - (4800 + 5600 + 5000 + 100));

    // 2. createCarrierInvoice on the overcharge branch (no
    // journal): a backdated invoice date resolves without
    // throwing — with no supplied rate and with a supplied
    // rate of 50 (no supplied+asOf contradiction) — and the
    // invoice is stored with its date; no journal is posted.
    // The rate VALUE on this branch is unobservable (the
    // audit never sees the rate and the row stores none),
    // so the value is pinned by §1 + the static pin.
    const callsBeforeCreate = calls.length;
    const created: any = await service.createCarrierInvoice(authFor('t2'), '2', {
      invoiceNumber: 'MSCU-200',
      invoiceDate: '2026-01-15',
      totalInvoicedAmount: 200,
      currency: 'USD',
      shippingLineId: 10,
      carrierName: 'Line',
    } as never);
    assert.equal(created.success, true);
    assert.equal(created.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, callsBeforeCreate, 'the overcharge branch posts no journal');
    const createdSupplied: any = await service.createCarrierInvoice(authFor('t2'), '2', {
      invoiceNumber: 'MSCU-201',
      invoiceDate: '2026-01-15',
      totalInvoicedAmount: 200,
      currency: 'USD',
      exchangeRate: 50,
      shippingLineId: 10,
      carrierName: 'Line',
    } as never);
    assert.equal(createdSupplied.success, true);
    assert.equal(createdSupplied.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, callsBeforeCreate);
    const createdLater: any = await service.createCarrierInvoice(authFor('t2'), '2', {
      invoiceNumber: 'MSCU-202',
      invoiceDate: '2026-03-01',
      totalInvoicedAmount: 200,
      currency: 'USD',
      shippingLineId: 10,
      carrierName: 'Line',
    } as never);
    assert.equal(createdLater.success, true);
    assert.equal(createdLater.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, callsBeforeCreate);
    const createdRows: any[] = await (db as any)
      .selectFrom('maritime_carrier_invoices')
      .selectAll()
      .where('tenant_id', '=', 't2')
      .orderBy('invoice_number', 'asc')
      .execute();
    assert.equal(createdRows.length, 3);
    assert.deepEqual(
      createdRows.map((r: any) => [
        r.invoice_number,
        new Date(r.invoice_date as any).toISOString().slice(0, 10),
        r.audit_status,
        Number(r.contracted_amount),
        Number(r.variance_amount),
      ]),
      [
        ['MSCU-200', '2026-01-15', 'overcharge', 100.13, 99.87],
        ['MSCU-201', '2026-01-15', 'overcharge', 100.13, 99.87],
        ['MSCU-202', '2026-03-01', 'overcharge', 100.13, 99.87],
      ],
    );

    // 3. overrideCarrierInvoice with a seeded journal id (the
    // poster is skipped, solo-admin pattern): the override
    // completes and stamps approved_override, and no journal
    // is posted. The :588 resolution itself executes only on
    // the journal-posting branch, which cannot run on PGlite
    // (hang note above), so its rate is pinned by §1 + the
    // static pin.
    await pg.exec(`
      INSERT INTO maritime_carrier_invoices (id, tenant_id, job_id, shipping_line_id, carrier_name, invoice_number, invoice_date, currency, total_invoiced_amount, ocean_freight, thc_charges, baf_charges, detention_demurrage, other_charges, rate_card_id, contracted_amount, variance_amount, variance_pct, audit_status, override_approved_by, override_approved_at, override_reason, journal_entry_id, payment_status, notes, created_by, updated_at) VALUES
        (9001,'t3',3,11,'Line','MSCU-300','2026-01-15','USD',100,100,0,0,0,0,NULL,48,52,108.33,'overcharge',NULL,NULL,NULL,77,'unpaid',NULL,2,NULL);
    `);
    const callsBeforeOverride = calls.length;
    const overridden: any = await (carrierService as any).overrideCarrierInvoice(authFor('t3'), '9001', {
      reason: 'اعتماد الزيادة بعد مراجعة إيميل الخط الملاحي بخصوص رسوم التكدس بالميناء',
    });
    assert.equal(overridden.success, true);
    assert.equal(calls.length, callsBeforeOverride, 'the seeded-journal override posts no journal');
    const overriddenRow: any = await (db as any)
      .selectFrom('maritime_carrier_invoices')
      .selectAll()
      .where('tenant_id', '=', 't3')
      .where('id', '=', 9001)
      .executeTakeFirstOrThrow();
    assert.equal(overriddenRow.audit_status, 'approved_override');
    assert.equal(Number(overriddenRow.journal_entry_id), 77, 'the seeded journal id stays linked');
    assert.equal(Number(overriddenRow.override_approved_by), 1);

    // 4. Agent settlement: created now, so it reads the history
    // rate at its creation moment — not a live row moved to 60
    // without history, and a supplied rate still wins.
    const base = { agentName: 'Agent', settlementType: 'debit_note', amount: 100 };
    const settledNow = await service.createAgentSettlement(authFor('t4'), { ...base, currency: 'USD' } as never);
    assert.equal(Number(settledNow.exchange_rate), 56);
    assert.equal(Number(settledNow.local_equivalent_amount), 5600);
    await pg.exec(
      `UPDATE currency_exchange_rates SET exchange_rate = 60 WHERE tenant_id = 't4' AND currency_code = 'USD'`,
    );
    const settledAfterMove = await service.createAgentSettlement(authFor('t4'), { ...base, currency: 'USD' } as never);
    assert.equal(
      Number(settledAfterMove.exchange_rate),
      56,
      'the settlement must read the history rate at creation (56), not the moved live row (60)',
    );
    assert.equal(Number(settledAfterMove.local_equivalent_amount), 5600);
    const settledSupplied = await service.createAgentSettlement(authFor('t4'), {
      ...base,
      currency: 'USD',
      exchangeRate: 50,
    } as never);
    assert.equal(Number(settledSupplied.exchange_rate), 50);
    assert.equal(Number(settledSupplied.local_equivalent_amount), 5000);

    // 5. Sales invoice + expense voucher: posted now, so they read
    // the history rate at their entry moment (56) even when the
    // live row was moved to 60 without history.
    await pg.exec(
      `UPDATE currency_exchange_rates SET exchange_rate = 60 WHERE tenant_id = 't5' AND currency_code = 'USD'`,
    );
    const callsBeforeInvoice = calls.length;
    const invoice = await service.issueJobSalesInvoice(authFor('t5'), '5', { amount: 100.125, currency: 'USD' });
    assert.equal(calls.length, callsBeforeInvoice + 1);
    assert.equal(
      Number(calls[calls.length - 1].lines[0].debit),
      5607,
      'the sales invoice must post at the history rate 56, not the moved live row 60',
    );
    assert.equal(Number((invoice.job as { client_invoiced_total: number }).client_invoiced_total), 5607);
    const expense = await service.recordJobExpenseVoucher(authFor('t5'), '5', {
      amount: 100.125,
      currency: 'USD',
      expenseType: 'other',
    } as never);
    assert.equal(
      Number(calls[calls.length - 1].lines[0].debit),
      5607,
      'the expense voucher must post at the history rate 56, not the moved live row 60',
    );
    assert.equal(Number((expense.job as { other_costs_total: number }).other_costs_total), 5607);

    // 6. Close guard: it reads the history rate at the close
    // moment — a $100 charge blocks the close when billed is
    // 5000 (5600 > 5000) and passes when billed is 6000. The
    // live row is moved to 48 without history, so a live read
    // would pass both closes (4800) and the guard would prove
    // nothing.
    await pg.exec(`
      INSERT INTO journal_entries (id, tenant_id, status, entry_date, entry_no, source_type, source_id) VALUES
        (9001,'t6','posted',NOW(),'JE-T6','maritime_job',1),
        (9002,'t7','posted',NOW(),'JE-T7','maritime_job',1);
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, description, partner_type, partner_id, cost_center_id) VALUES
        ('t6',9001,10,0,5000,'billed','none',NULL,NULL),
        ('t7',9002,10,0,6000,'billed','none',NULL,NULL);
      INSERT INTO maritime_job_charges (tenant_id, job_id, charge_code, charge_name_en, sell_amount, cost_amount, currency, is_invoiced) VALUES
        ('t6','1','OCEAN','Ocean freight',100,100,'USD',true),
        ('t7','1','OCEAN','Ocean freight',100,100,'USD',true);
      UPDATE currency_exchange_rates SET exchange_rate = 48 WHERE tenant_id IN ('t6','t7') AND currency_code = 'USD';
    `);
    await assert.rejects(
      (service as any).assertJobCanClose('t6', '1'),
      /تتجاوز/,
      'the close guard must read the history rate 56 at close: 5600 > billed 5000',
    );
    await (service as any).assertJobCanClose('t7', '1');

    // 7. Static pins: the kernel precedence, all seven call
    // sites passing asOf, quotations still live by design,
    // and the engine-map currency row.
    const facade = fs.readFileSync(FACADE, 'utf8');
    assert.ok(facade.includes('asOf?: Date | string,'), 'the kernel signature must accept an as-of moment');
    assert.ok(facade.includes('if (suppliedRate !== undefined) {'), 'the kernel must prefer a supplied rate');
    assert.ok(
      facade.includes('return resolveFxRate(this.db, tenantId, currency, { suppliedRate });'),
      'the kernel must resolve a supplied rate without an as-of moment',
    );
    assert.ok(facade.includes('if (asOf !== undefined) {'), 'the kernel must resolve an as-of moment');
    assert.ok(
      facade.includes('return resolveFxRate(this.db, tenantId, currency, { asOf });'),
      'the kernel must resolve the as-of moment through the single resolver',
    );
    const settlements = fs.readFileSync(AGENT_SETTLEMENTS, 'utf8');
    assert.ok(
      settlements.includes('resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate, new Date())'),
      'the settlement must pass its creation moment as asOf',
    );
    const carrierInvoices = fs.readFileSync(CARRIER_INVOICES, 'utf8');
    assert.ok(
      /resolveFreightExchangeRate\(\s*tenantId,\s*params\.currency,\s*params\.exchangeRate,\s*params\.entryDate,?\s*\)/.test(
        carrierInvoices,
      ),
      'the carrier-invoice journal must pass its entry date as asOf',
    );
    assert.ok(
      carrierInvoices.includes('resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate, entryDate)'),
      'createCarrierInvoice must pass its invoice date as asOf',
    );
    assert.ok(
      carrierInvoices.includes('resolveFreightExchangeRate(tenantId, invCurrency, undefined, invoiceDate)'),
      'the override must pass the stored invoice date as asOf',
    );
    const invoicing = fs.readFileSync(INVOICING, 'utf8');
    assert.ok(
      invoicing.includes('resolveFreightExchangeRate(tenantId, dto?.currency, dto?.exchangeRate, entryDate)'),
      'the sales invoice must pass its entry date as asOf',
    );
    assert.ok(
      invoicing.includes('resolveFreightExchangeRate(tenantId, dto.currency, dto.exchangeRate, entryDate)'),
      'the expense voucher must pass its entry date as asOf',
    );
    const jobsCore = fs.readFileSync(JOBS_CORE, 'utf8');
    assert.ok(
      jobsCore.includes('resolveFreightExchangeRate(tenantId, charge.currency, undefined, new Date())'),
      'the close guard must pass the close moment as asOf',
    );
    for (const [label, file] of [
      ['agent-settlements', AGENT_SETTLEMENTS],
      ['carrier-invoices', CARRIER_INVOICES],
      ['invoicing', INVOICING],
      ['jobs-core', JOBS_CORE],
      ['quotations', QUOTATIONS],
    ] as const) {
      const src = fs.readFileSync(file, 'utf8');
      assert.equal(
        (src.match(/asOf\?: Date \| string,/g) || []).length,
        2,
        `${label} must carry the uniform kernel type (interface + field)`,
      );
    }
    const quotations = fs.readFileSync(QUOTATIONS, 'utf8');
    assert.ok(
      quotations.includes('resolveFreightExchangeRate(tenantId, bidCurrency)'),
      'the auto-quote must still resolve live (quote priced now)',
    );
    assert.ok(
      quotations.includes('resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate)'),
      'createQuotation must still resolve live (quote priced now)',
    );
    assert.equal(
      (quotations.match(/resolveFreightExchangeRate\(tenantId,/g) || []).length,
      2,
      'quotations must have exactly the two live call sites, no asOf',
    );
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(engineMap.includes(NEW_INV), 'the engine-map currency row must cite the new INV');
    assert.ok(
      engineMap.includes('close-time conversions resolve at the document date'),
      'the engine-map currency row must state the document-date rule',
    );

    // 8. The INV entry exists exactly once in both places (never
    // quote another INV id literally).
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S14/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');

    // 9. Wiring: both critical lists carry 407 specs in identical
    // order, this spec last.
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 450);
    assert.equal(chain.length, 450);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 407 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    for (const [label, specPath] of [
      ['B1', B1_SPEC],
      ['B2', B2_SPEC],
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 450);') && src.includes('assert.equal(chain.length, 450);'),
        `${label} spec wiring must re-pin to 407`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }

    // 10. The wiring re-pin sweep is complete: no critical spec
    // may still pin the old count, point its last-entry at the
    // repair spec, or pin the old guard INV. (The patterns below
    // are built by concatenation so this block's own source never
    // contains the patterns it scans for.)
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-eval-repair-type-' + 'imports.spec.ts';
    const prevInv = 'INV-PHASE1-EVAL-REPAIR-TYPE-' + 'IMPORTS';
    const staleSpecs = 'specs.length, 40' + '6';
    const staleChain = 'chain.length, 40' + '6';
    const staleList = 'list.length, 40' + '6';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (406)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the repair spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (repair)');

    // 11. The guard tail holds ONLY the newest id, so this package
    // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
    // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
    // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
    // P3/repair specs' guard assertions to the new INV; their
    // invariants-file assertions still pin their own id (each line
    // stays in ARCHITECTURE_INVARIANTS.md exactly once).
    for (const [label, specPath] of [
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S14/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }

    // 12. The module-boundary pins do not move in this package
    // (the kernel gains an optional parameter; no import is
    // added, removed or moved, so no edge and no total moves).
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
      'module-boundary must still pin the frontend total 105',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      'module-boundary must still pin 63 backend edges',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
      'module-boundary must still pin 44 frontend edges',
    );
    assert.ok(
      boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
      'module-boundary must still pin the frontend edge floor 44',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
      'the frontend bidirectional pair list must stay empty',
    );
    const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
    assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
    const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
    assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
    const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');

    console.log('phase1 final slice 1 checks passed (maritime close FX at the document date, 407 specs wired)');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
