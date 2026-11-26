# Module Public Doors — Inventory

- Grounded at HEAD `fc3334c46` (file #20 repair). Method: the same static import scan as `zs-module-isolation-map.md` and `backend/test/critical/module-boundary.spec.ts` (INV-MODULE-BOUNDARY-BASELINE): every static import statement in a non-spec source file counts once; comments stripped first.
- Pinned coupling at this HEAD: backend 71 edges / 652 statements (re-pinned from 650 by the van-transfer-loaded-amount-3dp package: two new delivery-reps->accounting statements, the tenant base-currency lookup and the roundMoney import; the 650 pin itself came from the residual-rounding-deposits package), frontend 57 edges / 133 statements, 7 backend + 12 frontend bidirectional pairs, 79 external imports into `accounting-posting.service`, 15 into `accounting-tenant-foundation.service`.
- Backend modules: 37. Modules with inbound imports today: 20. Modules with no inbound imports today: 17 — their intended door is their Nest module file only, until a caller needs more.
- Frontend features: 40. Features with inbound imports today: 20. Features with a public `index.ts`: 26 of 40; missing it: 14 (listed in §3).
- `Imported by` lists the files other modules actually import today, with the importing module and statement count. That list IS the de-facto door today. Phase 1 is decided (2026-11-18): the 8 helper/util files once flagged in this inventory are all confirmed public doors — each is a shared function surface whose cross-module importers are legitimate and whose owning module is correct (reasons per door in section 4). No file is hidden by this document.
- This document is pinned by `backend/test/critical/module-doors.spec.ts` (INV-MODULE-DOORS): every module/feature heading must exist, the missing-index list must match disk, and the pinned counts above must be present.

## 1. Backend doors (37)

### backend/accounting

- Nest module: `backend/src/modules/accounting/accounting.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/accounting/accounting-boundaries` — 3 statement(s), from delivery-reps (1), maritime-freight (1), sales (1)
  - `backend/src/modules/accounting/accounting-currency` — 105 statement(s), from cash-drawer (3), catalog (1), contracting (3), delivery-reps (18), import-sales (7), inventory (4), maintenance (2), manufacturing (1), maritime-freight (8), partners (1), pharmacy (2), purchases (18), reports (5), returns (6), sales (15), services (1), settings (3), storefront (4), tax-integration (1), tradein (1), treasury (1)
  - `backend/src/modules/accounting/accounting-period-lock` — 6 statement(s), from contracting (1), maritime-freight (2), settings (1), storefront (1), treasury (1)
  - `backend/src/modules/accounting/accounting-posting.service` — 79 statement(s), from cash-drawer (2), catalog (4), contracting (2), delivery-reps (11), hr (5), import-sales (9), inventory (4), maintenance (2), manufacturing (1), maritime-freight (7), partners (1), pharmacy (2), purchases (12), returns (4), sales (7), services (1), settings (1), storefront (2), tradein (1), treasury (1)
  - `backend/src/modules/accounting/accounting-tenant-foundation.service` — 15 statement(s), from catalog (2), import-sales (9), maintenance (2), pharmacy (2)
  - `backend/src/modules/accounting/accounting.module` — 20 statement(s), from cash-drawer (1), catalog (1), contracting (1), delivery-reps (1), hr (1), import-sales (1), inventory (1), maintenance (1), manufacturing (1), maritime-freight (1), partners (1), pharmacy (1), purchases (1), returns (1), sales (1), services (1), settings (1), storefront (1), tradein (1), treasury (1)
  - `backend/src/modules/accounting/accounting.service` — 1 statement(s), from hr (1)
  - `backend/src/modules/accounting/engines/accounting-date.engine` — 54 statement(s), from contracting (10), delivery-reps (6), hr (1), import-sales (12), inventory (2), maritime-freight (7), pharmacy (1), purchases (5), reports (1), returns (2), sales (3), settings (1), storefront (2), tax-integration (1)
  - `backend/src/modules/accounting/engines/forex-difference.engine` — 1 statement(s), from maritime-freight (1)
  - `backend/src/modules/accounting/engines/fx-conversion.engine` — 9 statement(s), from maritime-freight (9)
  - `backend/src/modules/accounting/engines/installment-interest.engine` — 1 statement(s), from sales (1)
  - `backend/src/modules/accounting/engines/inventory-valuation.engine` — 1 statement(s), from import-sales (1)
  - `backend/src/modules/accounting/engines/money-minor-units.engine` — 191 statement(s), from cash-drawer (6), catalog (7), contracting (3), delivery-reps (26), hr (21), import-sales (12), inventory (4), maintenance (2), manufacturing (2), maritime-freight (9), partners (1), pharmacy (3), purchases (28), reports (12), returns (11), sales (23), services (1), settings (2), storefront (13), tax-integration (3), tradein (1), treasury (1)
  - `backend/src/modules/accounting/fx-rate-resolution` — 10 statement(s), from import-sales (5), maritime-freight (5)
  - `backend/src/modules/accounting/inventory-valuation` — 14 statement(s), from import-sales (2), maintenance (1), manufacturing (1), purchases (6), returns (2), sales (1), tradein (1)
  - `backend/src/modules/accounting/partner-subledger` — 3 statement(s), from contracting (1), maritime-freight (2)
- Intended door: the Nest module file plus the 16 file(s) above.

### backend/activation

- Nest module: `backend/src/modules/activation/activation.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/activation/activation.module` — 1 statement(s), from sessions (1)
  - `backend/src/modules/activation/activation.service` — 1 statement(s), from sessions (1)
- Intended door: the Nest module file plus the 2 file(s) above.

### backend/addons

- Nest module: `backend/src/modules/addons/addons.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`addons.module.ts`).

### backend/ai-copilot

- Nest module: `backend/src/modules/ai-copilot/ai-copilot.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/ai-copilot/ai-copilot.module` — 1 statement(s), from settings (1)
  - `backend/src/modules/ai-copilot/ai-copilot.service` — 1 statement(s), from settings (1)
- Intended door: the Nest module file plus the 2 file(s) above.

### backend/approvals

- Nest module: `backend/src/modules/approvals/approvals.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/approvals/approval-workflow.service` — 1 statement(s), from purchases (1)
  - `backend/src/modules/approvals/approvals.module` — 1 statement(s), from purchases (1)
- Intended door: the Nest module file plus the 2 file(s) above.

### backend/bosta

- Nest module: `backend/src/modules/bosta/bosta.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`bosta.module.ts`).

