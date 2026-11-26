import { type MoneyDigits, roundMoney } from '../../modules/accounting/engines/money-minor-units.engine';

/*
 * Moved here from backend/src/modules/purchases/helpers/purchases-write.helper.ts
 * by Phase 1 B6 (INV-PHASE1-B6-ACCOUNTING-PURCHASES-DECOUPLED) to break the
 * accounting|purchases circular pair: accounting's posting services imported
 * partitionPurchaseLineTotals from the purchases helper. The function is pure
 * purchase-line math with no purchases-module dependency of its own, so the
 * shared layer is its correct home. MOVE, never duplicate.
 */

function roundCurrency(value: number, digits: MoneyDigits = 2): number {
  // Canonical rounding at the tenant's book digits (INV-CANONICAL-ROUNDING-EVERYWHERE):
  // no EPSILON bump. Binary half-cents just below the half (1.005) round down,
  // as the canonical engine rounds them. The `= 2` default is preserved so
  // callers omitting digits behave exactly as they did in the old home.
  return roundMoney(Number(value || 0), digits);
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
