import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  tripSaleContribution,
  negateContribution,
  diffContributions,
  type TripSaleContribution,
} from '../../src/common/utils/van-trip-counters.engine';
import {
  getVanRepDiscountCapPercent,
  getCashDiscountPercent,
  parseRepPermissions,
  loadRepPermissions,
} from '../../src/common/utils/rep-settings.slice';
import { assertRepRouteForSale } from '../../src/common/utils/rep-route-gate';

/*
 * Phase 1 B8 — delivery-reps|sales circular pair broken, the LAST pair
 * (INV-PHASE1-B8-DELIVERY-REPS-SALES-DECOUPLED).
 *
 * The pair was delivery-reps->sales 9 + sales->delivery-reps 8
 * (grounding Pair 4, re-derived live at 18e793836 — the grounding's
 * 11/8 shifted by B1's 2 discountedSaleSql statements, which moved to
 * shared in B1 and no longer count as edges):
 * - delivery-reps->sales (9): delivery-reps.module.ts imports
 *   SalesModule; three services inject SalesFinanceService;
 *   van-pre-sales + convert-pre-sales-order inject SalesService;
 *   execute-field-sale-internal imports the sales offer/tax/pricing
 *   helpers. That direction is module DI + service injection and
 *   cannot move without restructuring DI — and is NOT touched here.
 * - sales->delivery-reps (8): compute-totals-and-gates reads the rep
 *   discount cap + cash-discount getters from the rep-settings slice
 *   (F1a deliberate coupling: one cap); assert-pos-rep-route calls
 *   the route gate (F3 deliberate coupling: one route rule);
 *   insert-sale-and-stock + the four sales-edit-and-cancel files +
 *   sales-write.service import the trip-contribution math
 *   (tripSaleContribution / diffContributions / negateContribution,
 *   F7 deliberate coupling: one attribution, two sale paths). That
 *   direction is eight near-pure function imports — no service, no
 *   module, no DI.
 *
 * The break moves those three helper modules whole to the shared
 * layer (backend/src/common/utils/): van-trip-counters.engine.ts
 * (137 lines, zero imports — pure math), rep-settings.slice.ts
 * (210 lines, zero imports — cap getters + permission flags),
 * rep-route-gate.ts (145 lines, one import: AppError from common).
 * Every export, signature and body is byte-identical — the money math
 * does not change. All 11 consumers re-point their imports at the
 * shared home (8 sales files + rep-target.engine.ts +
 * rep-scoped-reads.slice.ts + execute-field-sale-internal.ts), plus
 * the two critical specs that import the helpers directly
 * (van-trip-counter-adjustment, van-route-sale-gate). The
 * single-source property is preserved: the helpers are MOVED, never
 * duplicated — one cap, one route rule, one attribution. The
 * delivery-reps->sales leg stays: the dependency is one-way now, not
 * a cycle. The module-boundary method states explicitly that
 * src/common imports are not edges (the B4 precedent).
 *
 * Money is strict: the rep cap, the cash-discount %, the permission
 * flags, the route gate and the trip-contribution math must produce
 * IDENTICAL results after the move — blocks 3, 4 and 5 drive the real
 * shared helpers and pin the exact numbers (cap default 5, clamped
 * 0–100; cash sale 100 -> cash 100 / credit 0; mixed tender rows
 * 120 cash + 80 card on 300 -> credit 100; no-history first sale
 * passes the gate, a different rep's customer refuses 403).
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: sales->delivery-reps 8 -> 0 (edge gone),
 *   delivery-reps->sales stays 9; backend total 746 -> 738;
 *   backend edges 64 -> 63; the delivery-reps|sales pair leaves
 *   the bidirectional list — the backend list is EMPTY (no
 *   bidirectional pairs remain).
 * - module-doors: the van-trip-counters door row retires
 *   (docs/MODULE_DOORS.md delivery-reps section drops the row;
 *   intended door "plus the 3 file(s) above" -> "plus the 2 file(s)
 *   above"); the doors spec needs no change (it does not check §3
 *   rows).
 * - Wiring: both critical lists carry 377 specs in identical order,
 *   this spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_TRIP = path.join(BACKEND, 'src', 'common', 'utils', 'van-trip-counters.engine.ts');
const SHARED_SETTINGS = path.join(BACKEND, 'src', 'common', 'utils', 'rep-settings.slice.ts');
const SHARED_GATE = path.join(BACKEND, 'src', 'common', 'utils', 'rep-route-gate.ts');
const OLD_TRIP = path.join(BACKEND, 'src', 'modules', 'delivery-reps', 'van-trip-counters.engine.ts');
const OLD_SETTINGS = path.join(BACKEND, 'src', 'modules', 'delivery-reps', 'rep-target', 'rep-settings.slice.ts');
const OLD_GATE = path.join(
  BACKEND,
  'src',
  'modules',
  'delivery-reps',
  'services',
  'van-collections-and-swaps',
  'rep-route-gate.ts',
);
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const DOORS_DOC = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
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

// Minimal harness: only the tables the three shared helpers read.
async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, permissions text, is_active boolean DEFAULT true);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, customer_id bigint);
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, customer_id bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, delivery_rep_id bigint);
  `);
  return { pg, db };
}

async function expectRouteRefusal(db: Kysely<Database>, repId: number, customerId: number): Promise<void> {
  let caught: any = null;
  try {
    await assertRepRouteForSale(db as any, 't1', repId, customerId);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `route gate must refuse rep ${repId} selling to customer ${customerId}`);
  assert.equal(caught.code, 'CUSTOMER_NOT_ON_REP_ROUTE');
  assert.equal(caught.statusCode, 403);
}

async function main(): Promise<void> {
  // 1. The three shared helpers exist and define the exports; the old
  // delivery-reps homes are gone; no shared file imports a feature
  // module (the two pure files import nothing at all; the gate imports
  // only AppError from common).
  for (const [label, file, exports_] of [
    [
      'trip counters',
      SHARED_TRIP,
      [
        'export function tripSaleContribution',
        'export function negateContribution',
        'export function diffContributions',
        'export interface TripSaleContribution',
      ],
    ],
    [
      'rep settings',
      SHARED_SETTINGS,
      [
        'export async function getVanRepDiscountCapPercent',
        'export async function getCashDiscountPercent',
        'export function parseRepPermissions',
        'export async function loadRepPermissions',
      ],
    ],
    [
      'route gate',
      SHARED_GATE,
      [
        'export async function assertRepRouteForSale',
        'export async function listCustomerServingRepIds',
        'export async function assertRouteGate',
      ],
    ],
  ] as const) {
    assert.ok(fs.existsSync(file), `shared ${label} helper must exist`);
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const exp of exports_) {
      assert.ok(src.includes(exp), `shared ${label} helper must define ${exp}`);
    }
    for (const line of src.split('\n')) {
      if (line.includes('from ') && line.includes('modules/')) {
        assert.ok(
          line.trim().startsWith('import type'),
          `shared ${label} helper may only import feature modules as types (erased at runtime): ${line.trim()}`,
        );
      }
    }
  }
  assert.ok(!fs.existsSync(OLD_TRIP), 'old van-trip-counters.engine.ts must be gone');
  assert.ok(!fs.existsSync(OLD_SETTINGS), 'old rep-settings.slice.ts must be gone');
  assert.ok(!fs.existsSync(OLD_GATE), 'old rep-route-gate.ts must be gone');

  // 2. No sales file imports any delivery-reps file; all 11 consumers
  // re-point at the shared home; the two specs that import the helpers
  // directly re-point too.
  const salesDir = path.join(BACKEND, 'src', 'modules', 'sales');
  const salesFiles: string[] = [];
  (function walk(dir: string): void {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) salesFiles.push(full);
    }
  })(salesDir);
  assert.ok(salesFiles.length > 50, 'sales module scan must find its files');
  for (const file of salesFiles) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    assert.ok(
      !/from\s+['"][^'"]*delivery-reps/.test(src),
      `no sales file may import from delivery-reps: ${path.relative(BACKEND, file)}`,
    );
  }
  const consumers: Array<{ file: string; sharedImport: string; oldImport: string }> = [
    {
      file: 'src/modules/sales/services/create-sale/assert-pos-rep-route.ts',
      sharedImport: "'../../../../common/utils/rep-route-gate'",
      oldImport: "'../../../delivery-reps/services/van-collections-and-swaps/rep-route-gate'",
    },
    {
      file: 'src/modules/sales/services/create-sale/compute-totals-and-gates.ts',
      sharedImport: "'../../../../common/utils/rep-settings.slice'",
      oldImport: "'../../../delivery-reps/rep-target/rep-settings.slice'",
    },
    {
      file: 'src/modules/sales/services/create-sale/insert-sale-and-stock.ts',
      sharedImport: "'../../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/sales/services/sales-edit-and-cancel/adjust-sale-payments.service.ts',
      sharedImport: "'../../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/sales/services/sales-edit-and-cancel/cancel-sale.service.ts',
      sharedImport: "'../../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/sales/services/sales-edit-and-cancel/sales-edit-and-cancel-types.ts',
      sharedImport: "'../../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts',
      sharedImport: "'../../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/sales/services/sales-write.service.ts',
      sharedImport: "'../../../common/utils/van-trip-counters.engine'",
      oldImport: "'../../delivery-reps/van-trip-counters.engine'",
    },
    {
      file: 'src/modules/delivery-reps/rep-target.engine.ts',
      sharedImport: "'../../common/utils/rep-settings.slice'",
      oldImport: "'./rep-target/rep-settings.slice'",
    },
    {
      file: 'src/modules/delivery-reps/services/van-collections-and-swaps/rep-scoped-reads.slice.ts',
      sharedImport: "'../../../../common/utils/rep-route-gate'",
      oldImport: "'./rep-route-gate'",
    },
    {
      file: 'src/modules/delivery-reps/services/van-field-sales/execute-field-sale-internal.ts',
      sharedImport: "'../../../../common/utils/rep-route-gate'",
      oldImport: "'../van-collections-and-swaps/rep-route-gate'",
    },
  ];
  for (const { file, sharedImport, oldImport } of consumers) {
    const src = stripComments(fs.readFileSync(path.join(BACKEND, file), 'utf8'));
    assert.ok(src.includes(sharedImport), `${file} must import the shared helper ${sharedImport}`);
    assert.ok(!src.includes(oldImport), `${file} must no longer import the old helper ${oldImport}`);
  }
  const tripSpec = stripComments(
    fs.readFileSync(path.join(BACKEND, 'test', 'critical', 'van-trip-counter-adjustment.spec.ts'), 'utf8'),
  );
  assert.ok(
    tripSpec.includes("'../../src/common/utils/van-trip-counters.engine'"),
    'van-trip-counter-adjustment.spec.ts must import the shared trip engine',
  );
  assert.ok(
    !tripSpec.includes("'../../src/modules/delivery-reps/van-trip-counters.engine'"),
    'van-trip-counter-adjustment.spec.ts must no longer import the old trip engine',
  );
  const gateSpec = stripComments(
    fs.readFileSync(path.join(BACKEND, 'test', 'critical', 'van-route-sale-gate.spec.ts'), 'utf8'),
  );
  assert.ok(
    gateSpec.includes("'../../src/common/utils/rep-route-gate.ts'"),
    'van-route-sale-gate.spec.ts must resolve the shared gate file',
  );
  assert.ok(
    !gateSpec.includes("'../../src/modules/delivery-reps/services/van-collections-and-swaps/rep-route-gate.ts'"),
    'van-route-sale-gate.spec.ts must no longer resolve the old gate file',
  );
  assert.ok(
    gateSpec.includes("import { assertRouteGate } from '../../../../common/utils/rep-route-gate'"),
    'van-route-sale-gate.spec.ts must pin the field slice importing the gate from shared',
  );
  assert.ok(
    !gateSpec.includes("import { assertRouteGate } from '../van-collections-and-swaps/rep-route-gate'"),
    'van-route-sale-gate.spec.ts must no longer pin the old gate import',
  );

  // 3. Trip-contribution math identical through the shared module —
  // exact numbers, read straight from the moved engine.
  assert.deepEqual(
    tripSaleContribution({ total: 100, paidAmount: 0, paymentChannel: 'cash' }),
    { salesAmount: 100, cashCollected: 100, creditSales: 0, instapaySales: 0 },
    'cash sale 100 (paid 0): the whole total sits with the rep',
  );
  assert.deepEqual(
    tripSaleContribution({ total: 250, paidAmount: 250, paymentChannel: 'card' }),
    { salesAmount: 250, cashCollected: 0, creditSales: 0, instapaySales: 0 },
    'card sale 250 (paid 250): no cash, no credit',
  );
  assert.deepEqual(
    tripSaleContribution({ total: 80, paidAmount: 0, paymentChannel: 'instapay' }),
    { salesAmount: 80, cashCollected: 0, creditSales: 0, instapaySales: 80 },
    'instapay sale 80 (paid 0): the whole total is instapay',
  );
  assert.deepEqual(
    tripSaleContribution({ total: 400, paidAmount: 0, paymentChannel: 'credit' }),
    { salesAmount: 400, cashCollected: 0, creditSales: 400, instapaySales: 0 },
    'credit sale 400: the whole total is credit',
  );
  assert.deepEqual(
    tripSaleContribution({
      total: 300,
      paidAmount: 0,
      paymentChannel: 'mixed',
      payments: [
        { amount: 120, payment_channel: 'cash' },
        { amount: 80, payment_channel: 'card' },
      ],
    }),
    { salesAmount: 300, cashCollected: 120, creditSales: 100, instapaySales: 0 },
    'mixed sale 300 with tender rows 120 cash + 80 card: credit is the 100 remainder',
  );
  assert.deepEqual(
    tripSaleContribution({ total: 200, paidAmount: 0, paymentChannel: 'mixed', ledgerCreditAmount: 50 }),
    { salesAmount: 200, cashCollected: 150, creditSales: 50, instapaySales: 0 },
    'mixed sale 200 with a 50 ledger credit: cash 150, credit 50',
  );
  assert.deepEqual(
    tripSaleContribution({ total: 200, paidAmount: 60, paymentChannel: 'mixed' }),
    { salesAmount: 200, cashCollected: 60, creditSales: 140, instapaySales: 0 },
    'mixed sale 200 with no rows and no ledger: paid 60 is the cash leg',
  );
  const contribution: TripSaleContribution = { salesAmount: 100, cashCollected: 100, creditSales: 0, instapaySales: 0 };
  assert.deepEqual(
    negateContribution(contribution),
    { salesAmount: -100, cashCollected: -100, creditSales: 0, instapaySales: 0 },
    'negating a contribution flips the legs and keeps zero legs 0, not -0',
  );
  assert.deepEqual(
    negateContribution({ salesAmount: 0, cashCollected: 0, creditSales: 0, instapaySales: 0 }),
    { salesAmount: 0, cashCollected: 0, creditSales: 0, instapaySales: 0 },
    'negating a zero contribution stays exactly 0 on every leg',
  );
  assert.deepEqual(
    diffContributions(
      { salesAmount: 120, cashCollected: 120, creditSales: 0, instapaySales: 0 },
      { salesAmount: 100, cashCollected: 100, creditSales: 0, instapaySales: 0 },
    ),
    { salesAmount: 20, cashCollected: 20, creditSales: 0, instapaySales: 0 },
    'diffing two contributions subtracts leg by leg',
  );

  // 4. Cap getters identical through the shared module — the ONE
  // tenant-level rep discount cap (default 5%, clamped 0–100) and the
  // cash-discount % (default 0), read from the settings table.
  {
    const { pg, db } = await makeDb();
    try {
      assert.equal(await getVanRepDiscountCapPercent(db as any, 't1'), 5, 'missing cap row = 5%');
      assert.equal(await getCashDiscountPercent(db as any, 't1'), 0, 'missing cash-discount row = 0%');
      await sql`INSERT INTO settings VALUES ('t1', 'vanRepDiscountCapPercent', '8')`.execute(db);
      assert.equal(await getVanRepDiscountCapPercent(db as any, 't1'), 8, 'stored cap 8 reads back as 8');
      await sql`UPDATE settings SET value = '150' WHERE key = 'vanRepDiscountCapPercent'`.execute(db);
      assert.equal(await getVanRepDiscountCapPercent(db as any, 't1'), 100, 'cap 150 clamps to 100');
      await sql`UPDATE settings SET value = 'abc' WHERE key = 'vanRepDiscountCapPercent'`.execute(db);
      assert.equal(await getVanRepDiscountCapPercent(db as any, 't1'), 5, 'non-numeric cap falls back to 5');
      await sql`INSERT INTO settings VALUES ('t1', 'cashDiscountPercent', '10')`.execute(db);
      assert.equal(await getCashDiscountPercent(db as any, 't1'), 10, 'stored cash discount 10 reads back as 10');
      await sql`UPDATE settings SET value = '120' WHERE key = 'cashDiscountPercent'`.execute(db);
      assert.equal(await getCashDiscountPercent(db as any, 't1'), 100, 'cash discount 120 clamps to 100');
      // Permission flags: legacy (no object) keeps the pre-flag
      // behaviour; an explicit object is enforced per key.
      const legacy = parseRepPermissions(null);
      assert.equal(legacy.can_give_discount, true, 'legacy rep keeps the pre-flag per-line channel');
      assert.equal(legacy.max_discount_percent, 100, 'legacy rep max is 100');
      assert.equal(legacy.can_give_invoice_discount, false, 'legacy rep never had an invoice grant');
      assert.equal(legacy.can_collect_cash, true, 'legacy rep can collect cash');
      const explicit = parseRepPermissions({ can_give_discount: true, max_discount_percent: 7 });
      assert.equal(explicit.can_give_discount, true, 'explicit per-line grant opens the channel');
      assert.equal(explicit.max_discount_percent, 7, 'explicit max 7 reads back as 7');
      assert.equal(
        explicit.can_give_invoice_discount,
        false,
        'explicit rep without the invoice grant is per-line only',
      );
      assert.equal(
        parseRepPermissions({ max_discount_percent: 250 }).max_discount_percent,
        100,
        'explicit max 250 clamps to 100',
      );
      await sql`INSERT INTO delivery_representatives VALUES (7, 't1', 'a1', 'Courier', '{"can_give_discount":true,"max_discount_percent":7}', true)`.execute(
        db,
      );
      const loaded = await loadRepPermissions(db as any, 't1', 7);
      assert.equal(loaded.can_give_discount, true, 'loaded rep flags read from the rep row');
      assert.equal(loaded.max_discount_percent, 7, 'loaded rep max reads from the rep row');
      const missing = await loadRepPermissions(db as any, 't1', 999);
      assert.equal(missing.can_give_discount, true, 'missing rep row falls back to legacy');
      assert.equal(missing.max_discount_percent, 100, 'missing rep row legacy max is 100');
    } finally {
      await db.destroy();
    }
  }

  // 5. Route gate identical through the shared module — the three-way
  // distinction: no history (first sale) passes, an own served
  // customer passes, a different rep's customer refuses 403; a
  // missing evidence table reads as empty, never as an invented rep.
  {
    const { pg, db } = await makeDb();
    try {
      await assertRepRouteForSale(db as any, 't1', 7, 25);
      await sql`INSERT INTO van_field_visits (tenant_id, rep_id, customer_id) VALUES ('t1', 7, 25)`.execute(db);
      await assertRepRouteForSale(db as any, 't1', 7, 25);
      await expectRouteRefusal(db, 8, 25);
      await sql`INSERT INTO sales (id, tenant_id, account_id, customer_id, delivery_rep_id) VALUES (1, 't1', 'a1', 26, 7)`.execute(
        db,
      );
      await assertRepRouteForSale(db as any, 't1', 7, 26);
      await expectRouteRefusal(db, 8, 26);
      await sql`INSERT INTO sales_orders (tenant_id, rep_id, customer_id) VALUES ('t1', 9, 27)`.execute(db);
      await assertRepRouteForSale(db as any, 't1', 9, 27);
      await expectRouteRefusal(db, 7, 27);
    } finally {
      await db.destroy();
    }
    const bare = new PGlite();
    try {
      const bareDb = new Kysely<Database>({ dialect: new PGliteDialect(bare) });
      await assertRepRouteForSale(bareDb as any, 't1', 7, 25);
    } finally {
      await bare.close();
    }
  }

  // 6. The delivery-reps->sales spine is intact — the load-bearing
  // direction is untouched. (Pin-table forms only, scoped to the
  // BACKEND table: the frontend table still pins its own
  // delivery-reps->sales edge, 2 statements.)
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const frontendTable = boundary.slice(boundary.indexOf('PINNED_FRONTEND_EDGES'));
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  assert.ok(
    backendTable.includes("'delivery-reps->sales': 9,"),
    'module-boundary must keep delivery-reps->sales pinned at 9 (the staying leg)',
  );
  assert.ok(
    frontendTable.includes("'delivery-reps->sales': 2,"),
    'module-boundary frontend table must keep its own delivery-reps->sales edge at 2',
  );

  // 7. The boundary pins record the break.
  assert.ok(
    !backendTable.includes("'sales->delivery-reps':"),
    'module-boundary must no longer pin a sales->delivery-reps edge',
  );
  assert.ok(
    !backendPairs.includes("'delivery-reps|sales'"),
    'module-boundary must no longer list the delivery-reps|sales pair',
  );
  assert.ok(
    backendPairs.includes('PINNED_BACKEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
    'module-boundary backend bidirectional list must now be empty (no pairs remain)',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary backend total is now 738 (B7 pinned 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 63 (B7 pinned 64; B8 re-pins 64 -> 63)',
  );

  // 8. The doors doc retires the van-trip-counters row (the only door
  // row of the three moved files); the delivery-reps section keeps its
  // heading and the intended door drops from 3 files to 2.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  const repsSection = doors.slice(
    doors.indexOf('### backend/delivery-reps'),
    doors.indexOf('### backend/gcc-shipping'),
  );
  assert.ok(
    !repsSection.includes('van-trip-counters.engine` — 2 statement'),
    'MODULE_DOORS.md must no longer list the van-trip-counters door row',
  );
  assert.ok(
    repsSection.includes('plus the 2 file(s) above'),
    'MODULE_DOORS.md delivery-reps door must now be the Nest module file plus the 2 file(s) above',
  );
  assert.ok(
    !repsSection.includes('plus the 3 file(s) above'),
    'MODULE_DOORS.md delivery-reps door must no longer claim 3 files above',
  );

  // 9. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B8-DELIVERY-REPS-SALES-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B8 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F2-FEATURE-PUBLIC-INDICES/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the B8 INV exactly once');

  // 10. The B1/B2/B3/B4/B5/B6/B7 specs re-pin their boundary assertions to the B8 numbers.
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('const PINNED_BACKEND_TOTAL = 738;'),
      `${label} spec must re-pin the backend total 746 -> 738`,
    );
    assert.ok(
      src.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      `${label} spec must re-pin the backend edge table 64 -> 63 edges`,
    );
  }

  // 11. Wiring: both critical lists carry 378 specs in identical order, the F2 spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 378);
  assert.equal(chain.length, 378);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 377 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f2-feature-public-indices.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f2-feature-public-indices.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 378);') && src.includes('assert.equal(chain.length, 378);'),
      `${label} spec wiring must re-pin to 377`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f2-feature-public-indices.spec.ts'"),
      `${label} spec last-entry must re-pin to the B8 spec`,
    );
  }

  // 12. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the B7 spec. (The
  // live tree holds ~46 files asserting the count — the #264-fix /
  // D12 lesson. The B7 filename and the count literals are built by
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

  // 13. The guard tail holds ONLY the newest id, so B8 re-pins the
  // B3/B4/B5/B6/B7 specs' guard assertions to the B8 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F2-FEATURE-PUBLIC-INDICES/g)'),
      `${label} spec guard assertion must re-pin to the B8 INV`,
    );
  }

  console.log(
    'phase1 B8 delivery-reps|sales decoupling checks passed (377 specs wired, last pair gone, cap/gate/trip math identical through shared)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
