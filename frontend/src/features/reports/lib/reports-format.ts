export function buildRange(days: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function buildTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function toDateInputValue(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateInputValueStart(value: string) {
  if (!value) return '';
  const parts = value.split('-').map(Number);
  if (parts.length < 3) return '';
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function fromDateInputValueEnd(value: string) {
  if (!value) return '';
  const parts = value.split('-').map(Number);
  if (parts.length < 3) return '';
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(2)}%`;
}

export function relativePercent(value: number, values: number[]) {
  const maxValue = Math.max(...values.map((entry) => Math.abs(Number(entry || 0))), 1);
  return Math.max(8, Math.round((Math.abs(Number(value || 0)) / maxValue) * 100));
}

export const integerFormatter = (value: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value || 0);

/* INV-INVENTORY-REPORT-OUT-CODE: the inventory report's status column
rendered the backend's raw status code ('out' / 'low' / 'ok') as-is, so an
out-of-stock item showed the literal word "out". One shared label map for
every surface that shows a row status (on-screen table, Excel export):
known codes get their understandable label, unknown codes pass through
unchanged so a new backend code never renders blank. */
export function inventoryStatusLabel(status: string | null | undefined, isEn = false): string {
  if (!status) return isEn ? 'Healthy' : 'سليم';
  if (status === 'out') return isEn ? 'Out of stock' : 'نافد';
  if (status === 'low') return isEn ? 'Low stock' : 'منخفض';
  if (status === 'ok') return isEn ? 'Healthy' : 'سليم';
  return status;
}
