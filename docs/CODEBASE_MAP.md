# Codebase Map - zs

Static text map for AI agents and human developers joining this codebase.
It answers one question only: where does a thing live, and what is the
first file to open? It does not explain accounting rules, does not draw
call graphs, and does not resolve runtime dependency injection. For
those, see the pointers in "Source of truth" below.

## Grounded at

- Base HEAD: `faf0d28a788c67f4b76f4219bb07f68bfc855a68` (short `faf0d28`).
- Measurement method: `git ls-files` counts at that HEAD, generated
  mechanically. Counts below are tracked files only; gitignored files,
  `node_modules`, and build output are not counted.
- Total tracked files at this HEAD: 4686.

## Freshness rule

Regenerate this map when a top-level directory, a backend module, or a
frontend feature directory is added, removed, or renamed, or when an
entry point moves. Do not hand-edit file counts: re-run the measurement
commands in "How to regenerate" and replace the tables wholesale.
`backend/test/critical/codebase-map.spec.ts` pins directory presence
(every directory under `backend/src/modules/` must be named in this
map) and the required sections; it deliberately does not assert exact
file counts, because counts rot on every commit. A stale map is worse
than no map: if the tree and this file disagree, trust the tree.

## Stack (verified from package files at this HEAD)

| Layer | Verified claim | Evidence |
|---|---|---|
| Backend | NestJS 11.1.18, TypeScript 5.9.3 | `backend/package.json` (`@nestjs/core`, `typescript`) |
| Backend data | Kysely 0.28.8 with PostgreSQL dialect, `pg` driver; migrations under `backend/src/database/migrations/` | `backend/package.json`, `backend/src/database/database.module.ts` (`PostgresDialect`, `Pool`) |
| Frontend | React 19.2.0, TypeScript 5.9.3, Vite 7.1.12 | `frontend/package.json`, `frontend/vite.config.ts` |
| Frontend mobile | Capacitor packages present in `frontend/package.json` | `frontend/package.json` (`@capacitor/*`); mobile build behaviour is not asserted here |
| Desktop | Electron shell entry `frontend/electron/main.cjs`; Windows Portable layout in `portable/` (launcher, PostgreSQL runtime, manifest) | `frontend/electron/main.cjs`, `portable/README.md`, `portable/manifest.portable.json` |
| Repository root | Package `zs-main` 1.1.40; `hostinger-api-entry.cjs` | root `package.json` |

No other stack claims are made in this map. If a framework is not
listed above, it was not verified from a package file for this map.

## Entry points

- Backend bootstrap: `backend/src/main.ts` (NestFactory bootstrap,
  `AppModule`). Module wiring: `backend/src/app.module.ts` (imports the
  feature modules listed below).
- Frontend bootstrap: `frontend/src/main.tsx` (renders `AppProviders`
  and `AppRouter` from `frontend/src/app/`).
- Desktop shell: `frontend/electron/main.cjs` (Electron `BrowserWindow`;
  companion files `preload.cjs`, `postgres-manager.cjs`,
  `runtime-config.cjs` in the same directory).
- Portable layout: `portable/README.md` describes the Windows Portable
  run contract; `portable/manifest.portable.json` is its manifest.
- Root entry: `hostinger-api-entry.cjs` (root `package.json` `main`).

## Top-level tree (tracked files)

| Top-level entry | Tracked files |
|---|---|
| `frontend` | 2720 |
| `backend` | 1566 |
| `scripts` | 97 |
| `docs` | 90 |
| `(repository root files)` | 71 |
| `portable` | 43 |
| `tools` | 26 |
| `releases` | 18 |
| `android-app` | 13 |
| `deploy` | 11 |
| `load-tests` | 11 |
| `android-app-lite` | 10 |
| `.github` | 7 |
| `pricing` | 2 |
| `.agents` | 1 |

Directories with no files listed above have zero tracked files at
this HEAD. Root capability documents (`*_CAPABILITIES.md`,
`SYSTEM_CAPABILITIES.md`, `SYSTEM_BLUEPRINT.md`, `AGENTS.md`) are
counted under repository root files; see `AGENTS.md` in the repository
root for capability-document ownership rules before editing them.

## Backend layout

