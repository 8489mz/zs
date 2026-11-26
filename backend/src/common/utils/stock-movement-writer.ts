import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AppError } from '../errors/app-error';
import { roundMoney } from '../../modules/accounting/engines/money-minor-units.engine';
import {
  applyStockDelta,
  relocateStockBetweenLocations,
  setScopedStockQty,
  type StockDeltaParams,
  type StockDeltaResult,
  type StockSetParams,
  type StockTransferParams,
  type StockTransferResult,
} from './location-stock-ledger';

/**
 * Phase 1 A0 — the single stock-movements row-writer (INV-PHASE1-A0-ROW-WRITER).
 *
 * The ledger (applyStockDelta in location-stock-ledger.ts) moves balances only and
 * writes no movement row, so every caller used to hand-write its own row. This
 * file is the one place that does both halves: it runs the ledger call, then writes
 * the row(s) from the returned before/after, all on the caller's transaction
 * handle. It is modelled on moveVanStock (the only function that did both halves
 * before), minus the van-specific shape and minus its four-decimal fixed-point
 * total_cost spelling.
 *
 * Why a new file: location-stock-ledger.ts is baselined at exactly 1074 lines and
 * the file-size ratchet forbids growth past it, so the writer lives here instead.
 * The ledger file only gains `export` on the param/result types (0 net lines) so
 * this file can take and return them.
 *
 * Phase 1 A5 — writer modes (INV-PHASE1-A5-WRITER-MODES). The A0 delta mode could
 * not cover the four sites whose balance step is not an applyStockDelta call, so
 * the writer gained three modes (A6–A9 migrate the callers onto them):
 * - recordStockMovementSet: wraps setScopedStockQty (nextQty). The row carries
 *   qty = actualDelta (scopeAfter - scopeBefore, 3dp) with before/after from
 *   the change. Phase 1 A9 found it does NOT fit the two sites it was written
 *   for — the count (:638) and suppliers-stock (:225) — because both decide
 *   the row AFTER the setter: :638's movement_type comes from the post-setter
 *   actualDelta, and :225 skips the row entirely when actualDelta === 0,
 *   while the set mode needs movementType upfront and always writes a row.
 *   Both keep their setScopedStockQty call and stamp the row from its return
 *   via recordStockMovementRow instead; the set mode stays for callers whose
 *   movement type and row decision are known before the setter runs.
 * - recordStockRelocation: wraps relocateStockBetweenLocations once, then writes
 *   TWO rows — send + receive — the QA (:348/:360) shape. No new applyStockDelta
 *   call: the move is already ledger-routed.
 * - recordStockMovementRow: row-only — inserts exactly one row with the
 *   caller-supplied before/after and NO ledger call (the bin-trace shape);
 *   recordBinMovement delegates to it, its own insert site folded away.
 * All modes write through ONE shared private insert (insertMovementRow) — the
 * A0 spec pins exactly one direct stock_movements insert in this file, so no
 * mode inlines its own insert. The shared insert is also the ONE total_cost
 * computation: roundMoney((signedTotal ? delta : |delta|) * unitCost,
 * moneyDigits). The signedTotal flag (default false) exists only because the
 * suppliers-stock re-set needs a SIGNED total to agree with its signed journal
 * leg (INV-GL-INVENTORY-VALUE); every other site uses |delta|.
 *
 * Contract (all modes):
 * - One ledger call + its row(s), always — even a 0 delta writes a 0-qty row.
 *   Callers that want NO row (delta-0 location provisioning) keep calling
 *   applyStockDelta directly. Never extend applyStockDelta to write rows:
 *   its 63 callers depend on it NOT writing one.
 * - total_cost = roundMoney(|delta| * (totalUnitCost ?? unitCost),
 *   moneyDigits) + freightShare, the book rounding (A10: the bare unit
 *   defaults to the stored unitCost; the freight share defaults to 0).
 *   unitCost is taken as given (default 0); the writer never looks up
 *   product.cost_price. moneyDigits is a caller-supplied param (P2 pattern,
 *   like the trial-balance engine): the writer never queries settings or
 *   exchange rates per row. Rounding unification across call sites is A10.
 * - reason defaults to movementType; note defaults to ''; createdBy defaults
 *   to null; importReceiptId is optional (import-receipt rows set it).
 * - created_at is NOT set here: the DB default NOW() stamps it (server clock).
 * - Returns the row id(s) plus the ledger result, so later packages can stamp
 *   from the return (A3) and post journals against the row (A6-A9).
 * - quickReassignProduct's direct `products` update (warehouse-bins L698) is
 *   CLASSIFIED OUT of the writer: it sets only primary_bin_id / bin_location
 *   (a metadata pointer, never a balance), so no ledger routing is needed.
 *
 * Phase 1 A7 — omitTotalCost (INV-PHASE1-A7-SALES-WRITER). The sale rows
 * (sites 3-4) must keep total_cost NULL per INV-SALE-MOVEMENT-UNIT-COST:
 * storing a second rounded total would reopen the 91.87/91.88 rounding-
 * divergence vector, and the pinned sale-movement-unit-cost.spec.ts drives
 * the real createSale asserting total_cost === null. So recordStockMovement
 * (only) takes omitTotalCost?: boolean (default false): when true, the
 * shared insert stores total_cost NULL instead of the computed total.
 * The default path is unchanged; no other mode gets the flag; A10 does
 * not decide it (it is the absence of a total, not a rounding spelling).
 * Phase 1 A10 — cost-rounding unification (INV-PHASE1-A10-ROUNDING-UNIFICATION).
 * The A0 total (roundMoney(|delta| * unitCost)) could not reproduce five
 * sites' stored totals, so they stayed hand-written (A8/A9 deferrals):
 * GRN/create store a COMPOSITE total (bare line total at book digits +
 * the exact integer-minor-unit freight share); receive-goods stores its
 * total from the FULL repeating-decimal effective unit; receipt-posting
 * stores the book-rounded group value with a 6dp stored unit. The shared
 * insert gains two optional params (delta mode only, plus totalUnitCost
 * on the row mode so the signed spelling composes with it):
 * - totalUnitCost?: the unit the TOTAL is computed from, when it differs
 *   from the stored unitCost (full-precision effective unit / value/qty).
 *   The stored unit_cost column keeps unitCost verbatim (the A0 "stored
 *   as given" contract). This is NOT an override: the total is still
 *   computed by the writer from (delta x unit) at book digits.
 * - freightShare?: an exact minor-unit addend (landed-cost share). The
 *   addition is NOT re-rounded — exactly the old `stockMovementTotal(...)
 *   + freight` expression.
 * recordStockMovement returns totalCost (the computed total, null when
 * omitTotalCost), so GRN's journal sums the same number the row stores.
 * DECISION (the A5 open question): the signedTotal spelling SURVIVES —
 * it is not a rounding variant but the journal-agreement sign for the
 * suppliers-stock re-set, where a decrease stores a NEGATIVE total
 * agreeing with its signed journal leg (INV-GL-INVENTORY-VALUE); the
 * sign is load-bearing for the WAC pool direction. Removing it would
 * change a posted amount. Unification covers ROUNDING spellings only.
 * After A10 the total computation exists in exactly ONE place
 * (insertMovementRow); stockMovementTotal is the same computation by
 * definition for its two remaining non-row callers.
 */

