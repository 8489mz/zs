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
| Money precision / rounding | `backend/src/modules/accounting/engines/money-minor-units.engine.ts` — `roundMoney(amount, digits)`, `currencyMoneyDigits(currency)`, `toBookMoney` at the posting boundary | PARTIAL: posting boundary unified (zero bare `toMoney`); upstream services still truncate in places (private `toMoney` / `toFixed(2)` sites) — digits plumbing per service remains |
| Invoice totals + discount allocation | `backend/src/common/utils/invoice-totals.ts` — `computeInvoiceTotals`; `backend/src/modules/sales/engines/invoice-discount.engine.ts` — `allocateInvoiceDiscount` (digits required) | UNIFIED for sales/purchases invoice math |
| Sale tax-rate sourcing | `backend/src/modules/sales/engines/sale-tax-rate.engine.ts` — `resolveSaleTaxRate`; ZATCA/ETA builders read the stored `sale.tax_rate` | PARTIAL: subscription billing and maritime charge tax still compute inline. Storefront conversion is exempt BY DESIGN (INV-STOREFRONT-CONVERSION-TAX-EXEMPT): checkout charges catalog prices with no tax added, so conversion sends no rate and the F1 gate yields 0 — injecting the configured rate would overstate the sale versus the amount collected |
| FX conversion + rate resolution | `backend/src/modules/accounting/engines/fx-conversion.engine.ts` — `convertFxAmount`; `backend/src/modules/accounting/fx-rate-resolution.ts` — `resolveFxRate`; snapshot pattern `pdcCurrencySnapshot` in `backend/src/modules/accounting/pdc-currency.ts` | PARTIAL: maritime + forex-difference use the engine; no rate-history table; other flows still convert inline |
| Costing / WAC | `backend/src/modules/accounting/engines/inventory-valuation.engine.ts` — `weightedReceiptCost`, `recoverWacBeforeQty`; `backend/src/modules/accounting/inventory-valuation.ts` — `valueStockReceipt` | PARTIAL: import receipts delegate to `weightedReceiptCost`; landed-cost allocation is still four paths, not one engine |
| Stock ledger (locks, reserve/release) | `backend/src/common/utils/location-stock-ledger.ts` — `applyStockDelta`, `reserveLocationStock`, `releaseLocationStock` (products before balances, items sorted, transaction handle ONLY) | UNIFIED, with one known open exception (marketplace simulation, see below) |
| Installment interest | `backend/src/modules/accounting/engines/installment-interest.engine.ts` — `allocateInstallmentInterest` (minorUnits required, last installment absorbs remainder) | UNIFIED for new plans; historical 2155 over-release is a data remediation, not a code gap |
| Payroll / EOS engines | `backend/src/modules/hr/engines/` — payroll-calculation, payroll-accrual-allocation, eos-calculation (minorUnits required) | PARTIAL: EOS allowance source is DECISION-BLOCKED (phantom columns) |
| Gateway amounts | `backend/src/modules/storefront/engines/gateway-amount.engine.ts` — exponents 0/2/3 | UNIFIED |
| Document sequence numbers | `backend/src/modules/delivery-reps/services/van-common.util.ts` — `generateDailySequenceNumber` (transaction-held advisory lock, fail-closed) | PARTIAL: van call sites routed through transactions; contracting document numbers are id-derived throughout (INV-CONTRACTING-ID-DERIVED-NUMBERS, D6 decided and closed: core + operational documents) |
| User privilege guards | `backend/src/modules/users/users.service.ts` — self-promotion freeze, `assertGrantWithinActorScope`, `assertPeerAdminActionAllowed` | UNIFIED for create/update/sync/bulk-disable; peer demotion, deletion, and unlock deliberately unchanged |
| Idempotency (money writes) | Mandatory `requestKey` + in-transaction `FOR UPDATE` re-check + partial unique index: treasury transfers, expenses, drawer movements, subcontractor payments; `core/idempotency` interceptor for the covered controllers | PARTIAL: interceptor covers 5 controllers; finalize is awaited before the response and finalize failures flag recovery_required (INV-IDEMPOTENCY-FINALIZE-AWAITED); 30-day prune of terminal rows + manual review queue closed (INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE, D5; prune is an explicit staff action — no scheduler exists in this codebase) |

## Forbidden patterns (guarded)

1. A hardcoded VAT rate in a tax document builder. The document rate
   is the stored sale rate (posting gate), never `15`, `14`, or any
   literal.
2. A stock-ledger call on the pool handle (`this.db`) instead of a
   transaction. The single known exception is the marketplace
   simulation deduction (`marketplace-sync.service.ts`, F3.2) — it is
   allowlisted in the guard spec by file and must shrink to zero, never
   grow.
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

## Non-money engines (catalogued, not unified)

`backend/src/modules/**/engines/` holds 50+ engine files (inventory,
manufacturing, maritime, HR, pharmacy, reports, returns, …). They are
NOT unified by this map and must not be treated as canonical for each
other: repeated calculations inside inventory/manufacturing engines,
inline cash-variance logic in settlement paths, and frontend/backend
duplication remain open work, sequenced after the money/trust gaps.
Do not invent a new engine for a computation an existing engine in the
same module already performs — extend the existing one.

## Decisions that block unification (do not guess)

- Contracting numbering (D6): id-derived vs advisory-lock + unique index.
- EOS allowance source: new contract columns vs compensation/payroll data.
- Landed-cost single engine: needs the WAC policy decision first.
- Outbox, business-date definition, idempotency horizon: see
  `phase345-grounding/` reports in the audit workspace.