- `backend/src/` total: 1064 files.
  - `backend/src/modules/`: 556 files in
    37 module directories (table below).
  - `backend/src/database/`: 412 files,
    including 389 migration files.
  - `backend/src/core/`: 52 files
    (including auth, audit, health, idempotency, logging).
  - `backend/src/common/`: 34 files
    (including filters, interceptors, pipes, utils - including
    `common/utils/invoice-totals.ts` and
    `common/utils/location-stock-ledger.ts`, both named in
    `docs/ENGINE_MAP.md`).
  - `backend/src/config/`: 7 files.
  - `backend/src/tools/`: 1 file.
- Backend tests: `backend/test/` (critical specs under
  `backend/test/critical/`, wired into the `test:critical` script in
  `backend/package.json`; the codebase-map guard spec is
  `backend/test/critical/codebase-map.spec.ts`).

## Backend modules

One entry per directory under `backend/src/modules/`. Each entry lists
only files actually present: the module file, controllers, services,
and engine files (basenames, relative to the module directory), plus
the tracked file count and the subdirectories present. No purpose
sentence is asserted here: read the module file and its service files
to learn what a module does, and read `docs/ENGINE_MAP.md` for the
canonical money engines.

### `backend/src/modules/accounting/` (51 files)

- Module: `accounting.module.ts`
- Controllers: `accounting.controller.ts`, `ar-collections.controller.ts`
- Services: `accounting-posting.service.ts`, `accounting-tenant-foundation.service.ts`, `accounting.service.ts`, `services/accounting-recovery.service.ts`, `services/aged-debts.service.ts`, `services/ar-collections.service.ts`, `services/balance-sheet.service.ts`, `services/cash-flow.service.ts`, `services/cost-center-allocations.service.ts`, `services/fiscal-year.service.ts`, `services/fixed-assets-scheduler.service.ts`, `services/forex-revaluation.service.ts`, `services/installment-interest-scheduler.service.ts`, `services/payment-allocation.service.ts`, `services/pdc-cheques.service.ts`, `services/sale-edit-remediation.service.ts`, `services/withholding-tax.service.ts`
- Engines: `engines/accounting-date.engine.ts`, `engines/accounting-foundation.engine.ts`, `engines/ar-dunning.engine.ts`, `engines/cash-flow-classification.engine.ts`, `engines/cogs-residual.engine.ts`, `engines/fiscal-period-generation.engine.ts`, `engines/fixed-asset-depreciation.engine.ts`, `engines/forex-difference.engine.ts`, `engines/fx-conversion.engine.ts`, `engines/installment-interest.engine.ts`, `engines/inventory-valuation.engine.ts`, `engines/journal-reversal.engine.ts`, `engines/money-minor-units.engine.ts`, `engines/pdc-transition.engine.ts`, `engines/sales-return-cost.engine.ts`
- Subdirectories: `dto`, `engines`, `remediation`, `services`

### `backend/src/modules/activation/` (8 files)

- Module: `activation.module.ts`
- Controllers: `activation.controller.ts`
- Services: `activation.service.ts`
- Engines: (none)
- Subdirectories: `dto`, `utils`

### `backend/src/modules/addons/` (4 files)

- Module: `addons.module.ts`
- Controllers: `addons.controller.ts`
- Services: `addons.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/ai-copilot/` (7 files)

- Module: `ai-copilot.module.ts`
- Controllers: `ai-copilot.controller.ts`
- Services: `ai-copilot.service.ts`, `services/ai-agent.service.ts`, `services/ai-knowledge.service.ts`
- Engines: `engines/ai-embedding.engine.spec.ts`, `engines/ai-embedding.engine.ts`
- Subdirectories: `engines`, `services`

### `backend/src/modules/approvals/` (3 files)

- Module: `approvals.module.ts`
- Controllers: `approval-workflow.controller.ts`
- Services: `approval-workflow.service.ts`
- Engines: (none)
- Subdirectories: (none)

### `backend/src/modules/bosta/` (4 files)

- Module: `bosta.module.ts`
- Controllers: `bosta.controller.ts`
- Services: `bosta.service.ts`
- Engines: (none)
- Subdirectories: (none)

### `backend/src/modules/cash-drawer/` (8 files)

- Module: `cash-drawer.module.ts`
- Controllers: `cash-drawer.controller.ts`
- Services: `cash-drawer.service.ts`
- Engines: (none)
- Subdirectories: `dto`, `helpers`

### `backend/src/modules/catalog/` (11 files)