export type RecordStockMovementParams = StockDeltaParams & {
  movementType: string;
  referenceType: string | null;
  referenceId: number | null;
  reason?: string;
  note?: string;
  unitCost?: number;
  /**
   * Phase 1 A10: the unit the TOTAL is computed from, when it differs from
   * the stored unitCost (receive-goods' full-precision effective unit;
   * receipt-posting's value / qty at full precision). The stored unit_cost
   * column keeps unitCost verbatim (the A0 "stored as given" contract).
   * This is NOT an override: the total is still computed by the writer
   * from (delta x unit) at book digits.
   */
  totalUnitCost?: number;
  /**
   * Phase 1 A10: an exact minor-unit addend (GRN/create landed-cost
   * share, integer minor units via allocateLandedCosts). The addition is
   * NOT re-rounded — exactly the old `stockMovementTotal(...) + freight`
   * expression. Default 0.
   */
  freightShare?: number;
  createdBy?: number | null;
  /** Tenant book digits (2 or 3), resolved by the caller via the P2 pattern. */
  moneyDigits: 2 | 3;
  importReceiptId?: number | null;
  /**
   * Phase 1 A7: when true, total_cost is stored NULL instead of the
   * computed total. Only the sale rows use it (INV-SALE-MOVEMENT-
   * UNIT-COST — a second rounded total would reopen the 91.87/91.88
   * divergence vector). Default false (the A0 contract).
   */
  omitTotalCost?: boolean;
};

