export interface PreSalesCatalogItem {
  id: number;
  name: string;
  barcode: string | null;
  stockQty: number;
  warehouseStock?: number;
  reservedQty: number;
  warehouseReserved?: number;
  availableQty: number;
  warehouseAvailable?: number;
  // INV-REP-SCOPED-DRIVER-READS (M19/D9): the four non-retail prices
  // are present only on staff reads. A driver call (repId present)
  // omits them entirely — the driver sees the retail price only, like
  // getDriverAvailableProducts.
  costPrice?: number;
  retailPrice: number;
  creditPrice?: number;
  consumerPrice?: number;
  wholesalePrice?: number;
  supplierId?: number | null;
  supplierName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  packagingUnit?: { name: string; multiplier: number } | null;
  units: Array<{
    id: number;
    name: string;
    multiplier: number;
    isBaseUnit: boolean;
    isSaleUnitDefault: boolean;
    isBase?: boolean;
    isSaleDefault?: boolean;
  }>;
  activeOffers: Array<{
    id: number;
    offerType: string;
    value: number;
    minQty: number;
    startDate: string | null;
    endDate: string | null;
  }>;
  offers?: Array<{
    id: number;
    offerType: string;
    value: number;
    minQty: number;
  }>;
}

export interface CreatePreSalesOrderDto {
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  warehouseLocationId?: number;
  paymentMethod: 'cash' | 'credit';
  items: Array<{
    productId: number;
    qty?: number;
    quantity?: number;
    unitName?: string;
    unitMultiplier?: number;
    unitPrice?: number;
  }>;
  notes?: string;
  deliveryDate?: string;
}

export type ListWarehouseCatalogQuery = { search?: string; categoryId?: number; limit?: number; offset?: number };

export type ListPreSalesOrdersFilters = {
  repId?: number;
  customerId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ConsolidatePreSalesOrdersPayload = {
  orderIds: number[];
  // F18 (trial problem 30): the admin dialog sends `deliveryRepId`
  // (FE van-sales-presales.ts posts it verbatim); older callers send
  // `targetRepId`. Either names the target rep; at least one is required.
  targetRepId?: number;
  deliveryRepId?: number;
  sourceWarehouseId?: number;
  notes?: string;
};

export type ConvertPreSalesOrderPayload = {
  paymentType?: 'cash' | 'credit';
  paidAmount?: number;
  notes?: string;
};

export type ListWarehouseCatalogResult = { ok?: boolean; items: PreSalesCatalogItem[]; products?: PreSalesCatalogItem[]; total: number; targetWarehouseId?: number | null };

export type CreatePreSalesOrderResult = { ok: boolean; orderId: number; orderNumber: string; totalAmount: number; itemsCount: number };

export type ApprovePreSalesOrderResult = { ok: boolean; status: string };

export type RejectPreSalesOrderResult = { ok: boolean; status: string };

export type ConsolidatePreSalesOrdersResult = {
  ok: boolean;
  requisitionId: number;
  docNo: string;
  consolidatedOrdersCount: number;
  itemsCount: number;
  targetRepId: number;
  targetRepName: string;
};

export type ConvertPreSalesOrderResult = {
  ok: boolean;
  orderId: number;
  saleId: number;
  docNo: string | null;
};