- Module: `catalog.module.ts`
- Controllers: `catalog.controller.ts`
- Services: `catalog.service.ts`, `services/catalog-category.service.ts`, `services/catalog-product.service.ts`, `services/product-serials.service.ts`
- Engines: `engines/fashion-stock-safety.engine.ts`, `engines/pos-catalog-version.engine.ts`, `engines/stock-movement-total.engine.ts`
- Subdirectories: `dto`, `engines`, `services`

### `backend/src/modules/contracting/` (8 files)

- Module: `contracting.module.ts`
- Controllers: `contracting.controller.ts`
- Services: `contracting.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/crm/` (4 files)

- Module: `crm.module.ts`
- Controllers: `crm.controller.ts`
- Services: `crm.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/delivery-reps/` (25 files)

- Module: `delivery-reps.module.ts`
- Controllers: `delivery-reps.controller.ts`, `driver-portal.controller.ts`, `van-sales.controller.ts`
- Services: `delivery-reps.service.ts`, `services/van-field-execution.service.ts`, `services/van-fleet.service.ts`, `services/van-fraud-radar.service.ts`, `services/van-pre-sales.service.ts`, `services/van-promotions.service.ts`, `services/van-requisitions.service.ts`, `services/van-returns.service.ts`, `services/van-routes.service.ts`, `services/van-targets.service.ts`, `services/van-transfers.service.ts`, `van-sales.service.ts`
- Engines: (none)
- Subdirectories: `dto`, `services`

### `backend/src/modules/gcc-shipping/` (4 files)

- Module: `gcc-shipping.module.ts`
- Controllers: `gcc-shipping.controller.ts`
- Services: `gcc-shipping.service.ts`
- Engines: (none)
- Subdirectories: (none)

### `backend/src/modules/hr/` (27 files)

- Module: `hr.module.ts`
- Controllers: `controllers/end-of-service.controller.ts`, `controllers/recruitment-ats.controller.ts`, `employee-portal.controller.ts`, `hr.controller.ts`, `mobile-attendance.controller.ts`
- Services: `employee-portal.service.ts`, `hr.service.ts`, `mobile-attendance.service.ts`, `services/end-of-service.service.ts`, `services/recruitment-ats.service.ts`
- Engines: `engines/attendance-penalty.engine.ts`, `engines/employee-financial-statement.engine.ts`, `engines/employee-withdrawal-balance.engine.spec.ts`, `engines/employee-withdrawal-balance.engine.ts`, `engines/eos-calculation.engine.ts`, `engines/hourly-attendance-pay.engine.ts`, `engines/hr-payroll-run.engine.ts`, `engines/hr-statutory-policy.engine.ts`, `engines/payroll-accrual-allocation.engine.ts`, `engines/payroll-calculation.engine.ts`, `engines/recruitment-ats.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `services`

### `backend/src/modules/import-sales/` (13 files)

- Module: `import-sales.module.ts`
- Controllers: `import-sales.controller.ts`
- Services: `import-sales.service.ts`
- Engines: `engines/import-broker-capitalization.engine.ts`, `engines/import-feasibility.engine.ts`, `engines/import-form4-gate.engine.ts`, `engines/import-landed-cost.engine.ts`, `engines/import-payment-method.engine.ts`
- Subdirectories: `data`, `dto`, `engines`, `helpers`

### `backend/src/modules/inventory/` (34 files)

- Module: `inventory.module.ts`
- Controllers: `controllers/quality-assurance.controller.ts`, `controllers/reordering-rules.controller.ts`, `controllers/warehouse-bins.controller.ts`, `controllers/warehouse-packages.controller.ts`, `inventory.controller.ts`
- Services: `inventory.service.ts`, `services/inventory-adjustment.service.ts`, `services/inventory-count.service.ts`, `services/inventory-replenishment.service.ts`, `services/inventory-scope.service.ts`, `services/inventory-transfer.service.ts`, `services/quality-assurance.service.ts`, `services/reordering-rules.service.ts`, `services/reordering-scheduler.service.ts`, `services/warehouse-bins.service.ts`, `services/warehouse-packages.service.ts`
- Engines: `engines/package-barcode.engine.ts`, `engines/quality-control.engine.ts`, `engines/reordering-rule.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `helpers`, `services`

### `backend/src/modules/maintenance/` (6 files)

- Module: `maintenance.module.ts`
- Controllers: `maintenance.controller.ts`
- Services: `maintenance.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/manager-actions/` (5 files)