### backend/cash-drawer

- Nest module: `backend/src/modules/cash-drawer/cash-drawer.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/cash-drawer/cash-drawer.module` — 2 statement(s), from hr (1), sales (1)
  - `backend/src/modules/cash-drawer/cash-drawer.service` — 5 statement(s), from hr (3), sales (2)
  - `backend/src/modules/cash-drawer/helpers/cash-drawer.helper` — 6 statement(s), from delivery-reps (5), sales (1)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/catalog

- Nest module: `backend/src/modules/catalog/catalog.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/catalog/engines/stock-movement-total.engine` — 2 statement(s), from purchases (1), settings (1)
- Intended door: the Nest module file plus the 1 file(s) above.

### backend/contracting

- Nest module: `backend/src/modules/contracting/contracting.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`contracting.module.ts`).

### backend/crm

- Nest module: `backend/src/modules/crm/crm.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`crm.module.ts`).

### backend/delivery-reps

- Nest module: `backend/src/modules/delivery-reps/delivery-reps.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/delivery-reps/services/van-common.util` — 3 statement(s), from import-sales (1), partners (1), purchases (1)
  - `backend/src/modules/delivery-reps/van-routes-schedule.util` — 1 statement(s), from partners (1)
  - `backend/src/modules/delivery-reps/van-trip-counters.engine` — 2 statement(s), from sales (2)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/gcc-shipping

- Nest module: `backend/src/modules/gcc-shipping/gcc-shipping.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`gcc-shipping.module.ts`).

### backend/hr

- Nest module: `backend/src/modules/hr/hr.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`hr.module.ts`).

### backend/import-sales

- Nest module: `backend/src/modules/import-sales/import-sales.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/import-sales/helpers/import-lot-allocation.helper` — 7 statement(s), from inventory (3), returns (1), sales (3)
- Intended door: the Nest module file plus the 1 file(s) above.

### backend/inventory

- Nest module: `backend/src/modules/inventory/inventory.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/inventory/helpers/inventory-tracked-stock.helper` — 1 statement(s), from purchases (1)
  - `backend/src/modules/inventory/inventory.module` — 2 statement(s), from catalog (1), manufacturing (1)
  - `backend/src/modules/inventory/services/inventory-scope.service` — 6 statement(s), from catalog (6)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/maintenance

- Nest module: `backend/src/modules/maintenance/maintenance.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`maintenance.module.ts`).

### backend/manager-actions

- Nest module: `backend/src/modules/manager-actions/manager-actions.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`manager-actions.module.ts`).

