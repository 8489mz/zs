export const WEEKDAYS = [
  { id: 'saturday', label: 'السبت' },
  { id: 'sunday', label: 'الأحد' },
  { id: 'monday', label: 'الإثنين' },
  { id: 'tuesday', label: 'الثلاثاء' },
  { id: 'wednesday', label: 'الأربعاء' },
  { id: 'thursday', label: 'الخميس' },
  { id: 'friday', label: 'الجمعة' },
];

export const NEGATIVE_REASON_LABELS: Record<string, string> = {
  shop_closed: 'المحل مغلق',
  no_cash: 'لا توجد نقدية كافية',
  sufficient_stock: 'البضاعة متوفرة وكافية',
  item_unavailable: 'الصنف المطلوب غير متوفر بالسيارة',
  postponed: 'طلب تأجيل الميعاد',
  other: 'أسباب ميدانية أخرى',
};
