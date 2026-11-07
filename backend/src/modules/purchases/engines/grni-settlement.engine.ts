import { AppError } from '../../../common/errors/app-error';
import type { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type GrnAccrualLine = {
  id: number;
  acceptedQty: number;
  unitCost: number;
  /*
   * INV-SHIPPING-ALLOCATION: the exact landed line total (bare line
   * total at book digits + the line's allocated freight) when the
   * receipt carried freight. The GRN journal posts the landed total,
   * so the accrual must reconcile to it — not to the bare
   * acceptedQty x unitCost — or the freight would strand in 2125
   * after the bill settles. When absent, the bare product is used.
   */
  landedLineTotal?: number;
};

/**
 * Minor-unit conversion for DERIVED amounts (qty x unit cost). Such products
 * legitimately carry sub-minor precision and must be ROUNDED to the tenant's
 * minor units — exactly what the old hard-coded cents() did, but at the
 * tenant's precision instead of 2 digits. The rounding step is the
 * canonical engine's (roundMoney in money-minor-units.engine.ts):
 * plain Math.round at the tenant's digits, with no EPSILON bump, so a
 * binary half-cent just below the half rounds down
 * (INV-CANONICAL-ROUNDING-EVERYWHERE). This is deliberately NOT the
 * strict toMinorUnits() from the money engine, which throws on sub-minor
 * inputs: a 3-decimal-qty receipt at a 6-decimal unit cost is a valid input
 * that must round, not corrupt data. The conversion stays local because
 * its result is minor units; only the rounding formula is shared.
 */
function toMinorUnitsRounded(value: number, digits: MoneyDigits): number {
  const result = Math.round(value * 10 ** digits);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new AppError('قيمة تسوية الاستلام غير صالحة', 'GRNI_AMOUNT_INVALID', 422);
  }
  return result;
}

/** Reconcile line allocations to the exact total posted by the GRN journal, in minor units. */
export function allocateGrnAccrual(lines: GrnAccrualLine[], minorUnits: MoneyDigits): Map<number, number> {
  const sorted = [...lines].sort((a, b) => a.id - b.id);
  if (sorted.some((line) => !Number.isFinite(line.acceptedQty) || line.acceptedQty < 0 ||
    !Number.isFinite(line.unitCost) || line.unitCost < 0 ||
    (line.landedLineTotal != null && (!Number.isFinite(line.landedLineTotal) || line.landedLineTotal < 0)))) {
    throw new AppError('بنود الاستلام غير صالحة للتسوية', 'GRNI_LINE_INVALID', 422);
  }
  // INV-SHIPPING-ALLOCATION: a line that carried freight reconciles to
  // its landed total (already at book digits), never to the bare
  // product — the journal total includes the freight. When NO line
  // carries freight, the total keeps the original single-rounding of
  // the float sum (pinned by canonical-rounding.spec.ts: the sum lands
  // just above the half and the last line absorbs the residue); summing
  // per-line minors instead would move that total by a minor.
  const lineMinor = (line: GrnAccrualLine): number => line.landedLineTotal != null
    ? toMinorUnitsRounded(line.landedLineTotal, minorUnits)
    : toMinorUnitsRounded(line.acceptedQty * line.unitCost, minorUnits);
  const hasLanded = sorted.some((line) => line.landedLineTotal != null);
  let remaining = hasLanded
    ? sorted.reduce((sum, line) => sum + lineMinor(line), 0)
    : toMinorUnitsRounded(sorted.reduce((sum, line) => sum + line.acceptedQty * line.unitCost, 0), minorUnits);
  const result = new Map<number, number>();
  const lastBillableId = [...sorted].reverse().find((line) => line.acceptedQty > 0)?.id;
  sorted.forEach((line) => {
    const amount = line.acceptedQty <= 0 ? 0 : line.id === lastBillableId
      ? remaining : Math.min(remaining, lineMinor(line));
    result.set(line.id, amount);
    remaining -= amount;
  });
  return result;
}

/** The last invoice for a receipt line absorbs all rounding residue. Amounts are minor units. */
export function allocateGrniBillPortion(input: {
  lineAccrualMinor: number;
  acceptedQty: number;
  previouslyBilledQty: number;
  previouslyClearedMinor: number;
  newQty: number;
}): number {
  const { lineAccrualMinor, acceptedQty, previouslyBilledQty, previouslyClearedMinor, newQty } = input;
  if (!Number.isSafeInteger(lineAccrualMinor) || lineAccrualMinor < 0 ||
    !Number.isSafeInteger(previouslyClearedMinor) || previouslyClearedMinor < 0 ||
    !Number.isFinite(acceptedQty) || acceptedQty <= 0 ||
    !Number.isFinite(newQty) || newQty <= 0 ||
    previouslyBilledQty < 0 || previouslyBilledQty + newQty > acceptedQty + 0.000001 ||
    previouslyClearedMinor > lineAccrualMinor) {
    throw new AppError('الكمية المفوترة تتجاوز الكمية المستلمة', 'GRNI_OVERBILL', 422);
  }
  const cumulativeQty = previouslyBilledQty + newQty;
  const cumulativeMinor = Math.abs(cumulativeQty - acceptedQty) < 0.000001
    ? lineAccrualMinor : Math.round(lineAccrualMinor * cumulativeQty / acceptedQty);
  const portion = cumulativeMinor - previouslyClearedMinor;
  if (portion < 0) throw new AppError('تسوية GRNI السابقة غير متطابقة', 'GRNI_RECONCILIATION_REQUIRED', 422);
  return portion;
}
