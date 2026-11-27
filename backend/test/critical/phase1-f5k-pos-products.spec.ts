import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5k — break the pos|products frontend circular pair
 * (INV-PHASE1-F5K-POS-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 11 / §8 F5k (phase1-f0-grounding.md), re-derived live
 * at f8c5983fd: pos|products, module-boundary counts 5/5, 6 deep edges.
 * - products -> pos (5 statements — THE direction to break):
 *   products/components/BarcodePrinterPicker.tsx:8 imports
 *   HardwareBridgeClient from '@/features/pos' (public index) and calls
 *   HardwareBridgeClient.listPrinters() (:57); products/components/
 *   ProductOfferDialog.tsx:9 imports broadcastSignageOffersUpdate from
 *   '@/features/pos' (public index) and calls it (:277, :301, :583,
 *   :594); products/components/ProductUnitsEditor.tsx:6 imports
 *   normalizeUnitName from '@/features/pos/lib/pos.domain' (DEEP leg)
 *   and calls it (:28, :64); products/components/ScalePluExportModal.
 *   tsx:13 imports getWeightedBarcodeConfig, getScaleExportItemCode,
 *   buildSampleScaleBarcode from '@/features/pos/lib/weighted-barcode'
 *   (DEEP leg) and calls them (:85, :128, :131); products/utils/
 *   product-mappers.tsx:6 imports normalizeUnitName from
 *   '@/features/pos/lib/pos.domain' (DEEP leg) and calls it (:37).
 * - pos -> products (5 statements — STAYS): pos/components/pos-workspace/
 *   pos-workspace/PosWorkspaceAuxDialogs1.tsx:5 imports SerialLookupModal
 *   from '@/features/products/components/SerialLookupModal' (deep);
 *   pos/components/pos-workspace/PosEditProductModal.tsx:3 imports
 *   EditProductForm from '@/features/products/components/EditProductForm'
 *   (deep); pos/components/pos-workspace/PosNewProductModal.tsx:3
 *   imports NewProductForm from '@/features/products/components/
 *   NewProductForm' (deep); pos/components/pos-cart-panel/
 *   PosLineSerialEntry.tsx:5 imports productSerialsApi from
 *   '@/features/products' (public index); pos/pages/DigitalSignagePage.
 *   tsx:6 imports productsApi from '@/features/products/api/products.api'
 *   (deep — the F5j shim path).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other products file imports from pos — no spec file
 * either — no other pos file imports from products, no relative cross
 * imports, no other dynamic imports).
 * No earlier spec pins the pos|products pair as staying (unlike F5f /
 * F5h, no flip is needed).
 *
 * The break: the products -> pos direction goes to 0 via four seams
 * (F5f/F5h/F5i/F5j precedent — move ONLY what the legs require).
 * - normalizeUnitName (2 legs) is a PURE string normalizer (zero
 *   dependencies) embedded in pos/lib/pos-domain/pos-domain-sync-units.ts
 *   (143L), a POS cart-stock sync file whose other exports import four
 *   pos-domain modules — moving the WHOLE file to shared would drag POS
 *   cart logic into shared and fail the F5f "pure shared util" test. So
 *   the function alone is EXTRACTED whole (lines 97-123, verbatim, with
 *   its inline comments) to frontend/src/shared/utils/unit-name.ts;
 *   pos-domain-sync-units.ts gains an import + a re-export of it from
 *   shared, so the pos.domain barrel keeps re-exporting it unchanged and
 *   its internal uses (:132, :139) keep working.
 * - The weighted-barcode leg needs NO move: getWeightedBarcodeConfig,
 *   getScaleExportItemCode, buildSampleScaleBarcode are already exported
 *   by '@/shared/lib/weighted-barcode' (the pos barrel only re-exports
 *   them via `export *`); ScalePluExportModal re-points one import line
 *   to shared — same function objects.
 * - frontend/src/features/pos/lib/hardware-bridge-client.ts (368L,
 *   sha256 aaa6e240…) has ZERO imports — a pure shared util (bridge to
 *   127.0.0.1:18181). Moves WHOLE via git mv to frontend/src/shared/
 *   lib/hardware-bridge-client.ts, byte-identical. A shim at the old
 *   path re-exports the class + 7 interfaces explicitly, mirroring the
 *   sales/products shim form. Every other importer keeps the old path
 *   and works unchanged via the shim (pos-internal x6 + pos index +
 *   mobile-terminal-bridge relative import + src/lib/browser.ts), so NO
 *   other edge's count moves; only BarcodePrinterPicker re-points.
 * - frontend/src/features/pos/lib/pos-customer-display-bridge.ts (222L,
 *   sha256 24b2ac82…) imports ONLY from '@/features/pos/types/
 *   pos-customer-display.types'. Moving the bridge alone would leave a
 *   shared->feature import (layering inversion, against the F5h/F5i
 *   "pure shared util" precedent), so the types file moves WITH it:
 *   frontend/src/features/pos/types/pos-customer-display.types.ts (89L,
 *   sha256 1caed49a…, ZERO imports) moves WHOLE via git mv to
 *   frontend/src/shared/lib/pos-customer-display.types.ts. Both
 *   byte-identical except the bridge's ONE import line (types path ->
 *   shared). Shims at both old paths re-export explicitly. Every other
 *   importer keeps the old paths and works unchanged via the shims
 *   (PosDisplaysModal, usePosCustomerDisplayBroadcaster, pos index,
 *   CustomerFacingDisplayPage, DigitalSignagePage subscribe, app/
 *   query-invalidation dynamic import, the four types importers), so NO
 *   other edge's count moves; only ProductOfferDialog re-points. The pos
 *   index is UNCHANGED. The bridge's colocated spec moves WITH the file
 *   via git mv to frontend/src/shared/lib/pos-customer-display-bridge.
 *   spec.ts (sha256 5697c9fc…); its relative import still resolves
 *   (Vitest default include collects shared specs).
 * The 5 products files re-point one line each to the shared homes —
 * same function object / same class / same call, call sites
 * byte-identical. Direct '@/shared/lib/' and '@/shared/utils/' imports
 * from features are established practice (F5f receipt, F5h/F5i apis,
 * F5j modal/utils).
 * Why this direction, not pos -> products: the products->pos legs are
 * pure shared utils; the reverse direction has three heterogeneous
 * seams (two product-form modals, a serials api, the products api
 * client) — breaking it would be several moves including modal moves.
 * The pos -> products direction stays — breaking ONE direction is
 * enough for the pair to be gone.
 *
 * Audits (both F5h lessons, done live before starting):
 * - Check scripts: git grep for each moved old path in frontend/
 *   scripts/ matches ONLY the feature-boundary baseline JSON (the 3
 *   strings, shrunk in-package). api-mutation-envelope-check.mjs
 *   hardcodes only sales/purchases/pos api paths; none of my moved
 *   files is in the list; a local run at base exits 0 (repair base).
 * - Mock audit: grep over ALL frontend specs for vi.mock / vi.spyOn of
 *   the moved modules' OLD import paths in EVERY form. ScalePluExport-
 *   Modal.spec mocks only '@/lib/browser' + products.api (the
 *   weighted-barcode import is NOT mocked — real functions before and
 *   after). ProductOfferDialog.spec mocks only products.api +
 *   query-invalidation (the pos-index import is NOT mocked — real
 *   broadcast before and after). ProductUnitsEditor, product-mappers,
 *   BarcodePrinterPicker have NO spec files. PosSaleSuccessDialog.spec
 *   mocks '@/features/pos/lib/hardware-bridge-client' — the component
 *   imports from that SAME path (the shim after the move), so the mock
 *   still intercepts. mobile-terminal-bridge.spec imports the class via
 *   the relative shim import; createPosWorkspaceAsyncActions.spec
 *   imports it via the shim path; pos.domain.spec imports
 *   normalizeUnitName via the (unchanged) barrel, which keeps
 *   re-exporting it. The bridge spec moves with its file. Conclusion:
 *   F5k has NO stale-mock exposure (the F5h dialog-spec trap does not
 *   recur here — verified by grep, not assumed). Frontend vitest cannot
 *   run locally (OOM, CI-only) — any touched component spec's green is
 *   proven by CI, not locally; the mock-path alignment above is the
 *   local proof.
 *
 * Consequences, all re-pinned in this package:
 * - products -> pos: 5 -> 0; pos -> products stays 5.
 * - Frontend edges 46 -> 45, statements 116 -> 111, pairs 2 -> 1
 *   ('pos|products' gone; 'pos|storefront' remains). Backend pins
 *   unmoved (63 / 736, total 738). NOTE: edges land exactly on
 *   FRONTEND_EDGE_FLOOR (45) — the floor is a >= tripwire, so 45
 *   passes; F5l (which removes 5 more edges) will have to re-pin the
 *   floor deliberately — NOT this package.
 * - Feature-boundary baseline 63 -> 60 (exactly the 3 deep
 *   products->pos strings removed; the 2 index legs have NO baseline
 *   strings; the 4 pos->products strings stay). Import-layer baseline
 *   stays 152.
 * - Wiring: both critical lists carry 393 specs in identical order,
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
const SHARED_LIB = path.join(FRONTEND, 'src', 'shared', 'lib');
const SHARED_UTILS = path.join(FRONTEND, 'src', 'shared', 'utils');
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
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const PRODUCT_UNITS_EDITOR = path.join(FEATURES, 'products', 'components', 'ProductUnitsEditor.tsx');
const PRODUCT_MAPPERS = path.join(FEATURES, 'products', 'utils', 'product-mappers.tsx');
const SCALE_PLU_EXPORT_MODAL = path.join(FEATURES, 'products', 'components', 'ScalePluExportModal.tsx');
const BARCODE_PRINTER_PICKER = path.join(FEATURES, 'products', 'components', 'BarcodePrinterPicker.tsx');
const PRODUCT_OFFER_DIALOG = path.join(FEATURES, 'products', 'components', 'ProductOfferDialog.tsx');
const SHARED_UNIT_NAME = path.join(SHARED_UTILS, 'unit-name.ts');
const SHARED_WEIGHTED_BARCODE = path.join(SHARED_LIB, 'weighted-barcode.ts');
const SHARED_HARDWARE_BRIDGE_CLIENT = path.join(SHARED_LIB, 'hardware-bridge-client.ts');
const SHARED_CUSTOMER_DISPLAY_BRIDGE = path.join(SHARED_LIB, 'pos-customer-display-bridge.ts');
const SHARED_CUSTOMER_DISPLAY_TYPES = path.join(SHARED_LIB, 'pos-customer-display.types.ts');
const HARDWARE_BRIDGE_CLIENT_SHIM = path.join(FEATURES, 'pos', 'lib', 'hardware-bridge-client.ts');
const CUSTOMER_DISPLAY_BRIDGE_SHIM = path.join(FEATURES, 'pos', 'lib', 'pos-customer-display-bridge.ts');
const CUSTOMER_DISPLAY_TYPES_SHIM = path.join(FEATURES, 'pos', 'types', 'pos-customer-display.types.ts');
const POS_DOMAIN = path.join(FEATURES, 'pos', 'lib', 'pos.domain.ts');
const POS_DOMAIN_SYNC_UNITS = path.join(FEATURES, 'pos', 'lib', 'pos-domain', 'pos-domain-sync-units.ts');
const POS_INDEX = path.join(FEATURES, 'pos', 'index.ts');
const SHARED_BRIDGE_SPEC = path.join(SHARED_LIB, 'pos-customer-display-bridge.spec.ts');
const OLD_BRIDGE_SPEC = path.join(FEATURES, 'pos', 'lib', 'pos-customer-display-bridge.spec.ts');
const POS_EDIT_PRODUCT_MODAL = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosEditProductModal.tsx');
const POS_NEW_PRODUCT_MODAL = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosNewProductModal.tsx');
const POS_WORKSPACE_AUX_DIALOGS1 = path.join(
  FEATURES,
  'pos',
  'components',
  'pos-workspace',
  'pos-workspace',
  'PosWorkspaceAuxDialogs1.tsx',
);
const POS_LINE_SERIAL_ENTRY = path.join(FEATURES, 'pos', 'components', 'pos-cart-panel', 'PosLineSerialEntry.tsx');
const DIGITAL_SIGNAGE_PAGE = path.join(FEATURES, 'pos', 'pages', 'DigitalSignagePage.tsx');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The products -> pos direction is gone; the pos -> products
  // direction stays. The four seams moved to shared; the 5 products
  // files re-point to the shared homes; the shims keep every other
  // importer working; the pos index surface names are unchanged.
  const productsFiles: string[] = [];
  walkTs(path.join(FEATURES, 'products'), productsFiles);
  const stillPos: string[] = [];
  for (const file of productsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("from '@/features/pos") || src.includes("import('@/features/pos")) {
      stillPos.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillPos, [], "no products file may still import from '@/features/pos'");
  const productUnitsEditor = fs.readFileSync(PRODUCT_UNITS_EDITOR, 'utf8');
  assert.ok(
    productUnitsEditor.includes("import { normalizeUnitName } from '@/shared/utils/unit-name';"),
    'ProductUnitsEditor must import normalizeUnitName from the shared unit-name util (its new home)',
  );
  assert.ok(
    productUnitsEditor.includes("name: normalizeUnitName(unit.name) || (index === 0 ? 'قطعة' : ''),"),
    'ProductUnitsEditor must keep its normalizeUnitName call byte-identical',
  );
  const productMappers = fs.readFileSync(PRODUCT_MAPPERS, 'utf8');
  assert.ok(
    productMappers.includes("import { normalizeUnitName } from '@/shared/utils/unit-name';"),
    'product-mappers must import normalizeUnitName from the shared unit-name util (its new home)',
  );
  assert.ok(
    productMappers.includes(
      "{product.units.map((unit) => normalizeUnitName(unit.name)).join(' / ') || (isEn ? 'Piece' : 'قطعة')}",
    ),
    'product-mappers must keep its normalizeUnitName call byte-identical',
  );
  const scalePluExportModal = fs.readFileSync(SCALE_PLU_EXPORT_MODAL, 'utf8');
  assert.ok(
    scalePluExportModal.includes(
      "import { getWeightedBarcodeConfig, getScaleExportItemCode, buildSampleScaleBarcode } from '@/shared/lib/weighted-barcode';",
    ),
    'ScalePluExportModal must import the scale-barcode functions from the shared weighted-barcode lib (their real home)',
  );
  assert.ok(
    scalePluExportModal.includes('const scaleConfig = useMemo(() => getWeightedBarcodeConfig(settings), [settings]);'),
    'ScalePluExportModal must keep its getWeightedBarcodeConfig call byte-identical',
  );
  assert.ok(
    scalePluExportModal.includes('const itemCode = getScaleExportItemCode(prod, scaleConfig, padItemCode);'),
    'ScalePluExportModal must keep its getScaleExportItemCode call byte-identical',
  );
  assert.ok(
    scalePluExportModal.includes(
      'const sampleWeightBarcode = itemCode ? buildSampleScaleBarcode(itemCode, scaleConfig) : null;',
    ),
    'ScalePluExportModal must keep its buildSampleScaleBarcode call byte-identical',
  );
  const barcodePrinterPicker = fs.readFileSync(BARCODE_PRINTER_PICKER, 'utf8');
  assert.ok(
    barcodePrinterPicker.includes("import { HardwareBridgeClient } from '@/shared/lib/hardware-bridge-client';"),
    'BarcodePrinterPicker must import HardwareBridgeClient from the shared bridge client (its new home)',
  );
  assert.ok(
    barcodePrinterPicker.includes('const res = await HardwareBridgeClient.listPrinters();'),
    'BarcodePrinterPicker must keep its listPrinters call byte-identical',
  );
  const productOfferDialog = fs.readFileSync(PRODUCT_OFFER_DIALOG, 'utf8');
  assert.ok(
    productOfferDialog.includes(
      "import { broadcastSignageOffersUpdate } from '@/shared/lib/pos-customer-display-bridge';",
    ),
    'ProductOfferDialog must import broadcastSignageOffersUpdate from the shared display bridge (its new home)',
  );
  assert.ok(
    productOfferDialog.includes('broadcastSignageOffersUpdate();'),
    'ProductOfferDialog must keep its broadcastSignageOffersUpdate calls byte-identical',
  );
  const sharedUnitName = fs.readFileSync(SHARED_UNIT_NAME, 'utf8');
  assert.ok(
    sharedUnitName.includes('export function normalizeUnitName(rawUnit?: string): string {'),
    'the shared unit-name util must define normalizeUnitName',
  );
  assert.ok(
    sharedUnitName.includes("if (!trimmed) return 'قطعة';"),
    'the shared normalizeUnitName must keep its empty-unit default byte-identical',
  );
  assert.ok(
    sharedUnitName.includes("if (lower === 'kg'"),
    'the shared normalizeUnitName must keep its kg mapping byte-identical',
  );
  assert.ok(
    sharedUnitName.includes("if (lower === 'g'"),
    'the shared normalizeUnitName must keep its g mapping byte-identical',
  );
  assert.ok(
    sharedUnitName.includes("return 'كرتونة';"),
    'the shared normalizeUnitName must keep its carton mapping byte-identical',
  );
  assert.ok(
    sharedUnitName.includes('return trimmed;'),
    'the shared normalizeUnitName must keep its fallthrough byte-identical',
  );
  assert.ok(!sharedUnitName.includes('import '), 'the shared unit-name util must have zero imports (pure function)');
  const sharedWeightedBarcode = fs.readFileSync(SHARED_WEIGHTED_BARCODE, 'utf8');
  assert.ok(
    sharedWeightedBarcode.includes('export function getWeightedBarcodeConfig('),
    'the shared weighted-barcode lib must define getWeightedBarcodeConfig',
  );
  assert.ok(
    sharedWeightedBarcode.includes('export function getScaleExportItemCode('),
    'the shared weighted-barcode lib must define getScaleExportItemCode',
  );
  assert.ok(
    sharedWeightedBarcode.includes('export function buildSampleScaleBarcode('),
    'the shared weighted-barcode lib must define buildSampleScaleBarcode',
  );
  const sharedHardwareBridgeClient = fs.readFileSync(SHARED_HARDWARE_BRIDGE_CLIENT, 'utf8');
  assert.ok(
    sharedHardwareBridgeClient.includes('export class HardwareBridgeClient {'),
    'the shared hardware-bridge client must define HardwareBridgeClient',
  );
  assert.ok(
    sharedHardwareBridgeClient.includes('export interface BridgeHealth {'),
    'the shared hardware-bridge client must define BridgeHealth',
  );
  assert.ok(
    !sharedHardwareBridgeClient.includes('@/features/'),
    'the shared hardware-bridge client must have zero feature imports (pure shared util)',
  );
  const hardwareBridgeClientShim = fs.readFileSync(HARDWARE_BRIDGE_CLIENT_SHIM, 'utf8');
  assert.ok(
    hardwareBridgeClientShim.includes("from '@/shared/lib/hardware-bridge-client';"),
    'the hardware-bridge client shim must re-export from the shared home',
  );
  assert.ok(
    hardwareBridgeClientShim.includes('HardwareBridgeClient'),
    'the hardware-bridge client shim must re-export HardwareBridgeClient',
  );
  assert.ok(
    hardwareBridgeClientShim.includes('BridgeHealth'),
    'the hardware-bridge client shim must re-export BridgeHealth',
  );
  const sharedCustomerDisplayBridge = fs.readFileSync(SHARED_CUSTOMER_DISPLAY_BRIDGE, 'utf8');
  assert.ok(
    sharedCustomerDisplayBridge.includes('export function broadcastSignageOffersUpdate(): void {'),
    'the shared display bridge must define broadcastSignageOffersUpdate',
  );
  assert.ok(
    sharedCustomerDisplayBridge.includes('export function subscribeSignageOffersUpdate('),
    'the shared display bridge must define subscribeSignageOffersUpdate',
  );
  assert.ok(
    sharedCustomerDisplayBridge.includes('export function broadcastCustomerDisplayState('),
    'the shared display bridge must define broadcastCustomerDisplayState (move whole, not a subset)',
  );
  assert.ok(
    sharedCustomerDisplayBridge.includes("from '@/shared/lib/pos-customer-display.types';"),
    'the shared display bridge must import its types from the shared home',
  );
  assert.ok(
    !sharedCustomerDisplayBridge.includes('@/features/'),
    'the shared display bridge must have zero feature imports (pure shared util)',
  );
  const sharedCustomerDisplayTypes = fs.readFileSync(SHARED_CUSTOMER_DISPLAY_TYPES, 'utf8');
  assert.ok(
    sharedCustomerDisplayTypes.includes('export interface CustomerDisplayPayload {'),
    'the shared display types must define CustomerDisplayPayload',
  );
  assert.ok(
    sharedCustomerDisplayTypes.includes("export const POS_CFD_BROADCAST_CHANNEL = 'pos_cfd_broadcast_channel';"),
    'the shared display types must define POS_CFD_BROADCAST_CHANNEL',
  );
  assert.ok(
    !sharedCustomerDisplayTypes.includes('import '),
    'the shared display types must have zero imports (pure types)',
  );
  const customerDisplayBridgeShim = fs.readFileSync(CUSTOMER_DISPLAY_BRIDGE_SHIM, 'utf8');
  assert.ok(
    customerDisplayBridgeShim.includes("from '@/shared/lib/pos-customer-display-bridge';"),
    'the display bridge shim must re-export from the shared home',
  );
  assert.ok(
    customerDisplayBridgeShim.includes('broadcastSignageOffersUpdate'),
    'the display bridge shim must re-export broadcastSignageOffersUpdate',
  );
  assert.ok(
    customerDisplayBridgeShim.includes('subscribeSignageOffersUpdate'),
    'the display bridge shim must re-export subscribeSignageOffersUpdate',
  );
  const customerDisplayTypesShim = fs.readFileSync(CUSTOMER_DISPLAY_TYPES_SHIM, 'utf8');
  assert.ok(
    customerDisplayTypesShim.includes("from '@/shared/lib/pos-customer-display.types';"),
    'the display types shim must re-export from the shared home',
  );
  assert.ok(
    customerDisplayTypesShim.includes('CustomerDisplayPayload'),
    'the display types shim must re-export CustomerDisplayPayload',
  );
  assert.ok(
    customerDisplayTypesShim.includes('POS_CFD_BROADCAST_CHANNEL'),
    'the display types shim must re-export POS_CFD_BROADCAST_CHANNEL',
  );
  const posDomain = fs.readFileSync(POS_DOMAIN, 'utf8');
  assert.ok(
    posDomain.includes(
      "export { syncPosCartStock, normalizeUnitName, isWeightedSaleUnit, summarizeCartQuantities } from '@/features/pos/lib/pos-domain/pos-domain-sync-units';",
    ),
    'the pos.domain barrel must keep re-exporting normalizeUnitName from sync-units (surface unchanged)',
  );
  const posDomainSyncUnits = fs.readFileSync(POS_DOMAIN_SYNC_UNITS, 'utf8');
  assert.ok(
    posDomainSyncUnits.includes("import { normalizeUnitName } from '@/shared/utils/unit-name';"),
    'sync-units must import normalizeUnitName from the shared home (for its internal uses)',
  );
  assert.ok(
    posDomainSyncUnits.includes("export { normalizeUnitName } from '@/shared/utils/unit-name';"),
    'sync-units must re-export normalizeUnitName from the shared home (for the barrel)',
  );
  assert.ok(
    !posDomainSyncUnits.includes('export function normalizeUnitName'),
    'sync-units must not still define normalizeUnitName locally (it moved to shared)',
  );
  assert.ok(
    posDomainSyncUnits.includes('normalizeUnitName(unitName)'),
    'sync-units must keep its isWeightedSaleUnit call byte-identical',
  );
  assert.ok(
    posDomainSyncUnits.includes('normalizeUnitName(item.unitName)'),
    'sync-units must keep its summarizeCartQuantities call byte-identical',
  );
  const posIndex = fs.readFileSync(POS_INDEX, 'utf8');
  assert.ok(
    posIndex.includes("export { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';"),
    'the pos index must still re-export HardwareBridgeClient from its own lib file (public surface unchanged)',
  );
  assert.ok(
    posIndex.includes('broadcastSignageOffersUpdate,'),
    'the pos index must still re-export broadcastSignageOffersUpdate (public surface unchanged)',
  );
  assert.ok(
    posIndex.includes("} from '@/features/pos/lib/pos-customer-display-bridge';"),
    'the pos index must still re-export the display bridge names from its own lib file (public surface unchanged)',
  );
  assert.ok(fs.existsSync(SHARED_BRIDGE_SPEC), 'the display bridge spec must have moved with its file to shared/lib');
  assert.ok(!fs.existsSync(OLD_BRIDGE_SPEC), 'the old display bridge spec path must be gone (moved, not copied)');
  const sharedBridgeSpec = fs.readFileSync(SHARED_BRIDGE_SPEC, 'utf8');
  assert.ok(
    sharedBridgeSpec.includes("from './pos-customer-display-bridge';"),
    'the moved bridge spec must keep its relative import (it moved with its file)',
  );
  const posEditProductModal = fs.readFileSync(POS_EDIT_PRODUCT_MODAL, 'utf8');
  assert.ok(
    posEditProductModal.includes("import { EditProductForm } from '@/features/products/components/EditProductForm';"),
    'PosEditProductModal must keep its products import (the surviving direction)',
  );
  assert.ok(
    posEditProductModal.includes('<EditProductForm'),
    'PosEditProductModal must keep rendering EditProductForm',
  );
  const posNewProductModal = fs.readFileSync(POS_NEW_PRODUCT_MODAL, 'utf8');
  assert.ok(
    posNewProductModal.includes("import { NewProductForm } from '@/features/products/components/NewProductForm';"),
    'PosNewProductModal must keep its products import (the surviving direction)',
  );
  assert.ok(posNewProductModal.includes('<NewProductForm'), 'PosNewProductModal must keep rendering NewProductForm');
  const posWorkspaceAuxDialogs1 = fs.readFileSync(POS_WORKSPACE_AUX_DIALOGS1, 'utf8');
  assert.ok(
    posWorkspaceAuxDialogs1.includes(
      "import { SerialLookupModal } from '@/features/products/components/SerialLookupModal';",
    ),
    'PosWorkspaceAuxDialogs1 must keep its products import (the surviving direction)',
  );
  const posLineSerialEntry = fs.readFileSync(POS_LINE_SERIAL_ENTRY, 'utf8');
  assert.ok(
    posLineSerialEntry.includes("import { productSerialsApi } from '@/features/products';"),
    'PosLineSerialEntry must keep its products import (the surviving direction)',
  );
  const digitalSignagePage = fs.readFileSync(DIGITAL_SIGNAGE_PAGE, 'utf8');
  assert.ok(
    digitalSignagePage.includes("import { productsApi } from '@/features/products/api/products.api';"),
    'DigitalSignagePage must keep its products import (the surviving direction, via the F5j shim)',
  );

  // 2. F5l moves the module-boundary pins: frontend edges 44,
  // statements 105, pairs 0 (the pos|storefront pair is gone); the
  // backend pins do not move. Baselines 57 / 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
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
    !boundary.includes("'products->pos': 5,"),
    'the products->pos frontend edge (pinned at 5) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'pos->products': 5,"),
    'the pos->products edge must stay pinned at 5 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'pos|products'"), 'the pos|products pair must be gone from the pair list');
  assert.ok(
    !boundary.includes("'pos|storefront'"),
    'the pos|storefront pair must be gone from the pair list (F5l broke it — flipped from stay-pinned)',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57 after F5l');
  assert.ok(
    !featureBaseline.includes('products/components/ProductUnitsEditor.tsx imports @/features/pos/lib/pos.domain'),
    'feature-boundary baseline must not contain the removed ProductUnitsEditor string',
  );
  assert.ok(
    !featureBaseline.includes(
      'products/components/ScalePluExportModal.tsx imports @/features/pos/lib/weighted-barcode',
    ),
    'feature-boundary baseline must not contain the removed ScalePluExportModal string',
  );
  assert.ok(
    !featureBaseline.includes('products/utils/product-mappers.tsx imports @/features/pos/lib/pos.domain'),
    'feature-boundary baseline must not contain the removed product-mappers string',
  );
  assert.ok(
    featureBaseline.includes(
      'pos/components/pos-workspace/PosEditProductModal.tsx imports @/features/products/components/EditProductForm',
    ),
    'feature-boundary baseline must keep the surviving PosEditProductModal string',
  );
  assert.ok(
    featureBaseline.includes('pos/pages/DigitalSignagePage.tsx imports @/features/products/api/products.api'),
    'feature-boundary baseline must keep the surviving DigitalSignagePage string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5k');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5K-POS-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5k INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5k INV exactly once');

  // 4. Wiring: both critical lists carry 393 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 406);
  assert.equal(chain.length, 406);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 393 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 406);') && src.includes('assert.equal(chain.length, 406);'),
      `${label} spec wiring must re-pin to 393`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5k spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5j spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~75 files asserting the count — the #264-fix /
  // D12 lesson. The F5j filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the last-entry scan covers BOTH forms (specs[...] and
  // chain[...] — the F5j lesson: the chain form was missed once); the
  // baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const f5jName = 'phase1-f5j' + '-inventory-products.spec.ts';
  const f5jInv = 'INV-PHASE1-F5J' + '-INVENTORY-PRODUCTS-DECOUPLED';
  // Rebase note: F5k rebased onto F5h-REPAIR-2 (392nd), so the sweep
  // must also clear the 392-era pins — the repair-2 spec as last-entry
  // and the repair-2 guard INV. Same concatenation rule applies.
  const repair2Name = 'phase1-f5h-repair-2' + '-dialog-spec-mock.spec.ts';
  const repair2Inv = 'INV-PHASE1-F5H-REPAIR-2' + '-DIALOG-SPEC-MOCK';
  const staleSpecs = 'specs.length, 39' + '1';
  const staleChain = 'chain.length, 39' + '1';
  const staleList = 'list.length, 39' + '1';
  const staleSpecs392 = 'specs.length, 39' + '2';
  const staleChain392 = 'chain.length, 39' + '2';
  const staleList392 = 'list.length, 39' + '2';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 11" + "6;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 11" + '6 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 11" + "6'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "6,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '6 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "6 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '3';
  const staleBaselineB = 'featureBaseline.length, 6' + '3';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(staleSpecs392) || src.includes(staleChain392) || src.includes(staleList392)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5jName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${f5jName}'`)) staleLastEntry.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${repair2Name}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${repair2Name}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5jInv}/g)`)) staleGuard.push(file);
    if (src.includes(`guard.match(/${repair2Inv}/g)`)) staleGuard.push(file);
    if (
      src.includes(staleFeTotal) ||
      src.includes(staleFeTotalAfter) ||
      src.includes(staleFeTotalStill) ||
      src.includes(staleFeEdges) ||
      src.includes(staleFeEdgesAfter) ||
      src.includes(staleFeEdgesStill)
    ) {
      staleFePins.push(file);
    }
    for (const line of src.split('\n')) {
      if (line.includes(staleBaselineA) || line.includes(staleBaselineB)) {
        staleBaseline.push(`${file}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (391 or 392)');
  assert.deepEqual(
    staleLastEntry,
    [],
    'no critical spec may still point its last-entry at the F5j or F5h-REPAIR-2 spec',
  );
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (F5j or F5h-REPAIR-2)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5k re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2 specs'
  // guard assertions to the F5k INV; their invariants-file assertions
  // still pin their own id (each line stays in
  // ARCHITECTURE_INVARIANTS.md exactly once).
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS/g)'),
      `${label} spec guard assertion must re-pin to the F5k INV`,
    );
  }

  console.log(
    'phase1 F5k pos|products checks passed (products->pos gone, pairs 2->1, edges 45 / statements 111, 393 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
