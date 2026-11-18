import type { RefObject } from 'react';
import type { Product } from '@/types/domain';

export type PosPriceType = 'retail' | 'wholesale' | 'half_wholesale' | 'credit';
export type DoorstepPaymentMethod = 'cash' | 'card_pos' | 'instapay_wallet';
export type PaymentPreset = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit';


export interface PosItem {
  lineKey: string;
  productId: string;
  name: string;
  nameEn?: string;
  name_en?: string;
  itemCode?: string;
  unitId: string;
  unitName: string;
  unitMultiplier: number;
  price: number;
  originalPrice?: number;
  offerDiscount?: number;
  /* INV-POS-LINE-DISCOUNT: the per-line TOTAL discount (amount, same
   * unit as the backend SaleItemDto.lineDiscount), granted on this
   * cart line only — e.g. one clearance piece in a 4-piece sale. It
   * is subtracted from the line gross before the header discount, and
   * is stored per line so the invoice shows which piece was
   * discounted. Absent (undefined) means no line discount. */
  lineDiscount?: number;
  costPrice: number;
  qty: number;
  stockLimit: number;
  currentStock: number;
  minStock: number;
  priceType: PosPriceType;
  isWeighted?: boolean;
  sourceBarcode?: string;
  notes?: string;
  offerName?: string;
  modifiers?: any[];
  seatNumber?: number;
  course?: string;
  quantityChunks?: number[];
  trackSerials?: boolean;
  serials?: string[];
  /* INV-REST-HOLD-RECALL-TRUTH (R5-B): marker set by restoreHeldSnapshot
   * on lines restored from a hold; syncPosCartStock freezes the price of
   * such lines instead of repricing from the current catalog. */
  priceHeldAt?: number;
  /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a held line whose stock ran out is
   * kept and flagged, never silently deleted; submit still enforces stock. */
  heldUnavailable?: boolean;
  imageUrl?: string;
  icon?: string;
}

export type PosCardDensity = 'comfortable' | 'compact' | 'gallery';

export interface PosProductGroupCardProps {
  groupKey: string;
  index: number;
  title: string;
  hasVariants: boolean;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  totalStock: number;
  itemKind?: Product['itemKind'];
  imageUrl?: string | null;
  iconName?: string | null;
  metaLabel: string;
  isSelected: boolean;
  isFavorite: boolean;
  isOutOfStock: boolean;
  cardDensity: PosCardDensity;
  isMobile: boolean;
  mobileGridColumns: '2' | '3' | 'auto';
  showCardIcon: boolean;
  cardRefs: RefObject<Array<HTMLElement | null>>;
  onActivate: (groupKey: string) => void;
  onToggleFavorite: (groupKey: string) => void;
}
