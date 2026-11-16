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
  type: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';
  value: number;
  minQty?: number;
  from?: string | null;
  to?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  bogoBuyQty?: number | null;
  bogoGetQty?: number | null;
  bogoDiscountPercent?: number | null;
  happyHourStart?: string | null;
  happyHourEnd?: string | null;
  daysOfWeek?: string | null;
}

export interface ProductCustomerPrice {
  customerId: string;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  barcode: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  stock: number;
  minStock: number;
  notes: string;
  units: ProductUnit[];
  offers?: ProductOffer[];
  customerPrices?: ProductCustomerPrice[];
  itemType?: 'product' | 'raw_material' | 'service';
  itemKind?: 'standard' | 'fashion';
  styleCode?: string;
  color?: string;
  size?: string;
  status?: string;
  statusLabel?: string;
  bomId?: number;
  hasBom?: boolean;
  comboOriginalPrice?: number;
  comboComponentsSummary?: string;
  categoryName?: string;
  supplierName?: string;
  calories?: number | null;
  allergens?: string[] | null;
  isSpicy?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
  binLocation?: string;
  defaultLocationId?: string;
  defaultLocationName?: string;
  activeLocationIds?: string[];
  activeLocationNames?: string[];
  trackSerials?: boolean;
  matchedSerialNumber?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, any>;
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
  // INV-VAN-PRICE-LIST-WIRING: the assigned price-list id (null = none).
  priceListId?: number | null;
}
