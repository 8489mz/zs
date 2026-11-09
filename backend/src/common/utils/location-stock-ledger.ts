import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../errors/app-error';
import { Database } from '../../database/database.types';
import { ensureNonNegativeStock } from './financial-integrity';
import { canonicalLockIds } from './canonical-lock-order';

type LockedProductRow = {
  id: number;
  name: string;
  stock_qty: number | string | null;
  reserved_qty?: number | string | null;
};

type StockBalanceRow = {
  id: number;
  product_id: number;
  branch_id: number | null;
  location_id: number | null;
  qty: number | string | null;
  reserved_qty?: number | string | null;
};

export type StockReservationItem = {
  productId: number;
  qty: number;
};

export type StockLocationReservationParams = TenantStockScope & {
  branchId?: number | null;
  locationId?: number | null;
  items: StockReservationItem[];
  allowOutOfStock?: boolean;
};

export type StockReservationResultItem = {
  productId: number;
  qty: number;
  locationReservedBefore: number;
  locationReservedAfter: number;
  globalReservedBefore: number;
  globalReservedAfter: number;
};

export type StockReservationResult = {
  branchId: number | null;
  locationId: number | null;
  items: StockReservationResultItem[];
};

type TenantStockScope = {
  tenantId?: string | null;
  accountId?: string | null;
};

type StockScopeParams = TenantStockScope & {
  productId: number;
  branchId?: number | null;
  locationId?: number | null;
};

type StockDeltaParams = StockScopeParams & {
  delta: number;
  errorCode?: string;
  errorMessage?: string;
  allowNegative?: boolean;
  skipGlobalUpdate?: boolean;
  disableAutoDrain?: boolean;
};

type StockSetParams = StockScopeParams & {
  nextQty: number;
  errorCode?: string;
  errorMessage?: string;
  /** Preserve explicitly counted/traceable warehouse inventory; never drain unassigned stock. */
  disableAutoDrain?: boolean;
};

type StockTransferParams = TenantStockScope & {
  productId: number;
  qty: number;
  fromBranchId?: number | null;
  fromLocationId: number;
  toBranchId?: number | null;
  toLocationId: number;
  errorCode?: string;
  errorMessage?: string;
};

type StockTransitParams = TenantStockScope & {
  productId: number;
  qty: number;
  branchId?: number | null;
  locationId: number | null;
  errorCode?: string;
  errorMessage?: string;
};

type RequiredTenantStockScope = {
  tenantId: string;
  accountId: string;
};

type StockDeltaResult = {
  globalBefore: number;
  globalAfter: number;
  scopeBefore: number;
  scopeAfter: number;
};

type StockTransferResult = {
  globalBefore: number;
  globalAfter: number;
  sourceBefore: number;
  sourceAfter: number;
  targetBefore: number;
  targetAfter: number;
};

type LockedState = {
  scope: RequiredTenantStockScope;
  product: LockedProductRow;
  globalQty: number;
  balances: StockBalanceRow[];
};

function roundStockQty(value: number | string | null | undefined): number {
  return Number((Number(value || 0) + Number.EPSILON).toFixed(3));
}

function requireStockTenantScope(params: TenantStockScope): RequiredTenantStockScope {
  const tenantId = String(params.tenantId || '').trim();
  const accountId = String(params.accountId || '').trim();
  if (!tenantId || !accountId) {
    throw new AppError('Tenant/account scope is required for stock ledger operations', 'TENANT_SCOPE_REQUIRED', 403);
  }
  return { tenantId, accountId };
}

