import type { SalesOrderItem } from '../../hooks/useCreateSalesOrderForm';

export interface SalesOrderFormItem extends SalesOrderItem {
  id: number;
  stockOnHand?: number;
  barcode?: string;
  warehouse?: string;
}
