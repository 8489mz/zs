import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { ExchangeReturnPort, type ExchangeReturnContext } from '../../src/common/utils/exchange-return.port';

/*
 * Phase 1 B7 — returns|sales circular pair broken
 * (INV-PHASE1-B7-RETURNS-SALES-DECOUPLED).
 *
 * The pair was returns->sales 5 + sales->returns 4 (grounding Pair 6):
 * - returns->sales: returns-create.service.ts + returns.service.ts
 *   import settlePosExchange from the sales pos-exchange engine;
 *   returns-relief.service.ts + returns-sale-return.service.ts import
 *   allocateInvoiceDiscount from the sales invoice-discount engine;
 *   returns-write-helpers.service.ts imports
 *   resolveRequireCashierShiftForSales from the sales authorization
 *   service. That direction is three pricing/exchange engines plus an
 *   authorization service — duplicating or moving those would spread
 *   sale-pricing logic — and is NOT touched here.
 * - sales->returns: sales.module.ts imported ReturnsModule; the
 *   create-sale types imported ReturnsService + ExchangeReturnContext
 *   from the returns service; load-sale-context imported the
 *   ExchangeReturnContext type; sales-write.service.ts injected
 *   ReturnsService. That direction is exchange-return handling at
 *   sale time: prepareExchangeReturn (load-sale-context) +
 *   settleExchangeReturn (compute-totals-and-gates), both driven
 *   through the CreateSaleDeps.returnsService field.
 *
 * The break extracts the exchange-return execution behind a shared
 * port (the brief's sanctioned form): the ExchangeReturnContext type
 * + an ExchangeReturnPort abstract class move to the shared layer
 * (backend/src/common/utils/exchange-return.port.ts). ReturnsService
 * extends the port (its two methods already match the abstract
 * signatures exactly), ReturnsModule provides the port binding
 * ({ provide: ExchangeReturnPort, useExisting: ReturnsService }) and
 * becomes @Global() — the NestJS-native way to make the binding
 * visible to SalesModule without SalesModule importing ReturnsModule
 * (precedent: 7 @Global() modules already exist in this codebase —
 * config, audit, auth, idempotency, logging, database — all infra;
 * this is the first feature module to use it, and the INV records
 * why: the port binding must be resolvable from SalesModule, and
 * the only alternatives are a ModuleRef lazy lookup (zero
 * precedent, hides the dependency) or keeping the module import
 * (the edge itself). @Global() changes DI visibility only — no
 * existing module gains a new import, no provider is instantiated
 * twice, and ReturnsService is still constructed exactly once by
 * ReturnsModule. Sales files import only the port + the type from
 * shared; no sales file imports any returns file, and
 * sales.module.ts imports no returns module.
 *
 * The port file's feature-module imports are type-only (erased at
 * runtime): CreateReturnDto (the prepare payload), the
 * allocateRefundTenders input shape (the context's refundBase
 * field), and settlePosExchange's return type — so the moved type
 * and the port signatures stay byte-identical to the service's own,
 * with zero runtime coupling from shared to any feature module. The
 * module-boundary method states explicitly that src/common imports
 * are not edges (the B4 precedent: the shared payroll engines import
 * the accounting money engine the same way).
 *
 * Money is strict: the exchange math does not move and does not
 * change — the same ReturnsService instance serves the same two
 * methods through the port. Block 3 drives the real exchange on
 * PGlite through a port-typed reference (the returns-payout-truth
 * Case 9 flow, trimmed): prepare grants store credit 50 for the
 * returned half, settle with an equal new sale applies 50 credit
 * and refunds 0. The cash-only refund rule is untouched (a
 * requested 'card' remainder still refunds in cash).
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: sales->returns 4 -> 0 (edge gone),
 *   returns->sales stays 5; backend total 750 -> 746;
 *   backend edges 65 -> 64; the returns|sales pair leaves the
 *   bidirectional list (only delivery-reps|sales remains — B8).
 * - module-doors: both returns door rows retire (the module row and
 *   the service row had only sales importers); the returns section
 *   keeps its heading (the doors spec requires one per module) with
 *   no imported-by rows and the intended door "the Nest module file
 *   only". The doors spec needs no change (it does not check §3
 *   rows).
 * - Wiring: both critical lists carry 376 specs in identical order,
 *   the F5a spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const PORT_FILE = path.join(BACKEND, 'src', 'common', 'utils', 'exchange-return.port.ts');
const RETURNS_TYPES = path.join(BACKEND, 'src', 'modules', 'returns', 'returns.types.ts');
const RETURNS_SERVICE = path.join(BACKEND, 'src', 'modules', 'returns', 'returns.service.ts');
const RETURNS_MODULE = path.join(BACKEND, 'src', 'modules', 'returns', 'returns.module.ts');
const SALES_MODULE = path.join(BACKEND, 'src', 'modules', 'sales', 'sales.module.ts');
const SALES_WRITE = path.join(BACKEND, 'src', 'modules', 'sales', 'services', 'sales-write.service.ts');
const CREATE_SALE_TYPES = path.join(
  BACKEND,
  'src',
  'modules',
  'sales',
  'services',
  'create-sale',
  'create-sale-types.ts',
);
const LOAD_SALE_CONTEXT = path.join(
  BACKEND,
  'src',
  'modules',
  'sales',
  'services',
  'create-sale',
  'load-sale-context.ts',
);
const COMPUTE_TOTALS = path.join(
  BACKEND,
  'src',
  'modules',
  'sales',
  'services',
  'create-sale',
  'compute-totals-and-gates.ts',
);
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const DOORS_DOC = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const DOORS_SPEC = path.join(BACKEND, 'test', 'critical', 'module-doors.spec.ts');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  while (i < n) {
    const c = source[i];
    const nxt = i + 1 < n ? source[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && nxt === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && nxt === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = "'";
      else if (c === '"') state = '"';
      else if (c === '`') state = '`';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && nxt === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c;
      if (i + 1 < n) out += source[i + 1];
      i += 2;
      continue;
    }
    if ((state === "'" && c === "'") || (state === '"' && c === '"') || (state === '`' && c === '`')) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

const ADMIN = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

// PGlite harness copied from returns-payout-truth.spec.ts (same schema
// the real exchange flow needs; trimmed to the prepare + settle path).
async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (1, 't1', 'Main', 1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'branch_stock');
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text,
      name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT '', account_group text DEFAULT '',
      normal_balance text DEFAULT '', is_active boolean DEFAULT true, is_system boolean DEFAULT false,
      allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false,
      is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false,
      is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false,
      created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(),
      CONSTRAINT uq_acct_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint,
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
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text,
      barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint,
      status text, total numeric, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0,
      discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, subtotal numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, payment_type text, payment_channel text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      exchange_return_id bigint, tip_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0,
      delivery_fee_mode text, service_charge numeric DEFAULT 0, delivery_status text,
      delivery_rep_id bigint, collection_status text, order_type text,
      delivery_signature text, delivery_photo_url text, delivery_gps_lat numeric, delivery_gps_lng numeric,
      delivery_notes text, settled_at timestamptz, settled_by bigint, updated_at timestamptz, sale_origin text);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint,
      product_name text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric,
      net_line_total numeric, allocated_discount numeric DEFAULT 0, allocated_tax numeric DEFAULT 0,
      cost_price numeric DEFAULT 0, unit_multiplier numeric DEFAULT 1, serials text, modifiers text);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint,
      payment_channel text, amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_line_id bigint, product_id bigint, quantity numeric, allocation_order int, location_id bigint);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, batch_id bigint, qty numeric);
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, quantity numeric, allocation_type text,
      reversal_of_allocation_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text,
      remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text,
      invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02',
      exchange_return_id bigint, exchange_sale_id bigint,
      exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3),
      tip_relief numeric(15, 3), courier_relief numeric(15, 3),
      forfeited_header_discount numeric(15, 3), goodwill_amount numeric(15, 3), goodwill_reason text, header_discount_mode text);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint,
      product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric,
      allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint, sale_id bigint,
      sale_item_id bigint, location_id bigint, branch_id bigint, cost_price numeric, warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint,
      batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text);
    CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL,
      unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150),
      status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text,
      amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint,
      branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      opened_by bigint, status text, branch_id bigint, location_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, status text, updated_at timestamptz);
    INSERT INTO accounting_settings VALUES
      (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 4100, 4200, 4300, 4400, 5100, 2150]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,account_id,code) VALUES ($1,$2,$3,$4)', [
      code,
      't1',
      'a1',
      String(code),
    ]);
  }
  return { pg, db };
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
  const adminRecord = await createPasswordRecord('admin-pass');
  await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${adminRecord.hash}, ${adminRecord.salt}, true)`.execute(
    db,
  );
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (1, 't1', 'a1', 'SHIFT-1', 1, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (2, 't1', 'a1', 'SHIFT-2', 2, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO customers VALUES (25, 't1', 0, 0, 0, 0, false, NOW())`.execute(db);
  await sql`INSERT INTO delivery_representatives VALUES (7, 't1', 'a1', 'Courier', true)`.execute(db);
}

/* A sale of 2 units at 50 (goods 100) + tip 10 + freelance fee 20
   + service 12 = total 142, paid cash 142, customer 25. */
