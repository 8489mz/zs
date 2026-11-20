export interface AdminReviewLine {
  productId: number;
  productName: string;
  barcode?: string;
  unit?: string;
  isWeight?: boolean;
  packagingUnit?: { name: string; multiplier: number };
  requestedQty: number;
  requestedCartons?: number;
  requestedPieces?: number;
  requestedPackingText?: string;
  approvedQty: number;
  approvedCartons?: number;
  approvedPieces?: number;
  packingText?: string;
  warehouseAvailQty: number;
  warehouseStocks?: { warehouseId: number; warehouseName: string; qty: number }[];
}