### backend/manufacturing

- Nest module: `backend/src/modules/manufacturing/manufacturing.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`manufacturing.module.ts`).

### backend/maritime-freight

- Nest module: `backend/src/modules/maritime-freight/maritime-freight.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`maritime-freight.module.ts`).

### backend/partners

- Nest module: `backend/src/modules/partners/partners.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`partners.module.ts`).

### backend/pharmacy

- Nest module: `backend/src/modules/pharmacy/pharmacy.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`pharmacy.module.ts`).

### backend/pricing

- Nest module: `backend/src/modules/pricing/pricing.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`pricing.module.ts`).

### backend/public

- Nest module: `backend/src/modules/public/public.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`public.module.ts`).

### backend/purchases

- Nest module: `backend/src/modules/purchases/purchases.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/purchases/engines/landed-cost-allocation.engine` — 1 statement(s), from import-sales (1)
  - `backend/src/modules/purchases/purchases.module` — 1 statement(s), from pharmacy (1)
  - `backend/src/modules/purchases/purchases.service` — 1 statement(s), from pharmacy (1)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/reports

- Nest module: `backend/src/modules/reports/reports.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/reports/helpers/reports-range.helper` — 2 statement(s), from delivery-reps (1), sales (1)
- Intended door: the Nest module file plus the 1 file(s) above.

### backend/returns

- Nest module: `backend/src/modules/returns/returns.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/returns/returns.module` — 1 statement(s), from sales (1)
  - `backend/src/modules/returns/returns.service` — 2 statement(s), from sales (2)
- Intended door: the Nest module file plus the 2 file(s) above.

### backend/saas-admin

- Nest module: `backend/src/modules/saas-admin/saas-admin.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/saas-admin/saas-admin.module` — 1 statement(s), from public (1)
  - `backend/src/modules/saas-admin/trial-tenant-provisioning.service` — 1 statement(s), from public (1)
  - `backend/src/modules/saas-admin/trial.constants` — 2 statement(s), from public (2)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/sales

- Nest module: `backend/src/modules/sales/sales.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/sales/engines/invoice-discount.engine` — 2 statement(s), from returns (2)
  - `backend/src/modules/sales/engines/pos-exchange.engine` — 2 statement(s), from returns (2)
  - `backend/src/modules/sales/engines/price-list-resolution.engine` — 1 statement(s), from delivery-reps (1)
  - `backend/src/modules/sales/engines/sale-tax-rate.engine` — 4 statement(s), from delivery-reps (1), maritime-freight (3)
  - `backend/src/modules/sales/helpers/restaurant-modifier-contract.helper` — 1 statement(s), from storefront (1)
  - `backend/src/modules/sales/helpers/sales-write.helper` — 2 statement(s), from delivery-reps (2)
  - `backend/src/modules/sales/sales.module` — 2 statement(s), from delivery-reps (1), storefront (1)
  - `backend/src/modules/sales/sales.service` — 3 statement(s), from delivery-reps (1), storefront (2)
  - `backend/src/modules/sales/services/kds.service` — 2 statement(s), from storefront (2)
  - `backend/src/modules/sales/services/restaurant-advanced-fnb.service` — 1 statement(s), from storefront (1)
  - `backend/src/modules/sales/services/sales-authorization.service` — 1 statement(s), from returns (1)
  - `backend/src/modules/sales/services/sales-finance.service` — 3 statement(s), from delivery-reps (3)
- Intended door: the Nest module file plus the 12 file(s) above.

### backend/services

- Nest module: `backend/src/modules/services/services.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`services.module.ts`).

### backend/sessions

- Nest module: `backend/src/modules/sessions/sessions.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`sessions.module.ts`).

### backend/settings

- Nest module: `backend/src/modules/settings/settings.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/settings/services/settings-demo-data.service` — 1 statement(s), from saas-admin (1)
  - `backend/src/modules/settings/services/whatsapp-gateway.service` — 21 statement(s), from approvals (1), cash-drawer (2), delivery-reps (1), maritime-freight (4), purchases (1), returns (2), sales (3), storefront (7)
  - `backend/src/modules/settings/settings.module` — 9 statement(s), from approvals (1), cash-drawer (1), delivery-reps (1), maritime-freight (1), purchases (1), returns (1), saas-admin (1), sales (1), storefront (1)
  - `backend/src/modules/settings/settings.service` — 1 statement(s), from saas-admin (1)