- Module: `manager-actions.module.ts`
- Controllers: `manager-actions.controller.ts`
- Services: `manager-actions.service.ts`, `manager-dashboard.service.ts`
- Engines: (none)
- Subdirectories: `helpers`

### `backend/src/modules/manufacturing/` (5 files)

- Module: `manufacturing.module.ts`
- Controllers: `controllers/manufacturing.controller.ts`
- Services: `services/manufacturing.service.ts`
- Engines: `engines/manufacturing-overhead.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `services`

### `backend/src/modules/maritime-freight/` (33 files)

- Module: `maritime-freight.module.ts`
- Controllers: `maritime-customer-portal.controller.ts`, `maritime-freight.controller.ts`, `maritime-public-tracking.controller.ts`
- Services: `maritime-automation-scheduler.service.ts`, `maritime-customer-portal.service.ts`, `maritime-freight.service.ts`, `maritime-mail.service.ts`
- Engines: `engines/air-freight.engine.spec.ts`, `engines/air-freight.engine.ts`, `engines/cargo-insurance.engine.ts`, `engines/carrier-credit.engine.ts`, `engines/freight-audit.engine.spec.ts`, `engines/freight-audit.engine.ts`, `engines/road-freight.engine.spec.ts`, `engines/road-freight.engine.ts`
- Subdirectories: `dto`, `engines`

### `backend/src/modules/partners/` (8 files)

- Module: `partners.module.ts`
- Controllers: `partners.controller.ts`
- Services: `partners.service.ts`
- Engines: (none)
- Subdirectories: `dto`, `helpers`

### `backend/src/modules/pharmacy/` (12 files)

- Module: `pharmacy.module.ts`
- Controllers: `pharmacy.controller.ts`
- Services: `pharmacy.service.ts`
- Engines: `engines/distributor-invoice-validation.engine.ts`, `engines/distributor-purchase.engine.ts`
- Subdirectories: `data`, `dto`, `engines`

### `backend/src/modules/pricing/` (4 files)

- Module: `pricing.module.ts`
- Controllers: `pricing.controller.ts`
- Services: `pricing.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/public/` (5 files)

- Module: `public.module.ts`
- Controllers: `public.controller.ts`
- Services: `public-trial-signup.service.ts`, `trial-signup-mail.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/purchases/` (36 files)

- Module: `purchases.module.ts`
- Controllers: `controllers/goods-receipt.controller.ts`, `controllers/purchase-orders.controller.ts`, `controllers/purchase-rfqs.controller.ts`, `purchases.controller.ts`
- Services: `purchases.service.ts`, `services/goods-receipt.service.ts`, `services/margin-protection.service.ts`, `services/purchase-landed-costs.service.ts`, `services/purchase-orders.service.ts`, `services/purchase-rfqs.service.ts`, `services/purchases-finance.service.ts`, `services/purchases-query.service.ts`, `services/purchases-reorder.service.ts`, `services/purchases-write.service.ts`, `services/supplier-payment-schedules.service.ts`
- Engines: `engines/duplicate-bill-detector.engine.ts`, `engines/grn-location-policy.engine.ts`, `engines/grni-settlement.engine.ts`, `engines/landed-cost-allocation.engine.ts`, `engines/landed-cost-wac.engine.ts`, `engines/purchase-order-receipt.engine.ts`, `engines/purchase-order-totals.engine.ts`, `engines/purchase-receipt-cost.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `helpers`, `services`

### `backend/src/modules/reports/` (23 files)

- Module: `reports.module.ts`
- Controllers: `reports.controller.ts`
- Services: `reports.service.ts`, `services/daily-commercial-rollup.service.ts`, `services/dynamic-pivot.service.ts`, `services/reports-admin.service.ts`, `services/reports-summary.service.ts`
- Engines: `engines/pivot-aggregation.engine.ts`
- Subdirectories: `dto`, `engines`, `helpers`, `services`

### `backend/src/modules/returns/` (11 files)

- Module: `returns.module.ts`
- Controllers: `returns.controller.ts`
- Services: `returns.service.ts`
- Engines: `engines/exchange-store-credit.engine.ts`, `engines/refund-tender.engine.ts`
- Subdirectories: `dto`, `engines`, `helpers`

### `backend/src/modules/saas-admin/` (11 files)

- Module: `saas-admin.module.ts`
- Controllers: `developer.controller.ts`, `saas-admin.controller.ts`, `saas-diagnostics.controller.ts`
- Services: `saas-admin.service.ts`, `saas-diagnostics.service.ts`, `trial-tenant-provisioning.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/sales/` (55 files)

