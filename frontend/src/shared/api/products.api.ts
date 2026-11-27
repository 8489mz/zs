import { http } from '@/lib/http';
import { unwrapArray } from '@/lib/api/contracts';
import { buildQueryString } from '@/lib/query-string';
import type { Category, Product, Supplier } from '@/types/domain';

export interface ProductsListParams {
  page?: number;
  pageSize?: number;
  groupFashion?: boolean;
  q?: string;
  view?: 'all' | 'low' | 'out' | 'offers' | 'special' | 'archived';
  locationId?: number | string;
  categoryId?: number | string;
  supplierId?: number | string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface ProductsPageResponse {
  products: Product[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: { totalProducts: number; lowStockCount: number; outOfStockCount: number; inventoryCost: number; inventorySaleValue: number; activeOffersCount: number; customerPriceCount: number };
}

export const productsApi = {
  getNextStyleCode: () => http<{ styleCode: string }>('/api/products/next-style-code'),
  allocateStyleCode: () => http<{ styleCode: string }>('/api/products/allocate-style-code', { method: 'POST' }),
  list: async () => (await productsApi.listAll()).products,
  listPage: (params: ProductsListParams) => http<ProductsPageResponse>(`/api/products${buildQueryString(params)}`),
  listAll: async (params: Omit<ProductsListParams, 'page' | 'pageSize'> = {}) => {
    const pageSize = 1000;
    let page = 1;
    const rows: Product[] = [];
    let summary: ProductsPageResponse['summary'];
    while (true) {
      const payload = await productsApi.listPage({ ...params, page, pageSize });
      rows.push(...(payload.products || []));
      summary = payload.summary;
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { products: rows, summary };
  },
  categories: async () => unwrapArray<Category>(await http<Category[] | { categories: Category[] }>('/api/categories'), 'categories'),
  suppliers: async () => unwrapArray<Supplier>(await http<Supplier[] | { suppliers: Supplier[] }>('/api/suppliers'), 'suppliers'),
  create: (payload: unknown) => http<unknown>('/api/products', { method: 'POST', body: JSON.stringify(payload) }),
  saveFashionGroup: (styleCode: string, payload: { rows: unknown[]; consolidateStock?: boolean; zeroRemovedStock?: boolean }) => http<{ ok: boolean; updated: number; created: number; archived: number }>(`/api/products/fashion-groups/${encodeURIComponent(styleCode)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  get: (id: string) => http<Product>(`/api/products/${id}`),
  update: (id: string, payload: unknown) => http<unknown>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  bulkUpdateIcons: (updates: Array<{ id: number; icon: string }>) => http<{ ok: boolean; updated: number }>('/api/products/bulk-icons', { method: 'POST', body: JSON.stringify({ updates }) }),
  toggleArchive: (id: string, options?: { zeroStock?: boolean; archiveEntireGroup?: boolean }) => http<{ ok: boolean; id: number; isActive: boolean; message: string; count?: number }>(`/api/products/${id}/toggle-archive`, { method: 'POST', body: options ? JSON.stringify(options) : undefined }),
  remove: (id: string) => http<{ ok: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),
  createCategory: (payload: { name: string }) => http<unknown>('/api/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id: string, payload: { name: string }) => http<unknown>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCategory: (id: string) => http<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),
  transferCategory: (id: string, payload: { targetCategoryId: number; productIds?: number[] }) => http<{ ok: boolean }>(`/api/categories/${id}/transfer`, { method: 'POST', body: JSON.stringify(payload) }),
  createSupplier: (payload: { name: string; phone?: string; address?: string; balance?: number; notes?: string }) =>
    http<unknown>('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) })
};