- Intended door: the Nest module file plus the 4 file(s) above.

### backend/storefront

- Nest module: `backend/src/modules/storefront/storefront.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/storefront/engines/store-public-url.engine` — 5 statement(s), from ai-copilot (1), saas-admin (2), tenant-subscription (2)
  - `backend/src/modules/storefront/storefront-media.service` — 4 statement(s), from catalog (4)
  - `backend/src/modules/storefront/storefront.service` — 5 statement(s), from catalog (5)
- Intended door: the Nest module file plus the 3 file(s) above.

### backend/tax-integration

- Nest module: `backend/src/modules/tax-integration/tax-integration.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/tax-integration/services/zatca/zatca-invoice-status` — 1 statement(s), from sales (1)
- Intended door: the Nest module file plus the 1 file(s) above.

### backend/tenant-subscription

- Nest module: `backend/src/modules/tenant-subscription/tenant-subscription.module.ts`
- Imported by (de-facto door today):
  - `backend/src/modules/tenant-subscription/pricing/pricing-catalog.service` — 2 statement(s), from public (2)
- Intended door: the Nest module file plus the 1 file(s) above.

### backend/tradein

- Nest module: `backend/src/modules/tradein/tradein.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`tradein.module.ts`).

### backend/treasury

- Nest module: `backend/src/modules/treasury/treasury.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`treasury.module.ts`).

### backend/users

- Nest module: `backend/src/modules/users/users.module.ts`
- Imported by: no other module imports this module today.
- Intended door: the Nest module file only (`users.module.ts`).

## 2. Frontend doors (40)

### frontend/accounting

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/accounting` — 7 statement(s), from cash-drawer (1), import-sales (4), suppliers (2)
  - `frontend/src/features/accounting/api/cost-centers.api` — 1 statement(s), from treasury (1)
- Intended door: `frontend/src/features/accounting/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/accounts

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/accounts` — 2 statement(s), from suppliers (2)
  - `frontend/src/features/accounts/api/accounts.api` — 1 statement(s), from purchases (1)
- Intended door: `frontend/src/features/accounts/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/activation

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/activation/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/ai-copilot

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/ai-copilot/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/approvals

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/approvals/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/apps-store

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/apps-store/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/audit

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/audit` — 2 statement(s), from reports (1), settings (1)
- Intended door: `frontend/src/features/audit/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/auth

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/auth/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/cash-drawer

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/cash-drawer` — 1 statement(s), from pos (1)
- Intended door: `frontend/src/features/cash-drawer/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/contracting

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/contracting/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/crm

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/crm/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/customers

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/customers` — 1 statement(s), from sales (1)
  - `frontend/src/features/customers/api/customers.api` — 3 statement(s), from delivery-reps (1), maritime-freight (1), sales (1)
  - `frontend/src/features/customers/constants/customer-profiles` — 2 statement(s), from accounts (2)
- Intended door: `frontend/src/features/customers/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/dashboard

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/dashboard/hooks/useDashboardOverview` — 1 statement(s), from activation (1)
- Intended door: `frontend/src/features/dashboard/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/delivery-reps

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/delivery-reps/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/hr

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by (de-facto door today):
  - `frontend/src/features/hr/api/hr.api` — 1 statement(s), from settings (1)
- Intended door: `frontend/src/features/hr/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/import-sales

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/import-sales/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/inventory

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/inventory` — 2 statement(s), from products (2)
- Intended door: `frontend/src/features/inventory/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/maintenance

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by (de-facto door today):
  - `frontend/src/features/maintenance/api/maintenance.api` — 1 statement(s), from products (1)
  - `frontend/src/features/maintenance/constants/maintenance-profiles` — 4 statement(s), from products (1), settings (1), tradein (2)
- Intended door: `frontend/src/features/maintenance/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/manufacturing

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by (de-facto door today):
  - `frontend/src/features/manufacturing/api/work-orders.api` — 1 statement(s), from sales (1)
