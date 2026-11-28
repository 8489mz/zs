/**
 * catalog-product-types — shared type aliases for the catalog-product split.
 * Pure move of the 9 top-level type aliases from CatalogProductService
 * (byte-identical except each is 'export type' — in the facade they were
 * module-local, but the facade and all slices import them from here).
 * Created with the P1 merge (the first); the facade and
 * all slices import the types they need from here. Slices NEVER import
 * the facade file. No free functions exist in this file (prep §2.3).
 */

import { Kysely, Transaction } from '../../../database/kysely';
import { Database } from '../../../database/database.types';

export type ProductRow = {
  id: number;
  name: string;
  name_en?: string | null;
  barcode: string | null;
  sku?: string | null;
  catalog_updated_at?: Date | string | null;
  item_type?: 'product' | 'raw_material' | 'service';
  item_kind: 'standard' | 'fashion' | null;
  style_code: string | null;
  color: string | null;
  size: string | null;
  bin_location: string | null;
  category_id: number | null;
  supplier_id: number | null;
  cost_price: string | number;
  retail_price: string | number;
  wholesale_price: string | number;
  credit_price?: string | number | null;
  half_wholesale_price?: string | number | null;
  consumer_price?: string | number | null;
  min_selling_price?: string | number | null;
  stock_qty: string | number;
  min_stock_qty: string | number;
  bom_id?: number | null;
  default_location_id?: number | null;
  default_location_name?: string | null;
  notes: string;
  track_serials?: boolean | null;
  metadata?: string | Record<string, any> | null;
  is_active?: boolean | null;
  calories?: number | null;
  allergens?: any;
  is_spicy?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
  is_high_risk_shrinkage?: boolean | null;
};

export type ProductWriteExecutor = Kysely<Database> | Transaction<Database>;
export type ProductOfferColumnCapabilities = { hasMinQty: boolean; hasAdvancedPromotions: boolean };
export type ProductOfferReadRow = {
  id: number;
  product_id: number;
  offer_type: string;
  value: string | number;
  start_date: string | null;
  end_date: string | null;
  min_qty?: string | number | null;
  bogo_buy_qty?: string | number | null;
  bogo_get_qty?: string | number | null;
  bogo_discount_percent?: string | number | null;
  happy_hour_start?: string | null;
  happy_hour_end?: string | null;
  days_of_week?: string | null;
};

export type ProductCountRow = {
  product_id: number;
  count: string | number | bigint;
};

export type ProductUnitSearchRow = {
  product_id: number;
  name: string | null;
  barcode: string | null;
};

export type ProductUnitReadRow = {
  id: number;
  product_id: number;
  name: string;
  multiplier: string | number;
  barcode: string | null;
  is_base_unit: boolean;
  is_sale_unit_default: boolean;
  is_purchase_unit_default: boolean;
};

export type PosProductLookupRow = Pick<
  ProductRow,
  | 'id'
  | 'name'
  | 'name_en'
  | 'barcode'
  | 'sku'
  | 'item_type'
  | 'item_kind'
  | 'style_code'
  | 'color'
  | 'size'
  | 'retail_price'
  | 'wholesale_price'
  | 'credit_price'
  | 'half_wholesale_price'
  | 'consumer_price'
  | 'min_selling_price'
  | 'stock_qty'
  | 'min_stock_qty'
  | 'bom_id'
  | 'category_id'
  | 'track_serials'
  | 'metadata'
> & {
  calories?: number | null;
  allergens?: any;
  is_spicy?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
  matched_unit_id?: number | null;
  matched_unit_name?: string | null;
  matched_unit_multiplier?: string | number | null;
  matched_unit_barcode?: string | null;
  matched_serial_number?: string | null;
};

export type CustomerPriceReadRow = {
  id: number;
  product_id: number;
  customer_id: number;
  price: string | number;
};

export const CATALOG_PRODUCT_LIST_SELECT_COLUMNS = [
  'products.id',
  'products.name',
  'products.name_en',
  'products.barcode',
  'products.sku',
  'products.catalog_updated_at',
  'products.item_type',
  'products.item_kind',
  'products.style_code',
  'products.color',
  'products.size',
  'products.bin_location',
  'products.track_serials',
  'products.category_id',
  'products.supplier_id',
  'products.cost_price',
  'products.retail_price',
  'products.wholesale_price',
  'products.half_wholesale_price',
  'products.credit_price',
  'products.consumer_price',
  'products.min_selling_price',
  'products.stock_qty',
  'products.min_stock_qty',
  'sl.id as default_location_id',
  'products.notes',
  'products.metadata',
  'b.id as bom_id',
  'sl.name as default_location_name',
  'products.is_active',
  'products.calories',
  'products.allergens',
  'products.is_spicy',
  'products.is_vegetarian',
  'products.is_gluten_free',
  'products.is_high_risk_shrinkage',
] as const;
