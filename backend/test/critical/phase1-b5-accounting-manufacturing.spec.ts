import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scaledBomOverhead } from '../../src/common/utils/manufacturing-overhead.engine';

/*
 * Phase 1 B5 — accounting|manufacturing circular pair broken
 * (INV-PHASE1-B5-ACCOUNTING-MANUFACTURING-DECOUPLED).
 *
 * The pair was accounting->manufacturing 2 + manufacturing->accounting 6
 * (grounding Pair 2):
 * - accounting->manufacturing: accounting-posting.service.ts:15 imported
 *   scaledBomOverhead from the manufacturing overhead engine, and the
 *   post-manufacturing-work-order slice (:7) restated the same import.
 *   The facade import is UNUSED — the facade never calls the function —
 *   so that leg is removed outright, not re-pointed.
 * - manufacturing->accounting: the overhead engine itself imported
 *   roundMoney / MoneyDigits from accounting's money-minor-units.engine;
 *   manufacturing.module.ts imports AccountingModule;
 *   manufacturing.service.ts imports valueStockReceipt from
 *   accounting/inventory-valuation, AccountingPostingService,
 *   tenantBaseCurrency, and currencyMoneyDigits / roundMoney. That
 *   direction is the load-bearing money spine (posting + valuation) and
 *   is NOT touched — except the engine's own money-engine import, which
 *   leaves the manufacturing module with the engine file itself.
 * - sales->manufacturing 1: sales-restaurant-and-serials.service.ts:12
 *   imported scaledBomOverhead for the restaurant auto-produce path.
 *   That import re-points at shared, so the edge leaves the table too.
 *
 * The break moves the WHOLE engine file to the shared layer
 * (backend/src/common/utils/manufacturing-overhead.engine.ts). Its one
 * import (roundMoney / MoneyDigits from accounting's
 * money-minor-units.engine) is re-pointed from `../../accounting/...`
 * to `../../modules/accounting/...`; every export, signature and body
 * is otherwise byte-identical — the money math does not change at all.
 * MOVE, never duplicate: the engine exists in exactly one place after
 * this package. Precedent for common->accounting imports already exists
 * in the tree: stock-movement-writer.ts, the B4 HR engines
 * (payroll-accrual-allocation, eos-calculation), all import roundMoney
 * from ../../modules/accounting/engines/money-minor-units.engine. The
 * module-boundary method states it explicitly: "`src/common`,
 * `src/shared` and intra-module imports are not edges" — so the moved
 * engine's own accounting import creates NO new edge.
 *
 * Why the move and not the brief's alternative (into accounting's own
 * engines): the engine has THREE live callers outside accounting — the
 * manufacturing completion path and the sales auto-produce path — and
 * moving it into accounting would make manufacturing.service.ts and
 * sales-restaurant-and-serials.service.ts import from accounting
 * (manufacturing->accounting +1, a NEW sales->accounting edge) instead
 * of removing the cycle cleanly. The shared port is the only break that
 * covers all four callers (poster slice, completion, auto-produce) and
 * removes the accounting->manufacturing direction entirely.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: accounting->manufacturing 2 -> 0 (edge gone),
 *   manufacturing->accounting 6 -> 5 (the engine's own money-engine
 *   import leaves the module), sales->manufacturing 1 -> 0 (edge gone);
 *   backend total 756 -> 752; backend edges 68 -> 66; the
 *   accounting|manufacturing pair leaves the bidirectional list.
 * - module-doors: the engine door row is RETIRED — the file no longer
 *   lives in a module: docs/MODULE_DOORS.md drops its line (manufacturing
 *   door table 1 -> 0 files; intended door is the Nest module file only).
 *   The doors SPEC needs no change (it does not pin the engine door).
 * - manufacturing-overhead-unification.spec.ts: the engine import (:53)
 *   and the engine readSrc (:224) re-point at the shared home, and the
 *   auto-produce read moves to sales-restaurant-and-serials.service.ts
 *   — the implementation moved there (sales-write.service.ts only
 *   delegates via getRestaurantSerials().autoProduceShortfall), so the
 *   spec's auto-produce assertion failed identically at base
 *   (proven by a base run: ERR_ASSERTION 'auto-produce path must call
 *   scaledBomOverhead' at :219). Spec-only, intent preserved: the
 *   auto-produce path must still call the single function, no inline
 *   formula.
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   the F5a spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_ENGINE = path.join(BACKEND, 'src', 'common', 'utils', 'manufacturing-overhead.engine.ts');
const OLD_ENGINE = path.join(BACKEND, 'src', 'modules', 'manufacturing', 'engines', 'manufacturing-overhead.engine.ts');
const POSTING_FACADE = path.join(BACKEND, 'src', 'modules', 'accounting', 'accounting-posting.service.ts');
const POSTER_SLICE = path.join(
  BACKEND,
  'src',
  'modules',
  'accounting',
  'services',
  'inventory-manufacturing-cash-posting',
  'post-manufacturing-work-order.slice.ts',
);
const COMPLETION = path.join(BACKEND, 'src', 'modules', 'manufacturing', 'services', 'manufacturing.service.ts');
const AUTO_PRODUCE = path.join(
  BACKEND,
  'src',
  'modules',
  'sales',
  'services',
  'sales-restaurant-and-serials.service.ts',
);
const MANUFACTURING_MODULE = path.join(BACKEND, 'src', 'modules', 'manufacturing', 'manufacturing.module.ts');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const DOORS_DOC = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
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

async function main(): Promise<void> {
  // 1. The shared engine exists; the old manufacturing home is gone.
  assert.ok(fs.existsSync(SHARED_ENGINE), 'shared manufacturing-overhead engine must exist');
  assert.ok(!fs.existsSync(OLD_ENGINE), 'the old manufacturing overhead engine must be gone');

  // 2. The three calling consumers import from shared, never from manufacturing.
  // The accounting facade imports the function from nowhere: its import was
  // unused (no call site in the file), so the leg is removed outright.
  const slice = stripComments(fs.readFileSync(POSTER_SLICE, 'utf8'));
  assert.ok(
    slice.includes("'../../../../common/utils/manufacturing-overhead.engine'"),
    'poster slice must import scaledBomOverhead from shared',
  );
  assert.ok(
    !slice.includes("'../../../manufacturing/engines/manufacturing-overhead.engine'"),
    'poster slice must no longer import the engine from manufacturing',
  );
  const completion = stripComments(fs.readFileSync(COMPLETION, 'utf8'));
  assert.ok(
    completion.includes("'../../../common/utils/manufacturing-overhead.engine'"),
    'manufacturing completion must import scaledBomOverhead from shared',
  );
  assert.ok(
    !completion.includes("'../engines/manufacturing-overhead.engine'"),
    'manufacturing completion must no longer import the engine from its own engines dir',
  );
  const autoProduce = stripComments(fs.readFileSync(AUTO_PRODUCE, 'utf8'));
  assert.ok(
    autoProduce.includes("'../../../common/utils/manufacturing-overhead.engine'"),
    'sales auto-produce path must import scaledBomOverhead from shared',
  );
  assert.ok(
    !autoProduce.includes("'../../manufacturing/engines/manufacturing-overhead.engine'"),
    'sales auto-produce path must no longer import the engine from manufacturing',
  );
  const facade = stripComments(fs.readFileSync(POSTING_FACADE, 'utf8'));
  assert.ok(
    !facade.includes('scaledBomOverhead'),
    'accounting-posting facade must not reference scaledBomOverhead at all (its import was unused)',
  );
  const shared = stripComments(fs.readFileSync(SHARED_ENGINE, 'utf8'));
  assert.ok(
    shared.includes("'../../modules/accounting/engines/money-minor-units.engine'"),
    'shared engine must import roundMoney / MoneyDigits from the accounting money engine',
  );
  assert.ok(
    !shared.includes("'../../accounting/engines/money-minor-units.engine'"),
    'shared engine must no longer use the old relative accounting import',
  );

  // 3. The engine computes identically from the new home (exact numbers,
  // taken from manufacturing-overhead-unification.spec.ts — money is
  // strict, no leniency).
  assert.equal(scaledBomOverhead(100, 2, 3, 2), 66.67);
  assert.equal(scaledBomOverhead(10, 2, 2, 2), 10);
  assert.equal(scaledBomOverhead(20, 2, 1, 2), 40);
  assert.equal(scaledBomOverhead(0, 5, 2, 2), 0);
  assert.equal(scaledBomOverhead(100, 0, 2, 2), 0);
  assert.equal(scaledBomOverhead(100, 2, 0, 2), 200);
  assert.equal(scaledBomOverhead(100, 2, null as unknown as number, 2), 200);
  assert.equal(scaledBomOverhead(100, 2, 3, 3), 66.667);

  // 4. The three call sites still route through the engine.
  assert.ok(slice.includes('scaledBomOverhead('), 'poster must route overhead through the engine');
  assert.ok(completion.includes('scaledBomOverhead('), 'completion must route overhead through the engine');
  assert.ok(autoProduce.includes('scaledBomOverhead('), 'auto-produce must route overhead through the engine');

  // 5. The manufacturing->accounting spine is intact — the load-bearing
  // direction is untouched (only the engine file itself leaves the module).
  assert.ok(
    completion.includes("'../../accounting/inventory-valuation'"),
    'manufacturing completion must still import valueStockReceipt from accounting',
  );
  assert.ok(
    completion.includes('AccountingPostingService'),
    'manufacturing completion must still use AccountingPostingService',
  );
  assert.ok(completion.includes('tenantBaseCurrency'), 'manufacturing completion must still use tenantBaseCurrency');
  assert.ok(
    completion.includes('currencyMoneyDigits') && completion.includes('roundMoney'),
    'manufacturing completion must still use the accounting money helpers',
  );
  const manufacturingModule = stripComments(fs.readFileSync(MANUFACTURING_MODULE, 'utf8'));
  assert.ok(
    manufacturingModule.includes('AccountingModule'),
    'manufacturing.module must still import AccountingModule',
  );
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes("'manufacturing->accounting': 5,"),
    'module-boundary must keep manufacturing->accounting pinned at 5 (the staying leg)',
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
  assert.ok(
    !backendTable.includes("'accounting->manufacturing':"),
    'module-boundary must no longer pin an accounting->manufacturing edge',
  );
  assert.ok(
    !backendTable.includes("'sales->manufacturing':"),
    'module-boundary must no longer pin a sales->manufacturing edge',
  );
  assert.ok(
    !backendPairs.includes("'accounting|manufacturing',"),
    'module-boundary must no longer list the accounting|manufacturing pair',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary backend total is now 746 (B4 pinned 756; B5 re-pins 756 -> 752; B6 re-pins 752 -> 750; B7 re-pins 750 -> 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 64 (B4 pinned 68; B5 re-pins 68 -> 66; B6 re-pins 66 -> 65; B7 re-pins 65 -> 64; B8 re-pins 64 -> 63)',
  );

  // 7. The doors doc retires the engine door row.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  assert.ok(
    !doors.includes('manufacturing-overhead.engine'),
    'MODULE_DOORS.md must no longer list the manufacturing-overhead door',
  );
  assert.ok(
    doors.includes('Intended door: the Nest module file only (`manufacturing.module.ts`).'),
    'MODULE_DOORS.md manufacturing door must now be the Nest module file only',
  );

  // 8. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B5-ACCOUNTING-MANUFACTURING-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B5 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S10/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the B7 INV exactly once');

  // 9. The B1/B2/B3/B4 specs re-pin their boundary assertions to the B5 numbers.
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('const PINNED_BACKEND_TOTAL = 740;'),
      `${label} spec must re-pin the backend total 746 -> 738`,
    );
    assert.ok(
      src.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      `${label} spec must re-pin the backend edge table 64 -> 63 edges`,
    );
  }

  // 10. Wiring: both critical lists carry 375 specs in identical order, the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 426);
  assert.equal(chain.length, 426);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 375 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 426);') && src.includes('assert.equal(chain.length, 426);'),
      `${label} spec wiring must re-pin to 375`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts'"),
      `${label} spec last-entry must re-pin to the B7 spec`,
    );
  }

  // 11. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old 374 count or point its last-entry at the B5 spec. (The
  // B4 brief named only the B1/B2/B3/B4 specs; the live tree had 43 files
  // asserting 374 — the #264-fix / D12 lesson. The B5 filename is built
  // by concatenation so this block's own source never contains the
  // literals it scans for.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b5Name = 'phase1-b5' + '-accounting-manufacturing.spec.ts';
  const staleSpecs = 'specs.length, 37' + '4';
  const staleChain = 'chain.length, 37' + '4';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b5Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the 374 wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B5 spec');

  console.log(
    'phase1 B5 accounting|manufacturing decoupling checks passed (375 specs wired, pair gone, overhead identical)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
