import { http } from '@/lib/http';

export interface AlternativeLocationStock {
  locationId: number;
  locationName: string;
  qty: number;
}

export interface ReplenishmentSuggestionItem {
  productId: number;
  productName: string;
  barcode: string;
  currentShopStock: number;
  warehouseStock: number;
  totalEnterpriseStock: number;
  alternativeLocations: AlternativeLocationStock[];
  sold48h: number;
  dailySalesRate: number;
  daysOfSupplyRemaining: number;
  recommendedPurchaseDeadline?: string;
  suggestedQty: number;
  reorderPoint: number;
  costPrice: number;
  salePrice: number;
  cartonMultiplier?: number;
  cartonName?: string;
  cartonsCount?: number;
  urgency: 'out_of_stock' | 'low_stock' | 'sales_replenish' | 'unavailable_in_source';
}

export interface ReplenishmentSuggestionsResponse {
  fromLocation: { id: number; name: string };
  toLocation: { id: number; name: string };
  items: ReplenishmentSuggestionItem[];
  totalItems: number;
  totalSuggestedQty: number;
  coverageHours: number;
}

export interface ExecuteReplenishmentPayload {
  fromLocationId: number;
  toLocationId: number;
  items: { productId: number; qty: number }[];
  note?: string;
  carrierEmployeeId?: number;
  carrierName?: string;
}

export interface ExecuteReplenishmentResponse {
  ok: boolean;
  transferId: number;
  docNo: string;
  itemsCount: number;
  totalQty: number;
}

export const inventoryReplenishmentApi = {
  getSuggestions: async (fromLocationId: number, toLocationId: number, coverDays = 2): Promise<ReplenishmentSuggestionsResponse> => {
    const qs = `?fromLocationId=${encodeURIComponent(fromLocationId)}&toLocationId=${encodeURIComponent(toLocationId)}&coverDays=${encodeURIComponent(coverDays)}`;
    return http<ReplenishmentSuggestionsResponse>(`/api/inventory/smart-replenishment/suggestions${qs}`);
  },

  execute: async (payload: ExecuteReplenishmentPayload): Promise<ExecuteReplenishmentResponse> => {
    return http<ExecuteReplenishmentResponse>(`/api/inventory/smart-replenishment/execute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
