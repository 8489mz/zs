export interface CartItem {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  maxQty: number;
  originalPrice?: number;
  offerBadge?: string;
  unitName?: string;
  unitMultiplier?: number;
  isBonus?: boolean;
  bonusReason?: string;
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
  // discount amount (POS lineDiscount semantics).
  lineDiscount?: number;
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
}

export interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  balance: number;
  creditLimit?: number;
  customerCode?: string;
  route?: string;
  locationUrl?: string;
}
