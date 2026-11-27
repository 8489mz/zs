import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { buildPosLineKey, posLineNotesMatch, uniquePosLineKey } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';

/* Line transfer (R-I34): deduct-from-source and add-to-target match on the
 * lineKey, never on product + price. Legacy lines without a key fall back
 * to a full-identity match (product + unit + price type + modifiers +
 * seat + course + price + notes) — product + price alone never matches. */
export interface PosLineTransferItem {
  lineKey?: string;
  productId: string | number;
  unitId?: string | number;
  unitName?: string;
  priceType?: PosPriceType;
  price: number;
  qty: number;
  modifiers?: any[];
  notes?: string;
  seatNumber?: number;
  course?: string;
}

function posLineMatchesTransfer(
  line: PosItem | PosLineTransferItem,
  other: PosItem | PosLineTransferItem,
): boolean {
  if (line.lineKey && other.lineKey) return line.lineKey === other.lineKey;
  if (String(line.productId) !== String(other.productId)) return false;
  if (Number(line.price || 0) !== Number(other.price || 0)) return false;
  const keyOf = (entry: PosItem | PosLineTransferItem) => buildPosLineKey({
    productId: entry.productId,
    unitId: (entry as PosItem).unitId || entry.unitName,
    priceType: (entry as PosItem).priceType || 'retail',
    modifiers: entry.modifiers,
    seatNumber: entry.seatNumber,
    course: entry.course,
  });
  return keyOf(line) === keyOf(other) && posLineNotesMatch(line.notes, other.notes);
}

/** Move `items` (with the quantities to move) from `source` to `target`.
 * Never merges two different keys; a line whose notes differ from the
 * matching target line is added as its own line. */
export function applyPosLineTransfer(
  source: PosItem[],
  target: PosItem[],
  items: PosLineTransferItem[],
): { source: PosItem[]; target: PosItem[] } {
  const nextSource = [...source];
  const nextTarget = [...target];
  for (const item of items) {
    const moveQty = Number(item.qty || 0);
    if (moveQty <= 0) continue;
    const srcIdx = nextSource.findIndex((line) => posLineMatchesTransfer(line, item));
    if (srcIdx === -1) continue;
    if (Number(nextSource[srcIdx].qty || 0) > moveQty) {
      nextSource[srcIdx] = { ...nextSource[srcIdx], qty: Number(nextSource[srcIdx].qty || 0) - moveQty };
    } else {
      nextSource.splice(srcIdx, 1);
    }
    const tgtIdx = nextTarget.findIndex(
      (line) => posLineMatchesTransfer(line, item) && posLineNotesMatch(line.notes, item.notes),
    );
    if (tgtIdx !== -1) {
      nextTarget[tgtIdx] = { ...nextTarget[tgtIdx], qty: Number(nextTarget[tgtIdx].qty || 0) + moveQty };
    } else {
      const baseKey = item.lineKey || buildPosLineKey({
        productId: item.productId,
        unitId: item.unitId || item.unitName,
        priceType: item.priceType || 'retail',
        modifiers: item.modifiers,
        seatNumber: item.seatNumber,
        course: item.course,
      });
      nextTarget.push({
        ...(item as unknown as PosItem),
        lineKey: uniquePosLineKey(nextTarget, baseKey),
        qty: moveQty,
      });
    }
  }
  return { source: nextSource, target: nextTarget };
}