- Intended door: `frontend/src/features/manufacturing/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/maritime-freight

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/maritime-freight/api/maritime-freight.api` — 1 statement(s), from accounts (1)
- Intended door: `frontend/src/features/maritime-freight/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/not-found

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/not-found/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/pharmacy

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by (de-facto door today):
  - `frontend/src/features/pharmacy/api/pharmacy.api` — 1 statement(s), from inventory (1)
  - `frontend/src/features/pharmacy/types/pharmacy.types` — 1 statement(s), from inventory (1)
- Intended door: `frontend/src/features/pharmacy/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/portals-hub

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/portals-hub/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/pos

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/pos` — 11 statement(s), from activation (1), cash-drawer (1), products (2), sales (2), settings (3), storefront (2)
  - `frontend/src/features/pos/components/pos-workspace/PosSaleSuccessDialog` — 1 statement(s), from storefront (1)
  - `frontend/src/features/pos/lib/pos-offline-sync` — 1 statement(s), from cash-drawer (1)
  - `frontend/src/features/pos/lib/pos.domain` — 2 statement(s), from products (2)
  - `frontend/src/features/pos/lib/pos.persistence` — 1 statement(s), from storefront (1)
  - `frontend/src/features/pos/lib/weighted-barcode` — 1 statement(s), from products (1)
  - `frontend/src/features/pos/pages/DisplaysPortalPage` — 1 statement(s), from sales (1)
  - `frontend/src/features/pos/types/pos.types` — 1 statement(s), from storefront (1)
- Intended door: `frontend/src/features/pos/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/pricing-center

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/pricing-center/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/products

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/products` — 11 statement(s), from inventory (5), maintenance (1), manufacturing (2), pos (1), purchases (1), settings (1)
  - `frontend/src/features/products/api/products.api` — 3 statement(s), from delivery-reps (1), inventory (1), pos (1)
  - `frontend/src/features/products/components/BarcodePrintDialog` — 1 statement(s), from purchases (1)
  - `frontend/src/features/products/components/EditProductForm` — 1 statement(s), from pos (1)
  - `frontend/src/features/products/components/NewProductForm` — 2 statement(s), from pos (1), purchases (1)
  - `frontend/src/features/products/components/SerialLookupModal` — 1 statement(s), from pos (1)
- Intended door: `frontend/src/features/products/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/public-trial

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/public-trial/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/purchases

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/purchases/api/purchases.api` — 2 statement(s), from accounts (1), reports (1)
- Intended door: `frontend/src/features/purchases/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/reports

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/reports/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/returns

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/returns/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/saas-admin

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/saas-admin/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/sales

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/sales` — 3 statement(s), from customers (2), pos (1)
  - `frontend/src/features/sales/api/sales.api` — 6 statement(s), from accounts (1), delivery-reps (2), pos (2), reports (1)
  - `frontend/src/features/sales/lib/sales-workspace.helpers` — 1 statement(s), from reports (1)
- Intended door: `frontend/src/features/sales/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/services

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/services/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/settings

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/settings` — 6 statement(s), from audit (1), delivery-reps (1), pos (2), products (1), updates (1)
  - `frontend/src/features/settings/api/settings.api` — 5 statement(s), from activation (1), apps-store (1), contracting (1), maritime-freight (1), pos (1)
  - `frontend/src/features/settings/components/modular-configurator/modular-presets` — 10 statement(s), from activation (6), apps-store (4)
  - `frontend/src/features/settings/hooks/useSettingsMutations` — 1 statement(s), from activation (1)
  - `frontend/src/features/settings/pages/OfflineReleasesPage` — 1 statement(s), from saas-admin (1)
- Intended door: `frontend/src/features/settings/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/storefront

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/storefront` — 5 statement(s), from pos (4), settings (1)
  - `frontend/src/features/storefront/api/marketplace-sync.api` — 12 statement(s), from settings (12)
  - `frontend/src/features/storefront/api/storefront.api` — 3 statement(s), from pos (3)
  - `frontend/src/features/storefront/components/ConvertDeliveryModal` — 1 statement(s), from pos (1)
  - `frontend/src/features/storefront/lib/storefront-pos-loader` — 1 statement(s), from pos (1)
  - `frontend/src/features/storefront/pages/MerchantOnlineOrdersPage` — 1 statement(s), from sales (1)
  - `frontend/src/features/storefront/types/storefront.types` — 1 statement(s), from pos (1)
- Intended door: `frontend/src/features/storefront/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/suppliers

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/suppliers/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/tax-integration

- Public `index.ts`: yes
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/tax-integration/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/tradein

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by (de-facto door today):
  - `frontend/src/features/tradein/api/tradein.api` — 1 statement(s), from products (1)
- Intended door: `frontend/src/features/tradein/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/treasury

- Public `index.ts`: yes
- Imported by (de-facto door today):
  - `frontend/src/features/treasury` — 2 statement(s), from accounting (2)
- Intended door: `frontend/src/features/treasury/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

### frontend/updates