/** Acquire every product lock before any location balance lock, in one global order. */
export async function lockStockProducts(
  db: Kysely<Database>,
  params: TenantStockScope & { productIds: number[] },
): Promise<void> {
  const scope = requireStockTenantScope(params);
  const ids = canonicalLockIds(params.productIds.map(Number));
  if (!ids.length) return;
  const rows = await db.selectFrom('products')
    .select('id')
    .where('id', 'in', ids)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .orderBy('id', 'asc')
    .forUpdate()
    .execute();
  if (rows.length !== ids.length) {
    const foundIds = new Set(rows.map((r) => Number(r.id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw new AppError(`الصنف رقم #${missing.join(', ')} غير موجود أو ليس لديك صلاحية للوصول إليه`, 'PRODUCT_NOT_FOUND', 404);
  }
}

async function loadLockedState(db: Kysely<Database>, params: TenantStockScope & { productId: number }): Promise<LockedState> {
  const scope = requireStockTenantScope(params);
  const product = await db
    .selectFrom('products')
    .select(['id', 'name', 'stock_qty', sql<number | null>`COALESCE(reserved_qty, 0)`.as('reserved_qty')])
    .where('id', '=', params.productId)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .forUpdate()
    .executeTakeFirst();
  if (!product) throw new AppError(`الصنف رقم #${params.productId} غير موجود أو ليس لديك صلاحية للوصول إليه`, 'PRODUCT_NOT_FOUND', 404);
  let balancesQuery = db
    .selectFrom('product_location_stock')
    .select(['id', 'product_id', 'branch_id', 'location_id', 'qty', sql<number | null>`COALESCE(reserved_qty, 0)`.as('reserved_qty')])
    .where('product_id', '=', product.id)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId);
  if (typeof (balancesQuery as any).orderBy === 'function') {
    balancesQuery = (balancesQuery as any).orderBy('id', 'asc');
  }
  const balances = await (balancesQuery as any)
    .forUpdate()
    .execute();
  return { 
    scope, 
    product: {
      id: Number(product.id),
      name: String(product.name || ''),
      stock_qty: product.stock_qty,
      reserved_qty: product.reserved_qty ?? 0,
    }, 
    globalQty: roundStockQty(product.stock_qty), 
    balances: balances.map((row: any) => ({
      id: Number(row.id),
      product_id: Number(row.product_id),
      branch_id: row.branch_id == null ? null : Number(row.branch_id),
      location_id: row.location_id == null ? null : Number(row.location_id),
      qty: row.qty,
      reserved_qty: row.reserved_qty ?? 0,
    })),
  };
}

async function insertBalanceRow(
  db: Kysely<Database>,
  scope: RequiredTenantStockScope,
  productId: number,
  branchId: number | null,
  locationId: number | null,
  qty: number,
  reservedQty: number = 0,
): Promise<StockBalanceRow> {
  const inserted = await db
    .insertInto('product_location_stock')
    .values({
      product_id: productId,
      branch_id: branchId,
      location_id: locationId,
      qty: roundStockQty(qty),
      reserved_qty: roundStockQty(reservedQty),
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
    } as any)
    .returning(['id', 'product_id', 'branch_id', 'location_id', 'qty', sql<number | null>`COALESCE(reserved_qty, 0)`.as('reserved_qty')])
    .executeTakeFirstOrThrow();

  return {
    id: Number(inserted.id),
    product_id: Number(inserted.product_id),
    branch_id: inserted.branch_id == null ? null : Number(inserted.branch_id),
    location_id: inserted.location_id == null ? null : Number(inserted.location_id),
    qty: inserted.qty,
    reserved_qty: (inserted as any).reserved_qty ?? 0,
  };
}

async function ensureUnassignedBalance(db: Kysely<Database>, state: LockedState): Promise<StockBalanceRow> {
  const existing = state.balances.find((row) => row.location_id == null && row.branch_id == null);
  const currentSum = roundStockQty(state.balances.reduce((sum, row) => sum + Number(row.qty || 0), 0));
  const discrepancy = roundStockQty(state.globalQty - currentSum);

  if (existing) {
    if (discrepancy > 0.001) {
      const nextQty = roundStockQty(Number(existing.qty || 0) + discrepancy);
      await db
        .updateTable('product_location_stock')
        .set({ qty: nextQty, updated_at: sql`NOW()` })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', state.scope.tenantId)
        .where('account_id', '=', state.scope.accountId)
        .execute();
      existing.qty = nextQty;
    }
    return existing;
  }

  const seedQty = discrepancy > 0.001 ? discrepancy : 0;
  const inserted = await insertBalanceRow(db, state.scope, state.product.id, null, null, seedQty);
  state.balances.push(inserted);
  return inserted;
}

async function ensureLocationBalance(
  db: Kysely<Database>,
  state: LockedState,
  locationId: number | null,
  branchId: number | null,
): Promise<StockBalanceRow> {
  const searchLocationId = locationId == null ? null : Number(locationId);
  const searchBranchId = branchId == null ? null : Number(branchId);

  let existing: typeof state.balances[0] | undefined;

  if (searchLocationId !== null) {
    existing = state.balances.find((row) => 
      (row.location_id == null ? null : Number(row.location_id)) === searchLocationId
    );
  } else if (searchBranchId !== null) {
    existing = state.balances.find((row) => 
      (row.branch_id == null ? null : Number(row.branch_id)) === searchBranchId && 
      row.location_id == null
    ) || state.balances.find((row) => row.location_id == null);
  } else {
    existing = state.balances.find((row) => 
      row.location_id == null && row.branch_id == null
    ) || state.balances.find((row) => row.location_id == null);
  }

  if (existing) {
    if (branchId != null && existing.branch_id == null) {
      await db
        .updateTable('product_location_stock')
        .set({ branch_id: branchId, updated_at: sql`NOW()` })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', state.scope.tenantId)
        .where('account_id', '=', state.scope.accountId)
        .execute();
      existing.branch_id = branchId;
    }
    return existing;
  }
  const inserted = await insertBalanceRow(db, state.scope, state.product.id, branchId, locationId, 0);
  state.balances.push(inserted);
  return inserted;
}

async function updateBalanceQty(
  db: Kysely<Database>,
  scope: RequiredTenantStockScope,
  row: StockBalanceRow,
  nextQty: number,
  branchId?: number | null,
): Promise<void> {
  const payload: Record<string, unknown> = { qty: roundStockQty(nextQty), updated_at: sql`NOW()` };
  if (branchId !== undefined && branchId !== row.branch_id) {
    payload.branch_id = branchId;
    row.branch_id = branchId ?? null;
  }
  await db
    .updateTable('product_location_stock')
    .set(payload)
    .where('id', '=', row.id)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .execute();
  row.qty = roundStockQty(nextQty);
}

async function updateGlobalQty(db: Kysely<Database>, scope: RequiredTenantStockScope, productId: number, nextQty: number): Promise<void> {
  await db
    .updateTable('products')
    .set({ stock_qty: roundStockQty(nextQty), updated_at: sql`NOW()` })
    .where('id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .execute();
}

export async function previewConsumableStockQty(db: Kysely<Database>, params: StockScopeParams): Promise<number> {
  const state = await loadLockedState(db, params);
  const globalAvailable = roundStockQty(Math.max(0, Number(state.product.stock_qty || 0) - Number(state.product.reserved_qty || 0)));
  if (!params.locationId) return globalAvailable;
  const unassigned = await ensureUnassignedBalance(db, state);
  const location = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  const locationAvail = Math.max(0, Number(location.qty || 0) - Number(location.reserved_qty || 0));
  const unassignedAvail = Math.max(0, Number(unassigned.qty || 0) - Number(unassigned.reserved_qty || 0));
  const localSum = roundStockQty(locationAvail + unassignedAvail);
  return Math.min(localSum, globalAvailable);
}

export async function previewAssignedLocationStockQty(db: Kysely<Database>, params: StockScopeParams): Promise<number> {
  const state = await loadLockedState(db, params);
  const globalAvailable = roundStockQty(Math.max(0, Number(state.product.stock_qty || 0) - Number(state.product.reserved_qty || 0)));
  if (!params.locationId) return globalAvailable;
  const location = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  const locationAvail = roundStockQty(Math.max(0, Number(location.qty || 0) - Number(location.reserved_qty || 0)));
  return Math.min(locationAvail, globalAvailable);
}

// INV-STOCK-COUNT-ADJUSTMENT: the physical count basis. A stock count
// counts what is physically on the shelf, reservations included: a
// unit reserved for a store order is still on hand until it leaves.
// previewAssignedLocationStockQty nets reservations off by design
// (it answers "how much may I sell or consume"), so freezing a count
// on it shows a reserved unit as a phantom surplus -- the session
// displays a variance and a financial effect while the posting
// (setScopedStockQty, INV-STOCK-COUNT-ACTUAL-DELTA) moves nothing
// and books no journal. The count basis is the raw scoped quantity
// capped by the raw global counter: the same basis the stock write
// uses, so the displayed book quantity, the frozen variance and the
// posted delta can never disagree again.
export async function previewAssignedLocationOnHandQty(db: Kysely<Database>, params: StockScopeParams): Promise<number> {
  const state = await loadLockedState(db, params);
  const globalOnHand = roundStockQty(Math.max(0, Number(state.product.stock_qty || 0)));
  if (!params.locationId) return globalOnHand;
  const location = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  const locationOnHand = roundStockQty(Math.max(0, Number(location.qty || 0)));
  return Math.min(locationOnHand, globalOnHand);
}

export async function applyStockDelta(db: Kysely<Database>, params: StockDeltaParams): Promise<StockDeltaResult> {
  const delta = roundStockQty(params.delta);
  const state = await loadLockedState(db, params);
  const globalBefore = state.globalQty;
  const globalAfter = roundStockQty(globalBefore + delta);
  const errorCode = params.errorCode || 'INSUFFICIENT_STOCK';
  const errorMessage = params.errorMessage || `Insufficient stock for ${state.product.name || `#${params.productId}`}`;

  if (delta < 0 && !params.allowNegative && !params.skipGlobalUpdate) {
    ensureNonNegativeStock(roundStockQty(globalAfter - Number(state.product.reserved_qty || 0)), errorCode, errorMessage);
  }

  if (!params.locationId) {
    const unassigned = await ensureUnassignedBalance(db, state);
    const scopeBefore = roundStockQty(unassigned.qty);
    const scopeAfter = roundStockQty(scopeBefore + delta);
    if (delta < 0 && !params.allowNegative) ensureNonNegativeStock(roundStockQty(scopeAfter - Number(unassigned.reserved_qty || 0)), errorCode, errorMessage);
    
    const trueGlobalQty = roundStockQty(state.balances.reduce((sum, row) => sum + Number(row.qty), 0));
    const correctedGlobalAfter = roundStockQty(trueGlobalQty + delta);
    if (delta < 0 && !params.allowNegative && !params.skipGlobalUpdate) ensureNonNegativeStock(roundStockQty(correctedGlobalAfter - Number(state.product.reserved_qty || 0)), errorCode, errorMessage);
    
    await updateBalanceQty(db, state.scope, unassigned, scopeAfter, null);
    if (!params.skipGlobalUpdate) await updateGlobalQty(db, state.scope, params.productId, correctedGlobalAfter);
    return { globalBefore, globalAfter: params.skipGlobalUpdate ? globalBefore : correctedGlobalAfter, scopeBefore, scopeAfter };
  }

  // Paired source/transit/destination stock legs have a temporary gap in
  // the *location* sum while the product's global balance stays unchanged.
  // Never mint that in-flight quantity into the unassigned warehouse. Doing
  // so duplicates inventory and re-bases later GL shrinkage against a phantom
  // location balance. Ordinary single-leg stock adjustments and zero-delta
  // location provisioning retain the historical reconciliation behaviour.
  const unassigned = params.skipGlobalUpdate && params.disableAutoDrain
    ? state.balances.find(row => row.location_id == null && row.branch_id == null)
    : await ensureUnassignedBalance(db, state);
  const location = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  let locationBefore = roundStockQty(location.qty);

  if (!params.disableAutoDrain && unassigned && roundStockQty(unassigned.qty) > 0.001) {
    const unassignedBefore = roundStockQty(unassigned.qty);
    const provisionedLocationQty = roundStockQty(locationBefore + unassignedBefore);
    await updateBalanceQty(db, state.scope, unassigned, 0, null);
    await updateBalanceQty(db, state.scope, location, provisionedLocationQty, params.branchId ?? null);
    locationBefore = provisionedLocationQty;
  }

  const scopeAfter = roundStockQty(locationBefore + delta);
  if (delta < 0 && !params.allowNegative) ensureNonNegativeStock(roundStockQty(scopeAfter - Number(location.reserved_qty || 0)), errorCode, errorMessage);
  
  const trueGlobalQty = roundStockQty(state.balances.reduce((sum, row) => sum + Number(row.qty), 0));
  const correctedGlobalAfter = roundStockQty(trueGlobalQty + delta);
  if (delta < 0 && !params.allowNegative && !params.skipGlobalUpdate) ensureNonNegativeStock(roundStockQty(correctedGlobalAfter - Number(state.product.reserved_qty || 0)), errorCode, errorMessage);
  
  await updateBalanceQty(db, state.scope, location, scopeAfter, params.branchId ?? null);
  if (!params.skipGlobalUpdate) await updateGlobalQty(db, state.scope, params.productId, correctedGlobalAfter);
  return { globalBefore, globalAfter: params.skipGlobalUpdate ? globalBefore : correctedGlobalAfter, scopeBefore: locationBefore, scopeAfter };
}

export async function setScopedStockQty(db: Kysely<Database>, params: StockSetParams): Promise<StockDeltaResult> {
  const nextQty = roundStockQty(params.nextQty);
  const state = await loadLockedState(db, params);
  const errorCode = params.errorCode || 'INSUFFICIENT_STOCK';
  const errorMessage = params.errorMessage || `Invalid stock quantity for ${state.product.name || `#${params.productId}`}`;

  ensureNonNegativeStock(nextQty, errorCode, errorMessage);

  if (!params.locationId) {
    const unassigned = await ensureUnassignedBalance(db, state);
    const scopeBefore = roundStockQty(unassigned.qty);
    const delta = roundStockQty(nextQty - scopeBefore);
    
    const trueGlobalQty = roundStockQty(state.balances.reduce((sum, row) => sum + Number(row.qty), 0));
    const globalBefore = state.globalQty;
    const globalAfter = roundStockQty(trueGlobalQty + delta);

    ensureNonNegativeStock(roundStockQty(nextQty - Number(unassigned.reserved_qty || 0)), errorCode, errorMessage);
    ensureNonNegativeStock(roundStockQty(globalAfter - Number(state.product.reserved_qty || 0)), errorCode, errorMessage);

    if (delta === 0 && globalBefore === globalAfter) {
      return { globalBefore, globalAfter, scopeBefore, scopeAfter: nextQty };
    }
    
    if (delta !== 0) {
      await updateBalanceQty(db, state.scope, unassigned, nextQty, null);
    }
    if (delta !== 0 || globalBefore !== globalAfter) {
      await updateGlobalQty(db, state.scope, params.productId, globalAfter);
    }
    return { globalBefore, globalAfter, scopeBefore, scopeAfter: nextQty };
  }

  const unassigned = await ensureUnassignedBalance(db, state);
  const location = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  let scopeBefore = roundStockQty(location.qty);

  if (!params.disableAutoDrain && unassigned && roundStockQty(unassigned.qty) > 0.001) {
    const unassignedBefore = roundStockQty(unassigned.qty);
    const provisionedLocationQty = roundStockQty(scopeBefore + unassignedBefore);
    await updateBalanceQty(db, state.scope, unassigned, 0, null);
    await updateBalanceQty(db, state.scope, location, provisionedLocationQty, params.branchId ?? null);
    scopeBefore = provisionedLocationQty;
  }

  const delta = roundStockQty(nextQty - scopeBefore);
  
  const trueGlobalQty = roundStockQty(state.balances.reduce((sum, row) => sum + Number(row.qty), 0));
  const globalBefore = state.globalQty;
  const globalAfter = roundStockQty(trueGlobalQty + delta);

  ensureNonNegativeStock(roundStockQty(nextQty - Number(location.reserved_qty || 0)), errorCode, errorMessage);
  ensureNonNegativeStock(roundStockQty(globalAfter - Number(state.product.reserved_qty || 0)), errorCode, errorMessage);

  if (delta === 0 && globalBefore === globalAfter) {
    return { globalBefore, globalAfter, scopeBefore, scopeAfter: nextQty };
  }

  if (delta !== 0) {
    await updateBalanceQty(db, state.scope, location, nextQty, params.branchId ?? null);
  }
  if (delta !== 0 || globalBefore !== globalAfter) {
    await updateGlobalQty(db, state.scope, params.productId, globalAfter);
  }
  return { globalBefore, globalAfter, scopeBefore, scopeAfter: nextQty };
}

async function moveUnassignedToLocation(
  db: Kysely<Database>,
  state: LockedState,
  qty: number,
  locationId: number | null,
  branchId: number | null,
  errorCode: string,
  errorMessage: string,
): Promise<{ unassignedBefore: number; unassignedAfter: number; locationBefore: number; locationAfter: number }> {
  const unassigned = await ensureUnassignedBalance(db, state);
  const location = await ensureLocationBalance(db, state, locationId, branchId);
  const unassignedBefore = roundStockQty(unassigned.qty);
  const unassignedAfter = roundStockQty(unassignedBefore - qty);
  ensureNonNegativeStock(unassignedAfter, errorCode, errorMessage);
  const locationBefore = roundStockQty(location.qty);
  const locationAfter = roundStockQty(locationBefore + qty);
  await updateBalanceQty(db, state.scope, unassigned, unassignedAfter, null);
  await updateBalanceQty(db, state.scope, location, locationAfter, branchId);
  return { unassignedBefore, unassignedAfter, locationBefore, locationAfter };
}

export async function beginLocationTransfer(db: Kysely<Database>, params: StockTransitParams): Promise<StockTransferResult> {
  const qty = roundStockQty(params.qty);
  const state = await loadLockedState(db, params);
  const errorCode = params.errorCode || 'INSUFFICIENT_LOCATION_STOCK';
  const errorMessage = params.errorMessage || `Insufficient stock at source location for ${state.product.name || `#${params.productId}`}`;
  const source = await ensureLocationBalance(db, state, params.locationId, params.branchId ?? null);
  const unassigned = await ensureUnassignedBalance(db, state);
  const sourceBefore = roundStockQty(source.qty);
  const sourceAfter = roundStockQty(sourceBefore - qty);
  ensureNonNegativeStock(sourceAfter, errorCode, errorMessage);
  const targetBefore = roundStockQty(unassigned.qty);
  const targetAfter = roundStockQty(targetBefore + qty);
  await updateBalanceQty(db, state.scope, source, sourceAfter, params.branchId ?? null);
  await updateBalanceQty(db, state.scope, unassigned, targetAfter, null);
  return {
    globalBefore: state.globalQty,
    globalAfter: state.globalQty,
    sourceBefore,
    sourceAfter,
    targetBefore,
    targetAfter,
  };
}

export async function receiveLocationTransfer(db: Kysely<Database>, params: StockTransitParams): Promise<StockTransferResult> {
  const qty = roundStockQty(params.qty);
  const state = await loadLockedState(db, params);
  const errorCode = params.errorCode || 'TRANSFER_TRANSIT_STOCK_INVALID';
  const errorMessage = params.errorMessage || `Transfer stock is not available for ${state.product.name || `#${params.productId}`}`;
  const moved = await moveUnassignedToLocation(db, state, qty, params.locationId, params.branchId ?? null, errorCode, errorMessage);
  return {
    globalBefore: state.globalQty,
    globalAfter: state.globalQty,
    sourceBefore: moved.unassignedBefore,
    sourceAfter: moved.unassignedAfter,
    targetBefore: moved.locationBefore,
    targetAfter: moved.locationAfter,
  };
}

export async function restoreLocationTransfer(db: Kysely<Database>, params: StockTransitParams): Promise<StockTransferResult> {
  const qty = roundStockQty(params.qty);
  const state = await loadLockedState(db, params);
  const errorCode = params.errorCode || 'TRANSFER_TRANSIT_STOCK_INVALID';
  const errorMessage = params.errorMessage || `Transfer stock is not available for ${state.product.name || `#${params.productId}`}`;
  const moved = await moveUnassignedToLocation(db, state, qty, params.locationId, params.branchId ?? null, errorCode, errorMessage);
  return {
    globalBefore: state.globalQty,
    globalAfter: state.globalQty,
    sourceBefore: moved.unassignedBefore,
    sourceAfter: moved.unassignedAfter,
    targetBefore: moved.locationBefore,
    targetAfter: moved.locationAfter,
  };
}

export async function relocateStockBetweenLocations(db: Kysely<Database>, params: StockTransferParams): Promise<StockTransferResult> {
  const sent = await beginLocationTransfer(db, {
    productId: params.productId,
    qty: params.qty,
    branchId: params.fromBranchId ?? null,
    locationId: params.fromLocationId,
    tenantId: params.tenantId,
    accountId: params.accountId,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  });
  const received = await receiveLocationTransfer(db, {
    productId: params.productId,
    qty: params.qty,
    branchId: params.toBranchId ?? null,
    locationId: params.toLocationId,
    tenantId: params.tenantId,
    accountId: params.accountId,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  });
  return {
    globalBefore: sent.globalBefore,
    globalAfter: received.globalAfter,
    sourceBefore: sent.sourceBefore,
    sourceAfter: sent.sourceAfter,
    targetBefore: received.targetBefore,
    targetAfter: received.targetAfter,
  };
}

/**
 * INV-SALES-ORDER-WAREHOUSE-SELECTION: the ONE availability arithmetic
 * shared by reserveLocationStock and the display read
 * (getLocationAvailability). The available quantity at a location is
 * the location balance minus its reservations PLUS the unassigned
 * balance minus its reservations — unassigned stock is sellable from
 * any location, which is exactly what reserveLocationStock has always
 * enforced. Any change here must change both paths together, or the
 * line display and the approval check will disagree about the same
 * warehouse again (trial SO-261108-0008 showed "10 متاح" while
 * approval failed with 0 in the default warehouse).
 */
export function computeLocationAvailability(args: {
  locationQty: number | string | null | undefined;
  locationReserved: number | string | null | undefined;
  unassignedQty: number | string | null | undefined;
  unassignedReserved: number | string | null | undefined;
  globalStock: number | string | null | undefined;
  globalReserved: number | string | null | undefined;
}): { availableAtLocation: number; globalAvailable: number } {
  return {
    availableAtLocation: roundStockQty(
      Math.max(0, Number(args.locationQty || 0) - Number(args.locationReserved || 0)) +
        Math.max(0, Number(args.unassignedQty || 0) - Number(args.unassignedReserved || 0)),
    ),
    globalAvailable: roundStockQty(
      Math.max(0, Number(args.globalStock || 0) - Number(args.globalReserved || 0)),
    ),
  };
}

export type LocationAvailability = {
  productId: number;
  locationId: number | null;
  branchId: number | null;
  locationQty: number;
  locationReservedQty: number;
  unassignedQty: number;
  unassignedReservedQty: number;
  availableAtLocation: number;
  globalAvailable: number;
};

/**
 * Read-only availability of one product at one location — the display
 * side of computeLocationAvailability. It mirrors the row resolution
 * of reserveLocationStock (ensureLocationBalance matching, plus the
 * unassigned discrepancy seeding of ensureUnassignedBalance) WITHOUT
 * writing anything: no balance row is created and no quantity is
 * seeded, so a display read can never mutate stock. Throws
 * PRODUCT_NOT_FOUND for an unknown product, exactly like reserve.
 */
export async function getLocationAvailability(
  db: Kysely<Database>,
  params: TenantStockScope & { productId: number; locationId?: number | null; branchId?: number | null },
): Promise<LocationAvailability> {
  const scope = requireStockTenantScope(params);
  const product = await db
    .selectFrom('products')
    .select(['id', 'stock_qty', sql<number | null>`COALESCE(reserved_qty, 0)`.as('reserved_qty')])
    .where('id', '=', params.productId)
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .executeTakeFirst();
  if (!product) {
    throw new AppError(
      `الصنف رقم #${params.productId} غير موجود أو ليس لديك صلاحية للوصول إليه`,
      'PRODUCT_NOT_FOUND',
      404,
    );
  }
  const balances = await db
    .selectFrom('product_location_stock')
    .select(['id', 'product_id', 'branch_id', 'location_id', 'qty', sql<number | null>`COALESCE(reserved_qty, 0)`.as('reserved_qty')])
    .where('product_id', '=', Number(product.id))
    .where('tenant_id', '=', scope.tenantId)
    .where('account_id', '=', scope.accountId)
    .orderBy('id', 'asc')
    .execute();
  const rows = balances.map((row: any) => ({
    location_id: row.location_id == null ? null : Number(row.location_id),
    branch_id: row.branch_id == null ? null : Number(row.branch_id),
    qty: Number(row.qty || 0),
    reserved_qty: Number(row.reserved_qty || 0),
  }));
  const locationId = params.locationId == null ? null : Number(params.locationId);
  const branchId = params.branchId == null ? null : Number(params.branchId);

  // Same matching as ensureLocationBalance, read-only (no insert).
  let locationRow: (typeof rows)[number] | undefined;
  if (locationId !== null) {
    locationRow = rows.find((row) => row.location_id === locationId);
  } else if (branchId !== null) {
    locationRow =
      rows.find((row) => row.branch_id === branchId && row.location_id === null) ||
      rows.find((row) => row.location_id === null);
  } else {
    locationRow =
      rows.find((row) => row.location_id === null && row.branch_id === null) ||
      rows.find((row) => row.location_id === null);
  }

  // Same unassigned rule as ensureUnassignedBalance, read-only: the
  // global-minus-located discrepancy is sellable from any location.
  const globalQty = roundStockQty(product.stock_qty);
  const locatedSum = roundStockQty(rows.reduce((sum, row) => sum + row.qty, 0));
  const discrepancy = roundStockQty(globalQty - locatedSum);
  const unassignedRow = rows.find((row) => row.location_id === null && row.branch_id === null);
  const unassignedQty = roundStockQty((unassignedRow?.qty ?? 0) + (discrepancy > 0.001 ? discrepancy : 0));
  const unassignedReserved = unassignedRow?.reserved_qty ?? 0;

  const { availableAtLocation, globalAvailable } = computeLocationAvailability({
    locationQty: locationRow?.qty ?? 0,
    locationReserved: locationRow?.reserved_qty ?? 0,
    unassignedQty,
    unassignedReserved,
    globalStock: product.stock_qty,
    globalReserved: product.reserved_qty ?? 0,
  });

  return {
    productId: Number(product.id),
    locationId,
    branchId,
    locationQty: locationRow?.qty ?? 0,
    locationReservedQty: locationRow?.reserved_qty ?? 0,
    unassignedQty,
    unassignedReservedQty: unassignedReserved,
    availableAtLocation,
    globalAvailable,
  };
}

export async function reserveLocationStock(
  db: Kysely<Database>,
  params: StockLocationReservationParams,
): Promise<StockReservationResult> {
  const scope = requireStockTenantScope(params);
  const sortedItems = [...(params.items || [])]
    .filter((i) => Number(i.qty) > 0)
    .sort((a, b) => Number(a.productId) - Number(b.productId));

  const resultItems: StockReservationResultItem[] = [];

  for (const item of sortedItems) {
    const qty = roundStockQty(item.qty);
    if (qty <= 0) continue;

    const state = await loadLockedState(db, {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      productId: item.productId,
    });

    const location = await ensureLocationBalance(db, state, params.locationId ?? null, params.branchId ?? null);
    const unassigned = await ensureUnassignedBalance(db, state);

    // INV-SALES-ORDER-WAREHOUSE-SELECTION: same arithmetic as the
    // display read (getLocationAvailability) — never recompute here.
    const { availableAtLocation, globalAvailable } = computeLocationAvailability({
      locationQty: location.qty,
      locationReserved: location.reserved_qty,
      unassignedQty: unassigned.qty,
      unassignedReserved: unassigned.reserved_qty,
      globalStock: state.product.stock_qty,
      globalReserved: state.product.reserved_qty,
    });
    const locationReserved = Number(location.reserved_qty || 0);
    const globalReserved = Number(state.product.reserved_qty || 0);

    if (!params.allowOutOfStock) {
      if (params.locationId && availableAtLocation < qty) {
        throw new AppError(
          `عفواً، الرصيد المتاح من الصنف "${state.product.name}" في هذا المخزن هو ${availableAtLocation} فقط (المطلوب ${qty}).`,
          'INSUFFICIENT_LOCATION_STOCK',
          400,
        );
      }
      if (globalAvailable < qty) {
        throw new AppError(
          `عفواً، الرصيد المتاح من الصنف "${state.product.name}" هو ${globalAvailable} فقط (المطلوب ${qty}).`,
          'INSUFFICIENT_STOCK',
          400,
        );
      }
    }

    const nextLocationReserved = roundStockQty(locationReserved + qty);
    const nextGlobalReserved = roundStockQty(globalReserved + qty);

    await db
      .updateTable('product_location_stock')
      .set({
        reserved_qty: nextLocationReserved,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', location.id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .execute();

    await db
      .updateTable('products')
      .set({
        reserved_qty: nextGlobalReserved,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', state.product.id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .execute();

    location.reserved_qty = nextLocationReserved;
    state.product.reserved_qty = nextGlobalReserved;

    resultItems.push({
      productId: item.productId,
      qty,
      locationReservedBefore: locationReserved,
      locationReservedAfter: nextLocationReserved,
      globalReservedBefore: globalReserved,
      globalReservedAfter: nextGlobalReserved,
    });
  }

  return {
    branchId: params.branchId ?? null,
    locationId: params.locationId ?? null,
    items: resultItems,
  };
}

export async function releaseLocationStock(
  db: Kysely<Database>,
  params: StockLocationReservationParams,
): Promise<StockReservationResult> {
  const scope = requireStockTenantScope(params);
  const sortedItems = [...(params.items || [])]
    .filter((i) => Number(i.qty) > 0)
    .sort((a, b) => Number(a.productId) - Number(b.productId));

  const resultItems: StockReservationResultItem[] = [];

  for (const item of sortedItems) {
    const qty = roundStockQty(item.qty);
    if (qty <= 0) continue;

    const state = await loadLockedState(db, {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      productId: item.productId,
    });

    const location = await ensureLocationBalance(db, state, params.locationId ?? null, params.branchId ?? null);

    const locationReserved = Number(location.reserved_qty || 0);
    const globalReserved = Number(state.product.reserved_qty || 0);

    const nextLocationReserved = roundStockQty(Math.max(0, locationReserved - qty));
    const nextGlobalReserved = roundStockQty(Math.max(0, globalReserved - qty));

    await db
      .updateTable('product_location_stock')
      .set({
        reserved_qty: nextLocationReserved,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', location.id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .execute();

    await db
      .updateTable('products')
      .set({
        reserved_qty: nextGlobalReserved,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', state.product.id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .execute();

    location.reserved_qty = nextLocationReserved;
    state.product.reserved_qty = nextGlobalReserved;

    resultItems.push({
      productId: item.productId,
      qty,
      locationReservedBefore: locationReserved,
      locationReservedAfter: nextLocationReserved,
      globalReservedBefore: globalReserved,
      globalReservedAfter: nextGlobalReserved,
    });
  }

  return {
    branchId: params.branchId ?? null,
    locationId: params.locationId ?? null,
    items: resultItems,
  };
}
