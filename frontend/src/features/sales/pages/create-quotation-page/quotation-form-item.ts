import type { QuotationItem } from '../../hooks/useCreateQuotationForm';

export interface QuotationFormItem extends QuotationItem {
  id: number;
  stockOnHand?: number;
  barcode?: string;
  notes?: string;
}
