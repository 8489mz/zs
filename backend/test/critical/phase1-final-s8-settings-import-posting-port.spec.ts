import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import {
  SettingsImportOpeningBalances,
  type OpeningStockPostingPort,
} from '../../src/modules/settings/services/settings-import/settings-import-opening-balances';
import type { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { stockMovementTotal } from '../../src/modules/catalog/engines/stock-movement-total.engine';

/*
 * Phase 1 final-inspection slice 8 — cap reduction, one unit only:
 * the external-import count into the posting service 98 -> 97.
 *
 * DECISION (recorded): the posting cap, not the frontend as-any cap.
 * The frontend count is still 1510 and the backend 376 (recounted on
 * the slice-7 tree with the cleanup spec's own method); removing a
 * frontend cast proves its type-safety only in CI typecheck, while
 * this unit is fully provable locally — backend tsc proves the real
 * service satisfies the new port at the call site, and this spec
 * drives the real class on PGlite. The as-any cap stays 1510 for a
 * later slice; the three other type-only posting imports (two van
 * deps-types files and the field-sale internal helper) stay for
 * later cap-reduction slices too.
 *
 * WHAT THIS PINS, driving the REAL SettingsImportOpeningBalances
 * on PGlite (the port dependency is a recording stub — the class
 * under test is production code, and the stub only stands in for
 * the injected collaborator):
 * - §1: the opening-stock journal still posts through the port —
 *   increase posts Dr 1140 / Cr 3100 at tenant book digits (3dp
 *   tenant: 3 x 33.375 = 100.125; 2dp tenant: 3 x 33.375 = 100.13,
 *   both equal to the production stock-movement engine's value),
 *   a decrease mirrors the legs, a zero-value import posts
 *   nothing, a missing posting service fails closed with the
 *   ledger-unavailable code, and missing accounts fail closed
 *   with the account-missing code. The real posting service
 *   satisfies the port structurally (compile-time assignment in
 *   this section, proven by backend tsc and by ts-node running
 *   this spec — it is not a runtime proof).
 * - §2: static pins — the port type, the constructor taking the
 *   port, no reference to the concrete posting-service module in
 *   the file, and the caller still passing the real service.
 * - §3: the focused count — exactly 97 import statements into the
 *   posting service from non-accounting modules (the opening-
 *   balances file no longer among them), and the boundary pin
 *   lowered to 97. The boundary spec is the second, independent
 *   counter for the same number (it runs in the gates loop).
 * - §4: the INV entry exists exactly once in both places.
 * - §5: wiring 414 in both lists, this spec last.
 * - §6: the re-pin sweep is complete (no stale count,
 *   last-entry or guard id remains).
 * - §7: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §8: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5,
 *   posting pin 97, settings->accounting table 14)
 *   and the "highest migration" pins stay at 0345 (no
 *   migration in this package).
 *
 * Deliberately NOT re-driven here (pinned by their own specs):
 * the customer/supplier opening-balance ledger writes (the
 * opening-balances ledger spec) and the full posting-service
 * journal validation (the posting specs).
 *
 * RED-1: run this spec BEFORE the port exists (with the pin still
 * 98) — §1 fails on the missing port type, §2 fails on the
 * concrete import, §3 fails on the count 98. §4 fails on the
 * missing INV.
 * PGlite note: every read runs on the pool outside a transaction
 * — the class is driven with the pool handle directly, never a
 * pool read inside an open transaction.
 *
 * Wiring: both critical lists carry 414 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const BACKEND_SRC = path.join(BACKEND, 'src');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const OPENING_BALANCES = path.join(
  BACKEND_SRC,
  'modules',
  'settings',
  'services',
  'settings-import',
  'settings-import-opening-balances.ts',
);
const SETTINGS_IMPORT_SERVICE = path.join(BACKEND_SRC, 'modules', 'settings', 'services', 'settings-import.service.ts');
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
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const S2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s5-business-date-r3.spec.ts');
const S6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s6-import-fx-payout-idempotency.spec.ts');
const S7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s7-marketplace-webhook-map-row.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');

const NEW_INV = 'INV-SETTINGS-IMPORT-POSTING-PORT';

const TENANT = 't-s8';
const ACCOUNT = 'a-s8';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-s8',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

type RecordedCall = {
  params: Parameters<OpeningStockPostingPort['postDomainJournal']>[1];
};

function recordingPort(): { port: OpeningStockPostingPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const port: OpeningStockPostingPort = {
    postDomainJournal: async (_queryable, params) => {
      calls.push({ params });
      return 7;
    },
  };
  return { port, calls };
}

async function makeOpeningDb(currency: string): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
  `);
  const anyDb = db as any;
  await anyDb
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'currency', value: JSON.stringify(currency) })
    .execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('accounting_accounts')
    .values([
      { id: 1140, tenant_id: TENANT, code: '1140', is_active: true },
      { id: 3100, tenant_id: TENANT, code: '3100', is_active: true },
    ])
    .execute();
  return { pg, db };
}

function makeBalances(port?: OpeningStockPostingPort): SettingsImportOpeningBalances {
  return new SettingsImportOpeningBalances(
    {
      scope: () => ({ tenantId: TENANT, accountId: ACCOUNT }),
      tenantFields: () => ({ tenant_id: TENANT, account_id: ACCOUNT }),
    },
    port,
  );
}

function countPostingImports(): { files: string[]; statements: number } {
  const modulesDir = path.join(BACKEND_SRC, 'modules');
  const files: string[] = [];
  let statements = 0;
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(p);
      } else if (entry.isFile() && p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
        const mod = path.relative(modulesDir, p).split(path.sep)[0];
        if (mod === 'accounting') continue;
        const src = fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\n)\s*\/\/.*$/gm, '$1');
        const hits = src.match(/from\s+['"][^'"]*accounting-posting\.service['"]/g) ?? [];
        if (hits.length > 0) {
          files.push(path.relative(REPO_ROOT, p));
          statements += hits.length;
        }
      }
    }
  };
  walk(modulesDir);
  return { files, statements };
}

async function main(): Promise<void> {
  // §1: The opening-stock journal still posts through the port —
  // the REAL class on PGlite, the port a recording stub.
  {
    // (a) Increase on a 3-digit tenant: 3 x 33.375 = 100.125.
    {
      const { db } = await makeOpeningDb('KWD');
      try {
        const { port, calls } = recordingPort();
        const balances = makeBalances(port);
        await balances.postImportedOpeningStock(db as never, {
          productId: 9,
          signedQty: 3,
          unitCost: 33.375,
          locationId: null,
          branchId: null,
          sourceType: 'import-opening-stock',
          sourceId: 42,
          actor: auth(TENANT),
        });
        assert.equal(calls.length, 1, 'one journal posts for an increase');
        const params = calls[0].params;
        assert.equal(params.sourceType, 'import-opening-stock');
        assert.equal(params.sourceId, 42);
        assert.equal(params.tenantId, TENANT);
        assert.equal(params.accountId, ACCOUNT);
        assert.equal(params.createdBy, 1);
        assert.ok(params.entryDate instanceof Date, 'the entry date is an instant');
        assert.equal(params.lines.length, 2);
        const expected = stockMovementTotal(3, 33.375, 3);
        assert.equal(expected, 100.125, 'the production engine values the movement at 100.125');
        assert.equal(params.lines[0].accountId, 1140);
        assert.equal(params.lines[0].debit, expected);
        assert.equal(params.lines[0].credit, 0);
        assert.equal(params.lines[1].accountId, 3100);
        assert.equal(params.lines[1].debit, 0);
        assert.equal(params.lines[1].credit, expected);
      } finally {
        await db.destroy();
      }
    }
    // (b) Decrease mirrors the legs: Dr 3100 / Cr 1140.
    {
      const { db } = await makeOpeningDb('KWD');
      try {
        const { port, calls } = recordingPort();
        const balances = makeBalances(port);
        await balances.postImportedOpeningStock(db as never, {
          productId: 9,
          signedQty: -2,
          unitCost: 10,
          locationId: null,
          branchId: null,
          sourceType: 'import-opening-stock',
          sourceId: 43,
          actor: auth(TENANT),
        });
        assert.equal(calls.length, 1, 'one journal posts for a decrease');
        const params = calls[0].params;
        assert.equal(params.lines[0].accountId, 3100);
        assert.equal(params.lines[0].debit, stockMovementTotal(-2, 10, 3) * -1);
        assert.equal(params.lines[0].credit, 0);
        assert.equal(params.lines[1].accountId, 1140);
        assert.equal(params.lines[1].debit, 0);
        assert.equal(params.lines[1].credit, 20);
      } finally {
        await db.destroy();
      }
    }
    // (c) A zero-value import posts nothing.
    {
      const { db } = await makeOpeningDb('KWD');
      try {
        const { port, calls } = recordingPort();
        const balances = makeBalances(port);
        await balances.postImportedOpeningStock(db as never, {
          productId: 9,
          signedQty: 0,
          unitCost: 33.375,
          locationId: null,
          branchId: null,
          sourceType: 'import-opening-stock',
          sourceId: 44,
          actor: auth(TENANT),
        });
        assert.equal(calls.length, 0, 'a zero-value import posts no journal');
      } finally {
        await db.destroy();
      }
    }
    // (d) No posting service fails closed with the ledger code.
    {
      const { db } = await makeOpeningDb('KWD');
      try {
        const balances = makeBalances();
        await assert.rejects(
          balances.postImportedOpeningStock(db as never, {
            productId: 9,
            signedQty: 1,
            unitCost: 10,
            locationId: null,
            branchId: null,
            sourceType: 'import-opening-stock',
            sourceId: 45,
            actor: auth(TENANT),
          }),
          (error: unknown) => (error as { code?: string }).code === 'OPENING_STOCK_LEDGER_UNAVAILABLE',
          'a missing posting service must fail with the ledger-unavailable code',
        );
      } finally {
        await db.destroy();
      }
    }
    // (e) Missing accounts fail closed with the account code.
    {
      const { db } = await makeOpeningDb('KWD');
      try {
        await (db as any).deleteFrom('accounting_accounts').where('code', '=', '3100').execute();
        const { port, calls } = recordingPort();
        const balances = makeBalances(port);
        await assert.rejects(
          balances.postImportedOpeningStock(db as never, {
            productId: 9,
            signedQty: 1,
            unitCost: 10,
            locationId: null,
            branchId: null,
            sourceType: 'import-opening-stock',
            sourceId: 46,
            actor: auth(TENANT),
          }),
          (error: unknown) => (error as { code?: string }).code === 'OPENING_STOCK_ACCOUNT_MISSING',
          'missing accounts must fail with the account-missing code',
        );
        assert.equal(calls.length, 0, 'no journal posts when the accounts are missing');
      } finally {
        await db.destroy();
      }
    }
    // (f) A 2-digit tenant rounds at its own book digits: 3 x 33.375 = 100.13.
    {
      const { db } = await makeOpeningDb('EGP');
      try {
        const { port, calls } = recordingPort();
        const balances = makeBalances(port);
        await balances.postImportedOpeningStock(db as never, {
          productId: 9,
          signedQty: 3,
          unitCost: 33.375,
          locationId: null,
          branchId: null,
          sourceType: 'import-opening-stock',
          sourceId: 47,
          actor: auth(TENANT),
        });
        assert.equal(calls.length, 1, 'one journal posts for the 2-digit tenant');
        assert.equal(calls[0].params.lines[0].debit, stockMovementTotal(3, 33.375, 2));
        assert.equal(calls[0].params.lines[0].debit, 100.13, 'the 2-digit tenant rounds to 100.13');
      } finally {
        await db.destroy();
      }
    }
    // (g) Compile-time proof: the real posting service satisfies
    // the port structurally. This assignment is checked by backend
    // tsc and by ts-node running this spec; at runtime it is just
    // a null checked for its type.
    const _realServiceSatisfiesPort: OpeningStockPostingPort = null as unknown as AccountingPostingService;
    assert.equal(
      typeof _realServiceSatisfiesPort,
      'object',
      'the real posting service must satisfy the port structurally',
    );
    console.log('  ✓ §1 opening-stock journal posts through the port at tenant book digits');
  }

  // §2: Static pins — the port type, the constructor taking the
  // port, no reference to the concrete posting-service module in
  // the file, and the caller still passing the real service.
  {
    const src = fs.readFileSync(OPENING_BALANCES, 'utf8');
    assert.ok(src.includes('export type OpeningStockPostingPort = {'), 'the port type must be exported');
    assert.ok(src.includes('postDomainJournal('), 'the port must declare postDomainJournal');
    assert.ok(
      src.includes('private readonly accountingPosting?: OpeningStockPostingPort,'),
      'the constructor must take the port, not the concrete service',
    );
    assert.ok(!src.includes('accounting-posting.service'), 'the file must not import the posting-service module');
    assert.ok(!src.includes('AccountingPostingService'), 'the file must not name the concrete service type');
    const caller = fs.readFileSync(SETTINGS_IMPORT_SERVICE, 'utf8');
    assert.ok(
      caller.includes("import { AccountingPostingService } from '../../accounting/accounting-posting.service';"),
      'the caller must still import the real service',
    );
    assert.ok(
      caller.includes('new SettingsImportOpeningBalances('),
      'the caller must still construct the opening-balances helper',
    );
    assert.ok(caller.includes('this.accountingPosting,'), 'the caller must still pass the real service in');
    console.log('  ✓ §2 port type + constructor + caller pins');
  }

  // §3: The focused count — exactly 97 import statements into the
  // posting service from non-accounting modules, and the boundary
  // pin lowered to 97.
  {
    const { files, statements } = countPostingImports();
    assert.equal(statements, 97, `exactly 97 posting-service imports must remain (got ${statements})`);
    assert.equal(files.length, 97, 'each remaining import must live in its own file');
    assert.ok(
      !files.some((f) => f.endsWith('settings-import-opening-balances.ts')),
      'the opening-balances file must no longer import the posting service',
    );
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_POSTING_EXTERNAL = 97;'),
      'module-boundary must pin the posting count 97',
    );
    console.log('  ✓ §3 posting-service import count is exactly 97');
  }

  // §4: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S11/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §5: Wiring: both critical lists carry 414 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 427);
    assert.equal(chain.length, 427);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 414 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
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
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
      ['S7', S7_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 427);') && src.includes('assert.equal(chain.length, 427);'),
        `${label} spec wiring must re-pin to 414`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §6: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-7 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s7-marketplace-webhook-map-' + 'row.spec.ts';
    const prevInv = 'INV-MARKETPLACE-WEBHOOK-' + 'MAP-ROW';
    const staleSpecs = 'specs.length, 41' + '3';
    const staleChain = 'chain.length, 41' + '3';
    const staleList = 'list.length, 41' + '3';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (413)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-7 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 7)');
  }

  // §7: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3/S4/S5/S6/S7 specs' guard assertions to the
  // new INV; their invariants-file assertions still pin their own
  // id (each line stays in ARCHITECTURE_INVARIANTS.md exactly
  // once).
  {
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
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
      ['S7', S7_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S11/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §8: The module-boundary pins do not move in this package
  // except the posting pin itself (98 -> 97, one real import
  // removed; the settings->accounting edge drops 14 -> 13 in
  // actual statements, still under its pinned table value 14).
  // No migration in this package, so the "highest migration"
  // pins stay at 0345 (the two 3dp specs, the S2 spec §5/§10,
  // the S3 spec §9, the S4 spec §4/§9 — including its standalone
  // 0345 literals — the S5 spec §9 and the S6 spec §10).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_POSTING_EXTERNAL = 97;'),
      'module-boundary must pin the posting count 97',
    );
    assert.ok(
      boundary.includes("'settings->accounting': 14,"),
      'module-boundary must still pin the settings->accounting table 14',
    );
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
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
        `${label} spec highest-migration pin must stay at 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must stay at 0345`,
      );
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S2 spec migration-file pin must stay at 0345',
    );
    assert.ok(
      s2Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must stay at 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0345'),
      'S2 spec §10 pin message must stay at 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0345'),
      'S2 spec §10 message must stay at 0345',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S3 spec migration-file pin must stay at 0345',
    );
    assert.ok(s3Src.includes('must re-point to 0345'), 'S3 spec highest-migration assertions must stay at 0345');
    const s4Src = fs.readFileSync(S4_SPEC, 'utf8');
    assert.ok(
      s4Src.includes(
        "import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';",
      ),
      'S4 spec must still drive the real 0344 migration (its own migration under test)',
    );
    assert.ok(s4Src.includes('files[files.length - 1],'), 'S4 spec §4 must still compare the highest file on disk');
    assert.ok(
      s4Src.includes("'2040000000345_import_fx_payout_idempotency_keys.ts',"),
      'S4 spec §4 highest-migration literal must stay at 0345',
    );
    assert.ok(
      s4Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must stay at 0345',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0345'),
      'S4 spec §9 pin message must stay at 0345',
    );
    const s5Src = fs.readFileSync(S5_SPEC, 'utf8');
    assert.ok(
      s5Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S5 spec migration-file pin must stay at 0345',
    );
    assert.ok(s5Src.includes('must re-point to 0345'), 'S5 spec highest-migration assertions must stay at 0345');
    const s6Src = fs.readFileSync(S6_SPEC, 'utf8');
    assert.ok(
      s6Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S6 spec migration-file pin must stay at 0345',
    );
    assert.ok(s6Src.includes('must re-point to 0345'), 'S6 spec highest-migration assertions must stay at 0345');
  }

  console.log('phase1 final slice 8 checks passed (settings import posting port, 414 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