async function seedTippedCashSale(
  db: Kysely<Database>,
  opts: {
    saleId?: number;
    subtotal?: number;
    tip?: number;
    fee?: number;
    service?: number;
    qty?: number;
    paidCash?: number;
    paidCard?: number;
  } = {},
): Promise<number> {
  const saleId = opts.saleId ?? 1;
  const subtotal = opts.subtotal ?? 100;
  const tip = opts.tip ?? 10;
  const fee = opts.fee ?? 20;
  const service = opts.service ?? 12;
  const qty = opts.qty ?? 2;
  const total = subtotal + tip + fee + service;
  const paidCash = opts.paidCash ?? total;
  const paidCard = opts.paidCard ?? 0;
  const unitPrice = subtotal / qty;
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (${saleId}, 't1', 'a1', ${'S-' + saleId}, 25, 'posted', ${total}, ${paidCash + paidCard}, 0, 0, 0, ${subtotal}, false, 'cash', 'cash', 1, 1, ${tip}, ${fee}, 'freelance_courier', ${service})`.execute(
    db,
  );
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (${saleId * 10}, 't1', 'a1', ${saleId}, 10, 'Widget', ${qty}, ${unitPrice}, ${subtotal}, ${unitPrice}, ${subtotal}, 0, 0, 0, 1)`.execute(
    db,
  );
  if (paidCash > 0)
    await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'cash', ${paidCash})`.execute(
      db,
    );
  if (paidCard > 0)
    await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'card', ${paidCard})`.execute(
      db,
    );
  return saleId;
}