export type RecordStockMovementResult = StockDeltaResult & {
  movementId: number;
  /** Phase 1 A10: the total the row stores (null when omitTotalCost). */
  totalCost: number | null;
};

export type RecordStockMovementSetParams = StockSetParams & {
  movementType: string;
  referenceType: string | null;
  referenceId: number | null;
  reason?: string;
  note?: string;
  unitCost?: number;
  createdBy?: number | null;
  /** Tenant book digits (2 or 3), resolved by the caller via the P2 pattern. */
  moneyDigits: 2 | 3;
  importReceiptId?: number | null;
  /**
   * When true, total_cost is roundMoney(delta * unitCost) — SIGNED — instead of
   * roundMoney(|delta| * unitCost). Only the suppliers-stock opening re-set
   * uses it: its stored total must agree with its signed journal leg
   * (INV-GL-INVENTORY-VALUE). Default false (the A0 |delta| contract).
   */
  signedTotal?: boolean;
};

export type RecordStockMovementSetResult = StockDeltaResult & {
  movementId: number;
  /** The actual scoped delta the setter moved (scopeAfter - scopeBefore, 3dp). */
  actualDelta: number;
};

export type RecordStockRelocationParams = StockTransferParams & {
  referenceType: string | null;
  referenceId: number | null;
  reason?: string;
  note?: string;
  unitCost?: number;
  createdBy?: number | null;
  /** Tenant book digits (2 or 3), resolved by the caller via the P2 pattern. */
  moneyDigits: 2 | 3;
  importReceiptId?: number | null;
  sendMovementType?: string;
  receiveMovementType?: string;
};

export type RecordStockRelocationResult = StockTransferResult & {
  sendMovementId: number;
  receiveMovementId: number;
};

export type RecordStockMovementRowParams = {
  productId: number;
  branchId?: number | null;
  locationId?: number | null;
  tenantId: string;
  accountId: string;
  movementType: string;
  delta: number;
  beforeQty: number;
  afterQty: number;
  referenceType: string | null;
  referenceId: number | null;
  reason?: string;
  note?: string;
  unitCost?: number;
  /**
   * Phase 1 A10: the unit the TOTAL is computed from, when it differs
   * from the stored unitCost. Only the row mode takes it besides the
   * delta mode — so the signedTotal spelling composes with the unified
   * computation (the suppliers-stock re-set is a row-mode caller).
   */
  totalUnitCost?: number;
  createdBy?: number | null;
  /** Tenant book digits (2 or 3), resolved by the caller via the P2 pattern. */
  moneyDigits: 2 | 3;
  importReceiptId?: number | null;
  /** See RecordStockMovementSetParams.signedTotal. Default false. */
  signedTotal?: boolean;
  /**
   * Phase 1 A9: store total_cost NULL instead of the computed total.
   * Only the import-preorder 'sale' row uses it (the same NULL shape as
   * the A7 sale rows — the A7 flag foreseen serving it here).
   * Default false (the A0 contract).
   */
  omitTotalCost?: boolean;
};

/** Quantities are 3dp throughout; only money rounds, at book digits. */
function roundQty3dp(value: number): number {
  return Number((Number(value || 0) + Number.EPSILON).toFixed(3));
}

