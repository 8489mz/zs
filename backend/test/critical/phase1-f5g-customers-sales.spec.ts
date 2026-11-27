import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5g — break the customers|sales frontend circular pair
 * (INV-PHASE1-F5G-CUSTOMERS-SALES-DECOUPLED).
 *
 * Grounding §7 row 7 / §8 F5g (phase1-f0-grounding.md), re-derived live
 * at 4e97c6cbb: customers|sales, module-boundary counts 2/2, ONE deep
 * leg:
 * - sales -> customers (2): sales/pages/InstallmentsPage.tsx:14 imports
 *   customersApi from '@/features/customers/api/customers.api' (DEEP);
 *   sales/components/CreateSubscriptionModal.tsx:10 imports
 *   { customersApi, type Customer } from '@/features/customers'
 *   (public index).
 * - customers -> sales (2): customers/components/CustomerEditorCard.tsx:21
 *   + customers/components/CustomerForm.tsx:18 import priceListsApi from
 *   '@/features/sales' (public index).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other sales file imports from customers — no spec
 * file either — no other customers file imports from sales, no relative
 * cross imports). No earlier spec asserts the customers|sales pair
 * "must stay pinned" (only module-boundary.spec.ts lists it), so no
 * F3-style flip is needed (unlike F5f).
 *
 * The break: the sales -> customers direction goes to 0.
 * - InstallmentsPage: new shared hook useCustomersListInstallmentsQuery()
 *   in frontend/src/shared/hooks/use-catalog-queries.ts (the F5b/F5c/F5d/
 *   F5e precedent — the established home for cross-feature catalog
 *   queries; it already imports customersApi; shared imports are not
 *   feature edges). The hook carries the page's query VERBATIM — same
 *   queryKey ['customers-list-installments'], same queryFn
 *   (customersApi.list(), return res || []) — so no behaviour can
 *   change. The page re-points to the hook and drops its deep
 *   customersApi import.
 * - CreateSubscriptionModal: customersApi re-points to its real home
 *   '@/shared/api/customers.api' (the customers feature barrel is a pure
 *   re-export of it) and type Customer to '@/types/domain' (where the
 *   type actually lives — the customers index re-exports it from there).
 *   Same function object, same call, same timing; the useEffect body
 *   stays byte-identical. Direct '@/shared/api/' imports from features
 *   are established practice (delivery-reps hooks/pages do it). This is
 *   the "move to shared" break — the api client already lives in shared.
 * The customers -> sales direction stays (both priceListsApi imports) —
 * breaking ONE direction is enough for the pair to be gone. Both indices
 * keep their public surfaces.
 *
 * Consequences, all re-pinned in this package:
 * - sales -> customers: 2 -> 0; customers -> sales stays 2.
 * - Frontend edges 50 -> 49, statements 130 -> 128, pairs 6 -> 5
 *   ('customers|sales' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline 66 -> 65 (exactly the one deep
 *   InstallmentsPage string is gone — hand-shrunk by exactly that one
 *   string, F3/F5c/F5d/F5e precedent; the other two customers.api
 *   strings stay). Import-layer baseline stays 152.
 * - Wiring: both critical lists carry 387 specs in identical order,
 *   this spec last.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a)
 * that no package maintains — left as-is.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const FEATURES = path.join(FRONTEND, 'src', 'features');
