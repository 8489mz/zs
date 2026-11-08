import { Kysely, Transaction, sql } from 'kysely';
import { randomUUID } from 'crypto';
import { Database } from '../../../database/database.types';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Gross-margin digits follow the DENOMINATION of the amount, not the
 * tenant: gross_margin_egp is EGP-denominated (column name, and
 * NUMERIC(15, 2) in migration 2040000000239), so it always rounds to
 * EGP minor units (2) — even on a KWD tenant whose book digits are 3.
 * A KWD tenant's 3 book digits here would leave 3dp in EGP amounts
 * that are 2dp everywhere else. No tenant-currency lookup is needed
 * (and none is made) for these margins.
 */
const GROSS_MARGIN_EGP_DIGITS = currencyMoneyDigits('EGP');

/**
 * IMPORT LOT ALLOCATION & PROVENANCE ENGINE
 *
 * Provides operational lot traceability between sales (POS, Wholesale),
 * sales returns, cancellations, and inventory movements:
 * - Allocates sales from active container lots using FIFO with warehouse matching.
 * - Restores lot balances upon sale cancellation or returns, accounting for already-returned quantities.
 * - Handles multiple partial returns and prevents duplicate cancellations.
 * - Tracks exact landed costs, invoiced sales, and gross margins per project and shipment.
 * - Preserves General Ledger Weighted Average Cost (WAC) intact.
 */

/**
 * Lot-allocation coverage, reported per sale item instead of silently
 * skipped. A shortfall here is traceability-only for ordinary POS sales
 * (their GL COGS comes from sale_items.cost_price, i.e. WAC), but it is a
 * GL input for import preorder conversions, whose COGS is built from these
 * allocations — so a shortfall must reach the caller, never vanish in a
 * continue. Quantities use the file's existing 0.0001 epsilon: a
 * remainder at or below it counts as covered, not as a shortfall.
 */
export type ImportLotAllocationReason =
  | 'fully_covered'
  | 'missing_location'
  | 'no_active_lots'
  | 'lots_exhausted'
  | 'invalid_quantity';

export interface ImportLotAllocationCoverage {
  productId: number;
  requestedQty: number;
  allocatedQty: number;
  shortfallQty: number;
  fullyCovered: boolean;
  reason: ImportLotAllocationReason;
}

export interface ImportLotAllocationResult {
  items: ImportLotAllocationCoverage[];
  fullyCovered: boolean;
  totalShortfallQty: number;
}

/**
 * Whether an uncovered lot allocation is anomalous enough to record
 * (INV-IMPORT-LOT-SHORTFALL-RECORD). A shortfall is NOT anomalous just
 * because lots ran out: a product can legitimately be part import, part
 * local stock, so lots_exhausted / no_active_lots for a product that has
 * never had an import lot is ordinary local stock, not a traceability
 * break. It IS anomalous when the sale itself is malformed
 * (missing_location, invalid_quantity — traceability was impossible
 * regardless of lots) or when the product IS import-tracked (it has had
 * import lots) yet no lot at the sale location covered the sale — then
 * the sale's provenance is genuinely missing and must leave a record
 * instead of vanishing in a discarded return value. Callers that
 * ignore the allocation result entirely are the defect this exists to
 * close: the P0 preorder conversion already cross-checks coverage, but
 * ordinary POS sales discarded it.
 */
export function isAnomalousImportLotShortfall(
  coverage: ImportLotAllocationCoverage,
  hasAnyImportLots: boolean,
): boolean {
  if (coverage.fullyCovered) return false;
  if (coverage.reason === 'missing_location' || coverage.reason === 'invalid_quantity') return true;
  return hasAnyImportLots;
}

/**
 * Pure import-sale cost build-up (EGP-denominated by design: the import
 * subsystem prices everything in EGP — unit_cost_egp / unit_price_egp).
 * The total is rounded once to EGP minor units (2 digits); the unit cost
 * keeps 6 digits, matching the sale_items.cost_price precision POS uses,
 * so qty x unit cost reconciles to the journal total within rounding.
 * The old service code was a special case of this function: it used the
 * fallback for the whole quantity only when the allocation total was
 * exactly zero, and dropped the uncovered units' cost otherwise.
 */