type MovementRowValues = {
  tenantId: string;
  accountId: string;
  productId: number;
  movementType: string;
  delta: number;
  beforeQty: number;
  afterQty: number;
  unitCost: number;
  /** Phase 1 A10: the unit the total is computed from (default: unitCost). */
  totalUnitCost?: number;
  /** Phase 1 A10: an exact minor-unit addend (default 0, not re-rounded). */
  freightShare?: number;
  moneyDigits: 2 | 3;
  signedTotal?: boolean;
  /** Phase 1 A7: store total_cost NULL instead of the computed total. */
  omitTotalCost?: boolean;
  reason: string;
  note: string;
  referenceType: string | null;
  referenceId: number | null;
  branchId: number | null;
  locationId: number | null;
  createdBy: number | null;
  importReceiptId: number | null;
};

/**
 * The ONE direct write in this file (A0 spec pins exactly one insertInto).
 * Every mode funnels its row(s) through here so the total_cost computation
 * and the row shape exist exactly once.
 */
async function insertMovementRow(
  trx: Kysely<Database>,
  row: MovementRowValues,
): Promise<{ id: number; totalCost: number | null }> {
  // A10: the total computation exists in exactly ONE place. The total unit
  // defaults to the stored unit; the freight share defaults to 0 and is
  // added WITHOUT re-rounding (the old `stockMovementTotal(...) + freight`
  // expression). signedTotal composes with totalUnitCost (the row mode's
  // signed site passes both).
  const totalUnit = row.totalUnitCost ?? row.unitCost;
  const totalCost = row.omitTotalCost
    ? null
    : roundMoney((row.signedTotal ? row.delta : Math.abs(row.delta)) * totalUnit, row.moneyDigits) +
      (row.freightShare ?? 0);
  const inserted = await trx
    .insertInto('stock_movements')
    .values({
      tenant_id: row.tenantId,
      account_id: row.accountId,
      product_id: row.productId,
      movement_type: row.movementType,
      qty: row.delta,
      before_qty: row.beforeQty,
      after_qty: row.afterQty,
      unit_cost: row.unitCost,
      total_cost: totalCost,
      reason: row.reason,
      note: row.note,
      reference_type: row.referenceType,
      reference_id: row.referenceId,
      branch_id: row.branchId,
      location_id: row.locationId,
      created_by: row.createdBy,
      import_receipt_id: row.importReceiptId,
    })
    .returning('id')
    .executeTakeFirst();
  if (!inserted?.id) {
    throw new AppError('Failed to capture stock movement ID for stock posting', 'MOVEMENT_INSERT_FAILED', 500);
  }
  return { id: Number(inserted.id), totalCost };
}

export async function recordStockMovement(
  trx: Kysely<Database>,
  params: RecordStockMovementParams,
): Promise<RecordStockMovementResult> {
  const change = await applyStockDelta(trx, params);
  const unitCost = Number(params.unitCost ?? 0);
  // applyStockDelta already threw unless tenant/account scope is present, so
  // these are non-empty strings here; the fallback only satisfies the type.
  const { id: movementId, totalCost } = await insertMovementRow(trx, {
    tenantId: params.tenantId ?? '',
    accountId: params.accountId ?? '',
    productId: params.productId,
    movementType: params.movementType,
    delta: params.delta,
    beforeQty: change.scopeBefore,
    afterQty: change.scopeAfter,
    unitCost,
    totalUnitCost: params.totalUnitCost,
    freightShare: params.freightShare,
    moneyDigits: params.moneyDigits,
    reason: params.reason ?? params.movementType,
    note: params.note ?? '',
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.branchId ?? null,
    locationId: params.locationId ?? null,
    createdBy: params.createdBy ?? null,
    importReceiptId: params.importReceiptId ?? null,
    omitTotalCost: params.omitTotalCost,
  });
  return { ...change, movementId, totalCost };
}

