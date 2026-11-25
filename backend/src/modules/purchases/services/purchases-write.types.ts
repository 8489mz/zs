import { type Selectable } from '../../../database/kysely';
import { Database } from '../../../database/database.types';

export type PurchaseRepricingCandidate = {
  productId: number;
  name: string;
  itemKind: 'standard' | 'fashion';
  styleCode: string;
  previousCost: number;
  newCost: number;
  retailPrice: number;
  wholesalePrice: number;
};

export type PurchaseRepricingProduct = Pick<
  Selectable<Database['products']>,
  'id' | 'name' | 'item_kind' | 'style_code' | 'cost_price' | 'retail_price' | 'wholesale_price'
>;

export type PurchaseRepricingInsights = {
  purchaseId: number;
  supplierId: number;
  supplierName: string;
  affectedCount: number;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  productIds: number[];
  rows: Array<{
    productId: number;
    name: string;
    itemKind: 'standard' | 'fashion';
    styleCode: string;
    previousCost: number;
    newCost: number;
    costChangePercent: number;
    retailPrice: number;
    wholesalePrice: number;
    recommendedRetailPrice: number;
    recommendedWholesalePrice: number;
    recommendedRetailDelta: number;
    recommendedWholesaleDelta: number;
  }>;
};
