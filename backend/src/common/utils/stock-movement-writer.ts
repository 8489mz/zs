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
 * - recordStockMovementSet: wraps setScopedStockQty (nextQty) — the count
 *   (:638) and suppliers-stock (:225) shape. The row carries qty = actualDelta
 *   (scopeAfter - scopeBefore, 3dp) with before/after from the change.
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
 * - total_cost = roundMoney(|delta| * unitCost, moneyDigits), the book rounding.
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
 * It also serves A9's import-preorder 'sale' row later (the same NULL
 * shape).
 */

export type RecordStockMovementParams = StockDeltaParams & {
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
   * Phase 1 A7: when true, total_cost is stored NULL instead of the
   * computed total. Only the sale rows use it (INV-SALE-MOVEMENT-
   * UNIT-COST — a second rounded total would reopen the 91.87/91.88
   * divergence vector). Default false (the A0 contract).
   */
  omitTotalCost?: boolean;
};

export type RecordStockMovementResult = StockDeltaResult & {
  movementId: number;
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
  createdBy?: number | null;
  /** Tenant book digits (2 or 3), resolved by the caller via the P2 pattern. */
  moneyDigits: 2 | 3;
  importReceiptId?: number | null;
  /** See RecordStockMovementSetParams.signedTotal. Default false. */
  signedTotal?: boolean;
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
async function insertMovementRow(trx: Kysely<Database>, row: MovementRowValues): Promise<number> {
  const totalCost = row.omitTotalCost
    ? null
    : roundMoney((row.signedTotal ? row.delta : Math.abs(row.delta)) * row.unitCost, row.moneyDigits);
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
  return Number(inserted.id);
}

export async function recordStockMovement(
  trx: Kysely<Database>,
  params: RecordStockMovementParams,
): Promise<RecordStockMovementResult> {
  const change = await applyStockDelta(trx, params);
  const unitCost = Number(params.unitCost ?? 0);
  // applyStockDelta already threw unless tenant/account scope is present, so
  // these are non-empty strings here; the fallback only satisfies the type.
  const movementId = await insertMovementRow(trx, {
    tenantId: params.tenantId ?? '',
    accountId: params.accountId ?? '',
    productId: params.productId,
    movementType: params.movementType,
    delta: params.delta,
    beforeQty: change.scopeBefore,
    afterQty: change.scopeAfter,
    unitCost,
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
  return { ...change, movementId };
}

export async function recordStockMovementSet(
  trx: Kysely<Database>,
  params: RecordStockMovementSetParams,
): Promise<RecordStockMovementSetResult> {
  const change = await setScopedStockQty(trx, params);
  const actualDelta = roundQty3dp(change.scopeAfter - change.scopeBefore);
  const unitCost = Number(params.unitCost ?? 0);
  // setScopedStockQty already threw unless tenant/account scope is present.
  const movementId = await insertMovementRow(trx, {
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
  const sendMovementId = await insertMovementRow(trx, {
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
  const receiveMovementId = await insertMovementRow(trx, {
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
  return insertMovementRow(trx, {
    tenantId: params.tenantId,
    accountId: params.accountId,
    productId: params.productId,
    movementType: params.movementType,
    delta: params.delta,
    beforeQty: params.beforeQty,
    afterQty: params.afterQty,
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
}