export function calculateImportSaleCost(params: {
  qty: number;
  allocatedQty: number;
  allocCostEgp: number;
  fallbackUnitCostEgp: number;
  /** Book digits for the EGP total; defaults to EGP's (2). */
  moneyDigits?: MoneyDigits;
}): { shortfallQty: number; shortfallCostEgp: number; totalCostEgp: number; unitCostEgp: number } {
  const qty = Number(params.qty);
  const allocatedQty = Number(params.allocatedQty);
  const allocCostEgp = Number(params.allocCostEgp);
  const fallbackUnitCostEgp = Number(params.fallbackUnitCostEgp);
  if (!Number.isFinite(qty) || qty < 0) throw new Error('Import sale cost requires a finite non-negative quantity.');
  if (!Number.isFinite(allocatedQty) || allocatedQty < 0) throw new Error('Import sale allocated quantity must be finite and non-negative.');
  if (allocatedQty > qty + 0.0001) throw new Error('Import sale lot allocation exceeds the sale quantity.');
  if (!Number.isFinite(allocCostEgp) || allocCostEgp < 0) throw new Error('Import sale allocation cost must be finite and non-negative.');
  if (!Number.isFinite(fallbackUnitCostEgp) || fallbackUnitCostEgp < 0) throw new Error('Import sale fallback unit cost must be finite and non-negative.');
  const shortfallQty = Number(Math.max(0, qty - allocatedQty).toFixed(4));
  const shortfallCostEgp = shortfallQty * fallbackUnitCostEgp;
  const totalCostEgp = roundMoney(allocCostEgp + shortfallCostEgp, params.moneyDigits ?? currencyMoneyDigits('EGP'));
  const unitCostEgp = qty > 0 ? Number((totalCostEgp / qty).toFixed(6)) : 0;
  return { shortfallQty, shortfallCostEgp, totalCostEgp, unitCostEgp };
}

export async function allocateSaleFromImportLots(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    saleId: number;
    locationId?: number | null;
    items: Array<{
      itemId?: number | null;
      productId: number;
      qty: number;
      netUnitPrice: number;
      locationId?: number | null;
    }>;
  }
): Promise<ImportLotAllocationResult> {
  const moneyDigits = GROSS_MARGIN_EGP_DIGITS;
  const coverage: ImportLotAllocationCoverage[] = [];
  for (const item of params.items) {
    const pId = Number(item.productId);
    const requestedQty = Number(item.qty);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      coverage.push({
        productId: pId, requestedQty, allocatedQty: 0,
        shortfallQty: requestedQty > 0 ? requestedQty : 0,
        fullyCovered: false, reason: 'invalid_quantity',
      });
      continue;
    }
    let neededQty = requestedQty;

    // Check if any active import lots exist for this product and tenant
    let lotQuery = trx
      .selectFrom('import_inventory_lots')
      .selectAll()
      .where('tenant_id', '=', params.tenantId)
      .where('product_id', '=', pId)
      .where('status', '=', 'active')
      .where('remaining_quantity', '>', 0);

    const targetLocId = item.locationId !== undefined ? item.locationId : params.locationId;
    // Unlocated legacy lots cannot be assigned to a sale from an arbitrary store.
    if (!Number.isSafeInteger(targetLocId) || Number(targetLocId) <= 0) {
      coverage.push({
        productId: pId, requestedQty, allocatedQty: 0, shortfallQty: requestedQty,
        fullyCovered: false, reason: 'missing_location',
      });
      continue;
    }
    lotQuery = lotQuery.where('location_id', '=', Number(targetLocId));

    const lots = await lotQuery
      .orderBy('receipt_date', 'asc')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .execute();

    if (!lots || lots.length === 0) {
      coverage.push({
        productId: pId, requestedQty, allocatedQty: 0, shortfallQty: requestedQty,
        fullyCovered: false, reason: 'no_active_lots',
      });
      continue;
    }

    let allocatedQty = 0;
    for (const lot of lots) {
      if (neededQty <= 0.0001) break;

      const avail = Number(lot.remaining_quantity);
      const allocQty = Math.min(avail, neededQty);
      const newRemaining = Number((avail - allocQty).toFixed(4));

      await trx
        .updateTable('import_inventory_lots')
        .set({
          remaining_quantity: newRemaining,
          status: newRemaining <= 0.0001 ? 'depleted' : 'active',
          updated_at: new Date(),
        })
        .where('id', '=', lot.id)
        .where('tenant_id', '=', params.tenantId)
        .execute();

      const unitSalePrice = Number(item.netUnitPrice);
      const unitCost = Number(lot.unit_landed_cost_egp);
      const grossMargin = roundMoney((unitSalePrice - unitCost) * allocQty, moneyDigits);

      await trx
        .insertInto('import_sale_allocations')
        .values({
          tenant_id: params.tenantId,
          sale_id: params.saleId,
          sale_item_id: item.itemId || null,
          lot_id: lot.id,
          project_id: lot.project_id || null,
          shipment_id: lot.shipment_id || null,
          product_id: pId,
          quantity: allocQty,
          unit_sale_price_egp: unitSalePrice,
          unit_cost_egp: unitCost,
          gross_margin_egp: grossMargin,
          allocation_type: 'sale',
          reversal_of_allocation_id: null,
          created_at: new Date(),
        } as any)
        .execute();

      allocatedQty = Number((allocatedQty + allocQty).toFixed(4));
      neededQty = Number((neededQty - allocQty).toFixed(4));
    }

    const shortfallQty = Number(Math.max(0, requestedQty - allocatedQty).toFixed(4));
    coverage.push({
      productId: pId, requestedQty, allocatedQty, shortfallQty,
      fullyCovered: shortfallQty <= 0.0001,
      reason: shortfallQty <= 0.0001 ? 'fully_covered' : 'lots_exhausted',
    });
  }
  const totalShortfallQty = Number(coverage.reduce((sum, entry) => sum + entry.shortfallQty, 0).toFixed(4));
  return { items: coverage, fullyCovered: coverage.every((entry) => entry.fullyCovered), totalShortfallQty };
}

