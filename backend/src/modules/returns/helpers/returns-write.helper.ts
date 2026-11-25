import { AppError } from '../../../common/errors/app-error';
import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

/**
 * Book digits are REQUIRED everywhere in this helper
 * (INV-RETURN-HELPER-DIGITS-REQUIRED): every rounding here feeds a
 * stored return line, a document total, or a ledger balance, so a
 * caller that forgets the tenant's digits must fail closed instead of
 * silently falling back to 2 decimals on a 3-decimal tenant. Rounding
 * is the canonical engine's at the caller's digits
 * (INV-CANONICAL-ROUNDING-EVERYWHERE): the former EPSILON half-up
 * branch for digits === 2 is gone, so binary half-cents just below
 * the half round as the canonical engine rounds them.
 */
function roundMoney(value: number, digits: MoneyDigits): number {
  return roundBookMoney(Number(value || 0), digits);
}

export type ReturnSourceLine = {
  product_id?: number | string | null;
  product_name?: string | null;
  qty?: number | string | null;
  line_total?: number | string | null;
  net_line_total?: number | string | null;
  allocated_tax?: number | string | null;
  unit_multiplier?: number | string | null;
};

export type ReturnProductRow = {
  id?: number | string | null;
  stock_qty?: number | string | null;
};

export type ReturnRequestItem = {
  productId: number;
  productName: string;
  qty: number;
};

export type PreparedReturnLine = {
  productId: number;
  productName: string;
  qty: number;
  unitTotal: number;
  lineTotal: number;
  allocatedTax: number;
  stockDelta: number;
  beforeQty: number;
  afterQty: number;
};

export function buildSaleReturnLine(
  source: ReturnSourceLine,
  product: ReturnProductRow,
  requestItem: ReturnRequestItem,
  history: { qty: number; amount: number; tax: number } = { qty: 0, amount: 0, tax: 0 },
  digits: MoneyDigits,
): PreparedReturnLine {
  const money = (value: number) => roundMoney(value, digits);
  const soldQty = Number(source.qty || 0);
  if (!(soldQty > 0) || history.qty + requestItem.qty > soldQty + 0.000001) {
    throw new AppError('كمية المرتجع تتجاوز الكمية المباعة', 'RETURN_QUANTITY_EXCEEDED', 400);
  }
  const sourceNetLineTotal = Number(source.net_line_total ?? source.line_total ?? 0);
  const sourceTax = Number(source.allocated_tax || 0);
  const sourceLineTotal = sourceNetLineTotal + sourceTax;
  const cumulativeQty = history.qty + requestItem.qty;
  const lineTotal = money((sourceLineTotal * cumulativeQty) / soldQty) - money(history.amount);
  const allocatedTax = money((sourceTax * cumulativeQty) / soldQty) - money(history.tax);
  if (lineTotal < -0.0001 || allocatedTax < -0.0001) {
    throw new AppError('سجل المرتجع السابق يحتاج مراجعة مالية', 'RETURN_RECONCILIATION_REQUIRED', 409);
  }
  const unitTotal = money(lineTotal / requestItem.qty);
  const rawStockDelta = Number(requestItem.qty || 0) * Number(source.unit_multiplier || 1);
  const stockDelta = Number(rawStockDelta.toFixed(3));
  if (!Number.isFinite(rawStockDelta) || rawStockDelta <= 0 || Math.abs(rawStockDelta - stockDelta) > 0.00000001) {
    throw new AppError(
      'كمية المرتجع يجب أن تكون بدقة ثلاث خانات عشرية كحد أقصى',
      'RETURN_QUANTITY_PRECISION_INVALID',
      400,
    );
  }
  const beforeQty = Number(product.stock_qty || 0);
  const afterQty = Number((beforeQty + stockDelta).toFixed(3));

  return {
    productId: Number(requestItem.productId || source.product_id || 0),
    productName: String(source.product_name || requestItem.productName || '').trim(),
    qty: Number(requestItem.qty || 0),
    unitTotal,
    lineTotal,
    allocatedTax,
    stockDelta,
    beforeQty,
    afterQty,
  };
}

