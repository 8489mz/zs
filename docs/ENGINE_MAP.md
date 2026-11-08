# Engine Map (lite) — canonical engines and forbidden duplicates

Purpose: any agent (human or AI) adding financial or stock logic must
start here. Each domain has ONE canonical implementation. New logic
reuses it; a second implementation of the same computation is a defect
even when its result happens to match today, because the two copies
drift apart silently.

Status words: UNIFIED means all known call sites use the canonical
implementation. PARTIAL means the canonical implementation exists but
known call sites still bypass it (listed). NOT UNIFIED means no
canonical implementation exists yet. DECISION-BLOCKED means unification
needs a user decision first — do not guess; see the cited grounding.

This map is enforced by `backend/test/critical/architecture-guard.spec.ts`,
which runs in CI via `test:critical`. Every unification package updates
the row it touches. The full dependency graph is deliberately NOT kept
here: it rots faster than it helps. This page is the contract; the guard
spec is the enforcement.

## Canonical engines

| Domain | Canonical implementation | Status |
|---|---|---|
| Money precision / rounding | `backend/src/modules/accounting/engines/money-minor-units.engine.ts` — `roundMoney(amount, digits)`, `currencyMoneyDigits(currency)`, `toBookMoney` at the posting boundary | PARTIAL: posting boundary unified (zero bare `toMoney`); the service rounders are digits-aware and delegate to `roundMoney` (INV-CANONICAL-ROUNDING-EVERYWHERE, INV-POSTING-DIGITS-REQUIRED; D1/D2/D3 closed their sets) and the guard bans `toFixed(2)` in the 30 verified-clean money-path files. Open items, all dispositioned live: `import-sales.service.ts` non-posting math (command-center / profit-pool aggregates and customs-calculator shaping at 2dp; price-setting and the 2dp refund-amount validation need their own package), the van-transfer `loaded_amount` retail deduction, pricing-preview price-ending, and HR loan-report aggregates. Non-money 2dp sites (leave days, ratios, percentages, distances, message text, ZATCA/ETA document XML, HMAC) are not money defects |
| Invoice totals + discount allocation | `backend/src/common/utils/invoice-totals.ts` — `computeInvoiceTotals`; `backend/src/modules/sales/engines/invoice-discount.engine.ts` — `allocateInvoiceDiscount` (digits required) | UNIFIED for sales/purchases invoice math |
| Sale tax-rate sourcing | `backend/src/modules/sales/engines/sale-tax-rate.engine.ts` — `resolveSaleTaxRate`; ZATCA/ETA builders read the stored `sale.tax_rate` | UNIFIED: every rate resolves through `resolveSaleTaxRate` against the tenant's configured rate or 0 (INV-SUBSCRIPTION-TAX-RATE-SOURCE: `sales/services/commercial-subscription.service.ts`; INV-MARITIME-FREIGHT-TAX: the three sites in `maritime-freight/maritime-freight.service.ts`). Carve-outs, both deliberate: recurring invoices total from the rate stored at contract creation (a contract's rate is fixed at creation), and storefront conversion is exempt BY DESIGN (INV-STOREFRONT-CONVERSION-TAX-EXEMPT): checkout charges catalog prices with no tax added, so conversion sends no rate and the F1 gate yields 0 — injecting the configured rate would overstate the sale versus the amount collected |
| FX conversion + rate resolution | `backend/src/modules/accounting/engines/fx-conversion.engine.ts` — `convertFxAmount`; `backend/src/modules/accounting/fx-rate-resolution.ts` — `resolveFxRate`; snapshot pattern `pdcCurrencySnapshot` in `backend/src/modules/accounting/pdc-currency.ts` | PARTIAL: the append-only rate history (table `currency_exchange_rate_history`, migration 0270) has its first production consumer (INV-FX-RATE-HISTORY-CONSUMER): `AccountingService.convertCurrency` accepts an optional `asOf` moment and resolves both legs through `resolveFxRate`, which reads the rate registered at that moment via `exchangeRateAsOf` and fails closed when none was recorded; import + maritime inline conversions route through the resolver (F1/F2). Remaining: the maritime close-time conversions (7 `resolveFxRate` call sites in `maritime-freight.service.ts`) still resolve the live rate — no as-of consumer for historical maritime amounts yet |
| Costing / WAC | `backend/src/modules/accounting/engines/inventory-valuation.engine.ts` — `weightedReceiptCost`, `weightedReturnCost`, `recoverWacBeforeQty`; `backend/src/modules/accounting/inventory-valuation.ts` — `valueStockReceipt`, `revalueStockReturn` | UNIFIED: one landed-cost allocation path (INV-IMPORT-LANDED-COST-CANONICAL: the import engine allocates through `allocateLandedCosts`; INV-IMPORT-RECEIPT-BOOK-DIGITS: receipt journals round at book digits and the WAC blend was already canonical; INV-IMPORT-BROKER-LOT-EGP-DIGITS: broker capitalisation is classification-only and lot margins use EGP digits; INV-VALUE-STOCK-RECEIPT-ALREADY-CANONICAL: `valueStockReceipt` and the purchase-return re-blend delegate to the canonical engine). The four former paths — (1) purchases (`purchase-landed-costs.service.ts`), (2) `import-landed-cost.engine.ts`, (3) `import-inventory-cost.engine.ts`, (4) broker classification (`import-broker-capitalization.engine.ts`, classification only, not allocation) — now route through the single allocation path. Related: `import-lot-allocation.helper.ts` consumes `unit_landed_cost_egp`; `returns-write.helper.ts` deliberately excludes landed costs. Separate open follow-up, not a landed path: the VAT-strip duplication across 4 sites needs its own package + policy decision |
| Stock ledger (locks, reserve/release) | `backend/src/common/utils/location-stock-ledger.ts` — `applyStockDelta`, `reserveLocationStock`, `releaseLocationStock` (products before balances, items sorted, transaction handle ONLY) | UNIFIED. The former marketplace-simulation exception is closed (INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC): the simulation deducts inside `this.db.transaction()` on the transaction handle, and the guard asserts zero pool-handle stock calls anywhere |
| Installment interest | `backend/src/modules/accounting/engines/installment-interest.engine.ts` — `allocateInstallmentInterest` (minorUnits required, last installment absorbs remainder) | UNIFIED for new plans; historical 2155 over-release is a data remediation, not a code gap |
| Payroll / EOS engines | `backend/src/modules/hr/engines/` — payroll-calculation, payroll-accrual-allocation, eos-calculation (minorUnits required) | UNIFIED: total wage = contract base + the compensation package effective on the termination date (INV-EOS-TOTAL-WAGE-FROM-COMPENSATION); the payroll/EOS engine duplication review is closed (INV-PAYROLL-EOS-DEDUP): delay deduction and EOS settlement absorption route through the canonical engines, not inline duplicates |
| Gateway amounts | `backend/src/modules/storefront/engines/gateway-amount.engine.ts` — exponents 0/2/3 | UNIFIED |
| Document sequence numbers | `backend/src/modules/delivery-reps/services/van-common.util.ts` — `generateDailySequenceNumber` (transaction-held advisory lock, fail-closed) | PARTIAL: van call sites routed through transactions; contracting document numbers are id-derived throughout (INV-CONTRACTING-ID-DERIVED-NUMBERS, D6 decided and closed: core + operational documents). Remaining: no unique index on numbered columns — migration 0155 defines `doc_no VARCHAR(100) NOT NULL` (`van_field_returns`, `van_load_requisitions`) with no unique constraint on it (the migration's only unique is `uq_rep_target_month`) |
| User privilege guards | `backend/src/modules/users/users.service.ts` — self-promotion freeze, `assertGrantWithinActorScope`, `assertPeerAdminActionAllowed` | UNIFIED for create/update/sync/bulk-disable; peer demotion, deletion, and unlock deliberately unchanged |
| Idempotency (money writes) | Mandatory `requestKey` + in-transaction `FOR UPDATE` re-check + partial unique index: treasury transfers, expenses, drawer movements, subcontractor payments; `core/idempotency` interceptor for the covered controllers | PARTIAL: interceptor covers 4 controllers (sales, returns, services, inventory); finalize is awaited before the response and finalize failures flag recovery_required (INV-IDEMPOTENCY-FINALIZE-AWAITED); 30-day prune of terminal rows + manual review queue closed (INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE, D5; prune is an explicit staff action — no scheduler exists in this codebase). Purchases is NOT covered by the interceptor — `purchases-write.service.ts` states so explicitly and instead calls `IdempotencyService` directly (`reserveOperation` / `commitOperation`); import-sales handles an `x-idempotency-key` header manually |
| Outbox (inbound webhooks) | `backend/src/modules/storefront/engines/marketplace-webhook-event.engine.ts` — `extractMarketplaceEventIdentity`, `marketplaceWebhookDedupKey`, `matchMarketplaceTenant`; `marketplace_webhook_events` table (migration 0275) | PARTIAL, first slice only: inbound marketplace webhook payloads are persisted (deduped, tenant-resolved or unresolved) BEFORE the 200 response (INV-MARKETPLACE-WEBHOOK-PERSISTENCE). No relay, no processing of stored events, no signature verification yet -- rows are inert evidence for staff review |
| Business date | `backend/src/modules/accounting/engines/accounting-date.engine.ts` — `resolveBusinessDateKey`; `backend/src/common/utils/tenant-timezone.util.ts` — `getTenantTimezone`, `todayTenantDate` (settings key 'timezone', default Africa/Cairo) | PARTIAL: the four period gates, the shared daily-sequence generator, storefront ON numbers, and all contracting number sites use the tenant-local business day (INV-BUSINESS-DATE-TENANT-LOCAL). Remaining host-local/UTC day derivations (other number call sites, report/query slices, global schedulers) are recorded in the invariant, one module at a time. Remaining UTC-slice sites are inventoried in `phase-0-grounding-inventory.md` §1.8 (audit workspace) — 53 files in `backend/src` match `toISOString().slice(0, 10)` at HEAD 30a84e93 (re-grounded by U5; the R3a–R3c slices are in progress) |

## Forbidden patterns (guarded)

1. A hardcoded VAT rate in a tax document builder. The document rate
   is the stored sale rate (posting gate), never `15`, `14`, or any
   literal.
2. A stock-ledger call on the pool handle (`this.db`) instead of a
   transaction. Zero pool-handle stock calls are allowed anywhere —
   the former marketplace-simulation exception is closed
   (INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC) and the guard asserts zero.
3. A swallowed compensating write on a money path (`.catch(() => undefined)`
   around a re-reserve or similar recovery). Failures must surface.
4. `toFixed(2)` inside the posting service. All posting math goes
   through `roundMoney` at book digits.
5. A second implementation of a computation in the table above. Reuse
   the canonical engine or, if it cannot express the case, extend it
   with a spec — never copy the math inline.
6. Financial logic in the frontend that duplicates a backend engine.
   The frontend displays backend-computed values; display-only math
   must say so in a comment.
7. New money-rounding code outside the canonical rounder: a private
   `toMoney`/`money`/`roundMoney`/`roundCurrency` without a `digits`
   parameter, or a literal `toFixed(2)` in one of the guard-listed
   money-path files. Money math goes through `roundMoney` at book digits.
8. A map row whose status word disagrees with the verified state. The
   guard pins every row's status word — a row changes status only
   together with the code change that closes or opens it, in the same
   package.

## Non-money engines (catalogued, not unified)

`backend/src/modules/**/engines/` holds 50+ engine files (inventory,
manufacturing, maritime, HR, pharmacy, reports, returns, …). They are
NOT unified by this map and must not be treated as canonical for each
other: repeated calculations inside inventory/manufacturing engines and
frontend/backend duplication remain open work, sequenced after the
money/trust gaps. The inline cash-variance logic in the
trip-submission path is closed (INV-CASH-VARIANCE-UNIFICATION):
submitTripSettlement calls computeCashDrawerVariance at tenant book
digits; the settleTrip path deliberately still holds its inline form
(P9-cancelled site, separate decision).
Do not invent a new engine for a computation an existing engine in the
same module already performs — extend the existing one.
Exception: the manufacturing work-order poster derives its journal
explicitly (INV-MANUFACTURING-COST-DERIVATION) — operations + scaled
overhead, a separate by-product leg, and a 5190 variance — never a
stored-total-minus-materials residual. The scaled overhead itself
is computed once (INV-MANUFACTURING-OVERHEAD-UNIFICATION):
scaledBomOverhead in manufacturing-overhead.engine.ts, called by
completion, the poster, and the restaurant auto-produce path.

## Decisions that block unification (do not guess)

- Contracting numbering (D6): DECIDED and closed — id-derived throughout (INV-CONTRACTING-ID-DERIVED-NUMBERS).
- EOS allowance source: DECIDED — the whole allowance bucket of the effective compensation package counts (INV-EOS-TOTAL-WAGE-FROM-COMPENSATION).
- Landed-cost single engine: DECIDED — freight is allocated to item cost (policy 2026-11-06) and the single allocation path is closed (INV-IMPORT-LANDED-COST-CANONICAL); WAC reflects the true cost.
- Outbox relay, idempotency horizon: see
  `phase345-grounding/` reports in the audit workspace.
