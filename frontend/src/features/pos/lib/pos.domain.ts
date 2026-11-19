import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { Product, ProductOffer, ProductUnit } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { todayLocalDateKey } from '@/lib/format';

export { todayLocalIsoDate } from '@/features/pos/lib/pos-domain/pos-domain-helpers';

export { isOfferHappyHourActive, getOfferAppliedPrice } from '@/features/pos/lib/pos-domain/pos-domain-offers';

export { getSaleUnit, getStockLimit, isNegativeStockSalesAllowed, getProductItemCode, getProductPrice, getOfferDisplayName, repriceCartLine, getAvailableSaleProducts } from '@/features/pos/lib/pos-domain/pos-domain-pricing';

export { PosLineModifierLike, modifiersSignature, BuildPosLineKeyInput, buildPosLineKey, posLineNotesMatch, isServiceProduct } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';

export { addPosItem, updatePosItemNotes, updatePosItemLineDiscount } from '@/features/pos/lib/pos-domain/pos-domain-cart-add';

export { ComboSelection, ApplyComboToCartOptions, buildComboLineKey, applyComboToCart, updatePosItemModifiers, updatePosItemSeat } from '@/features/pos/lib/pos-domain/pos-domain-combo';

export { PosLineTransferItem, applyPosLineTransfer } from '@/features/pos/lib/pos-domain/pos-domain-transfer';

export { normalizeSerialNumber, getRequiredSerialCount, getSerialEntryState, addSerialToPosLine, removeSerialFromPosLine, SerialLookupEntry, getSerialLookupError, updatePosItemQtyWithOptions, removePosItem } from '@/features/pos/lib/pos-domain/pos-domain-serials';

export { syncPosCartStock, normalizeUnitName, isWeightedSaleUnit, summarizeCartQuantities } from '@/features/pos/lib/pos-domain/pos-domain-sync-units';