export function buildPurchaseReturnLine(
  source: ReturnSourceLine,
  product: ReturnProductRow,
  requestItem: ReturnRequestItem,
  history: { qty: number; amount: number; tax?: number } = { qty: 0, amount: 0 },
  digits: MoneyDigits,
): PreparedReturnLine {
  const money = (value: number) => roundMoney(value, digits);
  const purchasedQty = Number(source.qty || 0);
  const sourceLineTotal = money(Number(source.line_total || 0));
  const cumulativeQty = history.qty + requestItem.qty;
  if (!(purchasedQty > 0) || !(requestItem.qty > 0) || cumulativeQty > purchasedQty + 0.000001) {
    throw new AppError('كمية مرتجع الشراء تتجاوز الكمية المشتراة', 'PURCHASE_RETURN_QUANTITY_EXCEEDED', 400);
  }
  // Cumulative rounding allocates any residual cents to the final partial return.
  const lineTotal = money((sourceLineTotal * cumulativeQty) / purchasedQty) - money(history.amount);
  const sourceTax = money(Number(source.allocated_tax || 0));
  const allocatedTax = money((sourceTax * cumulativeQty) / purchasedQty) - money(history.tax || 0);
  if (lineTotal < -0.0001 || allocatedTax < -0.0001 || allocatedTax > lineTotal + 0.0001) {
    throw new AppError('سجل مرتجع الشراء السابق يحتاج مراجعة مالية', 'PURCHASE_RETURN_RECONCILIATION_REQUIRED', 409);
  }
  const unitTotal = money(lineTotal / requestItem.qty);
  const rawStockDelta = Number(requestItem.qty || 0) * Number(source.unit_multiplier || 1);
  const stockDelta = Number(rawStockDelta.toFixed(3));
  if (!Number.isFinite(rawStockDelta) || rawStockDelta <= 0 || Math.abs(rawStockDelta - stockDelta) > 0.00000001) {
    throw new AppError(
      'كمية المرتجع يجب أن تكون بدقة ثلاث خانات عشرية كحد أقصى',
      'RETURN_QUANTITY_PRECISION_INVALID',
      400,
    );
  }
  const beforeQty = Number(product.stock_qty || 0);
  if (beforeQty + 0.0001 < stockDelta) {
    throw new AppError('المخزون الحالي لا يسمح بتنفيذ مرتجع الشراء لهذا الصنف', 'PURCHASE_RETURN_STOCK_INVALID', 400);
  }
  const afterQty = Number((beforeQty - stockDelta).toFixed(3));

  return {
    productId: Number(requestItem.productId || source.product_id || 0),
    productName: String(source.product_name || requestItem.productName || '').trim(),
    qty: Number(requestItem.qty || 0),
    unitTotal,
    lineTotal,
    allocatedTax,
    stockDelta,
    beforeQty,
    afterQty,
  };
}

/**
 * Original purchase cost for a purchase return (INV-PURCHASE-RETURN-ORIGINAL-COST).
 *
 * createPurchaseReturn used to cost every returned unit at the CURRENT
 * product WAC (products.cost_price). That is wrong for a lot-identified
 * return: the return already pins the original purchase line
 * (purchase_item_id, and serial/batch provenance where applicable), so it
 * reverses that purchase, not a slice of the blended pool. When later
 * purchases moved the WAC, the journal credited inventory at the new WAC
 * while debiting the supplier at the original net price, and the whole
 * drift landed in the 5190 variance account as if it were a real gain/loss.
 *
 * The original inventory cost is recoverable from the purchase line itself,
 * with no new column and no WAC lookup:
 * - purchase_items.unit_cost is the line's unit cost AFTER invoice discount
 *   allocation, per sold unit, and it may include VAT.
 * - purchases-write capitalises inventory net of recoverable VAT, so the
 *   VAT is stripped here exactly as at purchase time: divide by
 *   (1 + taxRate/100) only when the purchase prices_include_tax, otherwise
 *   the stored cost is already net.
 * - perBaseUnit divides once more by unit_multiplier; perSoldUnit does not,
 *   because return_items.qty is in sold units while stock movements are in
 *   base units. Both are rounded to 6dp, the WAC precision.
 *
 * Fail-closed: a missing, negative or non-finite unit cost, a non-positive
 * multiplier, or a negative tax rate throws PURCHASE_RETURN_COST_INVALID
 * instead of silently falling back to the current WAC — a fallback would
 * reintroduce exactly the defect this helper removes.
 *
 * Deliberate limitation: landed costs are NOT included. A landed-cost
 * application capitalises only the unsold share of a line (the sold share
 * went to COGS at application time), and the per-unit capitalised share is
 * not stored per line, so it cannot be reconstructed exactly from
 * purchase_items alone. For a landed purchase, that landed portion still
 * flows to 5190 as before — strictly smaller than the old variance, which
 * also contained the full purchase-price WAC drift. Recovering it exactly
 * needs a capitalised-landed snapshot at application time, a separate item.
 */
export function originalPurchaseReturnUnitCost(args: {
  unitCost: unknown;
  unitMultiplier?: unknown;
  taxRate?: unknown;
  pricesIncludeTax?: unknown;
}): { perSoldUnit: number; perBaseUnit: number } {
  const { unitCost, unitMultiplier, taxRate, pricesIncludeTax } = args;
  if (unitCost == null) {
    throw new AppError(
      'سعر تكلفة سطر الشراء الأصلي غير محفوظ؛ لا يمكن تسعير المرتجع',
      'PURCHASE_RETURN_COST_INVALID',
      409,
    );
  }
  const cost = Number(unitCost);
  const multiplier = unitMultiplier == null ? 1 : Number(unitMultiplier);
  const tax = taxRate == null ? 0 : Number(taxRate);
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isFinite(tax) ||
    tax < 0
  ) {
    throw new AppError(
      'سعر تكلفة سطر الشراء الأصلي غير صالح؛ لا يمكن تسعير المرتجع',
      'PURCHASE_RETURN_COST_INVALID',
      409,
    );
  }
  const taxFactor = pricesIncludeTax ? 1 + tax / 100 : 1;
  const perSoldUnit = Number((cost / taxFactor).toFixed(6));
  const perBaseUnit = Number((cost / multiplier / taxFactor).toFixed(6));
  return { perSoldUnit, perBaseUnit };
}

export function calculateReturnDocumentTotal(lines: Array<{ lineTotal: number }>, digits: MoneyDigits): number {
  return roundMoney(
    lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0),
    digits,
  );
}

export function calculateNextLedgerBalance(
  currentBalance: number | string | null | undefined,
  amountDelta: number,
  digits: MoneyDigits,
): number {
  return roundMoney(Number(currentBalance || 0) + Number(amountDelta || 0), digits);
}
