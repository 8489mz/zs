import { sql } from '../../../database/kysely';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';

function applySearch(query: any, searchPattern: string | undefined, fields: string[]) {
  if (!searchPattern) return query;
  return query.where((eb: any) =>
    eb.or(
      fields.map((field) => eb(sql.raw(`lower(coalesce(${field}, ''))`), 'like', searchPattern)),
    ),
  );
}

/**
 * SQL-side mirror of normalizeArabicSearch (backend/src/common/utils/
 * arabic-search.util.ts) and the frontend SearchToolbar normalization:
 * the toolbar sends the term already normalized (ة→ه, أ/إ/آ→ا, ى→ي,
 * ؤ→و, ئ→ي, ء removed), but the stored text is raw — so the COLUMN
 * must be normalized in SQL or 'رحله' never matches 'بدء رحلة توزيع'.
 * Diacritics / eastern digits are not normalized here (the term side
 * handles them); the letter mappings below cover the live failure.
 */
function normalizeArabicSql(field: string): string {
  const steps: Array<[string, string]> = [
    ['ة', 'ه'],
    ['أ', 'ا'],
    ['إ', 'ا'],
    ['آ', 'ا'],
    ['ى', 'ي'],
    ['ؤ', 'و'],
    ['ئ', 'ي'],
    ['ء', ''],
  ];
  let expr = `lower(coalesce(${field}, ''))`;
  for (const [from, to] of steps) {
    expr = `replace(${expr}, '${from}', '${to}')`;
  }
  return expr;
}

function applyArabicNormalizedSearch(query: any, searchPattern: string | undefined, fields: string[]) {
  if (!searchPattern) return query;
  // Normalize the pattern too, so the helper does not depend on the
  // caller normalizing: '%رحلة%' (direct API call) and '%رحله%'
  // (toolbar) must both match. normalizeArabicSearch strips the '%'
  // wildcards as noise, so re-wrap after normalizing.
  const normalizedPattern = `%${normalizeArabicSearch(searchPattern)}%`;
  return query.where((eb: any) =>
    eb.or(
      fields.map((field) => eb(sql.raw(normalizeArabicSql(field)), 'like', normalizedPattern)),
    ),
  );
}

export function applyPartnerLedgerSearch(query: any, searchPattern: string | undefined) {
  return applySearch(query, searchPattern, ['note', 'entry_type', 'reference_type']);
}

export function applySignedAmountFilter(query: any, amountColumn: string, filter: string) {
  if (filter === 'debit' || filter === 'in') {
    return query.where(sql.raw(amountColumn), '>', 0);
  }
  if (filter === 'credit' || filter === 'out') {
    return query.where(sql.raw(amountColumn), '<', 0);
  }
  return query;
}

export function applyTreasurySearch(query: any, searchPattern: string | undefined) {
  return applySearch(query, searchPattern, ['t.txn_type', 't.note', 't.reference_type', 'u.username', 'b.name', 'l.name']);
}

export function applyAuditSearch(query: any, searchPattern: string | undefined) {
  return applyArabicNormalizedSearch(query, searchPattern, ['a.action', 'a.details', 'u.username']);
}