- Public `index.ts`: NO — missing, create in Phase 5
- Imported by: no other feature imports this feature today.
- Intended door: `frontend/src/features/updates/index.ts` re-exporting the file(s) above; Phase 5 creates the index where missing.

## 3. Features missing a public index.ts (14)

- `ai-copilot`
- `approvals`
- `apps-store`
- `delivery-reps`
- `hr`
- `import-sales`
- `maintenance`
- `manufacturing`
- `pharmacy`
- `portals-hub`
- `public-trial`
- `saas-admin`
- `tradein`
- `updates`

Flagged imported files total: 0 — 6 of the 8 resolved in Phase 1 (see section 4); the 7th (the purchases write helper) was retired by Phase 1 B6, which moved its one cross-module function to the shared layer (src/common/utils), so it is no longer a cross-module door; the 8th (the sales discount-filter helper) was retired by Phase 1 B1, which moved it to the shared layer (src/common/utils), so it is no longer a cross-module door; no flag remains in this document.

## 4. Phase 1 door resolution (2026-11-18)

Phase 1 decision: KEEP PUBLIC for the 6 remaining doors. (The 7th door, the purchases write helper, was retired by Phase 1 B6, 2026-11-26: the file's one cross-module function moved to `backend/src/common/utils/purchase-line-totals.helper.ts` to break the accounting|purchases pair, so it is no longer a module door. Its §4 row below is removed; the purchases door table loses its line, 4 -> 3 files. The 8th door, `backend/src/modules/sales/helpers/sales-discount-filter.helper`, was retired by Phase 1 B1, 2026-11-26: the file moved to `backend/src/common/utils/sales-discount-filter.helper.ts` to break the reports|sales pair, so it is no longer a module door. Its §4 row below is removed; the sales door table loses its line, 14 -> 13 files.) No file moved, no import re-pointed, no behaviour changed at the 2026-11-18 decision itself. Grounding re-verified at HEAD 35cdf065c (before the B1 retirement noted above): the cross-module statement counts below still match this document exactly (same static import scan as the header — comments stripped, non-spec source files only). The flag itself was raised by file path alone (every flagged file lives under a `helpers/` folder); it was never a coupling finding — the already-public accounting engines (for example money-minor-units.engine, 190 statements) were never flagged, and none of the imports below is a wrong-owner import.

| Door (owning module) | Cross-module importers (statements, verified) | What it is | Verdict and reason |
| --- | --- | --- | --- |
| `backend/src/modules/cash-drawer/helpers/cash-drawer.helper` | delivery-reps (5), sales (1) | Pure drawer math: paginate/filter/map shift rows, variance, amount assertions, shift doc-no | KEEP PUBLIC — the van services and the sale path share the same shift/drawer math; cash-drawer is the correct owner |
| `backend/src/modules/import-sales/helpers/import-lot-allocation.helper` | inventory (3), returns (1), sales (3) | Lot allocation engine: allocate/restore/transfer/sync import lots inside the caller's transaction, plus the pure import-sale cost calculation | KEEP PUBLIC — inventory, returns and sales all operate on the same import lots, which import-sales creates; a move would touch money/cost code (import-sale cost / COGS), so no move in this package. Follow-up for a future isolation phase: consider promoting it to a dedicated lots service behind a service method instead of direct helper imports |
| `backend/src/modules/inventory/helpers/inventory-tracked-stock.helper` | purchases (1) | Single guard: refuses a quantity-only stock mutation on a serial- or batch-tracked product inside the stock transaction | KEEP PUBLIC — the purchase receipt writes stock and must respect the tracked-stock guard; inventory owns the tracked-stock rule |
| `backend/src/modules/reports/helpers/reports-range.helper` | delivery-reps (1), sales (1) | Pure date-range, business-day bounds, pagination and scope-filter utilities | KEEP PUBLIC — generic report-range utility owned by reports; the two outside callers need exactly this |
| `backend/src/modules/sales/helpers/restaurant-modifier-contract.helper` | storefront (1) | Pure restaurant modifier price/contract enforcement (resolve prices, enforce group rules) | KEEP PUBLIC — the online order path carries the same modifier contract as the POS sale path; sales defines the contract |
| `backend/src/modules/sales/helpers/sales-write.helper` | delivery-reps (2) | Pure sale-write math: prepared sale items, below-floor detection, conversion recovery, residual rounding, store-credit calculations, offer helpers | KEEP PUBLIC — van field sales import the offer helpers (isOfferActive, pickBestApplicableOffer); sales is the correct owner |