- Module: `sales.module.ts`
- Controllers: `controllers/cashier-fraud-radar.controller.ts`, `controllers/commercial-subscription.controller.ts`, `controllers/customer-installments.controller.ts`, `controllers/delivery-aggregators.controller.ts`, `controllers/kds.controller.ts`, `controllers/kitchen-printers.controller.ts`, `controllers/pos-terminal.controller.ts`, `controllers/price-lists.controller.ts`, `controllers/quotations.controller.ts`, `controllers/restaurant-advanced-fnb.controller.ts`, `controllers/restaurant-food-waste.controller.ts`, `controllers/sales-orders.controller.ts`, `controllers/table-reservations.controller.ts`, `controllers/table-service-calls.controller.ts`, `sales.controller.ts`
- Services: `sales.service.ts`, `services/cashier-fraud-radar.service.ts`, `services/commercial-subscription.service.ts`, `services/customer-installments.service.ts`, `services/delivery-aggregators.service.ts`, `services/kds.service.ts`, `services/kitchen-printers.service.ts`, `services/pos-terminal.service.ts`, `services/price-lists.service.ts`, `services/quotations.service.ts`, `services/restaurant-advanced-fnb.service.ts`, `services/restaurant-food-waste.service.ts`, `services/sales-authorization.service.ts`, `services/sales-finance.service.ts`, `services/sales-orders.service.ts`, `services/sales-query.service.ts`, `services/sales-write.service.ts`, `services/table-reservations.service.ts`, `services/table-service-calls.service.ts`
- Engines: `engines/invoice-discount.engine.ts`, `engines/pos-exchange.engine.ts`, `engines/sale-tax-rate.engine.ts`, `engines/sale-tender.engine.ts`, `engines/subscription-billing.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `guards`, `helpers`, `services`

### `backend/src/modules/services/` (4 files)

- Module: `services.module.ts`
- Controllers: `services.controller.ts`
- Services: `services.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/sessions/` (9 files)

- Module: `sessions.module.ts`
- Controllers: `sessions.controller.ts`
- Services: `mfa.service.ts`, `password-reset-mail.service.ts`, `password-reset.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/settings/` (35 files)

- Module: `settings.module.ts`
- Controllers: `branches.controller.ts`, `controllers/daily-digest.controller.ts`, `controllers/offline-releases.controller.ts`, `controllers/settings-admin.controller.ts`, `controllers/settings-backup.controller.ts`, `controllers/settings-import.controller.ts`, `controllers/settings-support.controller.ts`, `controllers/tenant-transfer.controller.ts`, `controllers/whatsapp-gateway.controller.ts`, `settings.controller.ts`
- Services: `services/cloud-backup.service.ts`, `services/daily-digest.service.ts`, `services/diagnostics-scheduler.service.ts`, `services/offline-releases.service.ts`, `services/settings-admin.service.ts`, `services/settings-backup.service.ts`, `services/settings-demo-data.service.ts`, `services/settings-import.service.ts`, `services/settings-support.service.ts`, `services/tenant-transfer.service.ts`, `services/whatsapp-gateway.service.ts`, `settings.service.ts`
- Engines: (none)
- Subdirectories: `controllers`, `dto`, `services`

### `backend/src/modules/storefront/` (30 files)

- Module: `storefront.module.ts`
- Controllers: `controllers/marketplace-sync.controller.ts`, `storefront-merchant.controller.ts`, `storefront-public.controller.ts`
- Services: `services/marketplace-sync.service.ts`, `services/storefront-reservation-scheduler.service.ts`, `storefront-media.service.ts`, `storefront-payment.service.ts`, `storefront-social-preview.service.ts`, `storefront.service.ts`
- Engines: `engines/gateway-amount.engine.ts`, `engines/gateway-secret-mask.engine.ts`, `engines/marketplace-webhook-event.engine.ts`, `engines/online-order-access.engine.ts`, `engines/online-order-pricing.engine.ts`, `engines/paymob-notification.engine.ts`, `engines/store-public-url.engine.ts`, `engines/storefront-media.engine.ts`, `engines/storefront-offers.engine.ts`, `engines/storefront-reservation.engine.ts`, `engines/table-bill.engine.ts`, `engines/webhook-order-resolution.engine.ts`
- Subdirectories: `controllers`, `dto`, `engines`, `services`

### `backend/src/modules/tax-integration/` (19 files)

- Module: `tax-integration.module.ts`
- Controllers: `controllers/eta-invoices/eta-invoices.controller.ts`, `controllers/tax-settings/tax-settings.controller.ts`, `controllers/vat-declaration/vat-declaration.controller.ts`, `controllers/zatca/zatca.controller.ts`
- Services: `services/eta-auth/eta-auth.service.ts`, `services/eta-serializer/eta-serializer.service.ts`, `services/eta-submission/eta-signature-bridge.service.ts`, `services/eta-submission/eta-submission.service.ts`, `services/tax-settings/tax-settings.service.ts`, `services/vat-declaration/vat-declaration.service.ts`, `services/zatca/zatca-onboarding.service.ts`, `services/zatca/zatca-phase2.service.ts`, `services/zatca/zatca-submission.service.ts`
- Engines: `engines/configured-tax-id.engine.ts`, `engines/document-tax.engine.ts`, `engines/zatca-seller-identity.engine.ts`
- Subdirectories: `controllers`, `engines`, `services`

### `backend/src/modules/tenant-subscription/` (15 files)

- Module: `tenant-subscription.module.ts`
- Controllers: `tenant-subscription.controller.ts`
- Services: `gateways/payment-manager.service.ts`, `pricing/pricing-catalog.service.ts`, `tenant-subscription.service.ts`
- Engines: (none)
- Subdirectories: `dto`, `gateways`, `pricing`

### `backend/src/modules/tradein/` (4 files)

- Module: `tradein.module.ts`
- Controllers: `tradein.controller.ts`
- Services: `tradein.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/treasury/` (5 files)

- Module: `treasury.module.ts`
- Controllers: `treasury.controller.ts`
- Services: `treasury.service.ts`
- Engines: (none)
- Subdirectories: `dto`

### `backend/src/modules/users/` (10 files)

- Module: `users.module.ts`
- Controllers: `users.controller.ts`
- Services: `users.service.ts`
- Engines: `engines/user-plan-limit.engine.ts`
- Subdirectories: `dto`, `engines`, `helpers`

## Frontend layout

- `frontend/src/` total: 1883 files.
  - `frontend/src/features/`: 1530 files
    in feature directories (table below).
  - `frontend/src/shared/`: 157 files.
  - `frontend/src/styles/`: 63 files;
    `frontend/src/lib/`: 63 files;
    `frontend/src/types/`: 29 files;
    `frontend/src/app/`: 14 files;
    `frontend/src/locales/`: 8 files;
    `frontend/src/test/`: 6 files;
    `frontend/src/stores/`: 4 files;
    `frontend/src/config/`: 4 files.
- `frontend/electron/`: 183 files (desktop shell).
- Frontend checks: `npm --prefix frontend run qa` and the `guards:frontend`
  chain in the root `package.json` (see that file for the exact scripts).

## Frontend features

One entry per directory under `frontend/src/features/`. Each entry
lists the tracked file count, the subdirectories present, and the
files directly inside the feature directory (basenames). No purpose
sentence is asserted here: read the feature's files to learn what a
feature does. The frontend displays backend-computed values; see
`docs/ENGINE_MAP.md` forbidden pattern 6 before adding frontend
financial logic.

### `frontend/src/features/accounting/` (70 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `pages`, `types`, `utils`

### `frontend/src/features/accounts/` (26 files)

- Files in this directory: `contracts.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `schemas`, `utils`

