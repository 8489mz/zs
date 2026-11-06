import { AppError } from '../../../common/errors/app-error';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import { type MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

function roundCurrency(value: number, digits: MoneyDigits = 2): number {
  // Canonical rounding at the tenant's book digits (INV-CANONICAL-ROUNDING-EVERYWHERE):
  // no EPSILON bump. Binary half-cents just below the half (1.005) round down,
  // as the canonical engine rounds them. The `= 2` default is unchanged by
  // this package: normalizePositiveAmount relies on it and has no digits
  // context; removing the default is a separate fail-closed package.
  return roundMoney(Number(value || 0), digits);
}

export type PurchaseProductRow = {
  id?: number | string | null;
  name?: string | null;
  stock_qty?: number | string | null;
  item_type?: string | null;
};

export type NormalizedPurchaseItem = {
  productId: number;
  name: string;
  qty: number;
  cost: number;
  oldCostPrice: number;
  unitName: string;
  unitMultiplier: number;
  total: number;
  // INV-SERVICE-ITEM-QUICK-CREATE: a service line carries no stock and
  // its amount is expensed, never capitalised as inventory.
  isService: boolean;
  categoryId?: number | null;
  locationId?: number | null;
  serials?: any;
  batchNumber?: string | null;
  expiryDate?: string | null;
};

export type DiscountAllocatedPurchaseItem = NormalizedPurchaseItem & {
  allocatedDiscount: number;
  effectiveLineTotal: number;
  effectiveUnitCost: number;
};

export type PurchaseContextShape = {
  doc_no?: string | null;
  id?: number | string | null;
  branch_id?: number | null;
  location_id?: number | null;
  total?: number | string | null;
  supplier_id?: number | string | null;
  discount?: number | string | null;
};

export type PurchaseScope = {
  branchId: number | null;
  locationId: number | null;
};

export function buildNormalizedPurchaseItem(
  item: UpsertPurchaseDto['items'][number],
  product: PurchaseProductRow,
  digits: MoneyDigits = 2,
): NormalizedPurchaseItem {
  const productName = String(item.name || product.name || '').trim();
  if (!productName) {
    throw new AppError(`Product #${item.productId} is missing a display name`, 'PRODUCT_NAME_REQUIRED', 400);
  }

  const qty = Number(item.qty || 0);
  const cost = Number(item.cost || 0);
  const unitMultiplier = item.unitMultiplier == null ? 1 : Number(item.unitMultiplier);
  if (!Number.isFinite(unitMultiplier) || unitMultiplier <= 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
    throw new AppError('Invalid purchase quantity, multiplier or cost', 'INVALID_PURCHASE_ITEM', 400);
  }

  return {
    productId: Number(item.productId || product.id || 0),
    name: productName,
    qty,
    cost,
    oldCostPrice: Number((product as any).cost_price || 0),
    unitName: String(item.unitName || 'قطعة').trim() || 'قطعة',
    unitMultiplier,
    total: roundCurrency(qty * cost, digits),
    isService: (product as any)?.item_type === 'service',
    categoryId: item.categoryId ? Number(item.categoryId) : null,
    locationId: item.locationId ? Number(item.locationId) : null,
    ...(item.serials !== undefined ? { serials: item.serials } : {}),
    batchNumber: (item as any).batchNumber || (item as any).batch_number || null,
    expiryDate: (item as any).expiryDate || (item as any).expiry_date || null,
  };
}

export function calculatePurchaseSubtotal(items: Array<{ total: number }>, digits: MoneyDigits = 2): number {
  return roundCurrency(items.reduce((sum, item) => sum + Number(item.total || 0), 0), digits);
}

export function allocatePurchaseInvoiceDiscount(items: NormalizedPurchaseItem[], invoiceDiscount: number, digits: MoneyDigits = 2): DiscountAllocatedPurchaseItem[] {
  const safeDiscount = roundCurrency(Number(invoiceDiscount || 0), digits);
  if (!items.length || safeDiscount === 0) {
    return items.map((item) => ({
      ...item,
      allocatedDiscount: 0,
      effectiveLineTotal: roundCurrency(item.total, digits),
      effectiveUnitCost: item.qty > 0 ? Number((roundCurrency(item.total, digits) / item.qty).toFixed(6)) : 0,
    }));
  }

  const subtotal = roundCurrency(calculatePurchaseSubtotal(items, digits), digits);
  if (subtotal <= 0) {
    return items.map((item) => ({
      ...item,
      allocatedDiscount: 0,
      effectiveLineTotal: roundCurrency(item.total, digits),
      effectiveUnitCost: item.qty > 0 ? Number((roundCurrency(item.total, digits) / item.qty).toFixed(6)) : 0,
    }));
  }

  const eligibleIndexes = items
    .map((item, index) => ({ index, total: roundCurrency(item.total, digits) }))
    .filter((entry) => entry.total > 0)
    .map((entry) => entry.index);

  if (!eligibleIndexes.length) {
    return items.map((item) => ({
      ...item,
      allocatedDiscount: 0,
      effectiveLineTotal: roundCurrency(item.total, digits),
      effectiveUnitCost: item.qty > 0 ? Number((roundCurrency(item.total, digits) / item.qty).toFixed(6)) : 0,
    }));
  }

  const targetNetTotal = roundCurrency(subtotal - safeDiscount, digits);
  const allocatedByIndex = new Map<number, number>();
  const effectiveByIndex = new Map<number, number>();
  let allocatedSoFar = 0;
  let effectiveSoFar = 0;

  for (let i = 0; i < eligibleIndexes.length; i += 1) {
    const index = eligibleIndexes[i];
    const item = items[index];
    const gross = roundCurrency(item.total, digits);
    const isLastEligible = i === eligibleIndexes.length - 1;

    if (!isLastEligible) {
      const proportional = roundCurrency((safeDiscount * gross) / subtotal, digits);
      // For positive discounts, cap at gross to prevent negative net line totals. For negative discounts (surcharge), no cap needed.
      const allocated = safeDiscount > 0 ? Math.min(proportional, gross) : proportional;
      const net = roundCurrency(gross - allocated, digits);
      allocatedByIndex.set(index, allocated);
      effectiveByIndex.set(index, net);
      allocatedSoFar = roundCurrency(allocatedSoFar + allocated, digits);
      effectiveSoFar = roundCurrency(effectiveSoFar + net, digits);
      continue;
    }

    const allocated = roundCurrency(safeDiscount - allocatedSoFar, digits);
    const adjustedAllocated = safeDiscount > 0 ? Math.min(allocated, gross) : allocated;
    const net = roundCurrency(gross - adjustedAllocated, digits);
    
    allocatedByIndex.set(index, adjustedAllocated);
    effectiveByIndex.set(index, net);
    allocatedSoFar = roundCurrency(allocatedSoFar + adjustedAllocated, digits);
  }

  return items.map((item, index) => {
    const gross = roundCurrency(item.total, digits);
    const allocatedDiscount = roundCurrency(allocatedByIndex.get(index) || 0, digits);
    const effectiveLineTotal = roundCurrency(
      effectiveByIndex.has(index)
        ? Number(effectiveByIndex.get(index) || 0)
        : gross,
      digits,
    );
    return {
      ...item,
      allocatedDiscount,
      effectiveLineTotal,
      effectiveUnitCost: item.qty > 0 ? Number((effectiveLineTotal / item.qty).toFixed(6)) : 0,
    };
  });
}

export type PurchaseLineTotalInput = {
  lineTotal: number | string | null | undefined;
  isService?: boolean | null;
};

/**
 * Split a purchase invoice's discount-allocated line totals into the
 * service share and the stocked share, both net of recoverable VAT
 * (INV-SERVICE-ITEM-QUICK-CREATE). postPurchase debits the stocked
 * share to inventory (1140) and the service share to other expenses
 * (6950): a purchased service must never be capitalised as inventory.
 * VAT is stripped per line, mirroring the create path's per-line net
 * purchase unit cost. Pure: no I/O.
 */
export function partitionPurchaseLineTotals(
  lines: PurchaseLineTotalInput[],
  taxRate: number | string | null | undefined,
  pricesIncludeTax: boolean,
  digits: MoneyDigits = 2,
): { serviceNet: number; stockedNet: number } {
  const rate = Number(taxRate || 0);
  const divisor = pricesIncludeTax && rate > 0 ? 1 + rate / 100 : 1;
  let serviceNet = 0;
  let stockedNet = 0;
  for (const line of lines) {
    const net = roundCurrency(Number(line.lineTotal || 0) / divisor, digits);
    if (line.isService) serviceNet = roundCurrency(serviceNet + net, digits);
    else stockedNet = roundCurrency(stockedNet + net, digits);
  }
  return { serviceNet, stockedNet };
}

export function calculatePurchaseStockIncrease(itemQty: number | string | null | undefined, unitMultiplier: number | string | null | undefined, currentStockQty: number | string | null | undefined) {
  const exactQty = Number(itemQty || 0) * Number(unitMultiplier ?? 1);
  const increasedQty = Number(exactQty.toFixed(3));
  if (!Number.isFinite(exactQty) || exactQty <= 0 || Math.abs(exactQty - increasedQty) > 0.00000001) {
    throw new AppError('Purchase stock quantity must have at most three decimal places', 'PURCHASE_QUANTITY_PRECISION_INVALID', 400);
  }
  const beforeQty = Number(currentStockQty || 0);
  const afterQty = Number((beforeQty + increasedQty).toFixed(3));
  return { increasedQty, beforeQty, afterQty };
}

export function calculatePurchaseStockDecrease(itemQty: number | string | null | undefined, unitMultiplier: number | string | null | undefined, currentStockQty: number | string | null | undefined) {
  const exactQty = Number(itemQty || 0) * Number(unitMultiplier ?? 1);
  const removedQty = Number(exactQty.toFixed(3));
  if (!Number.isFinite(exactQty) || exactQty <= 0 || Math.abs(exactQty - removedQty) > 0.00000001) {
    throw new AppError('Purchase stock quantity must have at most three decimal places', 'PURCHASE_QUANTITY_PRECISION_INVALID', 400);
  }
  const beforeQty = Number(currentStockQty || 0);
  const afterQty = Number((beforeQty - removedQty).toFixed(3));
  return { removedQty, beforeQty, afterQty };
}

export function buildHistoricCostMap(oldItems: Array<{ product_id?: number | string | null; unit_cost?: number | string | null }>) {
  const oldByProduct = new Map<number, number>();
  for (const item of oldItems) {
    if (!item.product_id) continue;
    oldByProduct.set(Number(item.product_id), Number(item.unit_cost || 0));
  }
  return oldByProduct;
}

export function normalizePurchaseScope(payload: { branchId?: number | string | null; locationId?: number | string | null }): PurchaseScope {
  return {
    branchId: payload.branchId ? Number(payload.branchId) : null,
    locationId: payload.locationId ? Number(payload.locationId) : null,
  };
}

export function normalizeOptionalNote(note: unknown): string {
  return String(note || '').trim();
}

export function normalizePositiveAmount(amount: unknown, errorCode = 'INVALID_AMOUNT', message = 'Amount must be greater than zero'): number {
  const normalized = roundCurrency(Number(amount || 0));
  if (!(normalized > 0)) {
    throw new AppError(message, errorCode, 400);
  }
  return normalized;
}

export function ensureAmountWithinOutstanding(amount: number, outstanding: number, errorCode: string, message: string): void {
  if (!(outstanding > 0)) {
    throw new AppError(message, errorCode, 400);
  }
  if (amount > outstanding + 0.0001) {
    throw new AppError(message, errorCode, 400);
  }
}

export function resolvePurchaseDocumentNumber(purchase: PurchaseContextShape): string {
  return String(purchase.doc_no || purchase.id || '').trim();
}

export function buildPurchaseReferenceNote(prefix: string, purchase: PurchaseContextShape): string {
  return `${prefix} ${resolvePurchaseDocumentNumber(purchase)}`.trim();
}
