import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Dynamic BI Pivot Aggregation Pure Engine
 *
 * Implements deterministic multidimensional matrix aggregation,
 * cross-tabulation, row/col subtotals, and grand totals.
 *
 * Pure, side-effect free, and fully testable.
 */

export type PivotMetric = 'total_amount' | 'net_profit' | 'quantity' | 'count' | 'avg_amount' | 'net_profit_percent';

export interface PivotCell {
  value: number;
  formattedValue: string;
  count: number;
}

export interface PivotKeyItem {
  key: string;
  label: string;
}

export interface PivotResult {
  rowDimension: string;
  colDimension: string | null;
  metric: PivotMetric;
  rowKeys: PivotKeyItem[];
  colKeys: PivotKeyItem[];
  matrix: Record<string, Record<string, PivotCell>>;
  rowTotals: Record<string, PivotCell>;
  colTotals: Record<string, PivotCell>;
  grandTotal: PivotCell;
}

export interface PivotEngineInput {
  records: Array<Record<string, any>>;
  rowDimension: string;
  colDimension?: string | null;
  metric: PivotMetric;
  valueField?: string;
  profitField?: string;
  quantityField?: string;
  /** Book digits for money metrics (total_amount / net_profit / avg_amount). Defaults to 2. */
  digits?: MoneyDigits;
}

/**
 * Extracts a normalized string key and display label for a dimension from a record
 */
export function extractDimensionValue(record: Record<string, any>, dimension: string): { key: string; label: string } {
  const raw = record[dimension];

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { key: '__unassigned__', label: 'غير محدد' };
  }

  // If dimension is a date/month field
  if (dimension.toLowerCase().includes('month') || dimension === 'date_month') {
    if (raw instanceof Date) {
      const ym = raw.toISOString().slice(0, 7);
      return { key: ym, label: ym };
    }
    const str = String(raw).slice(0, 7);
    return { key: str, label: str };
  }

  // If dimension has an ID + Name pair in the record
  const nameField = `${dimension}_name`;
  if (record[nameField]) {
    return { key: String(raw), label: String(record[nameField]) };
  }

  const str = String(raw);
  return { key: str, label: str };
}

/**
 * Formats numbers into clean localized string
 */
export function formatPivotValue(value: number, metric: PivotMetric): string {
  const isCurrency = metric === 'total_amount' || metric === 'net_profit' || metric === 'avg_amount';
  // INV-VAN-PROFIT-REP-REPORTING: net_profit_percent is a ratio, not
  // money — 2dp, no currency shaping. The picker label carries the %.
  return value.toLocaleString('ar-EG', {
    minimumFractionDigits: isCurrency ? 2 : 0,
    maximumFractionDigits: isCurrency ? 2 : 2,
  });
}

/**
 * Executes dynamic pivot matrix cross-tabulation
 */
