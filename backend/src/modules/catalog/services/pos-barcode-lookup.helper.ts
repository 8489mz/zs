import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';

const ARABIC_DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const POS_PRODUCT_BASE_COLS = [
  'p.id',
  'p.name',
  'p.name_en',
  'p.barcode',
  'p.sku',
  'p.item_type',
  'p.item_kind',
  'p.style_code',
  'p.color',
  'p.size',
  'p.retail_price',
  'p.wholesale_price',
  'p.credit_price',
  'p.consumer_price',
  'p.min_selling_price',
  'p.stock_qty',
  'p.min_stock_qty',
  'b.id as bom_id',
  'p.category_id',
  'p.track_serials',
  'p.metadata',
] as const;

export function normalizePosBarcodeDigits(raw: string): string {
  return String(raw || '').replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_DIGIT_MAP[ch] ?? ch);
}

/**
 * Builds canonical lookup variants for POS barcodes:
 * - exactLower: trimmed lowercase string (preserves INV-POS-BARCODE-DASH exact matching)
 * - fallbackCandidates: Arabic digit normalization + leading-zero padded/stripped widths (1..13)
 *   plus exactLower (matched with TRIM in fallback tier to recover padded/whitespace legacy codes).
 */
export function buildPosBarcodeLookupVariants(rawBarcode: string): {
  exactLower: string;
  fallbackCandidates: string[];
} {
  const exactLower = String(rawBarcode || '')
    .trim()
    .toLowerCase();
  if (!exactLower) {
    return { exactLower: '', fallbackCandidates: [] };
  }

  const normalizedDigits = normalizePosBarcodeDigits(exactLower);
  const candidates = new Set<string>([exactLower]);
  if (normalizedDigits) {
    candidates.add(normalizedDigits);
  }

  if (/^\d+$/.test(normalizedDigits)) {
    const stripped = normalizedDigits.replace(/^0+/, '') || '0';
    candidates.add(stripped);
    const maxPadWidth = Math.max(13, normalizedDigits.length);
    for (let width = stripped.length; width <= maxPadWidth; width++) {
      candidates.add(stripped.padStart(width, '0'));
    }
  }

  return {
    exactLower,
    fallbackCandidates: Array.from(candidates),
  };
}

