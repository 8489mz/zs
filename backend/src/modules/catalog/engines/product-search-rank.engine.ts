import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';

export interface CompiledProductSearchQuery {
  rawLower: string;
  norm: string;
  tokens: string[];
}

export interface ProductSearchCandidate {
  name?: string | null;
  nameEn?: string | null;
  barcode?: string | null;
  sku?: string | null;
  styleCode?: string | null;
  color?: string | null;
  size?: string | null;
  unitSearchValues?: string[];
  secondaryValues?: string[];
}

export interface ProductSearchOptions {
  identityOnly?: boolean;
}

export const STRONG_PRODUCT_MATCH_SCORE = 450;

export function compileProductSearchQuery(rawQuery: unknown): CompiledProductSearchQuery {
  const rawLower = String(rawQuery ?? '')
    .trim()
    .toLowerCase();
  const norm = normalizeArabicSearch(rawQuery);
  const tokens = norm ? norm.split(/\s+/).filter(Boolean) : [];
  return { rawLower, norm, tokens };
}

export function scoreProductSearchMatch(
  compiled: CompiledProductSearchQuery,
  candidate: ProductSearchCandidate,
  options?: ProductSearchOptions,
): number {
  const { rawLower, norm: q, tokens } = compiled;
  if (!q) return 1;

  const normName = normalizeArabicSearch(candidate.name);
  const normNameEn = normalizeArabicSearch(candidate.nameEn);

  const rawCodes = [candidate.barcode, candidate.sku, candidate.styleCode]
    .map((v) =>
      String(v ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  const unitRawCodes = (candidate.unitSearchValues || [])
    .map((v) =>
      String(v ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  if (
    (rawLower && (rawCodes.includes(rawLower) || unitRawCodes.includes(rawLower))) ||
    normName === q ||
    normNameEn === q
  ) {
    return 1000;
  }

  if ((normName && normName.startsWith(`${q} `)) || (normNameEn && normNameEn.startsWith(`${q} `))) {
    return 900;
  }

  if ((normName && ` ${normName} `.includes(` ${q} `)) || (normNameEn && ` ${normNameEn} `.includes(` ${q} `))) {
    return 800;
  }

  if ((normName && normName.startsWith(q)) || (normNameEn && normNameEn.startsWith(q))) {
    return 720;
  }

  if ((normName && ` ${normName}`.includes(` ${q}`)) || (normNameEn && ` ${normNameEn}`.includes(` ${q}`))) {
    return 650;
  }

  const combinedNames = [normName, normNameEn].filter(Boolean).join(' ');
  if (tokens.length > 1 && combinedNames && tokens.every((token) => ` ${combinedNames}`.includes(` ${token}`))) {
    return 550;
  }

  if (rawLower) {
    if (rawCodes.some((c) => c.startsWith(rawLower)) || unitRawCodes.some((c) => c.startsWith(rawLower))) {
      return 500;
    }
    if (rawCodes.some((c) => c.includes(rawLower)) || unitRawCodes.some((c) => c.includes(rawLower))) {
      return 450;
    }
  }

  if (combinedNames && tokens.every((token) => combinedNames.includes(token))) {
    return 350;
  }

  const normIdentity = normalizeArabicSearch(
    [
      candidate.name,
      candidate.nameEn,
      candidate.barcode,
      candidate.sku,
      candidate.styleCode,
      candidate.color,
      candidate.size,
      ...(candidate.unitSearchValues || []),
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (normIdentity && tokens.every((token) => normIdentity.includes(token))) {
    return 250;
  }

  if (options?.identityOnly) {
    return 0;
  }

  const normSecondary = normalizeArabicSearch((candidate.secondaryValues || []).filter(Boolean).join(' '));
  const normFull = [normIdentity, normSecondary].filter(Boolean).join(' ');
  if (normFull && tokens.every((token) => normFull.includes(token))) {
    return 100;
  }

  return 0;
}

export function compareRankedProductMatches(
  a: { id: number | string; score: number; stock?: number },
  b: { id: number | string; score: number; stock?: number },
  options?: { preferInStock?: boolean },
): number {
  if (options?.preferInStock) {
    const aStrong = a.score >= STRONG_PRODUCT_MATCH_SCORE ? 1 : 0;
    const bStrong = b.score >= STRONG_PRODUCT_MATCH_SCORE ? 1 : 0;
    if (aStrong !== bStrong) return bStrong - aStrong;

    const aHasStock = Number(a.stock || 0) > 0 ? 1 : 0;
    const bHasStock = Number(b.stock || 0) > 0 ? 1 : 0;
    if (aHasStock !== bHasStock) return bHasStock - aHasStock;
  }

  if (a.score !== b.score) return b.score - a.score;
  return Number(b.id) - Number(a.id);
}