async function returnDoc(db: Kysely<Database>, id: number): Promise<any> {
  return db.selectFrom('return_documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function treasurySum(db: Kysely<Database>, txnType: string): Promise<number> {
  const row = await sql<{
    s: string;
  }>`SELECT COALESCE(SUM(amount), 0) AS s FROM treasury_transactions WHERE txn_type = ${txnType}`.execute(db);
  return Number(row.rows[0].s);
}

async function customerBalance(db: Kysely<Database>): Promise<{ balance: number; storeCredit: number }> {
  const row = await db
    .selectFrom('customers')
    .select(['balance', 'store_credit_balance'])
    .where('id', '=', 25)
    .executeTakeFirstOrThrow();
  return { balance: Number((row as any).balance || 0), storeCredit: Number((row as any).store_credit_balance || 0) };
}

function makeServices(db: Kysely<Database>): { returns: ReturnsService; posting: AccountingPostingService } {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined, logWithExecutor: async () => undefined };
  const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
  const returns = new ReturnsService(
    db as any,
    new TransactionHelper(),
    auditStub as any,
    posting as any,
    idempotencyStub as any,
  );
  return { returns, posting };
}

async function main(): Promise<void> {
  // 1. The shared port exists; the old returns home no longer defines
  // the type — it re-exports it from shared.
  assert.ok(fs.existsSync(PORT_FILE), 'shared exchange-return port must exist');
  const portSrc = stripComments(fs.readFileSync(PORT_FILE, 'utf8'));
  assert.ok(
    portSrc.includes('export interface ExchangeReturnContext'),
    'shared port must define the ExchangeReturnContext type',
  );
  assert.ok(portSrc.includes('export abstract class ExchangeReturnPort'), 'shared port must define the port class');
  assert.ok(portSrc.includes('abstract prepareExchangeReturn('), 'shared port must declare prepareExchangeReturn');
  assert.ok(portSrc.includes('abstract settleExchangeReturn('), 'shared port must declare settleExchangeReturn');
  for (const line of portSrc.split('\n')) {
    if (line.includes("from '../../modules/")) {
      assert.ok(
        line.trim().startsWith('import type'),
        `shared port may only import feature modules as types (erased at runtime): ${line.trim()}`,
      );
    }
  }
  const returnsTypes = stripComments(fs.readFileSync(RETURNS_TYPES, 'utf8'));
  assert.ok(
    !returnsTypes.includes('export interface ExchangeReturnContext'),
    'returns.types must no longer define ExchangeReturnContext',
  );
  assert.ok(
    returnsTypes.includes("export type { ExchangeReturnContext } from '../../common/utils/exchange-return.port';"),
    'returns.types must re-export ExchangeReturnContext from shared',
  );

  // 2. The sales consumers import the port + the type from shared,
  // never from returns; the module-DI line is gone.
  const salesModule = stripComments(fs.readFileSync(SALES_MODULE, 'utf8'));
  assert.ok(!salesModule.includes('ReturnsModule'), 'sales.module must no longer reference ReturnsModule');
  assert.ok(!salesModule.includes('../returns/returns.module'), 'sales.module must no longer import ReturnsModule');
  const createSaleTypes = stripComments(fs.readFileSync(CREATE_SALE_TYPES, 'utf8'));
  assert.ok(
    createSaleTypes.includes("'../../../../common/utils/exchange-return.port'"),
    'create-sale-types must import the port from shared',
  );
  assert.ok(
    createSaleTypes.includes('returnsService: ExchangeReturnPort;'),
    'CreateSaleDeps.returnsService must be typed as the port',
  );
  assert.ok(
    !createSaleTypes.includes('../../../returns/returns.service'),
    'create-sale-types must no longer import from the returns service',
  );
  const loadContext = stripComments(fs.readFileSync(LOAD_SALE_CONTEXT, 'utf8'));
  assert.ok(
    loadContext.includes("'../../../../common/utils/exchange-return.port'"),
    'load-sale-context must import the context type from shared',
  );
  assert.ok(
    !loadContext.includes('../../../returns/returns.service'),
    'load-sale-context must no longer import from the returns service',
  );
  const salesWrite = stripComments(fs.readFileSync(SALES_WRITE, 'utf8'));
  assert.ok(
    salesWrite.includes("'../../../common/utils/exchange-return.port'"),
    'sales-write.service must import the port from shared',
  );
  assert.ok(
    salesWrite.includes('private readonly returnsService: ExchangeReturnPort,'),
    'sales-write.service must inject the port, not ReturnsService',
  );
  assert.ok(
    !salesWrite.includes("'../../returns/returns.service'"),
    'sales-write.service must no longer import ReturnsService',
  );
  const returnsModule = stripComments(fs.readFileSync(RETURNS_MODULE, 'utf8'));
  assert.ok(returnsModule.includes('@Global()'), 'returns.module must be @Global() (the port binding must resolve)');
  assert.ok(
    returnsModule.includes('{ provide: ExchangeReturnPort, useExisting: ReturnsService }'),
    'returns.module must bind the port to ReturnsService',
  );
  const returnsService = stripComments(fs.readFileSync(RETURNS_SERVICE, 'utf8'));
  assert.ok(
    returnsService.includes('export class ReturnsService extends ExchangeReturnPort'),
    'ReturnsService must extend the port',
  );

  // 3. The real exchange, driven through a port-typed reference on
  // PGlite (the returns-payout-truth Case 9 flow, trimmed): prepare
  // grants store credit 50 for the returned half; settle with an
  // equal new sale applies 50 credit and refunds 0. Money is strict.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { saleId: 1, subtotal: 100, tip: 10, fee: 20, service: 12, qty: 2 });
      const { returns } = makeServices(db);
      // ReturnsService IS the port: this assignment compiles only if
      // the class satisfies the abstract signatures exactly.
      const port: ExchangeReturnPort = returns;
      const context: ExchangeReturnContext = await db.transaction().execute((trx) =>
        port.prepareExchangeReturn(
          trx,
          {
            type: 'sale',
            invoiceId: 1,
            note: 'exchange',
            items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
            settlementMode: 'refund',
            refundMethod: 'cash',
            managerPin: '2468',
          } as never,
          ADMIN,
        ),
      );
      assert.equal(context.total, 50);
      assert.equal((await customerBalance(db)).storeCredit, 50);
      const prepared = await returnDoc(db, context.returnId);
      const preparedAllocations =
        typeof prepared.refund_allocations === 'string'
          ? JSON.parse(prepared.refund_allocations)
          : prepared.refund_allocations;
      assert.deepEqual(preparedAllocations, [{ tender: 'store_credit', amount: 50 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      const settlement = await db
        .transaction()
        .execute((trx) => port.settleExchangeReturn(trx, context, 50, 'store_credit', ADMIN));
      assert.equal(settlement.appliedCredit, 50);
      assert.equal(settlement.refundAmount, 0);
      assert.equal((await customerBalance(db)).storeCredit, 50);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      // Type identity both ways: the returns re-export is the shared type.
      const viaReturns: import('../../src/modules/returns/returns.types').ExchangeReturnContext = context;
      assert.equal(viaReturns.total, 50);
    } finally {
      await db.destroy();
    }
  }

  // 4. The live call sites still route through the port.
  assert.ok(
    loadContext.includes('this.returnsService.prepareExchangeReturn('),
    'load-sale-context must still prepare the exchange through the port',
  );
  const computeTotals = stripComments(fs.readFileSync(COMPUTE_TOTALS, 'utf8'));
  assert.ok(
    computeTotals.includes('this.returnsService.settleExchangeReturn('),
    'compute-totals-and-gates must still settle the exchange through the port',
  );
  assert.ok(
    salesWrite.includes('returnsService: this.returnsService,'),
    'sales-write.service must still pass the port into CreateSaleDeps',
  );

  // 5. The returns->sales spine is intact — the load-bearing
  // direction is untouched.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes("'returns->sales': 5,"),
    'module-boundary must keep returns->sales pinned at 5 (the staying leg)',
  );

  // 6. The boundary pins record the break. (Pin-table forms only, scoped
  // to the BACKEND table.)
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  assert.ok(!backendTable.includes("'sales->returns':"), 'module-boundary must no longer pin a sales->returns edge');
  assert.ok(!backendPairs.includes("'returns|sales',"), 'module-boundary must no longer list the returns|sales pair');
  assert.ok(
    !backendPairs.includes("'delivery-reps|sales'"),
    'module-boundary must no longer list the delivery-reps|sales pair (B8 breaks the last pair)',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary backend total is now 738 (B6 pinned 750; B7 re-pins 750 -> 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 63 (B6 pinned 65; B7 re-pins 65 -> 64; B8 re-pins 64 -> 63)',
  );

  // 7. The doors doc retires both returns door rows (the module row
  // and the service row had only sales importers); the returns
  // section keeps its heading with no imported-by rows.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  const returnsSection = doors.slice(doors.indexOf('### backend/returns'), doors.indexOf('### backend/saas-admin'));
  assert.ok(
    !returnsSection.includes('returns.module` — 1 statement'),
    'MODULE_DOORS.md must no longer list the returns.module door row',
  );
  assert.ok(
    !returnsSection.includes('returns.service` — 2 statement'),
    'MODULE_DOORS.md must no longer list the returns.service door row',
  );
  assert.ok(
    returnsSection.includes('the Nest module file only'),
    'MODULE_DOORS.md returns door must now be the Nest module file only',
  );
  assert.ok(
    !returnsSection.includes('plus the 2 file(s) above'),
    'MODULE_DOORS.md returns door must no longer claim 2 files above',
  );

  // 8. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B7-RETURNS-SALES-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B7 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-BATCH-REPAIR-DISCOUNT-I18N-KEYS/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the B7 INV exactly once');

  // 9. The B1/B2/B3/B4/B5/B6 specs re-pin their boundary assertions to the B7 numbers.
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('const PINNED_BACKEND_TOTAL = 738;'),
      `${label} spec must re-pin the backend total 746 -> 738`,
    );
    assert.ok(
      src.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      `${label} spec must re-pin the backend edge table 65 -> 64 edges`,
    );
  }

  // 10. Wiring: both critical lists carry 377 specs in identical order, the B8 spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 402);
  assert.equal(chain.length, 402);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 377 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 402);') && src.includes('assert.equal(chain.length, 402);'),
      `${label} spec wiring must re-pin to 377`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
      `${label} spec last-entry must re-pin to the B7 spec`,
    );
  }

  // 11. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the B6 spec. (The
  // live tree holds ~49 files asserting the count — the #264-fix /
  // D12 lesson. The B6 filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b7Name = 'phase1-b7' + '-returns-sales.spec.ts';
  const staleSpecs = 'specs.length, 37' + '6';
  const staleChain = 'chain.length, 37' + '6';
  const staleList = 'list.length, 37' + '6';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b7Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B7 spec');

  // 12. The guard tail holds ONLY the newest id, so B7 re-pins the
  // B3/B4/B5/B6 specs' guard assertions to the B7 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-BATCH-REPAIR-DISCOUNT-I18N-KEYS/g)'),
      `${label} spec guard assertion must re-pin to the B7 INV`,
    );
  }

  console.log(
    'phase1 B7 returns|sales decoupling checks passed (377 specs wired, pair gone, exchange identical through the port)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
