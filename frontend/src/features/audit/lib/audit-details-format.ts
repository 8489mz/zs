import type { AuditLog } from '@/types/domain';
import { normalizeAuditDetailText } from '@/features/audit/lib/audit-activity-presenter';

type AuditDetailsObject = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  actorUserId: 'رقم المستخدم',
  productId: 'الصنف',
  qty: 'الكمية',
  quantity: 'الكمية',
  reason: 'السبب',
  note: 'ملاحظات',
  locationId: 'المخزن',
  locationName: 'المخزن',
  branchId: 'الفرع',
  branchName: 'الفرع',
  sessionId: 'رقم الجلسة',
  status: 'الحالة',
  fromQty: 'من',
  toQty: 'إلى',
  oldQty: 'من',
  newQty: 'إلى',
  itemId: 'رقم البند',
  firstItemId: 'رقم أول بند',
  itemCount: 'عدد البنود',
  journalEntryId: 'رقم القيد',
  remaining: 'بنود متبقية',
  skippedItemIds: 'البنود المؤجلة',
  countedSerials: 'السيريالات',
  batchCounts: 'التشغيلات',
  batchId: 'التشغيلة',
  batchNumber: 'رقم التشغيلة',
  countedQty: 'الكمية المعدودة',
  expiryDate: 'تاريخ الانتهاء',
};

// Stored enum values are English ('draft', 'posted', ...); the general
// tab shows their Arabic meaning, never the raw code.
const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  posted: 'مرحّلة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
  canceled: 'ملغاة',
  pending: 'قيد الانتظار',
  completed: 'مكتملة',
  rejected: 'مرفوضة',
};

function stringifyDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function readDetail(details: AuditDetailsObject, key: string): string {
  return stringifyDetailValue(details[key]);
}

function parseAuditDetails(rawDetails?: string): AuditDetailsObject | null {
  const raw = String(rawDetails || '').trim();
  if (!raw) return null;

  // Prefixed JSON: "after: {...}" — a snapshot stored under a key prefix
  // instead of a bare object. The prefix is the key; the object is the
  // value. Without this the whole text falls through verbatim as raw JSON.
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const prefixed = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\{[\s\S]*\}|\[[\s\S]*\])$/);
    if (prefixed) {
      const inner = parseAuditDetails(prefixed[2]);
      if (inner) return { [prefixed[1]]: inner };
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AuditDetailsObject : null;
  } catch {
    try {
      const normalized = raw.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
      const parsed = JSON.parse(normalized);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AuditDetailsObject : null;
    } catch {
      return null;
    }
  }
}

function formatDamagedStockDetails(details: AuditDetailsObject): string {
  const productId = readDetail(details, 'productId');
  const qty = readDetail(details, 'qty') || readDetail(details, 'quantity');
  const reason = readDetail(details, 'reason');
  const locationId = readDetail(details, 'locationId');

  const parts = [
    productId ? `الصنف #${productId}` : 'صنف غير محدد',
    qty ? `الكمية التالفة ${qty}` : '',
    reason ? `السبب: ${reason}` : '',
    locationId ? `المخزن #${locationId}` : '',
  ].filter(Boolean);

  return `تم تسجيل تالف: ${parts.join(' — ')}`;
}

function formatGenericObjectDetails(details: AuditDetailsObject, depth = 0): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    // A resolved name beside its id replaces the raw id: 'الفرع: المخزن
    // الرئيسي', never the id next to the name. Legacy rows with ids only
    // keep the labelled '#31' fallback below.
    if ((key === 'branchId' && details.branchName) || (key === 'locationId' && details.locationName)) continue;
    // 'after' / 'before' wrap a snapshot; they are not fields to display.
    // Their children render inline with their own labels.
    if ((key === 'after' || key === 'before') && value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = formatGenericObjectDetails(value as AuditDetailsObject, depth + 1);
      if (nested) parts.push(nested);
      continue;
    }
    if (Array.isArray(value)) {
      // Object items recurse with their own labels instead of being
      // JSON.stringify'd raw into the output: the count-session trace
      // event stores batchCounts as an array of {batchId, batchNumber,
      // expiryDate, countedQty} objects, which used to render as
      // `batchCounts: {"batchId":3,...}`. Same depth cap as nested
      // objects below, so a pathological payload can never render JSON.
      const joined = value
        .map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            if (depth >= 2) return '';
            return formatGenericObjectDetails(item as AuditDetailsObject, depth + 1);
          }
          return stringifyDetailValue(item);
        })
        .filter(Boolean)
        .join('، ');
      if (!joined) continue;
      const label = FIELD_LABELS[key] || key;
      parts.push(`${label}: ${joined}`);
      continue;
    }
    if (value && typeof value === 'object') {
      // Nested objects recurse with their own labels instead of being
      // JSON.stringify'd raw into the output. Depth is capped so a
      // pathological payload can never render raw JSON.
      if (depth >= 2) continue;
      const nested = formatGenericObjectDetails(value as AuditDetailsObject, depth + 1);
      if (!nested) continue;
      const label = FIELD_LABELS[key] || key;
      parts.push(`${label}: ${nested}`);
      continue;
    }
    const formattedValue = stringifyDetailValue(value);
    if (!formattedValue) continue;
    const label = FIELD_LABELS[key] || key;
    let displayValue = formattedValue;
    // `remaining` is a boolean: render its meaning, never true/false.
    if (key === 'remaining' && typeof value === 'boolean') displayValue = value ? 'يوجد' : 'لا يوجد';
    else if (key === 'productId' || key === 'branchId' || key === 'locationId' || key === 'firstItemId' || key === 'journalEntryId') displayValue = `#${formattedValue}`;
    else if (key === 'status') displayValue = STATUS_LABELS[formattedValue.toLowerCase()] || formattedValue;
    parts.push(`${label}: ${displayValue}`);
  }
  return parts.join(' — ');
}

function looksLikeRawDetails(value?: string): boolean {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

export function formatAuditDetails(row: AuditLog): string {
  const rawDetails = row.details || row.detailsSummary || '';
  const parsedDetails = parseAuditDetails(rawDetails);

  if (parsedDetails) {
    if (String(row.action || '').includes('تالف') || String(row.action || '').toLowerCase().includes('damage')) {
      return formatDamagedStockDetails(parsedDetails);
    }

    const genericDetails = formatGenericObjectDetails(parsedDetails);
    return genericDetails || '—';
  }

  if (row.detailsSummary && !looksLikeRawDetails(row.detailsSummary)) return row.detailsSummary;
  if (row.details && !looksLikeRawDetails(row.details)) return row.details;
  return '—';
}

// The employee activity log (Reports → employee reports → user details)
// receives the same audit rows through a different shape: the audit
// action arrives as `title` and the raw details as `details`. It renders
// through this adapter so both renderers call the SAME formatter —
// formatAuditDetails above — and a count-session event reads identically
// on /audit and in the activity log. Non-audit activities never reach
// this adapter; their notes stay verbatim in the caller.
//
// The adapter also runs the SAME sentence normaliser /audit runs
// (normalizeAuditDetailText): a plain-English HR sentence such as
// 'Employee loan created by muse' is not JSON, so formatAuditDetails
// passes it through verbatim — without this step the activity logs
// would keep showing the English sentence while /audit translates it.
// One canonical pipeline, every path.
export function formatEmployeeActivityDetails(activity: { title: string; details: string }): string {
  return normalizeAuditDetailText(
    formatAuditDetails({ id: '', action: activity.title, details: activity.details, createdAt: '' }),
  );
}
