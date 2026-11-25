import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { roundMoney } from '../../modules/accounting/engines/money-minor-units.engine';
import { applyStockDelta, type StockDeltaParams, type StockDeltaResult } from './location-stock-ledger';

/**
 * Phase 1 A0 — the single stock-movements row-writer (INV-PHASE1-A0-ROW-WRITER).
 *
 * The ledger (applyStockDelta in location-stock-ledger.ts) moves balances only and
 * writes no movement row, so every caller used to hand-write its own row. This
 * function is the one place that does both halves: it runs the delta, then writes
 * exactly one row from the returned scopeBefore/scopeAfter, all on the caller's
 * transaction handle. It is modelled on moveVanStock (the only function that did
 * both halves before), minus the van-specific shape and minus its four-decimal
 * fixed-point total_cost spelling.
 *
 * Why a new file: location-stock-ledger.ts is baselined at exactly 1074 lines and
 * the file-size ratchet forbids growth past it, so the writer lives here instead.
 * The ledger file only gains `export` on StockDeltaParams / StockDeltaResult
 * (0 net lines) so this file can take and return them.
 *
 * Contract:
 * - One delta + exactly one row, always — even delta 0 writes a 0-qty row.
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
 * - Returns the row id plus the ledger result, so later packages can stamp
 *   from the return (A3) and post journals against the row (A6-A9).
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
};

export type RecordStockMovementResult = StockDeltaResult & {
  movementId: number;
};

export async function recordStockMovement(
  trx: Kysely<Database>,
  params: RecordStockMovementParams,
): Promise<RecordStockMovementResult> {
  const change = await applyStockDelta(trx, params);
  const unitCost = Number(params.unitCost ?? 0);
  const totalCost = roundMoney(Math.abs(params.delta) * unitCost, params.moneyDigits);
  // applyStockDelta already threw unless tenant/account scope is present, so
  // these are non-empty strings here; the fallback only satisfies the type.
  const inserted = await trx
    .insertInto('stock_movements')
    .values({
      tenant_id: params.tenantId ?? undefined,
      account_id: params.accountId ?? undefined,
      product_id: params.productId,
      movement_type: params.movementType,
      qty: params.delta,
      before_qty: change.scopeBefore,
      after_qty: change.scopeAfter,
      unit_cost: unitCost,
      total_cost: totalCost,
      reason: params.reason ?? params.movementType,
      note: params.note ?? '',
      reference_type: params.referenceType,
      reference_id: params.referenceId,
      branch_id: params.branchId ?? null,
      location_id: params.locationId ?? null,
      created_by: params.createdBy ?? null,
      import_receipt_id: params.importReceiptId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { ...change, movementId: Number(inserted.id) };
}