export async function recordStockMovementSet(
  trx: Kysely<Database>,
  params: RecordStockMovementSetParams,
): Promise<RecordStockMovementSetResult> {
  const change = await setScopedStockQty(trx, params);
  const actualDelta = roundQty3dp(change.scopeAfter - change.scopeBefore);
  const unitCost = Number(params.unitCost ?? 0);
  // setScopedStockQty already threw unless tenant/account scope is present.
  const { id: movementId } = await insertMovementRow(trx, {
    tenantId: params.tenantId ?? '',
    accountId: params.accountId ?? '',
    productId: params.productId,
    movementType: params.movementType,
    delta: actualDelta,
    beforeQty: change.scopeBefore,
    afterQty: change.scopeAfter,
    unitCost,
    moneyDigits: params.moneyDigits,
    signedTotal: params.signedTotal,
    reason: params.reason ?? params.movementType,
    note: params.note ?? '',
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.branchId ?? null,
    locationId: params.locationId ?? null,
    createdBy: params.createdBy ?? null,
    importReceiptId: params.importReceiptId ?? null,
  });
  return { ...change, movementId, actualDelta };
}

export async function recordStockRelocation(
  trx: Kysely<Database>,
  params: RecordStockRelocationParams,
): Promise<RecordStockRelocationResult> {
  const moved = await relocateStockBetweenLocations(trx, params);
  const unitCost = Number(params.unitCost ?? 0);
  const qty = roundQty3dp(params.qty);
  const sendMovementType = params.sendMovementType ?? 'transfer_send';
  const receiveMovementType = params.receiveMovementType ?? 'transfer_receive';
  // relocateStockBetweenLocations already threw unless tenant/account scope
  // is present, so these are non-empty strings here.
  const { id: sendMovementId } = await insertMovementRow(trx, {
    tenantId: params.tenantId ?? '',
    accountId: params.accountId ?? '',
    productId: params.productId,
    movementType: sendMovementType,
    delta: -qty,
    beforeQty: moved.sourceBefore,
    afterQty: moved.sourceAfter,
    unitCost,
    moneyDigits: params.moneyDigits,
    reason: params.reason ?? sendMovementType,
    note: params.note ?? '',
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.fromBranchId ?? null,
    locationId: params.fromLocationId,
    createdBy: params.createdBy ?? null,
    importReceiptId: params.importReceiptId ?? null,
  });
  const { id: receiveMovementId } = await insertMovementRow(trx, {
    tenantId: params.tenantId ?? '',
    accountId: params.accountId ?? '',
    productId: params.productId,
    movementType: receiveMovementType,
    delta: qty,
    beforeQty: moved.targetBefore,
    afterQty: moved.targetAfter,
    unitCost,
    moneyDigits: params.moneyDigits,
    reason: params.reason ?? receiveMovementType,
    note: params.note ?? '',
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.toBranchId ?? null,
    locationId: params.toLocationId,
    createdBy: params.createdBy ?? null,
    importReceiptId: params.importReceiptId ?? null,
  });
  return { ...moved, sendMovementId, receiveMovementId };
}

export async function recordStockMovementRow(
  trx: Kysely<Database>,
  params: RecordStockMovementRowParams,
): Promise<number> {
  const unitCost = Number(params.unitCost ?? 0);
  const { id } = await insertMovementRow(trx, {
    tenantId: params.tenantId,
    accountId: params.accountId,
    productId: params.productId,
    movementType: params.movementType,
    delta: params.delta,
    beforeQty: params.beforeQty,
    afterQty: params.afterQty,
    unitCost,
    totalUnitCost: params.totalUnitCost,
    moneyDigits: params.moneyDigits,
    signedTotal: params.signedTotal,
    omitTotalCost: params.omitTotalCost,
    reason: params.reason ?? params.movementType,
    note: params.note ?? '',
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.branchId ?? null,
    locationId: params.locationId ?? null,
    createdBy: params.createdBy ?? null,
    importReceiptId: params.importReceiptId ?? null,
  });
  return id;
}
