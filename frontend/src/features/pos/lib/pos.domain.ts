export { todayLocalIsoDate } from '@/features/pos/lib/pos-domain/pos-domain-helpers';

export { isOfferHappyHourActive, getOfferAppliedPrice } from '@/features/pos/lib/pos-domain/pos-domain-offers';

export { getSaleUnit, getStockLimit, isNegativeStockSalesAllowed, getProductItemCode, getProductPrice, getOfferDisplayName, repriceCartLine, getAvailableSaleProducts } from '@/features/pos/lib/pos-domain/pos-domain-pricing';

export { modifiersSignature, buildPosLineKey, posLineNotesMatch, isServiceProduct } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';
export type { PosLineModifierLike, BuildPosLineKeyInput } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';

export { addPosItem, updatePosItemNotes, updatePosItemLineDiscount } from '@/features/pos/lib/pos-domain/pos-domain-cart-add';

export { buildComboLineKey, applyComboToCart, updatePosItemModifiers, updatePosItemSeat } from '@/features/pos/lib/pos-domain/pos-domain-combo';
export type { ComboSelection, ApplyComboToCartOptions } from '@/features/pos/lib/pos-domain/pos-domain-combo';

export { applyPosLineTransfer } from '@/features/pos/lib/pos-domain/pos-domain-transfer';
export type { PosLineTransferItem } from '@/features/pos/lib/pos-domain/pos-domain-transfer';

export { normalizeSerialNumber, getRequiredSerialCount, getSerialEntryState, addSerialToPosLine, removeSerialFromPosLine, getSerialLookupError, updatePosItemQtyWithOptions, removePosItem } from '@/features/pos/lib/pos-domain/pos-domain-serials';
export type { SerialLookupEntry } from '@/features/pos/lib/pos-domain/pos-domain-serials';

export { syncPosCartStock, normalizeUnitName, isWeightedSaleUnit, summarizeCartQuantities } from '@/features/pos/lib/pos-domain/pos-domain-sync-units';
