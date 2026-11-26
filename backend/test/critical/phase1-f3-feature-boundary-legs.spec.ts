import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F3 — the 2 class-(b) feature-boundary legs
 * (INV-PHASE1-F3-FEATURE-BOUNDARY-LEGS).
 *
 * Grounding §2/§7 (phase1-f0-grounding.md), re-derived live at e7077ed63:
 * - Leg 1: cash-drawer/components/CashDrawerFormsPanel.tsx:10 imported
 *   getOfflineSalesQueue from '@/features/pos/lib/pos-offline-sync'
 *   (deep). Fix: expose it via the pos public index (pos/index.ts
 *   already re-exports getPosTerminalCode from the same file) and
 *   re-point the import to '@/features/pos'. No other cash-drawer file
 *   imports the helper deep; the second cash-drawer->pos statement is
 *   useCashDrawerMutations.ts:12 importing getPosTerminalCode through
 *   the bare index already (a statement, not a violation).
 * - Leg 2: pos/components/PosWorkspace.tsx:12, pos-workspace/
 *   PosRecentSalesReprintModal.tsx:9 and its .spec.tsx:6 imported
 *   salesApi from '@/features/sales/api/sales.api' (deep). Fix: route
 *   all three through the sales public index (sales/index.ts:3 already
 *   re-exports salesApi). The third pos->sales statement is
 *   PosInstantExchangeDialog.tsx:10 importing salesApi through the bare
 *   index already. Three OTHER sales.api deep strings stay baselined
 *   (accounts CustomerBalanceInvoicesCard, delivery-reps
 *   DeliveryRepSettlements + VanSaleNewInvoiceModal) — they belong to
 *   other pairs, not F3.
 * - Grounding §7 note: fixing a deep leg removes a feature-boundary
 *   violation but does NOT reduce the module-boundary count — routing
 *   through a public index still counts as a statement on the same
 *   edge. So the module-boundary pins do not move (57 edges /
 *   138 statements; pairs unchanged) while the feature-boundary
 *   baseline shrinks 74 -> 70. A pair breaks only when one direction's
 *   statements reach 0 (code moves / inversion) — that is F5, not F3.
 *
 * Consequences, all re-pinned in this package:
 * - Wiring: both critical lists carry 380 specs in identical order,
 *   this spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FEATURES = path.join(REPO_ROOT, 'frontend', 'src', 'features');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const BASELINE_JSON = path.join(REPO_ROOT, 'frontend', 'scripts', 'baselines', 'feature-boundary.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
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

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

// The 4 deep-import strings F3 removes from the feature-boundary
// baseline (74 -> 70). The 3 other sales.api strings stay baselined.
const REMOVED_STRINGS = [
  'cash-drawer/components/CashDrawerFormsPanel.tsx imports @/features/pos/lib/pos-offline-sync',
  'pos/components/PosWorkspace.tsx imports @/features/sales/api/sales.api',
  'pos/components/pos-workspace/PosRecentSalesReprintModal.tsx imports @/features/sales/api/sales.api',
  'pos/components/pos-workspace/PosRecentSalesReprintModal.spec.tsx imports @/features/sales/api/sales.api',
];
const REMAINING_SALES_API_STRINGS = [
  'accounts/components/CustomerBalanceInvoicesCard.tsx imports @/features/sales/api/sales.api',
  'delivery-reps/components/DeliveryRepSettlements.tsx imports @/features/sales/api/sales.api',
  'delivery-reps/components/VanSaleNewInvoiceModal.tsx imports @/features/sales/api/sales.api',
];

const POS_INDEX = path.join(FEATURES, 'pos', 'index.ts');
const SALES_INDEX = path.join(FEATURES, 'sales', 'index.ts');
const FORMS_PANEL = path.join(FEATURES, 'cash-drawer', 'components', 'CashDrawerFormsPanel.tsx');
const POS_WORKSPACE = path.join(FEATURES, 'pos', 'components', 'PosWorkspace.tsx');
const REPRINT_MODAL = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosRecentSalesReprintModal.tsx');
const REPRINT_SPEC = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosRecentSalesReprintModal.spec.tsx');

async function main(): Promise<void> {
  // 1. Both legs are broken: the deep imports are gone, the public
  // indices carry the names, and the call sites are identical.
  const posIndex = fs.readFileSync(POS_INDEX, 'utf8');
  assert.ok(
    posIndex.includes("export { getOfflineSalesQueue } from '@/features/pos/lib/pos-offline-sync';"),
    'pos/index.ts must re-export getOfflineSalesQueue from pos-offline-sync',
  );
  const salesIndex = fs.readFileSync(SALES_INDEX, 'utf8');
  assert.ok(
    salesIndex.includes("export { salesApi } from '@/features/sales/api/sales.api';"),
    'sales/index.ts must re-export salesApi from sales.api',
  );
  const panel = stripComments(fs.readFileSync(FORMS_PANEL, 'utf8'));
  assert.ok(
    panel.includes("import { getOfflineSalesQueue } from '@/features/pos';"),
    'CashDrawerFormsPanel must import getOfflineSalesQueue through the pos public index',
  );
  assert.ok(
    !panel.includes('@/features/pos/lib/pos-offline-sync'),
    'CashDrawerFormsPanel must not import pos-offline-sync deep anymore',
  );
  assert.ok(
    panel.includes('getOfflineSalesQueue().length'),
    'CashDrawerFormsPanel must still read the offline queue length (drawer pending count)',
  );
  for (const [label, file] of [
    ['PosWorkspace', POS_WORKSPACE],
    ['PosRecentSalesReprintModal', REPRINT_MODAL],
    ['PosRecentSalesReprintModal.spec', REPRINT_SPEC],
  ] as const) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    assert.ok(
      src.includes("import { salesApi } from '@/features/sales';"),
      `${label} must import salesApi through the sales public index`,
    );
    assert.ok(!src.includes('@/features/sales/api/sales.api'), `${label} must not import sales.api deep anymore`);
  }
  assert.ok(
    stripComments(fs.readFileSync(POS_WORKSPACE, 'utf8')).includes('salesApi.'),
    'PosWorkspace must still call salesApi (same call sites, only the import route changed)',
  );
  assert.ok(
    stripComments(fs.readFileSync(REPRINT_MODAL, 'utf8')).includes('salesApi.'),
    'PosRecentSalesReprintModal must still call salesApi (same call sites, only the import route changed)',
  );
  // No file outside pos may import pos-offline-sync deep (pos-internal
  // files keep their own imports). The sales.api deep importers outside
  // pos that remain are the 3 baselined ones (block 2), not F3 scope.
  const frontendFiles: string[] = [];
  walkTs(FRONTEND_SRC, frontendFiles);
  assert.ok(frontendFiles.length > 2000, 'frontend scan must find its files');
  const outsidePos: string[] = [];
  for (const file of frontendFiles) {
    const rel = path.relative(FEATURES, file);
    if (rel.startsWith('pos/')) continue;
    if (stripComments(fs.readFileSync(file, 'utf8')).includes('@/features/pos/lib/pos-offline-sync')) {
      outsidePos.push(rel);
    }
  }
  assert.deepEqual(outsidePos, [], 'no file outside pos may import pos-offline-sync deep');

  // 2. The feature-boundary baseline shrinks 74 -> 70: exactly the 4
  // F3 strings are gone, the 3 other sales.api strings stay.
  const baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8')) as string[];
  assert.equal(baseline.length, 70, 'feature-boundary baseline must hold exactly 70 strings after F3');
  for (const gone of REMOVED_STRINGS) {
    assert.ok(!baseline.includes(gone), `baseline must not contain the removed string: ${gone}`);
  }
  for (const kept of REMAINING_SALES_API_STRINGS) {
    assert.ok(baseline.includes(kept), `baseline must keep the out-of-scope string: ${kept}`);
  }

  // 3. The module-boundary pins do not move: routing through a public
  // index still counts as a statement on the same edge (grounding §7
  // note), so the backend total, the frontend total, both edge tables
  // and both pair lists stay exactly where F2 left them.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 138;'),
    'module-boundary must still pin the frontend total 138',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 57,'),
    'module-boundary must still pin 57 frontend edges',
  );
  assert.ok(
    boundary.includes("'cash-drawer->pos': 2,"),
    'module-boundary must still pin cash-drawer->pos at 2 (bare index import still counts)',
  );
  assert.ok(
    boundary.includes("'pos->sales': 3,"),
    'module-boundary must still pin pos->sales at 3 (bare index imports still count)',
  );
  assert.ok(boundary.includes("'cash-drawer|pos',"), 'cash-drawer|pos pair must stay pinned');
  assert.ok(boundary.includes("'pos|sales',"), 'pos|sales pair must stay pinned');

  // 4. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F3-FEATURE-BOUNDARY-LEGS/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F3 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F4-SETTINGS-ACCESS-DOOR/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F3 INV exactly once');

  // 5. Wiring: both critical lists carry 380 specs in identical order, the F4 spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 380);
  assert.equal(chain.length, 380);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 379 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f4-settings-access-door.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f4-settings-access-door.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 380);') && src.includes('assert.equal(chain.length, 380);'),
      `${label} spec wiring must re-pin to 379`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f4-settings-access-door.spec.ts'"),
      `${label} spec last-entry must re-pin to the F3 spec`,
    );
  }

  // 6. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F2 spec. (The
  // live tree holds ~53 files asserting the count — the #264-fix /
  // D12 lesson. The F2 filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f2Name = 'phase1-f2' + '-feature-public-indices.spec.ts';
  const staleSpecs = 'specs.length, 37' + '8';
  const staleChain = 'chain.length, 37' + '8';
  const staleList = 'list.length, 37' + '8';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f2Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F2 spec');

  // 7. The guard tail holds ONLY the newest id, so F3 re-pins the
  // B3/B4/B5/B6/B7/B8/F2 specs' guard assertions to the F3 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F4-SETTINGS-ACCESS-DOOR/g)'),
      `${label} spec guard assertion must re-pin to the F3 INV`,
    );
  }

  console.log(
    'phase1 F3 feature boundary legs checks passed (2 legs, 4 strings, boundary 74->70, counts unmoved, 379 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
