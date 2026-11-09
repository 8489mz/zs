/*
 * R4-E (INV-REST-KDS-TRUTH-2): pure KDS station + transition decisions.
 *
 * I15 — station resolution precedence (single source of truth, imported by
 * KdsService and by the spec; never duplicated in tests):
 *   product station (if a valid item station) -> category station (if valid)
 *   -> keyword inference on the product + category names.
 * Keyword matching is WORD-BOUNDARY (token equality after stripping the
 * Arabic definite article): the old substring guess matched 'بار' inside
 * 'باربكيو' and sent barbecue to the bar. Inflected forms are listed
 * explicitly (مشويات / مشروبات / مخبوزات / فطائر) because token equality
 * does not do stemming. 'expo' is a filter view, not an item station, so a
 * product configured 'expo' falls through to inference.
 *
 * I12 — printer station_code -> KDS station map. Printer vocabulary and
 * KDS vocabulary disagree (printer codes include bar/fryer/cold/dessert,
 * which are not KDS stations), so the map is explicit and total for the
 * known codes: bar -> beverages, fryer/cold -> kitchen, dessert -> bakery.
 *
 * I18 — transition tables. Tickets move single-step forward only:
 * pending -> cooking -> ready -> served. Items move forward only, with one
 * carve-out: pending -> ready (tap-to-complete — KdsTicketCard marks an
 * item done with a single tap and has no "start cooking" step for items).
 * Backward moves are not in either table; the sanctioned backward step is
 * recallLastServedTicket, not these tables.
 */

export type KdsStation = 'all' | 'kitchen' | 'grill' | 'beverages' | 'bakery' | 'general' | 'expo';
export type KdsTicketStatus = 'pending' | 'cooking' | 'ready' | 'served';
export type KdsItemStatus = 'pending' | 'cooking' | 'ready';

export type KdsItemStation = 'kitchen' | 'grill' | 'beverages' | 'bakery' | 'general';

const ITEM_STATIONS: ReadonlySet<string> = new Set(['kitchen', 'grill', 'beverages', 'bakery', 'general']);

export function isValidKdsItemStation(value: unknown): value is KdsItemStation {
  return typeof value === 'string' && ITEM_STATIONS.has(value.toLowerCase());
}

const GRILL_KEYWORDS: ReadonlySet<string> = new Set([
  'مشوي', 'مشوية', 'مشويات', 'كباب', 'كفتة', 'ستيك',
  'grill', 'grilled',
]);
const BEVERAGE_KEYWORDS: ReadonlySet<string> = new Set([
  'عصير', 'مشروب', 'مشروبات', 'قهوة', 'شاي', 'كوكتيل', 'بار',
  'pepsi', 'cola',
]);
const BAKERY_KEYWORDS: ReadonlySet<string> = new Set([
  'بيتزا', 'فطير', 'فطائر', 'مخبوز', 'مخبوزات', 'حلو', 'حلويات', 'كيك', 'كيكة',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;،.()\-_/\\|]+/)
    .map((token) => token.replace(/^ال/, ''))
    .filter(Boolean);
}

export function inferItemStationFromKeywords(name: string, categoryName?: string): KdsStation {
  const tokens = new Set(tokenize(`${name || ''} ${categoryName || ''}`));
  for (const keyword of GRILL_KEYWORDS) if (tokens.has(keyword)) return 'grill';
  for (const keyword of BEVERAGE_KEYWORDS) if (tokens.has(keyword)) return 'beverages';
  for (const keyword of BAKERY_KEYWORDS) if (tokens.has(keyword)) return 'bakery';
  return 'kitchen';
}

export function resolveItemStation(input: {
  productStation?: string | null;
  categoryStation?: string | null;
  productName: string;
  categoryName?: string | null;
}): KdsStation {
  if (isValidKdsItemStation(input.productStation)) {
    return input.productStation.toLowerCase() as KdsItemStation;
  }
  if (isValidKdsItemStation(input.categoryStation)) {
    return input.categoryStation.toLowerCase() as KdsItemStation;
  }
  return inferItemStationFromKeywords(input.productName, input.categoryName ?? undefined);
}

const PRINTER_STATION_MAP: Record<string, KdsStation> = {
  kitchen: 'kitchen',
  grill: 'grill',
  bar: 'beverages',
  expo: 'expo',
  fryer: 'kitchen',
  cold: 'kitchen',
  dessert: 'bakery',
};

export function mapPrinterStationToKdsStation(stationCode: string | null | undefined): KdsStation | null {
  if (!stationCode) return null;
  return PRINTER_STATION_MAP[String(stationCode).toLowerCase().trim()] ?? null;
}

const NEXT_TICKET_STATUS: Partial<Record<KdsTicketStatus, KdsTicketStatus>> = {
  pending: 'cooking',
  cooking: 'ready',
  ready: 'served',
};

export function isAllowedKdsTransition(from: KdsTicketStatus, to: KdsTicketStatus): boolean {
  return NEXT_TICKET_STATUS[from] === to;
}

export function isAllowedKdsItemTransition(from: KdsItemStatus, to: KdsItemStatus): boolean {
  if (from === 'pending') return to === 'cooking' || to === 'ready';
  if (from === 'cooking') return to === 'ready';
  return false;
}