### `frontend/src/features/activation/` (19 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `pages`

### `frontend/src/features/ai-copilot/` (1 file)

- Files in this directory: (none)
- Subdirectories: `components`

### `frontend/src/features/approvals/` (6 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `pages`

### `frontend/src/features/apps-store/` (7 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `components`, `data`, `pages`, `types`

### `frontend/src/features/audit/` (14 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `types`

### `frontend/src/features/auth/` (21 files)

- Files in this directory: `index.ts`, `useBootstrapAuth.spec.tsx`, `useBootstrapAuth.ts`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/cash-drawer/` (18 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `utils`

### `frontend/src/features/contracting/` (101 files)

- Files in this directory: `contracting.types.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `context`, `pages`, `utils`

### `frontend/src/features/crm/` (10 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `pages`

### `frontend/src/features/customers/` (23 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `constants`, `hooks`, `lib`, `pages`, `schemas`

### `frontend/src/features/dashboard/` (29 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/delivery-reps/` (76 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `offline`, `pages`, `utils`

### `frontend/src/features/hr/` (112 files)

- Files in this directory: `HR_ATTENDANCE_BACKEND_INVENTORY.md`, `HR_BACKEND_INVENTORY.md`, `HR_BACKEND_SCOPE.md`, `HR_REBUILD_PLAN.md`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `pages`, `utils`

