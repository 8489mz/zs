import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Dynamic BI Pivot Aggregation Pure Engine
 *
 * Implements deterministic multidimensional matrix aggregation,
 * cross-tabulation, row/col subtotals, and grand totals.
 *
 * Pure, side-effect free, and fully testable.
 */

export type PivotMetric = 'total_amount' | 'net_profit' | 'quantity' | 'count' | 'avg_amount';

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

  // Cell accumulators: [rowKey][colKey] -> { sum: number, count: number }
  const cellAccumulators: Record<string, Record<string, { sum: number; count: number }>> = {};
  const rowAccumulators: Record<string, { sum: number; count: number }> = {};
  const colAccumulators: Record<string, { sum: number; count: number }> = {};
  let grandSum = 0;
  let grandCount = 0;

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
    }

    // Initialize cell
    if (!cellAccumulators[row.key]) {
      cellAccumulators[row.key] = {};
    }
    if (!cellAccumulators[row.key][col.key]) {
      cellAccumulators[row.key][col.key] = { sum: 0, count: 0 };
    }

    // Initialize row & col
    if (!rowAccumulators[row.key]) {
      rowAccumulators[row.key] = { sum: 0, count: 0 };
    }
    if (!colAccumulators[col.key]) {
      colAccumulators[col.key] = { sum: 0, count: 0 };
    }

    // Accumulate
    cellAccumulators[row.key][col.key].sum += cellVal;
    cellAccumulators[row.key][col.key].count += 1;

    rowAccumulators[row.key].sum += cellVal;
    rowAccumulators[row.key].count += 1;

    colAccumulators[col.key].sum += cellVal;
    colAccumulators[col.key].count += 1;

    grandSum += cellVal;
    grandCount += 1;
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
  const matrix: Record<string, Record<string, PivotCell>> = {};
  const rowTotals: Record<string, PivotCell> = {};
  const colTotals: Record<string, PivotCell> = {};

  for (const r of rowKeys) {
    matrix[r.key] = {};
    for (const c of colKeys) {
      const acc = cellAccumulators[r.key]?.[c.key] || { sum: 0, count: 0 };
      const val = metric === 'avg_amount' ? (acc.count > 0 ? acc.sum / acc.count : 0) : acc.sum;
      matrix[r.key][c.key] = {
        value: shapeCell(val),
        formattedValue: formatPivotValue(shapeCell(val), metric),
        count: acc.count,
      };
    }

    const rAcc = rowAccumulators[r.key] || { sum: 0, count: 0 };
    const rVal = metric === 'avg_amount' ? (rAcc.count > 0 ? rAcc.sum / rAcc.count : 0) : rAcc.sum;
    rowTotals[r.key] = {
      value: shapeCell(rVal),
      formattedValue: formatPivotValue(shapeCell(rVal), metric),
      count: rAcc.count,
    };
  }

  for (const c of colKeys) {
    const cAcc = colAccumulators[c.key] || { sum: 0, count: 0 };
    const cVal = metric === 'avg_amount' ? (cAcc.count > 0 ? cAcc.sum / cAcc.count : 0) : cAcc.sum;
    colTotals[c.key] = {
      value: shapeCell(cVal),
      formattedValue: formatPivotValue(shapeCell(cVal), metric),
      count: cAcc.count,
    };
  }

  const grandVal = metric === 'avg_amount' ? (grandCount > 0 ? grandSum / grandCount : 0) : grandSum;
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
