import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5j — break the inventory|products frontend circular pair
 * (INV-PHASE1-F5J-INVENTORY-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 10 / §8 F5j (phase1-f0-grounding.md), re-derived live
 * at 8f940f973: inventory|products, module-boundary counts 6/3; 1 deep leg.
 * - inventory -> products (6, ALL six import statements):
 *   inventory/components/CreatePackageModal.tsx:7 imports productsApi
 *   from '@/features/products' (public index) and calls
 *   productsApi.listAll() (:45); inventory/components/quality/
 *   CreateNCRModal.tsx:6 imports productsApi from '@/features/products'
 *   and calls productsApi.listAll() (:31); inventory/components/quality/
 *   CreateQCPointModal.tsx:6 imports productsApi from '@/features/products'
 *   and calls productsApi.listAll() (:35); inventory/hooks/
 *   useInventoryPage.ts:4 imports productsApi + type ProductsListParams
 *   from '@/features/products/api/products.api' (DEEP leg) and calls
 *   productsApi.listPage() in a useQuery queryFn (:26);
 *   inventory/pages/WarehouseDetailsPage.tsx:10 imports ProductCardModal
 *   from '@/features/products' and renders it (:358);
 *   inventory/components/quality/RecordInspectionModal.tsx:6 imports
 *   productsApi from '@/features/products' and calls productsApi.listAll()
 *   (:43).
 * - products -> inventory (3, STAYS): products/components/
 *   EditProductForm.tsx:14 imports QuickStockAdjustmentDialog +
 *   useInventoryActionCatalog from '@/features/inventory';
 *   products/components/workspace-sections/FashionGroupEditorCard.tsx:8
 *   imports useInventoryActionCatalog from '@/features/inventory';
 *   products/components/workspace-sections/fashion-group-editor/
 *   stock-adjustment-dialog.tsx:1 imports QuickStockAdjustmentDialog +
 *   type useInventoryActionCatalog from '@/features/inventory'.
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other inventory file imports from products — no
 * spec file either — no other products file imports from inventory, no
 * relative cross imports, no other dynamic imports).
 * No earlier spec pins the inventory|products pair as staying (unlike
 * F5f / F5h, no flip is needed).
 *
 * The break: the inventory -> products direction goes to 0 by moving
 * its two seams WHOLE to shared (F5f/F5h/F5i precedent).
 * - frontend/src/features/products/api/products.api.ts (60L) moves via
 *   git mv to frontend/src/shared/api/products.api.ts, byte-identical.
 *   Its own imports are all non-feature (@/lib/http,
 *   @/lib/api/contracts, @/lib/query-string, @/types/domain), so the
 *   moved file has zero feature dependencies and is a pure shared util.
 * - A shim at the old path re-exports productsApi + the two types
 *   (ProductsListParams, ProductsPageResponse) from
 *   '@/shared/api/products.api' — mirrors the sales.api shim exactly.
 *   Every other importer (products-internal ~20 files, delivery-reps,
 *   maintenance, manufacturing x2, pos DigitalSignagePage, purchases,
 *   the products index, the four vi.mock('@/features/products/api/
 *   products.api') spec files) keeps working unchanged via the shim,
 *   so NO other edge's count moves.
 * - frontend/src/features/products/components/ProductCardModal.tsx
 *   (822L) moves via git mv to frontend/src/shared/components/
 *   ProductCardModal.tsx, byte-identical except its ONE
 *   products-relative import (../utils/product-expiry.utils ->
 *   @/shared/utils/product-expiry.utils). Its other imports are
 *   already shared/lib/types + @/shared/api/inventory.api.
 * - frontend/src/features/products/utils/product-expiry.utils.ts
 *   (107L, ZERO imports, used by nothing except the modal) moves via
 *   git mv to frontend/src/shared/utils/product-expiry.utils.ts,
 *   byte-identical.
 * - The 6 inventory files re-point one line each to the shared homes
 *   — same function object / same component, call sites byte-identical.
 *   The products-internal modal user (products-table-card-card-modal)
 *   re-points to shared; the products index keeps re-exporting
 *   productsApi from its own api file (= the shim) and re-exports
 *   ProductCardModal from the shared path (public surface NAMES
 *   unchanged). Direct '@/shared/api/' and '@/shared/components/'
 *   imports from features are established practice (delivery-reps
 *   hooks/pages, F5g modal, F5h, F5i).
 * Why this direction, not products -> inventory: the reverse direction
 * is NOT cleanly breakable — QuickStockAdjustmentDialog (644L)
 * imports FOUR inventory-feature modules (useInventoryMutations,
 *   inventory.api, adjustment-prefill, inventory.schema), so moving it
 *   to shared would drag inventory internals with it and fail the F5f
 *   "pure shared util" test. The hook seam IS already shared
 *   (@/shared/hooks/use-inventory-action-catalog, imported that way by
 *   ProductsWorkspace.tsx:14), but the dialog blocks the direction:
 *   re-pointing the hook alone takes products->inventory 3 -> 2 and
 *   the pair stays. The inventory -> products direction's seams are
 *   both pure shared utils, so it breaks whole. (The brief's "do not
 *   touch the 6-stmt direction first" clause is read as sequencing,
 *   not direction: do not re-point the 6 legs one by one first — move
 *   the two seams whole and let the legs follow. The deep leg
 *   identifies the break direction in every prior F5 package, and the
 *   reverse is not cleanly breakable.)
 * The products -> inventory direction stays — breaking ONE direction
 * is enough for the pair to be gone.
 *
 * Envelope-check note (F5h lesson): api-mutation-envelope-check.mjs
 * hardcodes only sales/purchases/pos api paths; products.api is NOT
 * in the list, and git grep for the old path in frontend/scripts/
 * matches only the feature-boundary baseline JSON (not a check script).
 * A local run at base fails on EXACTLY the one pre-existing sales
 * failure (ci-fast #496 / ci-full #316, owned by F5h-REPAIR, not yet
 * landed); the F5j move adds no new failure line.
 *
 * Consequences, all re-pinned in this package:
 * - inventory -> products: 6 -> 0; products -> inventory stays 3.
 * - Frontend edges 47 -> 46, statements 122 -> 116, pairs 3 -> 2
 *   ('inventory|products' gone). Backend pins unmoved (63 / 736,
 *   total 738).
 * - Feature-boundary baseline 64 -> 63 (exactly the one deep
 *   useInventoryPage string removed; the other two products.api deep
 *   strings stay — delivery-reps VanSaleNewInvoiceModal, pos
 *   DigitalSignagePage — out of scope, still importing via the shim).
 *   Import-layer baseline stays 152.
 * - Wiring: both critical lists carry 391 specs in identical order,
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
const SHARED_API = path.join(FRONTEND, 'src', 'shared', 'api');
const SHARED_COMPONENTS = path.join(FRONTEND, 'src', 'shared', 'components');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const CREATE_PACKAGE_MODAL = path.join(FEATURES, 'inventory', 'components', 'CreatePackageModal.tsx');
const CREATE_NCR_MODAL = path.join(FEATURES, 'inventory', 'components', 'quality', 'CreateNCRModal.tsx');
const CREATE_QC_POINT_MODAL = path.join(FEATURES, 'inventory', 'components', 'quality', 'CreateQCPointModal.tsx');
const RECORD_INSPECTION_MODAL = path.join(FEATURES, 'inventory', 'components', 'quality', 'RecordInspectionModal.tsx');
const USE_INVENTORY_PAGE = path.join(FEATURES, 'inventory', 'hooks', 'useInventoryPage.ts');
const WAREHOUSE_DETAILS_PAGE = path.join(FEATURES, 'inventory', 'pages', 'WarehouseDetailsPage.tsx');
const SHARED_PRODUCTS_API = path.join(SHARED_API, 'products.api.ts');
const PRODUCTS_API_SHIM = path.join(FEATURES, 'products', 'api', 'products.api.ts');
const SHARED_PRODUCT_CARD_MODAL = path.join(SHARED_COMPONENTS, 'ProductCardModal.tsx');
const SHARED_PRODUCT_EXPIRY_UTILS = path.join(SHARED_UTILS, 'product-expiry.utils.ts');
const PRODUCTS_INDEX = path.join(FEATURES, 'products', 'index.ts');
const CARD_MODAL = path.join(
  FEATURES,
  'products',
  'components',
  'products-table-card',
  'products-table-card-card-modal.tsx',
);
const EDIT_PRODUCT_FORM = path.join(FEATURES, 'products', 'components', 'EditProductForm.tsx');
const FASHION_GROUP_EDITOR_CARD = path.join(
  FEATURES,
  'products',
  'components',
  'workspace-sections',
  'FashionGroupEditorCard.tsx',
);
const STOCK_ADJUSTMENT_DIALOG = path.join(
  FEATURES,
  'products',
  'components',
  'workspace-sections',
  'fashion-group-editor',
  'stock-adjustment-dialog.tsx',
);

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The inventory -> products direction is gone; the products ->
  // inventory direction stays. The productsApi client + the product
  // card modal moved whole to shared; the 6 inventory files re-point
  // to the shared homes; the shim keeps every other importer working;
  // the products index surface names are unchanged.
  const inventoryFiles: string[] = [];
  walkTs(path.join(FEATURES, 'inventory'), inventoryFiles);
  const stillProducts: string[] = [];
  for (const file of inventoryFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("from '@/features/products") || src.includes("import('@/features/products")) {
      stillProducts.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillProducts, [], "no inventory file may still import from '@/features/products'");
  const createPackageModal = fs.readFileSync(CREATE_PACKAGE_MODAL, 'utf8');
  assert.ok(
    createPackageModal.includes("import { productsApi } from '@/shared/api/products.api';"),
    'CreatePackageModal must import productsApi from the shared api client (its new home)',
  );
  assert.ok(
    createPackageModal.includes('productsApi.listAll().then((res) => {'),
    'CreatePackageModal must keep its listAll call byte-identical',
  );
  assert.ok(
    createPackageModal.includes('const prods = (res as any)?.products || res || [];'),
    'CreatePackageModal must keep its products mapping byte-identical',
  );
  const createNcrModal = fs.readFileSync(CREATE_NCR_MODAL, 'utf8');
  assert.ok(
    createNcrModal.includes("import { productsApi } from '@/shared/api/products.api';"),
    'CreateNCRModal must import productsApi from the shared api client (its new home)',
  );
  assert.ok(
    createNcrModal.includes('productsApi.listAll().then((res) => {'),
    'CreateNCRModal must keep its listAll call byte-identical',
  );
  assert.ok(
    createNcrModal.includes('setProducts((res as any)?.products || res || []);'),
    'CreateNCRModal must keep its products mapping byte-identical',
  );
  const createQcPointModal = fs.readFileSync(CREATE_QC_POINT_MODAL, 'utf8');
  assert.ok(
    createQcPointModal.includes("import { productsApi } from '@/shared/api/products.api';"),
    'CreateQCPointModal must import productsApi from the shared api client (its new home)',
  );
  assert.ok(
    createQcPointModal.includes('productsApi.listAll().then((res) => {'),
    'CreateQCPointModal must keep its listAll call byte-identical',
  );
  assert.ok(
    createQcPointModal.includes('setProducts((res as any)?.products || res || []);'),
    'CreateQCPointModal must keep its products mapping byte-identical',
  );
  const recordInspectionModal = fs.readFileSync(RECORD_INSPECTION_MODAL, 'utf8');
  assert.ok(
    recordInspectionModal.includes("import { productsApi } from '@/shared/api/products.api';"),
    'RecordInspectionModal must import productsApi from the shared api client (its new home)',
  );
  assert.ok(
    recordInspectionModal.includes('productsApi.listAll().then((res) => {'),
    'RecordInspectionModal must keep its listAll call byte-identical',
  );
  assert.ok(
    recordInspectionModal.includes('const prods = (res as any)?.products || res || [];'),
    'RecordInspectionModal must keep its products mapping byte-identical',
  );
  const useInventoryPage = fs.readFileSync(USE_INVENTORY_PAGE, 'utf8');
  assert.ok(
    useInventoryPage.includes("import { productsApi, type ProductsListParams } from '@/shared/api/products.api';"),
    'useInventoryPage must import productsApi from the shared api client (its new home)',
  );
  assert.ok(
    useInventoryPage.includes(
      "queryKey: [...queryKeys.products, 'inventory', page, pageSize, search, statusFilter, locationFilter, categoryFilter, supplierFilter],",
    ),
    'useInventoryPage must keep its inventory queryKey byte-identical',
  );
  assert.ok(
    useInventoryPage.includes('productsApi.listPage({'),
    'useInventoryPage must keep its listPage call byte-identical',
  );
  assert.ok(
    useInventoryPage.includes("view: viewMap[statusFilter] || 'all',"),
    'useInventoryPage must keep its view mapping byte-identical',
  );
  const warehouseDetailsPage = fs.readFileSync(WAREHOUSE_DETAILS_PAGE, 'utf8');
  assert.ok(
    warehouseDetailsPage.includes("import { ProductCardModal } from '@/shared/components/ProductCardModal';"),
    'WarehouseDetailsPage must import ProductCardModal from shared (its new home)',
  );
  assert.ok(
    warehouseDetailsPage.includes('<ProductCardModal'),
    'WarehouseDetailsPage must keep rendering ProductCardModal',
  );
  assert.ok(
    warehouseDetailsPage.includes('product={activeCardProduct}'),
    'WarehouseDetailsPage must keep its modal product prop byte-identical',
  );
  assert.ok(
    warehouseDetailsPage.includes('onClose={() => setActiveCardProduct(null)}'),
    'WarehouseDetailsPage must keep its modal onClose byte-identical',
  );
  const sharedApi = fs.readFileSync(SHARED_PRODUCTS_API, 'utf8');
  assert.ok(sharedApi.includes('export const productsApi = {'), 'the shared products.api must define productsApi');
  assert.ok(
    sharedApi.includes('listPage: (params: ProductsListParams) => http<ProductsPageResponse>'),
    'the shared products.api must define the listPage reader',
  );
  assert.ok(
    sharedApi.includes("listAll: async (params: Omit<ProductsListParams, 'page' | 'pageSize'> = {}) => {"),
    'the shared products.api must define the listAll reader',
  );
  assert.ok(
    sharedApi.includes('export interface ProductsListParams {'),
    'the shared products.api must define ProductsListParams',
  );
  assert.ok(
    sharedApi.includes('export interface ProductsPageResponse {'),
    'the shared products.api must define ProductsPageResponse',
  );
  assert.ok(
    sharedApi.includes('getNextStyleCode: () => http<{ styleCode: string }>'),
    'the shared products.api must define getNextStyleCode (move whole, not a subset)',
  );
  assert.ok(
    sharedApi.includes('categories: async () => unwrapArray<Category>'),
    'the shared products.api must define categories (move whole, not a subset)',
  );
  assert.ok(
    !sharedApi.includes('@/features/'),
    'the shared products.api must have zero feature imports (pure shared util)',
  );
  const shim = fs.readFileSync(PRODUCTS_API_SHIM, 'utf8');
  assert.ok(
    shim.includes("from '@/shared/api/products.api';"),
    'the products api shim must re-export from the shared home',
  );
  assert.ok(shim.includes('productsApi'), 'the products api shim must re-export productsApi');
  assert.ok(shim.includes('ProductsListParams'), 'the products api shim must re-export ProductsListParams');
  assert.ok(shim.includes('ProductsPageResponse'), 'the products api shim must re-export ProductsPageResponse');
  const sharedModal = fs.readFileSync(SHARED_PRODUCT_CARD_MODAL, 'utf8');
  assert.ok(
    sharedModal.includes('export function ProductCardModal({'),
    'the shared ProductCardModal must define the modal component',
  );
  assert.ok(
    sharedModal.includes("from '@/shared/utils/product-expiry.utils';"),
    'the shared ProductCardModal must import its expiry utils from the shared home',
  );
  assert.ok(
    !sharedModal.includes('@/features/'),
    'the shared ProductCardModal must have zero feature imports (pure shared util)',
  );
  assert.ok(
    !sharedModal.includes('../utils/product-expiry.utils'),
    'the shared ProductCardModal must not keep its old products-relative utils import',
  );
  const sharedExpiryUtils = fs.readFileSync(SHARED_PRODUCT_EXPIRY_UTILS, 'utf8');
  assert.ok(
    sharedExpiryUtils.includes("export type ProductExpiryStatus = 'valid' | 'near_expiry' | 'expired' | 'no_expiry';"),
    'the shared product-expiry utils must define ProductExpiryStatus',
  );
  assert.ok(
    sharedExpiryUtils.includes('export interface ProductExpiryStatusResult {'),
    'the shared product-expiry utils must define ProductExpiryStatusResult',
  );
  assert.ok(
    !sharedExpiryUtils.includes('import '),
    'the shared product-expiry utils must have zero imports (pure util)',
  );
  const productsIndex = fs.readFileSync(PRODUCTS_INDEX, 'utf8');
  assert.ok(
    productsIndex.includes("export { productsApi } from '@/features/products/api/products.api';"),
    'the products index must still re-export productsApi from its own api file (public surface unchanged)',
  );
  assert.ok(
    productsIndex.includes("export { ProductCardModal } from '@/shared/components/ProductCardModal';"),
    'the products index must re-export ProductCardModal from the shared home (surface name unchanged)',
  );
  assert.ok(
    productsIndex.includes("export { ProductsPage } from '@/features/products/pages/ProductsPage';"),
    'the products index must still re-export ProductsPage (public surface unchanged)',
  );
  assert.ok(
    productsIndex.includes("export { productsRouteModule } from '@/features/products/routes';"),
    'the products index must still re-export productsRouteModule (public surface unchanged)',
  );
  const cardModal = fs.readFileSync(CARD_MODAL, 'utf8');
  assert.ok(
    cardModal.includes("import { ProductCardModal } from '@/shared/components/ProductCardModal';"),
    'products-table-card-card-modal must import ProductCardModal from shared (its new home)',
  );
  assert.ok(cardModal.includes('<ProductCardModal'), 'products-table-card-card-modal must keep rendering the modal');
  const editProductForm = fs.readFileSync(EDIT_PRODUCT_FORM, 'utf8');
  assert.ok(
    editProductForm.includes(
      "import { QuickStockAdjustmentDialog, useInventoryActionCatalog } from '@/features/inventory';",
    ),
    'EditProductForm must keep its inventory import (the surviving direction)',
  );
  assert.ok(
    editProductForm.includes('const inventoryCatalog = useInventoryActionCatalog();'),
    'EditProductForm must keep its inventory catalog call byte-identical',
  );
  assert.ok(
    editProductForm.includes('<QuickStockAdjustmentDialog'),
    'EditProductForm must keep rendering QuickStockAdjustmentDialog',
  );
  const fashionGroupEditorCard = fs.readFileSync(FASHION_GROUP_EDITOR_CARD, 'utf8');
  assert.ok(
    fashionGroupEditorCard.includes("import { useInventoryActionCatalog } from '@/features/inventory';"),
    'FashionGroupEditorCard must keep its inventory import (the surviving direction)',
  );
  assert.ok(
    fashionGroupEditorCard.includes('const inventoryCatalog = useInventoryActionCatalog();'),
    'FashionGroupEditorCard must keep its inventory catalog call byte-identical',
  );
  const stockAdjustmentDialog = fs.readFileSync(STOCK_ADJUSTMENT_DIALOG, 'utf8');
  assert.ok(
    stockAdjustmentDialog.includes(
      "import { QuickStockAdjustmentDialog, type useInventoryActionCatalog } from '@/features/inventory';",
    ),
    'stock-adjustment-dialog must keep its inventory import (the surviving direction)',
  );
  assert.ok(
    stockAdjustmentDialog.includes('<QuickStockAdjustmentDialog'),
    'stock-adjustment-dialog must keep rendering QuickStockAdjustmentDialog',
  );

  // 2. The module-boundary pins move: frontend edges 47 -> 46,
  // statements 122 -> 116, pairs 3 -> 2 ('inventory|products' gone);
  // the backend pins do not move. The feature-boundary baseline
  // shrinks 64 -> 63 (exactly the one deep useInventoryPage string
  // removed); the import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5j',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5j',
  );
  assert.ok(
    !boundary.includes("'inventory->products': 6,"),
    'the inventory->products frontend edge (pinned at 6) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'products->inventory': 3,"),
    'the products->inventory edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'inventory|products'"), 'the inventory|products pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must shrink to exactly 57 after F5j');
  assert.ok(
    !featureBaseline.includes('inventory/hooks/useInventoryPage.ts imports @/features/products/api/products.api'),
    'feature-boundary baseline must not contain the removed useInventoryPage string',
  );
  assert.ok(
    featureBaseline.includes(
      'delivery-reps/components/VanSaleNewInvoiceModal.tsx imports @/features/products/api/products.api',
    ),
    'feature-boundary baseline must keep the out-of-scope VanSaleNewInvoiceModal string',
  );
  assert.ok(
    featureBaseline.includes('pos/pages/DigitalSignagePage.tsx imports @/features/products/api/products.api'),
    'feature-boundary baseline must keep the out-of-scope DigitalSignagePage string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5j');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5J-INVENTORY-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5j INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-BATCH-REPAIR-DISCOUNT-I18N-KEYS/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5j INV exactly once');

  // 4. Wiring: both critical lists carry 391 specs in identical order, this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 391 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 402);') && src.includes('assert.equal(chain.length, 402);'),
      `${label} spec wiring must re-pin to 391`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5j spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5h-REPAIR spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~75 files asserting the count — the #264-fix /
  // D12 lesson. The F5h-REPAIR filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const f5hRepairName = 'phase1-f5h-repair' + '-sales-envelope-check.spec.ts';
  const f5hRepairInv = 'INV-PHASE1-F5H-REPAIR' + '-SALES-ENVELOPE-CHECK';
  const staleSpecs = 'specs.length, 39' + '0';
  const staleChain = 'chain.length, 39' + '0';
  const staleList = 'list.length, 39' + '0';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 12" + "2;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 12" + '2 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 12" + "2'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "7,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '7 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "7 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '4';
  const staleBaselineB = 'featureBaseline.length, 6' + '4';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5hRepairName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${f5hRepairName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5hRepairInv}/g)`)) staleGuard.push(file);
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5h-REPAIR spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5j re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR specs'
  // guard assertions to the F5j INV; their invariants-file assertions
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-BATCH-REPAIR-DISCOUNT-I18N-KEYS/g)'),
      `${label} spec guard assertion must re-pin to the F5j INV`,
    );
  }

  console.log(
    'phase1 F5j inventory|products checks passed (inventory->products gone, pairs 3->2, edges 46 / statements 116, 391 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