### `frontend/src/features/import-sales/` (27 files)

- Files in this directory: `AddShipmentItemDialog.tsx`, `ChinaSourcingPage.tsx`, `ContainerAutopsyModal.tsx`, `ContainerDepositsManager.tsx`, `ContainerPreordersModal.tsx`, `CustomsBrokerManager.tsx`, `CustomsTariffCalculator.tsx`, `ImportApprovalsManager.tsx`, `ImportCommandCenter.tsx`, `ImportFxTreasuryManager.tsx`, `ImportProjectsManager.tsx`, `ImportReconciliationManager.tsx`, `ManagePartnersDialog.tsx`, `NewShipmentDialog.tsx`, `PartnerLedgerComponents.tsx`, `ProfitPool.tsx`, `ShipmentDetailsPage.tsx`, `ShipmentsManager.tsx`, `SupplierCredit.tsx`, `routes.tsx`
- Subdirectories: `api`, `components`

### `frontend/src/features/inventory/` (90 files)

- Files in this directory: `contracts.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `schemas`, `utils`

### `frontend/src/features/maintenance/` (15 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `constants`, `pages`, `utils`

### `frontend/src/features/manufacturing/` (25 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `pages`, `utils`

### `frontend/src/features/maritime-freight/` (58 files)

- Files in this directory: `index.ts`, `maritime-freight.types.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `context`, `hooks`, `pages`, `utils`

### `frontend/src/features/not-found/` (2 files)

- Files in this directory: `index.ts`
- Subdirectories: `pages`

### `frontend/src/features/pharmacy/` (27 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `constants`, `pages`, `types`

### `frontend/src/features/portals-hub/` (5 files)

- Files in this directory: (none)
- Subdirectories: `components`, `pages`

### `frontend/src/features/pos/` (179 files)

