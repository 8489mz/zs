# stock_movements Direct Writes — Inventory

- Grounded at HEAD `edca43058`, re-scanned after the archive-residual fix (INV-STOCK-MOVEMENTS-ARCHIVE-ROW): the scan still finds every write below, plus the one new row at `catalog-product-archive.service.ts:364`.
- Re-scanned at HEAD `16dd42877` (van-trial fix chain): +2 writes from F19 paired final-issue movement (INV-FINAL-ISSUE-PAIRED-MOVEMENT) — the paired `transfer_receive` IN at `inventory-transfer.service.ts:336` and the final-issue reversal at `:726` — and line shifts in `inventory-transfer.service.ts` (F19 insertions) and `insert-sale-and-stock.ts` (F1a/F7/F8 create-sale changes); every other row re-verified against the scan. Method: line-based scan of `backend/src` (spec/test files and `database/migrations` + `database/legacy-migration` excluded) — a line is a business write iff it calls `insertInto('stock_movements')`, `deleteFrom('stock_movements')`, or `.from('stock_movements').update(...)`. Comments, type declarations, backup table-name lists and reads (`selectFrom` / `.from().select`) are not writes.
- Re-scanned at HEAD `3e7035854` (item (5) FIX, ci-full #264 repair): 64 of 70 rows re-lined — Prettier `--write` sweeps, DTO packages D1–D5 and the #116 settings-import split shifted lines; no write added or removed, total still 70. The 2 settings-import rows moved from the split facade (`settings-import.service.ts:615/:1067`) to their slice files (`settings-import-products.ts:282`, `settings-import-suppliers-stock.ts:225`) and their `paired` flips to `no` (the slices never call `applyStockDelta`).
- Re-scanned at HEAD `9a2eee6a` (Phase 1 A0, INV-PHASE1-A0-ROW-WRITER): +1 write — the unified row-writer itself (`backend/src/common/utils/stock-movement-writer.ts:65`, `recordStockMovement`); total 70 → 71. The writer is the one insert all future callers converge on (A6–A9); it runs the delta through `applyStockDelta` and writes exactly one row from the returned before/after. No caller migrated yet, so all 70 prior rows stand unchanged.
- Total business writes: **71**. One further write exists in migration code (`backend/src/database/legacy-migration/entities/inventory.migration.ts:108`, data migration, not a business write) and is excluded by design.
- The ledger (`applyStockDelta` in `backend/src/common/utils/location-stock-ledger.ts`) updates balances; each caller still writes its own `stock_movements` row. That split is the risk this inventory exists to close in Phase 1 (single writer).
- `paired` below is file-level (YES if the same file calls `applyStockDelta` anywhere) — deterministic and reproducible. It does NOT prove the ledger call and the row happen in the same branch: see the notes, especially the archive residual.
- FIXED ASYMMETRY (catalog archive, INV-STOCK-MOVEMENTS-ARCHIVE-ROW): `toggleProductArchive` used to call `applyStockDelta` for the residual global stock (`-remainingGlobal`) with NO `stock_movements` row for it. It now writes the row at line 364, mirroring the sibling deduct rows (same type, reason, reference, cost, posting call) — before_qty remainingGlobal, after_qty 0, qty -remainingGlobal. A zero residual writes no row.
- Resolves the map's UNVERIFIED maintenance path: `maintenance/maintenance/ticket-parts.slice.ts:154,305` and `maintenance/maintenance/delete-ticket.slice.ts:121` are all real inserts (maintenance_consumption / maintenance_return), listed below.
- This document is pinned by `backend/test/critical/stock-movements-writes.spec.ts` (INV-STOCK-MOVEMENTS-WRITE-INVENTORY): the scanned write count must equal 71 and every `file:line` below must be listed.

## Per-module totals

- `catalog`: 9
- `common` (ledger writer): 1
- `delivery-reps`: 1
- `import-sales`: 3
- `inventory`: 21
- `maintenance`: 3
- `manufacturing`: 5
- `purchases`: 6
- `returns`: 3
- `sales`: 12
- `settings`: 6
- `tradein`: 1

## All 71 writes

| file:line | kind | movement_type | paired (file calls applyStockDelta) | notes |
|---|---|---|---|---|
| backend/src/modules/catalog/services/catalog-product-archive.service.ts:277 | insert | deduct | yes | Archive deduct; same method also calls applyStockDelta (line 265) — paired per flow, not per branch. |
| backend/src/modules/catalog/services/catalog-product-archive.service.ts:319 | insert | deduct | yes | Restore deduct; same method also calls applyStockDelta (line 308) — paired per flow, not per branch. |
| backend/src/modules/catalog/services/catalog-product-archive.service.ts:364 | insert | deduct | yes | Archive residual deduct (INV-STOCK-MOVEMENTS-ARCHIVE-ROW): the applyStockDelta for -remainingGlobal now has its own row, mirroring the sibling deduct rows; a zero residual writes no row. |
| backend/src/modules/catalog/services/catalog-product-fashion.service.ts:489 | insert | transfer | yes |  |
| backend/src/modules/catalog/services/catalog-product-fashion.service.ts:510 | insert | transfer | yes |  |
| backend/src/modules/catalog/services/catalog-product-fashion.service.ts:583 | insert | deduct | yes |  |
| backend/src/modules/catalog/services/catalog-product-fashion.service.ts:738 | insert | expr: stockDelta > 0 ? 'add' : 'deduct' | yes |  |
| backend/src/modules/catalog/services/catalog-product-fashion.service.ts:893 | insert | opening_balance | yes |  |
| backend/src/modules/catalog/services/catalog-product-write.service.ts:662 | insert | opening_balance | no | Opening balance: writes product_location_stock directly + this row; file never calls applyStockDelta. Phase 1: route through the ledger or document why direct. |
| backend/src/modules/delivery-reps/services/van-common.util.ts:57 | insert | expr: params.movementType | yes |  |
| backend/src/modules/import-sales/services/import-container-preorders.service.ts:751 | insert | sale | yes |  |
| backend/src/modules/import-sales/services/import-receipt-posting.service.ts:339 | insert | import_receipt | yes |  |
| backend/src/modules/import-sales/services/import-receipt-posting.service.ts:701 | insert | import_receipt_reversal | yes |  |
| backend/src/modules/inventory/services/inventory-adjustment.service.ts:256 | insert | expr: payload.actionType | yes |  |
| backend/src/modules/inventory/services/inventory-count.service.ts:638 | insert | via spread: ...buildStockCountPostingMovement | yes |  |
| backend/src/modules/inventory/services/inventory-count.service.ts:817 | insert | via spread: ...writeModels.stockMovement | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:298 | insert | expr: (isFinalIssue && !isFinalIssueToLocation) ? 'transfer_final_issue' : 'transfer_send' | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:328 | insert | transfer_transit_in | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:336 | insert | transfer_receive | yes | Paired IN for a final issue to a van/location (F19, INV-FINAL-ISSUE-PAIRED-MOVEMENT): the source OUT at :298 loses stock at frozen cost, this IN restores it at the destination so stock is never lost. |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:515 | insert | transfer_transit_out | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:521 | insert | transfer_receive | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:563 | insert | transfer_transit_loss | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:656 | insert | transfer_transit_cancel | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:661 | insert | transfer_cancel | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:726 | insert | transfer_final_issue_reversal | yes | Reversal of a final issue (F19): credits the source at the frozen cost, correcting journal Dr 1140 / Cr 6900. |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:855 | insert | transfer_send | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:860 | insert | transfer_receive | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:932 | insert | transfer_send | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:942 | insert | expr: isUnassignedLink ? 'stock_assign' : 'transfer_receive' | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:1035 | insert | transfer_send | yes |  |
| backend/src/modules/inventory/services/inventory-transfer.service.ts:1040 | insert | transfer_receive | yes |  |
| backend/src/modules/inventory/services/quality-assurance.service.ts:348 | insert | transfer_send | no | File never calls applyStockDelta — balances for QA moves are not routed through the ledger. Phase 1: verify per caller. |
| backend/src/modules/inventory/services/quality-assurance.service.ts:360 | insert | transfer_receive | no | File never calls applyStockDelta — see above. |
| backend/src/modules/inventory/services/warehouse-bins.service.ts:202 | insert | expr: args.movementType | no | Shared writer helper (takes movement args, writes one row); the ledger call lives with the caller. Phase 1: verify per caller. |
| backend/src/modules/maintenance/maintenance/ticket-parts.slice.ts:154 | insert | maintenance_consumption | yes |  |
| backend/src/modules/maintenance/maintenance/ticket-parts.slice.ts:305 | insert | maintenance_return | yes |  |
| backend/src/modules/maintenance/maintenance/delete-ticket.slice.ts:121 | insert | maintenance_return | yes |  |
| backend/src/modules/manufacturing/services/manufacturing.service.ts:516 | insert | manufacturing_consumption | yes |  |
| backend/src/modules/manufacturing/services/manufacturing.service.ts:609 | insert | manufacturing_production | yes |  |
| backend/src/modules/manufacturing/services/manufacturing.service.ts:648 | insert | manufacturing_byproduct | yes |  |
| backend/src/modules/manufacturing/services/manufacturing.service.ts:961 | insert | manufacturing_unbuild | yes |  |
| backend/src/modules/manufacturing/services/manufacturing.service.ts:1007 | insert | manufacturing_unbuild_recovery | yes |  |
| backend/src/modules/purchases/services/goods-receipt-post.service.ts:301 | insert | goods_receipt | yes |  |
| backend/src/modules/purchases/services/purchases-write-cancel.service.ts:279 | insert | purchase_cancel | yes |  |
| backend/src/modules/purchases/services/purchases-write-create.service.ts:708 | insert | purchase | yes |  |
| backend/src/modules/purchases/services/purchases-write-receive-goods.service.ts:247 | insert | purchase_receipt | yes |  |
| backend/src/modules/purchases/services/purchases-write-update.service.ts:254 | insert | purchase_edit_restore | yes |  |
| backend/src/modules/purchases/services/purchases-write-update.service.ts:497 | insert | purchase_edit_apply | yes |  |
| backend/src/modules/returns/returns-purchase-return.service.ts:460 | insert | purchase_return | yes |  |
| backend/src/modules/returns/returns-sale-return.service.ts:367 | insert | sale_return | yes |  |
| backend/src/modules/returns/returns-sale-return.service.ts:380 | insert | sale_return | yes |  |
| backend/src/modules/sales/services/create-sale/insert-sale-and-stock.ts:424 | insert | sale | yes |  |
| backend/src/modules/sales/services/create-sale/insert-sale-and-stock.ts:587 | insert | sale | yes | Modifier leg (was :1714 before the INV-SALE-MOVEMENT-UNIT-COST +1 line); now stores unit_cost (per-stock-unit WAC). |
| backend/src/modules/sales/services/restaurant-food-waste.service.ts:199 | insert | damaged | yes |  |
| backend/src/modules/sales/services/restaurant-food-waste.service.ts:307 | insert | damaged | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts:412 | insert | sale_edit_reversal | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts:451 | insert | sale_edit_reversal | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts:1127 | insert | sale_edit | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts:1261 | insert | sale_edit | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/cancel-sale.service.ts:253 | insert | sale_cancel | yes |  |
| backend/src/modules/sales/services/sales-edit-and-cancel/cancel-sale.service.ts:286 | insert | sale_cancel | yes |  |
| backend/src/modules/sales/services/sales-restaurant-and-serials.service.ts:610 | insert | manufacturing_consumption | yes |  |
| backend/src/modules/sales/services/sales-restaurant-and-serials.service.ts:642 | insert | manufacturing_production | yes |  |
| backend/src/modules/settings/services/demo-data/settings-demo-data-wipe.ts:187 | delete | (delete) | no | Demo reset (deleteFrom), not a ledger movement. |
| backend/src/modules/settings/services/demo-data/settings-demo-data-wipe.ts:370 | delete | (delete) | no | Demo reset (deleteFrom), not a ledger movement. |
| backend/src/modules/settings/services/settings-demo-data-wipe-tables.ts:281 | delete | (delete) | no | Tenant wipe/demo reset (deleteFrom), not a ledger movement. |
| backend/src/modules/settings/services/settings-import/settings-import-products.ts:282 | insert | opening_balance | no | Opening balance on import: row written without an applyStockDelta call in this file. Phase 1: route through the ledger or document why direct. Moved here from settings-import.service.ts:615 in the #116 split (the facade no longer holds the write). |
| backend/src/modules/settings/services/settings-import/settings-import-suppliers-stock.ts:225 | insert | opening_stock | no | Opening stock on import: see above. Moved here from settings-import.service.ts:1067 in the #116 split. |
| backend/src/modules/settings/settings/settings-locations-admin.ts:173 | delete | (delete) | no | Location delete cleanup (deleteFrom), not a ledger movement. |
| backend/src/modules/tradein/tradein.service.ts:401 | insert | tradein_in | yes |  |
| backend/src/common/utils/stock-movement-writer.ts:65 | insert | expr: params.movementType | yes | Phase 1 A0 unified writer (INV-PHASE1-A0-ROW-WRITER): runs applyStockDelta, then writes exactly one row from the returned scopeBefore/scopeAfter with total_cost = roundMoney(|delta| * unitCost, moneyDigits). The one insert all callers converge on (A6–A9); no caller migrated yet. |

## Reverse asymmetry (screening only, not proven violations)

- 17 `applyStockDelta` calls have no `stock_movements` insert in the same enclosing function (heuristic function detection; multi-line signatures fall back, so treat as candidates for Phase 1, not violations). One is by design: the ledger helper file itself (`backend/src/common/utils/location-stock-ledger.ts`, `applyStockDelta` defined at :446) holds no `applyStockDelta` call — it never writes rows, its callers do. One was VERIFIED above and is now FIXED: `catalog-product-archive.service.ts:364` writes the residual row (INV-STOCK-MOVEMENTS-ARCHIVE-ROW; see the FIXED ASYMMETRY note above). The remaining 15 are listed in the grounding data (`/tmp/p0-stock-data.json`, `reverse_asymmetry`) and must be checked per call site in Phase 1 before being called violations.
