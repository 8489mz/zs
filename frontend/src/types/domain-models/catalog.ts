export interface ProductUnit {
  id: string;
  name: string;
  multiplier: number;
  barcode: string;
  isBaseUnit: boolean;
  isSaleUnit: boolean;
  isPurchaseUnit: boolean;
}

export interface ProductOffer {
  id?: string;
  type?: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';
  offer_type?: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';
  value: number | string;
  minQty?: number;
  min_qty?: number | string | null;
  from?: string | null;
  to?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  bogoBuyQty?: number | null;
  bogo_buy_qty?: number | string | null;
  bogoGetQty?: number | null;
  bogo_get_qty?: number | string | null;
  bogoDiscountPercent?: number | null;
  bogo_discount_percent?: number | string | null;
  happyHourStart?: string | null;
  happy_hour_start?: string | null;
  happyHourEnd?: string | null;
  happy_hour_end?: string | null;
  daysOfWeek?: string | null;
  days_of_week?: string | null;
}

export interface ProductCustomerPrice {
  customerId: string;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  nameEn?: string;
  name_en?: string;
  barcode: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  halfWholesalePrice?: number | null;
  creditPrice?: number | null;
  consumerPrice?: number | null;
  stock: number;
  minStock: number;
  notes: string;
  units: ProductUnit[];
  offers?: ProductOffer[];
  customerPrices?: ProductCustomerPrice[];
  itemType?: 'product' | 'raw_material' | 'service';
  itemKind?: 'standard' | 'fashion';
  styleCode?: string;
  variantsCount?: number;
  sku?: string;
  catalogUpdatedAt?: string;
  color?: string;
  size?: string;
  isActive?: boolean;
  is_active?: boolean;
  hasMovements?: boolean;
  canDelete?: boolean;
  status?: string;
  statusLabel?: string;
  bomId?: number;
  hasBom?: boolean;
  comboOriginalPrice?: number;
  comboComponentsSummary?: string;
  categoryName?: string;
  supplierName?: string;
  binLocation?: string;
  defaultLocationId?: string;
  defaultLocationName?: string;
  activeLocationIds?: string[];
  activeLocationNames?: string[];
  trackSerials?: boolean;
  matchedSerialNumber?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
  expiryDate?: string | null;
  calories?: number | null;
  allergens?: string[] | null;
  isSpicy?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
  isHighRiskShrinkage?: boolean;
  metadata?: Record<string, any> | null;
}

export interface Category {
  id: string;
  name: string;
  productCount?: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
  notes: string;
  metadata?: any;
  /* INV-SUPPLIER-PAGE-BILL-STATEMENT: 'freelancer' marks a contractor
   * (ads/marketing) registered on the supplier page instead of as an HR
   * employee. overdraftLimit caps cumulative outstanding advances; null
   * (or absent) means uncapped. This is NOT metadata.supplierType
   * (factory/shipping/customs — the import classification). */
  supplierType?: 'supplier' | 'freelancer';
  overdraftLimit?: number | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
  type: string;
  creditLimit: number;
  storeCreditBalance: number;
  metadata?: any;
  repBalances?: Array<{
    repId: number;
    repName: string;
    balance: number;
  }>;
  unassignedBalance?: number;
}