- Files in this directory: `contracts.spec.ts`, `contracts.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `types`, `utils`

### `frontend/src/features/pricing-center/` (15 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/products/` (82 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `schemas`, `utils`

### `frontend/src/features/public-trial/` (3 files)

- Files in this directory: `trial.constants.ts`
- Subdirectories: `api`, `pages`

### `frontend/src/features/purchases/` (75 files)

- Files in this directory: `contracts.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `__tests__`, `api`, `components`, `hooks`, `lib`, `pages`, `schemas`, `utils`

### `frontend/src/features/reports/` (43 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/returns/` (24 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/saas-admin/` (26 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `pages`

### `frontend/src/features/sales/` (58 files)

- Files in this directory: `contracts.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `utils`

### `frontend/src/features/services/` (12 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/settings/` (97 files)

- Files in this directory: `contracts.ts`, `desktop-mobile-isolation.spec.ts`, `index.ts`, `routes.tsx`
- Subdirectories: `__tests__`, `api`, `components`, `hooks`, `pages`, `schemas`

### `frontend/src/features/storefront/` (86 files)

- Files in this directory: `index.ts`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`, `types`

### `frontend/src/features/suppliers/` (16 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `pages`, `schemas`

### `frontend/src/features/tax-integration/` (3 files)

- Files in this directory: `index.ts`
- Subdirectories: `components`

### `frontend/src/features/tradein/` (9 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `api`, `components`, `pages`

### `frontend/src/features/treasury/` (17 files)

- Files in this directory: `index.ts`, `routes.tsx`
- Subdirectories: `api`, `components`, `hooks`, `lib`, `pages`

### `frontend/src/features/updates/` (6 files)

- Files in this directory: `routes.tsx`
- Subdirectories: `hooks`, `pages`, `utils`

## Source of truth

- Canonical money engines: `docs/ENGINE_MAP.md` is the source of truth.
  This map does not duplicate its engine table. Read ENGINE_MAP before
  adding any financial or stock logic; reuse the canonical engine or
  extend it with a spec, never copy the math inline.
- Accounting rules and closed decisions: `ARCHITECTURE_INVARIANTS.md`
  (2,569 lines at this HEAD). This map asserts no accounting rule; if
  this map and the invariants file disagree, the invariants file wins.
- Capability documentation: root `AGENTS.md` routes capability changes
  through `SYSTEM_BLUEPRINT.md` / `SYSTEM_CAPABILITIES.md` and the
  owning domain file. This map is a navigation aid, not a capability
  document: do not append feature histories here.

## Financial boundary pointer (verified by grep at this HEAD)

- The posting boundary is `postDomainJournal` in
  `backend/src/modules/accounting/accounting-posting.service.ts`
  (defined there; verified by grep). Callers found by grep at this
  HEAD include files in the accounting, catalog, contracting, and
  import-sales modules (for example
  `backend/src/modules/accounting/accounting.service.ts`,
  `backend/src/modules/catalog/services/catalog-product.service.ts`,
  `backend/src/modules/contracting/contracting.service.ts`, and
  `backend/src/modules/import-sales/import-sales.service.ts`). The
  list above is illustrative, not exhaustive: re-run the grep before
  claiming a complete caller list.
- All money math on posting paths goes through the canonical rounding
  engine named in `docs/ENGINE_MAP.md`. The guard spec
  `backend/test/critical/architecture-guard.spec.ts` pins the
  forbidden patterns (hardcoded VAT rate, pool-handle stock calls,
  swallowed compensating writes, `toFixed(2)` in the posting
  service).

## Navigation recipes

### Answer a question about one area

1. Find the module or feature directory in the tables above.
2. Read its module/service files (backend) or its directory files
   (frontend) - not the whole repository.
3. If the question needs more than one file, build a scoped Repomix
   pack: one slice plus `docs/ENGINE_MAP.md` plus
   `ARCHITECTURE_INVARIANTS.md`, Markdown style, generated locally
   at the live HEAD, used for that question, then discarded. Never
   commit a pack, never send a pack to a hosted service, and never
   reuse a pack after the HEAD moves. Full procedure: the scoped-pack
   runbook kept in the audit workspace (not committed to this
   repository).
4. Check `docs/ENGINE_MAP.md` before writing or changing any money
   or stock computation, and check `ARCHITECTURE_INVARIANTS.md` for
   the closed decision that governs the area.

### Find where a computation lives

1. Search the canonical engine table in `docs/ENGINE_MAP.md` first.
2. If the computation is not a money engine, search `engines/` files
   under the owning module (listed above), then grep for the function
   name across `backend/src/`. Do not assume a second implementation
   in another module is equivalent: ENGINE_MAP records that repeated
   inventory/manufacturing calculations remain open work.

### Add a new module or feature

1. Add the directory and its files, following the existing module
   shape (module file, controllers, services) visible in the tables
   above.
2. Regenerate this map (see below) so the new directory is listed;
   the guard spec fails if a backend module directory is not named
   here.
3. If the change adds or changes a capability, follow the repository
   `AGENTS.md` documentation routing instead of appending the
   description to this map.

## Not covered by this map

- No call graph, no import graph, and no dependency graph. The
  ENGINE_MAP deliberately does not keep one either (it rots faster
  than it helps); use grep and the scoped-pack recipe above.
- No runtime dependency-injection resolution: NestJS module wiring is
  listed by file presence only. Read `app.module.ts` and each
  `*.module.ts` file for the actual wiring.
- No accounting rules, tax rates, prices, or business decisions:
  those live in `ARCHITECTURE_INVARIANTS.md` and in code, never in
  this map.
- No database schema: migrations live under
  `backend/src/database/migrations/`. Never infer a column from code
  alone; check the migration files on disk.
- No deployment topology beyond the entry points and stack rows
  above. Deployment and backup invariants live in
  `ARCHITECTURE_INVARIANTS.md` and the repository `AGENTS.md`.
- No visual diagrams. Diagram generation needs an LLM provider and
  human review of every diagram; it is deferred and is not part of
  this map.

## How to regenerate

From a clean checkout at the target HEAD, run:

```
git ls-files | wc -l
git ls-files | cut -d/ -f1 | sort | uniq -c | sort -rn
ls backend/src/modules frontend/src/features
```

Then rebuild the tables from that output, verify the stack rows
against `backend/package.json` / `frontend/package.json` /
`backend/src/database/database.module.ts` again, and run the guard
spec `backend/test/critical/codebase-map.spec.ts`. Never hand-edit
counts to make them look current.