export async function restoreImportLotsFromCancelledSale(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    saleId: number;
  }
): Promise<void> {
  const moneyDigits = GROSS_MARGIN_EGP_DIGITS;
  const allocations = await trx
    .selectFrom('import_sale_allocations')
    .selectAll()
    .where('tenant_id', '=', params.tenantId)
    .where('sale_id', '=', params.saleId)
    .where('allocation_type', '=', 'sale')
    .forUpdate()
    .execute();

  for (const alloc of allocations) {
    const previousRestorations = await trx
      .selectFrom('import_sale_allocations')
      .select([sql<number>`coalesce(sum(abs(quantity)), 0)`.as('restored_qty')])
      .where('tenant_id', '=', params.tenantId)
      .where('reversal_of_allocation_id', '=', alloc.id)
      .executeTakeFirst();

    const alreadyRestored = Number(previousRestorations?.restored_qty || 0);
    const qtyToRestore = Number((Number(alloc.quantity) - alreadyRestored).toFixed(4));
    if (qtyToRestore <= 0.0001) continue;

    await trx
      .updateTable('import_inventory_lots')
      .set((eb) => ({
        remaining_quantity: sql`${eb.ref('remaining_quantity')} + ${qtyToRestore}`,
        status: 'active',
        updated_at: new Date(),
      }))
      .where('id', '=', alloc.lot_id)
      .where('tenant_id', '=', params.tenantId)
      .execute();

    const unitSalePrice = Number(alloc.unit_sale_price_egp);
    const unitCost = Number(alloc.unit_cost_egp);
    const grossMarginReversed = roundMoney((unitSalePrice - unitCost) * qtyToRestore, moneyDigits);

    await trx
      .insertInto('import_sale_allocations')
      .values({
        tenant_id: params.tenantId,
        sale_id: params.saleId,
        sale_item_id: alloc.sale_item_id,
        lot_id: alloc.lot_id,
        project_id: alloc.project_id,
        shipment_id: alloc.shipment_id,
        product_id: alloc.product_id,
        quantity: -qtyToRestore,
        unit_sale_price_egp: unitSalePrice,
        unit_cost_egp: unitCost,
        gross_margin_egp: -grossMarginReversed,
        allocation_type: 'cancellation',
        reversal_of_allocation_id: alloc.id,
        created_at: new Date(),
      } as any)
      .execute();
  }
}

