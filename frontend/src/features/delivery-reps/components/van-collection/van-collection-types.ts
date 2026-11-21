export interface CustomerOption {
  id: number;
  name: string;
  phone?: string;
  balance: number;
  creditLimit?: number;
  customerCode?: string;
  route?: string;
  district?: string;
  locationUrl?: string;
  // INV-VAN-UNLINKED-RETURN-PICKER: the sale cart prices wholesale
  // customers at the wholesale price; the unlinked return picker
  // applies the same rule, so it needs the type the page already
  // carries on these objects (customer_type, snake_case from the API).
  customer_type?: string;
}

export const RETURN_REASONS = [
  { value: 'damaged', label: 'بضاعة تالفة / كسر أثناء التخزين والنقل' },
  { value: 'expired', label: 'اقتراب أو انتهاء تاريخ الصلاحية' },
  { value: 'manufacturing_defect', label: 'عيب صناعة / عيب تعبئة وتغليف' },
  { value: 'stagnant', label: 'بضاعة راكدة / بطيئة الحركة لدى العميل' },
  { value: 'order_mismatch', label: 'خطأ في التوريد أو مقاسات الطلب' },
  { value: 'customer_request', label: 'رغبة العميل / رفض استلام' },
];
