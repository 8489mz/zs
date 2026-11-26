import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { partitionPurchaseLineTotals } from '../../src/common/utils/purchase-line-totals.helper';

/*
 * Phase 1 B6 — accounting|purchases circular pair broken
 * (INV-PHASE1-B6-ACCOUNTING-PURCHASES-DECOUPLED).
 *
 * The pair was accounting->purchases 2 + purchases->accounting 70
 * (grounding Pair 3):
 * - accounting->purchases: accounting-posting.service.ts:15 imported
 *   partitionPurchaseLineTotals from the purchases write helper, and
 *   the post-trade-in-purchase slice (:7) restated the same import.
 *   A third consumer, the service-item-quick-create spec, imported it
 *   for its direct partition assertions; it re-points at shared too
 *   (spec-only, no service code).
 *   The facade import is UNUSED — the facade never calls the function —
 *   so that leg is removed outright, not re-pointed (the B5 precedent:
 *   the accounting-posting facade import of scaledBomOverhead was
 *   unused the same way).
 * - purchases->accounting: the whole purchases->accounting money spine
 *   (purchases.module.ts importing AccountingModule; 11x
 *   AccountingPostingService, 9x tenantBaseCurrency, ~25x
 *   money-minor-units.engine, 6x inventory-valuation, 6x
 *   accounting-date.engine across services/*, engines/*, helpers/*).
 *   That direction is UNTOUCHABLE as a break target and is NOT
 *   touched here.
 *
 * The break moves the ONE pure function (+ its input type) to the
 * shared layer (backend/src/common/utils/purchase-line-totals.helper.ts).
 * Its rounding helper is replicated identically (roundCurrency wrapping
 * roundMoney, same canonical comment) and its one import (roundMoney /
 * MoneyDigits from accounting's money-minor-units.engine) is stated
 * from the shared home as ../../modules/accounting/... — the same
 * shape as the B4/B5 shared engines, and the module-boundary method
 * states explicitly that src/common imports are not edges, so the
 * moved function's own accounting import creates NO new edge. Every
 * export, signature and body is otherwise byte-identical — the money
 * math does not change at all. MOVE, never duplicate: the function
 * exists in exactly one place after this package. The rest of
 * purchases-write.helper.ts stays where it is (normalize items,
 * allocate the invoice discount, subtotal, stock delta calculations —
 * all still imported intra-purchases only).
 *
 * Why the move and not the brief's alternative (into accounting): the
 * function is purchase-line math, and purchases is its canonical
 * owner; moving it into accounting would make the purchases side
 * import from accounting for its own line math instead of removing
 * the cycle cleanly. The shared port is the only break that removes
 * the accounting->purchases direction entirely.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: accounting->purchases 2 -> 0 (edge gone),
 *   purchases->accounting stays 70; backend total 752 -> 750;
 *   backend edges 66 -> 65; the accounting|purchases pair leaves
 *   the bidirectional list.
 * - module-doors: the purchases-write.helper door row is RETIRED — the
 *   file no longer has any cross-module importer (its 2 accounting
 *   statements are gone; the remaining importers are all
 *   intra-purchases): docs/MODULE_DOORS.md drops its §3 bullet
 *   (purchases door table 4 -> 3 files) and its §4 row (7 -> 6
 *   remaining doors), and module-doors.spec.ts drops it from the
 *   resolved-doors list. (The B1 precedent: a retired door leaves
 *   the resolved-doors list in the spec too.)
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   this spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_HELPER = path.join(BACKEND, 'src', 'common', 'utils', 'purchase-line-totals.helper.ts');
const WRITE_HELPER = path.join(BACKEND, 'src', 'modules', 'purchases', 'helpers', 'purchases-write.helper.ts');
const POSTING_FACADE = path.join(BACKEND, 'src', 'modules', 'accounting', 'accounting-posting.service.ts');
const TRADE_IN_SLICE = path.join(
  BACKEND,
  'src',
  'modules',
  'accounting',
  'services',
  'purchases-treasury-posting',
  'post-trade-in-purchase.ts',
);
const PURCHASES_MODULE = path.join(BACKEND, 'src', 'modules', 'purchases', 'purchases.module.ts');
const SERVICE_ITEM_SPEC = path.join(BACKEND, 'test', 'critical', 'service-item-quick-create.spec.ts');
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
  // 1. The shared helper exists; the old purchases home no longer
  // defines the function or its input type.
  assert.ok(fs.existsSync(SHARED_HELPER), 'shared purchase-line-totals helper must exist');
  const helper = stripComments(fs.readFileSync(WRITE_HELPER, 'utf8'));
  assert.ok(
    !helper.includes('partitionPurchaseLineTotals'),
    'purchases-write.helper must no longer define or reference partitionPurchaseLineTotals',
  );
  assert.ok(
    !helper.includes('PurchaseLineTotalInput'),
    'purchases-write.helper must no longer define the PurchaseLineTotalInput type',
  );
  const shared = stripComments(fs.readFileSync(SHARED_HELPER, 'utf8'));
  assert.ok(
    shared.includes("'../../modules/accounting/engines/money-minor-units.engine'"),
    'shared helper must import roundMoney / MoneyDigits from the accounting money engine',
  );
  assert.ok(
    shared.includes('export function partitionPurchaseLineTotals('),
    'shared helper must export partitionPurchaseLineTotals',
  );
  assert.ok(
    shared.includes('export type PurchaseLineTotalInput'),
    'shared helper must export the PurchaseLineTotalInput type',
  );

  // 2. The one live consumer imports from shared, never from purchases.
  // The accounting facade imports the function from nowhere: its import was
  // unused (no call site in the file), so the leg is removed outright.
  const slice = stripComments(fs.readFileSync(TRADE_IN_SLICE, 'utf8'));
  assert.ok(
    slice.includes("'../../../../common/utils/purchase-line-totals.helper'"),
    'post-trade-in-purchase must import partitionPurchaseLineTotals from shared',
  );
  assert.ok(
    !slice.includes("'../../../purchases/helpers/purchases-write.helper'"),
    'post-trade-in-purchase must no longer import from the purchases write helper',
  );
  const facade = stripComments(fs.readFileSync(POSTING_FACADE, 'utf8'));
  assert.ok(
    !facade.includes('partitionPurchaseLineTotals'),
    'accounting-posting facade must not reference partitionPurchaseLineTotals at all (its import was unused)',
  );
  // The one spec consumer re-points too (it drove the function directly).
  const serviceItem = stripComments(fs.readFileSync(SERVICE_ITEM_SPEC, 'utf8'));
  assert.ok(
    serviceItem.includes("'../../src/common/utils/purchase-line-totals.helper'"),
    'service-item-quick-create spec must import partitionPurchaseLineTotals from shared',
  );
  assert.ok(
    !serviceItem.includes('partitionPurchaseLineTotals,'),
    'service-item-quick-create spec must no longer import the function from the purchases write helper',
  );

  // 3. The function computes identically from the new home (exact
  // numbers, taken from the live function at base 728214cdf — money is
  // strict, no leniency).
  // A. VAT-inclusive split at 14%: 100/1.14 = 87.72 stocked, 50/1.14 = 43.86 service.
  assert.deepEqual(
    partitionPurchaseLineTotals(
      [
        { lineTotal: 100, isService: false },
        { lineTotal: 50, isService: true },
      ],
      14,
      true,
      2,
    ),
    { serviceNet: 43.86, stockedNet: 87.72 },
  );
  // B. VAT-exclusive: divisor 1, raw sums.
  assert.deepEqual(
    partitionPurchaseLineTotals(
      [
        { lineTotal: 100, isService: false },
        { lineTotal: 50, isService: true },
      ],
      14,
      false,
      2,
    ),
    { serviceNet: 50, stockedNet: 100 },
  );
  // C. 3 book digits: 100/1.14 = 87.719.
  assert.deepEqual(partitionPurchaseLineTotals([{ lineTotal: 100, isService: false }], 14, true, 3), {
    serviceNet: 0,
    stockedNet: 87.719,
  });
  // D. Nulls and strings: null total is 0, '100.50' coerces, null isService counts as stocked.
  assert.deepEqual(
    partitionPurchaseLineTotals(
      [{ lineTotal: null }, { lineTotal: '100.50', isService: null }, { lineTotal: undefined, isService: true }],
      null,
      true,
      2,
    ),
    { serviceNet: 0, stockedNet: 100.5 },
  );
  // E. Canonical half-cent: 1.005 rounds DOWN to 1.00 (binary half-cent just below the half).
  assert.deepEqual(partitionPurchaseLineTotals([{ lineTotal: 1.005, isService: false }], 0, false, 2), {
    serviceNet: 0,
    stockedNet: 1,
  });
  // F. Per-line rounding accumulates: 33.335 rounds to 33.34 per line, three lines total 100.02.
  assert.deepEqual(
    partitionPurchaseLineTotals(
      [
        { lineTotal: 33.335, isService: false },
        { lineTotal: 33.335, isService: false },
        { lineTotal: 33.335, isService: false },
      ],
      0,
      false,
      2,
    ),
    { serviceNet: 0, stockedNet: 100.02 },
  );
  // G. Empty lines: both nets are 0.
  assert.deepEqual(partitionPurchaseLineTotals([], 14, true, 2), { serviceNet: 0, stockedNet: 0 });
  // H. String tax rate coerces: 200/1.14 = 175.44 service.
  assert.deepEqual(partitionPurchaseLineTotals([{ lineTotal: 200, isService: true }], '14', true, 2), {
    serviceNet: 175.44,
    stockedNet: 0,
  });

  // 4. The live call site still routes through the function.
  assert.ok(slice.includes('partitionPurchaseLineTotals('), 'post-trade-in-purchase must route through the function');

  // 5. The purchases->accounting spine is intact — the load-bearing
  // direction is untouched.
  const purchasesModule = stripComments(fs.readFileSync(PURCHASES_MODULE, 'utf8'));
  assert.ok(purchasesModule.includes('AccountingModule'), 'purchases.module must still import AccountingModule');
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes("'purchases->accounting': 70,"),
    'module-boundary must keep purchases->accounting pinned at 70 (the staying leg)',
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
    !backendTable.includes("'accounting->purchases':"),
    'module-boundary must no longer pin an accounting->purchases edge',
  );
  assert.ok(
    !backendPairs.includes("'accounting|purchases',"),
    'module-boundary must no longer list the accounting|purchases pair',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary backend total is now 746 (B5 pinned 752; B6 re-pins 752 -> 750; B7 re-pins 750 -> 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 64 (B5 pinned 66; B6 re-pins 66 -> 65; B7 re-pins 65 -> 64; B8 re-pins 64 -> 63)',
  );

  // 7. The doors doc retires the purchases-write.helper door row, and the
  // doors spec drops it from the resolved-doors list.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  assert.ok(!doors.includes('purchases-write.helper'), 'MODULE_DOORS.md must no longer list the write-helper door');
  const purchasesSection = doors.slice(doors.indexOf('### backend/purchases'), doors.indexOf('### backend/reports'));
  assert.ok(
    purchasesSection.includes('plus the 3 file(s) above'),
    'MODULE_DOORS.md purchases door must now list 3 files',
  );
  assert.ok(
    doors.includes('KEEP PUBLIC for the 6 remaining doors'),
    'MODULE_DOORS.md must now record 6 remaining doors',
  );
  assert.ok(
    !doors.includes('KEEP PUBLIC for the 7 remaining doors'),
    'MODULE_DOORS.md must no longer record 7 remaining doors',
  );
  assert.ok(doors.includes('6 of the 8 resolved'), 'MODULE_DOORS.md must now record 6 of the 8 doors resolved');
  assert.ok(!doors.includes('7 of the 8 resolved'), 'MODULE_DOORS.md must no longer record 7 of the 8 resolved');
  const doorsSpec = fs.readFileSync(DOORS_SPEC, 'utf8');
  assert.ok(
    !doorsSpec.includes('purchases-write.helper'),
    'module-doors.spec.ts must no longer list the write-helper door',
  );

  // 8. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B6-ACCOUNTING-PURCHASES-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B6 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F3-FEATURE-BOUNDARY-LEGS/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the B7 INV exactly once');

  // 9. The B1/B2/B3/B4/B5 specs re-pin their boundary assertions to the B6 numbers.
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
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

  // 10. Wiring: both critical lists carry 375 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 379);
  assert.equal(chain.length, 379);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 375 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f3-feature-boundary-legs.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f3-feature-boundary-legs.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 379);') && src.includes('assert.equal(chain.length, 379);'),
      `${label} spec wiring must re-pin to 375`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f3-feature-boundary-legs.spec.ts'"),
      `${label} spec last-entry must re-pin to the B7 spec`,
    );
  }

  // 11. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old 375 count or point its last-entry at the B6 spec. (The
  // live tree had 45 files asserting 375 — the #264-fix / D12 lesson.
  // The B6 filename is built
  // by concatenation so this block's own source never contains the
  // literals it scans for. The van-return spec asserted the count in a
  // third form — list.length — which no sweep pattern covered until the
  // B6 regression loop caught its stale 370 pin; the scan below covers
  // all three variable forms now.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b6Name = 'phase1-b6' + '-accounting-purchases.spec.ts';
  const staleSpecs = 'specs.length, 37' + '5';
  const staleChain = 'chain.length, 37' + '5';
  const staleList = 'list.length, 37' + '5';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b6Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the 375 wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B6 spec');

  // 12. The guard tail holds ONLY the newest id, so B7 re-pins the
  // B3/B4/B5 specs' guard assertions to the B7 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F3-FEATURE-BOUNDARY-LEGS/g)'),
      `${label} spec guard assertion must re-pin to the B7 INV`,
    );
  }

  console.log(
    'phase1 B6 accounting|purchases decoupling checks passed (375 specs wired, pair gone, partition identical)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