export async function restoreImportLotsFromSalesReturn(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    saleId: number;
    saleItemId?: number | null;
    productId: number;
    returnQty: number;
  }
): Promise<void> {
  const moneyDigits = GROSS_MARGIN_EGP_DIGITS;
  let remainingReturnQty = Number(params.returnQty);
  if (!Number.isFinite(remainingReturnQty) || remainingReturnQty <= 0) return;

  let query = trx
    .selectFrom('import_sale_allocations')
    .selectAll()
    .where('tenant_id', '=', params.tenantId)
    .where('sale_id', '=', params.saleId)
    .where('product_id', '=', params.productId)
    .where('allocation_type', '=', 'sale');

  if (params.saleItemId) {
    query = query.where('sale_item_id', '=', params.saleItemId);
  }

  const allocations = await query.orderBy('created_at', 'desc').forUpdate().execute();

  for (const alloc of allocations) {
    if (remainingReturnQty <= 0.0001) break;

    const previousRestorations = await trx
      .selectFrom('import_sale_allocations')
      .select([sql<number>`coalesce(sum(abs(quantity)), 0)`.as('restored_qty')])
      .where('tenant_id', '=', params.tenantId)
      .where('reversal_of_allocation_id', '=', alloc.id)
      .executeTakeFirst();

    const alreadyRestored = Number(previousRestorations?.restored_qty || 0);
    const allocAvailable = Number((Number(alloc.quantity) - alreadyRestored).toFixed(4));
    if (allocAvailable <= 0.0001) continue;

    const restoreAmount = Math.min(allocAvailable, remainingReturnQty);

    await trx
      .updateTable('import_inventory_lots')
      .set((eb) => ({
        remaining_quantity: sql`${eb.ref('remaining_quantity')} + ${restoreAmount}`,
        status: 'active',
        updated_at: new Date(),
      }))
      .where('id', '=', alloc.lot_id)
      .where('tenant_id', '=', params.tenantId)
      .execute();

    const unitSalePrice = Number(alloc.unit_sale_price_egp);
    const unitCost = Number(alloc.unit_cost_egp);
    const grossMarginReversed = roundMoney((unitSalePrice - unitCost) * restoreAmount, moneyDigits);

    await trx
      .insertInto('import_sale_allocations')
      .values({
        tenant_id: params.tenantId,
        sale_id: params.saleId,
        sale_item_id: alloc.sale_item_id,
        lot_id: alloc.lot_id,
        project_id: alloc.project_id,
        shipment_id: alloc.shipment_id,
        product_id: params.productId,
        quantity: -restoreAmount,
        unit_sale_price_egp: unitSalePrice,
        unit_cost_egp: unitCost,
        gross_margin_egp: -grossMarginReversed,
        allocation_type: 'return',
        reversal_of_allocation_id: alloc.id,
        created_at: new Date(),
      } as any)
      .execute();

    remainingReturnQty = Number((remainingReturnQty - restoreAmount).toFixed(4));
  }
}

