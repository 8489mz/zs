import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

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

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): the driver pre-sales order payload
 * was an interface, so the global pipe did nothing for it — it is now
 * a class. customerId is optional: the service interface it replaces
 * had it optional, the service resolves a customer by name when it is
 * absent, and an existing spec (van-pre-sales-customer-attribution)
 * constructs an order without it — so the boundary must not narrow
 * the service's contract. paymentMethod is the cash/credit union the
 * caller always sends. The per-item qty AND quantity are both
 * accepted (the service reads qty ?? quantity and SKIPS qty <= 0
 * lines, so neither carries a Min).
 */
export class PreSalesOrderItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsNumber()
  qty?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsOptional()
  @IsNumber()
  unitMultiplier?: number;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;
}

export class CreatePreSalesOrderDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseLocationId?: number;

  @IsIn(['cash', 'credit'])
  paymentMethod!: 'cash' | 'credit';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreSalesOrderItemDto)
  items!: PreSalesOrderItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
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

export type ListWarehouseCatalogResult = {
  ok?: boolean;
  items: PreSalesCatalogItem[];
  products?: PreSalesCatalogItem[];
  total: number;
  targetWarehouseId?: number | null;
};

export type CreatePreSalesOrderResult = {
  ok: boolean;
  orderId: number;
  orderNumber: string;
  totalAmount: number;
  itemsCount: number;
};

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
