/*
 * Shared import display formatters (I2-P9).
 *
 * The import screens rendered raw engine values: a project status of
 * "feasibility" in English, a per-unit market profit of "+-50.76"
 * (a "+" prefix glued onto an already-negative number), a market-ROI
 * badge with no number ("% ROI"), a hardcoded "$3500" freight in the
 * allocation hint, and a CBM field that silently turned a typed 0.01
 * into 1. Every formatter here is a pure function so the Vitest spec
 * next to it pins the rule; ImportProjectsManager, ImportCommandCenter
 * and ShipmentDetailsPage all render through these helpers instead of
 * keeping a second copy of the same map or prefix.
 */

/**
 * Arabic label for an import-project status code. Known codes are
 * translated; an unknown code falls back to the raw value (never a
 * blank badge) so a future status still renders instead of vanishing.
 */
export function getImportProjectStatusLabel(status: string | null | undefined): string {
  switch ((status || '').trim().toLowerCase()) {
    case 'feasibility':
      return 'قيد الدراسة';
    // INV-IMPORT-PROJECT-STATUS-APPROVED: a converted / approved
    // project reads 'sourcing' — without this case the badge fell
    // through to the raw English code ("sourcing").
    case 'sourcing':
      return 'قيد التوريد';
    case 'warehousing':
      return 'بالمخزن';
    case 'selling':
      return 'قيد البيع';
    case 'closed':
      return 'مغلق';
    default:
      return status && status.trim() ? status : '—';
  }
}

/**
 * Signed per-unit market profit, with exactly one sign: "+50.76 ج.م"
 * for a gain, "-50.76 ج.م" for a loss (the minus already rides on the
 * number — never a "+" prefix on a negative value, which rendered
 * "+-50.76"), and "—" when the engine reported no market price.
 */
export function formatMarketProfitEgp(value: number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toLocaleString()} ج.م`;
}

/**
 * Market-ROI badge text, or null when the engine reported no ROI.
 * The engine leaves overallRoiVsMarketPercent undefined whenever the
 * market profit is zero or negative (and the card still renders, gated
 * on totalProfitVsMarketEgp), so rendering the badge unconditionally
 * produced "عائد الاستثمار من السوق: % ROI" with no number. Callers
 * hide the badge when this returns null — never an empty "% ROI".
 */
export function formatMarketRoiBadge(overallRoiVsMarketPercent: number | undefined | null): string | null {
  if (overallRoiVsMarketPercent === undefined || overallRoiVsMarketPercent === null) return null;
  const n = Number(overallRoiVsMarketPercent);
  if (!Number.isFinite(n)) return null;
  return `عائد الاستثمار من السوق: ${n}% ROI`;
}

/**
 * Allocation hint with the shipment's real freight instead of the
 * hardcoded "$3500" the feasibility defaults used to carry. A missing
 * or non-positive freight renders as $0 (honest: nothing to allocate),
 * never a stale default from another shipment's scale.
 */
export function formatFreightAllocationHint(freightUsd: number | undefined | null): string {
  const n = Number(freightUsd);
  const freight = Number.isFinite(n) && n > 0 ? n : 0;
  return `تحدد كيف يقسم النظام الـ $${freight} والجمارك بين قطع الغيار المختلفة في الحاوية.`;
}

/**
 * Parses one keystroke of a numeric feasibility-grid input.
 *
 * The grid used to store Number(e.target.value) straight into state
 * while rendering value={it.unitCbm || ''}: typing "0.01" collapsed
 * at every intermediate step ("0" -> 0 -> "", "0." -> NaN -> "",
 * "0.0" -> 0 -> "") and the final "1" landed as a whole number — so
 * a 0.01 CBM entry was silently kept as 1. This keeps the raw text
 * while the user is still typing an incomplete decimal ("0.", "0.0",
 * "5.") and returns a real number only once the text is complete
 * ("0.01" -> 0.01, "5" -> 5); an empty field clears to undefined.
 * Callers normalize with normalizeFeasibilityNumber before sending
 * the row to the engine.
 */
export function parseFeasibilityNumberInput(raw: string): number | string | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && String(n) === raw) return n;
  // Incomplete decimal text the user is still typing: keep it verbatim
  // so the controlled input never collapses it to "" or a whole number.
  if (/^[-+]?(\d+\.?\d*|\.\d*)([eE][-+]?\d*)?$/.test(raw)) return raw;
  return undefined;
}

/**
 * Normalizes a grid numeric field (number, in-progress decimal text,
 * or cleared) to a finite number for the engine call. Anything
 * unparseable counts as 0; the engine's own resolveNumber then applies
 * its per-field defaults.
 */
export function normalizeFeasibilityNumber(value: number | string | undefined | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