export function buildDynamicPivotMatrix(input: PivotEngineInput): PivotResult {
  const { records, rowDimension, colDimension, metric } = input;
  const valueField = input.valueField || 'total_amount';
  const profitField = input.profitField || 'net_profit';
  const quantityField = input.quantityField || 'quantity';
  const digits = input.digits ?? 2;
  const isMoneyMetric = metric === 'total_amount' || metric === 'net_profit' || metric === 'avg_amount';
  // Money totals round at book digits; quantity/count keep the legacy 2dp shaping.
  const shapeCell = (value: number): number => (isMoneyMetric ? roundMoney(value, digits) : Number(value.toFixed(2)));

  // 1. Discover unique row & col keys preserving sort order
  const rowKeyMap = new Map<string, string>();
  const colKeyMap = new Map<string, string>();

  // Cell accumulators: [rowKey][colKey] -> { sum, count, profitSum, amountSum }
  // INV-VAN-PROFIT-REP-REPORTING: net_profit_percent is a RATIO OF SUMS
  // (SUM(net_profit) / SUM(total_amount) per group), never an average of
  // row percents — a grouped report would lie otherwise. Every record
  // therefore accumulates BOTH sums, and the percent is derived from
  // the group's own sums at cell, row, column and grand level.
  const cellAccumulators: Record<
    string,
    Record<string, { sum: number; count: number; profitSum: number; amountSum: number }>
  > = {};
  const rowAccumulators: Record<string, { sum: number; count: number; profitSum: number; amountSum: number }> = {};
  const colAccumulators: Record<string, { sum: number; count: number; profitSum: number; amountSum: number }> = {};
  let grandSum = 0;
  let grandCount = 0;
  let grandProfitSum = 0;
  let grandAmountSum = 0;

  const defaultColKey = 'total';
  const defaultColLabel = 'الإجمالي';

  for (const rec of records) {
    const row = extractDimensionValue(rec, rowDimension);
    rowKeyMap.set(row.key, row.label);

    let col = { key: defaultColKey, label: defaultColLabel };
    if (colDimension && colDimension !== 'none') {
      col = extractDimensionValue(rec, colDimension);
      colKeyMap.set(col.key, col.label);
    } else {
      colKeyMap.set(defaultColKey, defaultColLabel);
    }

    // Determine target value for metric
    let cellVal = 0;
    if (metric === 'total_amount') {
      cellVal = Number(rec[valueField] || 0);
    } else if (metric === 'net_profit') {
      cellVal = Number(rec[profitField] || 0);
    } else if (metric === 'quantity') {
      cellVal = Number(rec[quantityField] || 0);
    } else if (metric === 'count') {
      cellVal = 1;
    } else if (metric === 'avg_amount') {
      cellVal = Number(rec[valueField] || 0);
    } else if (metric === 'net_profit_percent') {
      // The cell value is derived from the group's sums below, not
      // from a per-row percent — a per-row value here would average.
      cellVal = 0;
    }

    // Initialize cell
    if (!cellAccumulators[row.key]) {
      cellAccumulators[row.key] = {};
    }
    if (!cellAccumulators[row.key][col.key]) {
      cellAccumulators[row.key][col.key] = { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
    }

    // Initialize row & col
    if (!rowAccumulators[row.key]) {
      rowAccumulators[row.key] = { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
    }
    if (!colAccumulators[col.key]) {
      colAccumulators[col.key] = { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
    }

    // Accumulate
    cellAccumulators[row.key][col.key].sum += cellVal;
    cellAccumulators[row.key][col.key].count += 1;
    cellAccumulators[row.key][col.key].profitSum += Number(rec[profitField] || 0);
    cellAccumulators[row.key][col.key].amountSum += Number(rec[valueField] || 0);

    rowAccumulators[row.key].sum += cellVal;
    rowAccumulators[row.key].count += 1;
    rowAccumulators[row.key].profitSum += Number(rec[profitField] || 0);
    rowAccumulators[row.key].amountSum += Number(rec[valueField] || 0);

    colAccumulators[col.key].sum += cellVal;
    colAccumulators[col.key].count += 1;
    colAccumulators[col.key].profitSum += Number(rec[profitField] || 0);
    colAccumulators[col.key].amountSum += Number(rec[valueField] || 0);

    grandSum += cellVal;
    grandCount += 1;
    grandProfitSum += Number(rec[profitField] || 0);
    grandAmountSum += Number(rec[valueField] || 0);
  }

  // 2. Prepare structured lists of keys
  const rowKeys: PivotKeyItem[] = Array.from(rowKeyMap.entries()).map(([k, label]) => ({
    key: k,
    label,
  }));

  const colKeys: PivotKeyItem[] = Array.from(colKeyMap.entries()).map(([k, label]) => ({
    key: k,
    label,
  }));

  // 3. Transform accumulators into finished PivotCell matrices
  // INV-VAN-PROFIT-REP-REPORTING: the percent of a group is its own
  // profit sum over its own amount sum (ratio of sums); a zero
  // denominator yields 0, never NaN or Infinity.
  const percentOf = (profitSum: number, amountSum: number): number =>
    amountSum > 0 ? (profitSum / amountSum) * 100 : 0;
  const cellValue = (acc: { sum: number; count: number; profitSum: number; amountSum: number }): number => {
    if (metric === 'avg_amount') return acc.count > 0 ? acc.sum / acc.count : 0;
    if (metric === 'net_profit_percent') return percentOf(acc.profitSum, acc.amountSum);
    return acc.sum;
  };
  const matrix: Record<string, Record<string, PivotCell>> = {};
  const rowTotals: Record<string, PivotCell> = {};
  const colTotals: Record<string, PivotCell> = {};

  for (const r of rowKeys) {
    matrix[r.key] = {};
    for (const c of colKeys) {
      const acc = cellAccumulators[r.key]?.[c.key] || { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
      const val = cellValue(acc);
      matrix[r.key][c.key] = {
        value: shapeCell(val),
        formattedValue: formatPivotValue(shapeCell(val), metric),
        count: acc.count,
      };
    }

    const rAcc = rowAccumulators[r.key] || { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
    const rVal = cellValue(rAcc);
    rowTotals[r.key] = {
      value: shapeCell(rVal),
      formattedValue: formatPivotValue(shapeCell(rVal), metric),
      count: rAcc.count,
    };
  }

  for (const c of colKeys) {
    const cAcc = colAccumulators[c.key] || { sum: 0, count: 0, profitSum: 0, amountSum: 0 };
    const cVal = cellValue(cAcc);
    colTotals[c.key] = {
      value: shapeCell(cVal),
      formattedValue: formatPivotValue(shapeCell(cVal), metric),
      count: cAcc.count,
    };
  }

  const grandVal =
    metric === 'avg_amount'
      ? grandCount > 0
        ? grandSum / grandCount
        : 0
      : metric === 'net_profit_percent'
        ? percentOf(grandProfitSum, grandAmountSum)
        : grandSum;
  const grandTotal: PivotCell = {
    value: shapeCell(grandVal),
    formattedValue: formatPivotValue(shapeCell(grandVal), metric),
    count: grandCount,
  };

  // Sort rows descending by row total value
  rowKeys.sort((a, b) => (rowTotals[b.key]?.value || 0) - (rowTotals[a.key]?.value || 0));

  return {
    rowDimension,
    colDimension: colDimension || null,
    metric,
    rowKeys,
    colKeys,
    matrix,
    rowTotals,
    colTotals,
    grandTotal,
  };
}