export async function adjustImportLotQuantity(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    lotId: string;
    adjustmentQty: number;
    reason?: string;
  }
): Promise<void> {
  const lot = await trx
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('id', '=', params.lotId)
    .where('tenant_id', '=', params.tenantId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  const current = Number(lot.remaining_quantity);
  if (!Number.isFinite(params.adjustmentQty) || params.adjustmentQty === 0) {
    throw new Error('Lot adjustment quantity must be finite and nonzero.');
  }
  const newQty = Number((current + params.adjustmentQty).toFixed(4));
  if (newQty < 0 || newQty > Number(lot.initial_quantity) + 0.0001) {
    throw new Error('Lot adjustment would exceed available inventory or original receipt.');
  }

  await trx
    .updateTable('import_inventory_lots')
    .set({
      remaining_quantity: newQty,
      status: newQty <= 0.0001 ? 'depleted' : 'active',
      updated_at: new Date(),
    })
    .where('id', '=', params.lotId)
    .where('tenant_id', '=', params.tenantId)
    .execute();
}

export async function transferImportLotLocation(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    lotId: string;
    toLocationId: number;
    qty?: number;
  }
): Promise<void> {
  const lot = await trx
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('id', '=', params.lotId)
    .where('tenant_id', '=', params.tenantId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  const current = Number(lot.remaining_quantity);
  const transferQty = params.qty === undefined ? current : Number(params.qty);
  if (!Number.isSafeInteger(params.toLocationId) || params.toLocationId <= 0 ||
      !Number.isFinite(transferQty) || transferQty <= 0 || transferQty > current + 0.0001 ||
      lot.location_id === params.toLocationId) {
    throw new Error('Invalid destination or transfer quantity for import lot.');
  }
  const destination = await trx.selectFrom('stock_locations').select('id')
    .where('tenant_id', '=', params.tenantId).where('id', '=', params.toLocationId).executeTakeFirst();
  if (!destination) throw new Error('Target warehouse does not belong to this tenant.');

  if (transferQty >= current - 0.0001) {
    await trx
      .updateTable('import_inventory_lots')
      .set({
        location_id: params.toLocationId,
        updated_at: new Date(),
      })
      .where('id', '=', params.lotId)
      .where('tenant_id', '=', params.tenantId)
      .execute();
  } else {
    const remainingAtSource = Number((current - transferQty).toFixed(4));
    await trx
      .updateTable('import_inventory_lots')
      .set({
        remaining_quantity: remainingAtSource,
        updated_at: new Date(),
      })
      .where('id', '=', params.lotId)
      .where('tenant_id', '=', params.tenantId)
      .execute();

    await trx
      .insertInto('import_inventory_lots')
      .values({
        tenant_id: params.tenantId,
        lot_number: `${lot.lot_number.slice(0, 65)}-TR${params.toLocationId}-${randomUUID().slice(0, 8)}`,
        project_id: lot.project_id,
        shipment_id: lot.shipment_id,
        shipment_item_id: lot.shipment_item_id,
        product_id: lot.product_id,
        location_id: params.toLocationId,
        initial_quantity: transferQty,
        remaining_quantity: transferQty,
        unit_landed_cost_egp: lot.unit_landed_cost_egp,
        status: 'active',
        receipt_date: lot.receipt_date,
        created_at: new Date(),
        updated_at: new Date(),
      } as any)
      .execute();
  }
}

export async function syncImportLotsOnLocationTransfer(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    productId: number;
    fromLocationId?: number | null;
    toLocationId?: number | null;
    qty: number;
  }
): Promise<void> {
  const fromLoc = Number(params.fromLocationId);
  const toLoc = Number(params.toLocationId);
  let remaining = Number(params.qty);
  if (
    !Number.isSafeInteger(fromLoc) ||
    fromLoc <= 0 ||
    !Number.isSafeInteger(toLoc) ||
    toLoc <= 0 ||
    fromLoc === toLoc ||
    !Number.isFinite(remaining) ||
    remaining <= 0
  ) {
    return;
  }

  const lots = await trx
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', params.tenantId)
    .where('product_id', '=', Number(params.productId))
    .where('location_id', '=', fromLoc)
    .where('status', '=', 'active')
    .where('remaining_quantity', '>', 0)
    .orderBy('receipt_date', 'asc')
    .orderBy('created_at', 'asc')
    .forUpdate()
    .execute();

  for (const lot of lots || []) {
    if (remaining <= 0.0001) break;
    const avail = Number(lot.remaining_quantity);
    if (avail <= 0.0001) continue;
    const moveQty = Math.min(avail, remaining);
    await transferImportLotLocation(trx, {
      tenantId: params.tenantId,
      lotId: String(lot.id),
      toLocationId: toLoc,
      qty: moveQty,
    });
    remaining = Number((remaining - moveQty).toFixed(4));
  }
}

export async function syncImportLotsOnStockDeduction(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    productId: number;
    locationId?: number | null;
    qty: number;
    reason?: string;
  }
): Promise<void> {
  const locId = Number(params.locationId);
  let remaining = Math.abs(Number(params.qty));
  if (!Number.isFinite(remaining) || remaining <= 0) return;

  let query = trx
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', params.tenantId)
    .where('product_id', '=', Number(params.productId))
    .where('status', '=', 'active')
    .where('remaining_quantity', '>', 0);

  if (Number.isSafeInteger(locId) && locId > 0) {
    query = query.where('location_id', '=', locId);
  }

  const lots = await query
    .orderBy('receipt_date', 'asc')
    .orderBy('created_at', 'asc')
    .forUpdate()
    .execute();

  for (const lot of lots || []) {
    if (remaining <= 0.0001) break;
    const avail = Number(lot.remaining_quantity);
    if (avail <= 0.0001) continue;
    const deductQty = Math.min(avail, remaining);
    await adjustImportLotQuantity(trx, {
      tenantId: params.tenantId,
      lotId: String(lot.id),
      adjustmentQty: -deductQty,
      reason: params.reason,
    });
    remaining = Number((remaining - deductQty).toFixed(4));
  }
}

