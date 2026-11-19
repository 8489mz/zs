import type { MoneyDigits } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';

export interface AddPosItemOptions {
  priceType: PosPriceType;
  digits: MoneyDigits;
  unitId?: string;
  allowNegativeStockSales?: boolean;
  quantity?: number;
  isWeighted?: boolean;
  sourceBarcode?: string;
  serialNumber?: string;
  /** Product ids currently 86'd (out of stock) for this branch — the
   * workspace passes the list the header already fetches (query key
   * ['pos-86-items-header', branchId]). An 86'd add is refused here
   * with a named error, before any key/stock logic. */
  eightySixedProductIds?: Array<number | string>;
  /** Modifiers the new line carries (when known at add time). They are part
   * of the line identity: a modified line never merges into a plain one. */
  modifiers?: any[];
  /** Note the new line carries. Notes are NOT in the key, but a merge
   * requires equal notes (both empty, or equal). */
  notes?: string;
  seatNumber?: number;
  course?: string;
  /** Appended to the lineKey so the new line never merges into an existing
   * line of the same product (used by combo adds — see applyComboToCart). */
  lineKeySuffix?: string;
}

/* R-I34 / INV-REST-LINE-IDENTITY: a cart line is identified by its FULL
 * identity — product + unit + price type + modifier set + seat + course —
 * never by product + price alone. Before this fix the key was
 * product::unit::priceType, so a plain burger merged into a burger with
 * extra cheese and the cheese was charged on EVERY unit (calcCartLineTotal
 * is qty x (price + modifiers)). Notes are deliberately NOT in the key:
 * they are free text, and editing a note must not split a line — the merge
 * step requires equal notes instead (see posLineNotesMatch). */
export interface PosLineModifierLike {
  optionId?: unknown;
  id?: unknown;
  option_id?: unknown;
  name?: unknown;
  price?: unknown;
  qty?: unknown;
  quantity?: unknown;
}

export function cleanKeyPart(value: unknown): string {
  return String(value ?? '').replace(/[;:]/g, ' ').trim();
}

/** Stable signature of a modifier set. Sorted by option id first (names
 * collide across groups); when there is no id — combo modifiers carry only
 * name + price — name + price + qty is the only identity available. Two
 * lines with the same modifier set in a different order share a signature,
 * so re-adding the same modified item still merges. */
export function modifiersSignature(modifiers: Array<PosLineModifierLike | any> | null | undefined): string {
  const entries = (modifiers || []).map((rawMod) => {
    const mod = (rawMod ?? {}) as PosLineModifierLike;
    const id = cleanKeyPart(mod.optionId ?? mod.id ?? mod.option_id ?? '');
    const name = cleanKeyPart(mod.name ?? '');
    const price = Number(mod.price || 0);
    const qty = Number(mod.qty ?? mod.quantity ?? 1);
    return {
      id,
      name,
      price: Number.isFinite(price) ? price : 0,
      qty: Number.isFinite(qty) ? qty : 1,
    };
  });
  entries.sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name)
    || a.name.localeCompare(b.name) || a.price - b.price || a.qty - b.qty);
  return entries.map((entry) => `${entry.id}:${entry.name}:${entry.price}:${entry.qty}`).join(';');
}

export interface BuildPosLineKeyInput {
  productId: string | number;
  unitId?: string | number;
  priceType: PosPriceType;
  modifiers?: Array<PosLineModifierLike | any> | null;
  seatNumber?: number | null;
  course?: string | null;
}

/** The one canonical line key. Every merge / match site must use it — no
 * site hand-rolls a key again. */
export function buildPosLineKey(input: BuildPosLineKeyInput): string {
  const signature = modifiersSignature(input.modifiers);
  let key = `${input.productId}::${input.unitId || ''}::${input.priceType}`;
  if (signature) key += `::${signature}`;
  const seat = Number(input.seatNumber);
  if (input.seatNumber != null && Number.isFinite(seat)) key += `::seat-${seat}`;
  const course = cleanKeyPart(input.course ?? '');
  if (course) key += `::course-${course}`;
  return key;
}

/** Notes are not identity, but a merge must never silently drop a note
 * that differs: two lines merge only when their notes match (both empty,
 * or equal ignoring surrounding whitespace). */
export function posLineNotesMatch(a?: string | null, b?: string | null): boolean {
  return String(a || '').trim() === String(b || '').trim();
}

/** A line that cannot merge (notes differ) still needs its own addressable
 * key, or later qty / modifier edits hit the first line with that key. */
export function uniquePosLineKey(cart: PosItem[], baseKey: string): string {
  if (!cart.some((line) => line.lineKey === baseKey)) return baseKey;
  let n = 2;
  while (cart.some((line) => line.lineKey === `${baseKey}::note-${n}`)) n += 1;
  return `${baseKey}::note-${n}`;
}

/** Rebuild a line's key after its identity changed (modifiers / seat set
 * after the add). A trailing ::combo-<id> suffix (combo instances are
 * distinct by design) and a ::split suffix (split halves) survive the
 * rebuild — they are instance markers, not identity. */
export function rekeyPosLine(
  item: PosItem,
  patch: { modifiers?: any[]; seatNumber?: number | null },
): string {
  const key = String(item.lineKey || '');
  const combo = key.match(/::(combo-[^:]+)$/);
  const split = /::split$/.test(key) ? '::split' : '';
  const base = buildPosLineKey({
    productId: item.productId,
    unitId: item.unitId || item.unitName,
    priceType: item.priceType,
    modifiers: patch.modifiers !== undefined ? patch.modifiers : item.modifiers,
    seatNumber: patch.seatNumber !== undefined
      ? (patch.seatNumber ?? undefined)
      : item.seatNumber,
    course: item.course,
  });
  return `${base}${combo ? `::${combo[1]}` : ''}${split}`;
}

// INV-SERVICE-STOCK-NO-STOCK-CHECK (spice trial D02): the single
// canonical service test. The service kind lives on itemType
// ('product' | 'raw_material' | 'service'); itemKind is only
// 'standard' | 'fashion' and can never be 'service'. The item_type
// fallback covers database-shaped API payloads that were never
// mapped to camelCase. Every stock gate must use this — the trial
// bug was three ad-hoc tests disagreeing about where the kind lives.
export function isServiceProduct(product: Product | null | undefined): boolean {
  if (!product) return false;
  return product.itemType === 'service' || (product as any).item_type === 'service';
}