export async function findPosProductsByBarcodeWithDb<Row = Record<string, unknown>>(
  db: Kysely<Database>,
  tenantPredicate: (alias?: string) => any,
  barcode: string,
  limit: number,
): Promise<Row[]> {
  const { exactLower, fallbackCandidates } = buildPosBarcodeLookupVariants(barcode);
  if (!exactLower) return [];

  let productMatches = (await db
    .selectFrom('products as p')
    .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
    .select([...POS_PRODUCT_BASE_COLS])
    .where('p.is_active', '=', true)
    .where(sql<boolean>`LOWER(p.barcode) = ${exactLower}`)
    .where(tenantPredicate('p'))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .execute()) as Row[];

  // Prefer the physical barcode; a SKU is a fallback, not a competing code.
  if (!productMatches.length) {
    productMatches = (await db
      .selectFrom('products as p')
      .leftJoin('manufacturing_boms as b', (join) =>
        join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true),
      )
      .select([...POS_PRODUCT_BASE_COLS])
      .where('p.is_active', '=', true)
      .where(sql<boolean>`LOWER(p.sku) = ${exactLower}`)
      .where(tenantPredicate('p'))
      .orderBy('p.id', 'asc')
      .limit(limit)
      .execute()) as Row[];
  }

  const seenProductIds = productMatches.map((product: any) => Number(product.id));
  let remaining = limit - productMatches.length;

  let serialMatches: Row[] = [];
  if (remaining > 0) {
    const serialRows = (await db
      .selectFrom('product_serials as ps')
      .innerJoin('products as p', 'p.id', 'ps.product_id')
      .leftJoin('manufacturing_boms as b', (join) =>
        join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true),
      )
      .select([...POS_PRODUCT_BASE_COLS, 'ps.serial_number as matched_serial_number'])
      .where('p.is_active', '=', true)
      .where('ps.status', '=', 'in_stock')
      .where(tenantPredicate('ps'))
      .where((eb) =>
        eb.or([sql<boolean>`LOWER(ps.serial_number) = ${exactLower}`, sql<boolean>`LOWER(ps.imei_2) = ${exactLower}`]),
      )
      .limit(remaining)
      .execute()) as Row[];
    serialMatches = serialRows;
    for (const sm of serialMatches as any[]) seenProductIds.push(Number(sm.id));
    remaining = limit - productMatches.length - serialMatches.length;
  }

  let unitMatches: Row[] = [];
  if (remaining > 0) {
    let unitQuery = db
      .selectFrom('product_units as pu')
      .innerJoin('products as p', 'p.id', 'pu.product_id')
      .leftJoin('manufacturing_boms as b', (join) =>
        join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true),
      )
      .select([
        ...POS_PRODUCT_BASE_COLS,
        'pu.id as matched_unit_id',
        'pu.name as matched_unit_name',
        'pu.multiplier as matched_unit_multiplier',
        'pu.barcode as matched_unit_barcode',
      ])
      .where('p.is_active', '=', true)
      .where(sql<boolean>`LOWER(pu.barcode) = ${exactLower}`)
      .where(tenantPredicate('p'));

    if (seenProductIds.length) unitQuery = unitQuery.where('p.id', 'not in', seenProductIds);

    unitMatches = (await unitQuery.orderBy('p.id', 'asc').limit(remaining).execute()) as Row[];
  }

  const exactCombined = [...productMatches, ...serialMatches, ...unitMatches];
  if (exactCombined.length > 0 || !fallbackCandidates.length) {
    return exactCombined;
  }

  // Fallback for scale/PLU codes stored without leading zeros (e.g. '1' vs '00001'),
  // accidental surrounding spaces, Arabic digits, or PLU codes stored in style_code.
  const candidateSql = sql.join(fallbackCandidates);

  const fallbackBarcodeMatches = (await db
    .selectFrom('products as p')
    .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
    .select([...POS_PRODUCT_BASE_COLS])
    .where('p.is_active', '=', true)
    .where(sql<boolean>`LOWER(TRIM(p.barcode)) IN (${candidateSql})`)
    .where(tenantPredicate('p'))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .execute()) as Row[];
  if (fallbackBarcodeMatches.length) return fallbackBarcodeMatches;

  const fallbackSkuMatches = (await db
    .selectFrom('products as p')
    .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
    .select([...POS_PRODUCT_BASE_COLS])
    .where('p.is_active', '=', true)
    .where(sql<boolean>`LOWER(TRIM(p.sku)) IN (${candidateSql})`)
    .where(tenantPredicate('p'))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .execute()) as Row[];
  if (fallbackSkuMatches.length) return fallbackSkuMatches;

  const fallbackUnitMatches = (await db
    .selectFrom('product_units as pu')
    .innerJoin('products as p', 'p.id', 'pu.product_id')
    .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
    .select([
      ...POS_PRODUCT_BASE_COLS,
      'pu.id as matched_unit_id',
      'pu.name as matched_unit_name',
      'pu.multiplier as matched_unit_multiplier',
      'pu.barcode as matched_unit_barcode',
    ])
    .where('p.is_active', '=', true)
    .where(sql<boolean>`LOWER(TRIM(pu.barcode)) IN (${candidateSql})`)
    .where(tenantPredicate('p'))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .execute()) as Row[];
  if (fallbackUnitMatches.length) return fallbackUnitMatches;

  return (await db
    .selectFrom('products as p')
    .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
    .select([...POS_PRODUCT_BASE_COLS])
    .where('p.is_active', '=', true)
    .where(sql<boolean>`LOWER(TRIM(p.style_code)) IN (${candidateSql})`)
    .where(tenantPredicate('p'))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .execute()) as Row[];
}
