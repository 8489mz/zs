import { http } from '@/lib/http';

export interface PriceListItem {
  id?: number;
  product_id?: number | null;
  product_name?: string | null;
  category_id?: number | null;
  min_quantity: number;
  fixed_price?: number | null;
  discount_percent?: number | null;
}

export interface PriceList {
  id: number;
  name: string;
  code: string;
  currency: string;
  type: 'percentage' | 'fixed_override' | 'markup_cost';
  default_discount_percent: number;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
  items_count?: number;
  items?: PriceListItem[];
  created_at: string;
  updated_at: string;
}

export interface UpsertPriceListPayload {
  name: string;
  code: string;
  currency?: string;
  type?: 'percentage' | 'fixed_override' | 'markup_cost';
  default_discount_percent?: number;
  is_default?: boolean;
  is_active?: boolean;
  notes?: string;
  items?: PriceListItem[];
}

export const priceListsApi = {
  list: async (): Promise<PriceList[]> => {
    const res = await http<{ data: PriceList[] }>('/api/sales/price-lists');
    return res.data || [];
  },

  getOne: async (id: number): Promise<PriceList> => {
    const res = await http<{ data: PriceList }>(`/api/sales/price-lists/${id}`);
    return res.data;
  },

  create: async (payload: UpsertPriceListPayload): Promise<PriceList> => {
    const res = await http<{ data: PriceList }>('/api/sales/price-lists', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  update: async (id: number, payload: UpsertPriceListPayload): Promise<void> => {
    await http(`/api/sales/price-lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  delete: async (id: number): Promise<void> => {
    await http(`/api/sales/price-lists/${id}`, {
      method: 'DELETE',
    });
  },

  calculate: async (params: {
    customerId?: number | null;
    productId: number;
    quantity: number;
    basePrice: number;
    // INV-VAN-PRICE-LIST-WIRING: the engine's credit branch runs
    // only when paymentTerms is 'credit'; without it the preview
    // could never reach the credit price.
    paymentTerms?: 'cash' | 'credit';
  }): Promise<{
    effectivePrice: number;
    discountPercent: number;
    appliedRule: string;
    priceListId: number | null;
    priceListName?: string;
  }> => {
    const res = await http<{
      data: {
        effectivePrice: number;
        discountPercent: number;
        appliedRule: string;
        priceListId: number | null;
        priceListName?: string;
      };
    }>('/api/sales/price-lists/calculate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.data;
  },
};