const SHARED_HOOKS = path.join(FRONTEND, 'src', 'shared', 'hooks');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
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
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const INSTALLMENTS_PAGE = path.join(FEATURES, 'sales', 'pages', 'InstallmentsPage.tsx');
const SUBSCRIPTION_MODAL = path.join(FEATURES, 'sales', 'components', 'CreateSubscriptionModal.tsx');
const CATALOG_HOOKS = path.join(SHARED_HOOKS, 'use-catalog-queries.ts');
const CUSTOMERS_INDEX = path.join(FEATURES, 'customers', 'index.ts');
const SALES_INDEX = path.join(FEATURES, 'sales', 'index.ts');
const CUSTOMER_EDITOR_CARD = path.join(FEATURES, 'customers', 'components', 'CustomerEditorCard.tsx');
const CUSTOMER_FORM = path.join(FEATURES, 'customers', 'components', 'CustomerForm.tsx');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The sales -> customers direction is gone; the customers ->
  // sales direction stays. The InstallmentsPage query moved verbatim
  // into the shared catalog hook; the subscription modal re-points to
  // the shared api client (same function object) + the Customer type
  // from its real home; both public indices keep their surface.
  const salesFiles: string[] = [];
  walkTs(path.join(FEATURES, 'sales'), salesFiles);
  const stillCustomers: string[] = [];
  for (const file of salesFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/customers")) {
      stillCustomers.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillCustomers, [], "no sales file may still import from '@/features/customers'");
  const installments = fs.readFileSync(INSTALLMENTS_PAGE, 'utf8');
  assert.ok(
    installments.includes("import { useCustomersListInstallmentsQuery } from '@/shared/hooks/use-catalog-queries';"),
    'InstallmentsPage must import useCustomersListInstallmentsQuery from the shared catalog hook',
  );
  assert.ok(
    installments.includes('const customersQuery = useCustomersListInstallmentsQuery();'),
    'InstallmentsPage must call the shared hook for its customers query',
  );
  assert.ok(!installments.includes('customersApi'), 'InstallmentsPage must not reference customersApi anymore');
  assert.ok(
    installments.includes('customers={customersQuery.data || []}'),
    'InstallmentsPage must keep passing the query data to the plan modal byte-identical',
  );
  const hooks = fs.readFileSync(CATALOG_HOOKS, 'utf8');
  assert.ok(
    hooks.includes('export function useCustomersListInstallmentsQuery() {'),
    'the shared catalog hook file must export useCustomersListInstallmentsQuery',
  );
  assert.ok(
    hooks.includes("queryKey: ['customers-list-installments'],"),
    'the shared hook must carry the InstallmentsPage queryKey verbatim',
  );
  assert.ok(
    hooks.includes('const res = await customersApi.list();'),
    'the shared hook must carry the InstallmentsPage queryFn verbatim',
  );
  assert.ok(
    hooks.includes('return res || [];'),
    'the shared hook must carry the InstallmentsPage empty fallback verbatim',
  );
  const modal = fs.readFileSync(SUBSCRIPTION_MODAL, 'utf8');
  assert.ok(
    modal.includes("import { customersApi } from '@/shared/api/customers.api';"),
    'CreateSubscriptionModal must import customersApi from the shared api client (its real home)',
  );
  assert.ok(
    modal.includes("import type { Customer } from '@/types/domain';"),
    'CreateSubscriptionModal must import the Customer type from @/types/domain (its real home)',
  );
  assert.ok(
    !modal.includes("from '@/features/customers"),
    'CreateSubscriptionModal must not import from the customers feature anymore',
  );
  assert.ok(
    modal.includes('customersApi.list().then((res) => {'),
    'CreateSubscriptionModal must keep the same customersApi.list() call',
  );
  assert.ok(
    modal.includes('if (Array.isArray(res)) setCustomers(res);'),
    'CreateSubscriptionModal must keep its array-shape branch byte-identical',
  );
  assert.ok(
    modal.includes('else if (res && Array.isArray((res as any).customers)) setCustomers((res as any).customers);'),
    'CreateSubscriptionModal must keep its object-shape branch byte-identical',
  );
  assert.ok(
    modal.includes('const [customers, setCustomers] = useState<Customer[]>([]);'),
    'CreateSubscriptionModal must keep its Customer-typed state byte-identical',
  );
  const editorCard = fs.readFileSync(CUSTOMER_EDITOR_CARD, 'utf8');
  assert.ok(
    editorCard.includes("import { priceListsApi } from '@/features/sales';"),
    'CustomerEditorCard must keep its priceListsApi import (the surviving direction)',
  );
  const customerForm = fs.readFileSync(CUSTOMER_FORM, 'utf8');
  assert.ok(
    customerForm.includes("import { priceListsApi } from '@/features/sales';"),
    'CustomerForm must keep its priceListsApi import (the surviving direction)',
  );
  const customersIndex = fs.readFileSync(CUSTOMERS_INDEX, 'utf8');
  assert.ok(
    customersIndex.includes("export { customersApi } from '@/features/customers/api/customers.api';"),
    'the customers index must still re-export customersApi (public surface unchanged)',
  );
  assert.ok(
    customersIndex.includes("export type { Customer } from '@/types/domain';"),
    'the customers index must still re-export the Customer type (public surface unchanged)',
  );
  assert.ok(
    customersIndex.includes("export { CustomersPage } from '@/features/customers/pages/CustomersPage';"),
    'the customers index must still re-export CustomersPage (public surface unchanged)',
  );
  assert.ok(
    customersIndex.includes("export { customersRouteModule } from '@/features/customers/routes';"),
    'the customers index must still re-export customersRouteModule (public surface unchanged)',
  );
  const salesIndex = fs.readFileSync(SALES_INDEX, 'utf8');
  assert.ok(
    salesIndex.includes("export { priceListsApi } from '@/features/sales/api/price-lists.api';"),
    'the sales index must still re-export priceListsApi (public surface unchanged)',
  );
  assert.ok(
    salesIndex.includes("export { salesApi } from '@/features/sales/api/sales.api';"),
    'the sales index must still re-export salesApi (public surface unchanged)',
  );

  // 2. The module-boundary pins move: frontend edges 50 -> 49,
  // statements 130 -> 128, pairs 6 -> 5 ('customers|sales' gone);
  // the backend pins do not move. Feature-boundary baseline shrinks
  // 66 -> 65 (exactly the one deep InstallmentsPage string is gone);
  // import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 116;'),
    'module-boundary must pin the frontend total 116 after F5g',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 46,'),
    'module-boundary must pin 46 frontend edges after F5g',
  );
  assert.ok(
    !boundary.includes("'sales->customers': 2,"),
    'the sales->customers frontend edge (pinned at 2) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'customers->sales': 2,"),
    'the customers->sales edge must stay pinned at 2 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'customers|sales'"), 'the customers|sales pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 63, 'feature-boundary baseline must shrink to exactly 63 after F5g');
  assert.ok(
    !featureBaseline.includes('sales/pages/InstallmentsPage.tsx imports @/features/customers/api/customers.api'),
    'feature-boundary baseline must not contain the removed InstallmentsPage string',
  );
  assert.ok(
    featureBaseline.includes(
      'delivery-reps/components/VanSaleNewInvoiceModal.tsx imports @/features/customers/api/customers.api',
    ),
    'feature-boundary baseline must keep the out-of-scope VanSaleNewInvoiceModal string',
  );
  assert.ok(
    featureBaseline.includes(
      'maritime-freight/components/CreateInquiryModal.tsx imports @/features/customers/api/customers.api',
    ),
    'feature-boundary baseline must keep the out-of-scope CreateInquiryModal string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5g');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5G-CUSTOMERS-SALES-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5g INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F5H-REPAIR-2-DIALOG-SPEC-MOCK/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5g INV exactly once');

  // 4. Wiring: both critical lists carry 387 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 392);
  assert.equal(chain.length, 392);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 387 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 392);') && src.includes('assert.equal(chain.length, 392);'),
      `${label} spec wiring must re-pin to 387`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f5h-repair-2-dialog-spec-mock.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5g spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5f spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~69 files asserting the count — the #264-fix /
  // D12 lesson. The F5f filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const f5fName = 'phase1-f5f' + '-cash-drawer-pos.spec.ts';
  const f5fInv = 'INV-PHASE1-F5F' + '-CASH-DRAWER-POS-DECOUPLED';
  const staleSpecs = 'specs.length, 38' + '6';
  const staleChain = 'chain.length, 38' + '6';
  const staleList = 'list.length, 38' + '6';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 13" + "0;'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 5" + "0,'";
  const staleBaselineA = 'baseline.length, 6' + '6';
  const staleBaselineB = 'featureBaseline.length, 6' + '6';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5fName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5fInv}/g)`)) staleGuard.push(file);
    if (src.includes(staleFeTotal) || src.includes(staleFeEdges)) staleFePins.push(file);
    for (const line of src.split('\n')) {
      if (line.includes(staleBaselineA) || line.includes(staleBaselineB)) {
        staleBaseline.push(`${file}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5f spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5g re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f specs' guard
  // assertions to the F5g INV; their invariants-file assertions still
  // pin their own id (each line stays in ARCHITECTURE_INVARIANTS.md
  // exactly once).
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F5H-REPAIR-2-DIALOG-SPEC-MOCK/g)'),
      `${label} spec guard assertion must re-pin to the F5g INV`,
    );
  }

  console.log(
    'phase1 F5g customers|sales checks passed (sales->customers gone, pairs 6->5, edges 49 / statements 128, 387 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
