import type { BusinessVertical, MobileQuickActionItem } from './vertical-scope.types';

/**
 * Mobile Quick Actions (Center '+' Sheet) per Vertical:
 * Returns 6 highly relevant, operational actions strictly aligned with the vertical.
 */
export function getMobileQuickActionsConfig(vertical: BusinessVertical, settings?: any): MobileQuickActionItem[] {
  const isPosActive = settings?.posModuleEnabled !== false;

  switch (vertical) {
    case 'maritime':
      return [
        {
          id: 'maritime-job',
          title: 'أمر تشغيل شحنة',
          subtitle: 'إنشاء ملف شحنة وعمليات',
          to: '/maritime/jobs?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'ship',
        },
        {
          id: 'maritime-containers',
          title: 'تتبع الحاويات',
          subtitle: 'فحص الحاويات ومواقعها',
          to: '/maritime/containers',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'container',
        },
        {
          id: 'maritime-inquiry',
          title: 'استفسار شحن جديد',
          subtitle: 'تسجيل طلب شحن لعميل',
          to: '/maritime/inquiries?action=new',
          bg: '#f3e8ff',
          color: '#7c3aed',
          iconType: 'inquiry',
        },
        {
          id: 'maritime-quotation',
          title: 'عرض أسعار لعميل',
          subtitle: 'تسعير نولون وخدمات بحرية',
          to: '/maritime/quotations?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'quotation',
        },
        {
          id: 'maritime-customer',
          title: 'إضافة عميل جديد',
          subtitle: 'تسجيل شاحن أو مستورد',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'maritime-treasury',
          title: 'الخزينة والمصروفات',
          subtitle: 'سند قبض أو مصروف تشغيلي',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'contracting':
      return [
        {
          id: 'contracting-project',
          title: 'مشروع جديد',
          subtitle: 'تسجيل موقع عمل أو مشروع',
          to: '/contracting/projects?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'project',
        },
        {
          id: 'contracting-ipc',
          title: 'مستخلص أعمال (IPC)',
          subtitle: 'إصدار مستخلص جاري أو ختامي',
          to: '/contracting/invoices?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'ipc',
        },
        {
          id: 'contracting-daily-log',
          title: 'يوميات الموقع',
          subtitle: 'تسجيل تقرير ميداني يومي',
          to: '/contracting/daily-logs?action=new',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'dailyLog',
        },
        {
          id: 'contracting-change-order',
          title: 'أمر تغيير ومطالبة',
          subtitle: 'طلب إضافة أو تعديل بنود',
          to: '/contracting/change-orders?action=new',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'changeOrder',
        },
        {
          id: 'contracting-subcontractor',
          title: 'إضافة مقاول / مورد',
          subtitle: 'تسجيل مقاول باطن أو مورد',
          to: '/suppliers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'supplier',
        },
        {
          id: 'contracting-treasury',
          title: 'الخزينة والعهد',
          subtitle: 'سند صرف عهدة أو مستحقات',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'wholesale_van':
      return [
        {
          id: 'van-load-order',
          title: 'إذن تحميل سيارة',
          subtitle: 'تحميل بضاعة لسيارة مندوب',
          to: '/inventory/van-sales',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'truck',
        },
        {
          id: 'van-sale-invoice',
          title: 'فاتورة بيع جملة',
          subtitle: 'تسجيل فاتورة توريد جديدة',
          to: '/sales?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'invoice',
        },
        {
          id: 'van-customer',
          title: 'إضافة متجر / عميل',
          subtitle: 'تسجيل منفذ بيع أو بقالة',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'van-stock-checker',
          title: 'فاحص رصيد المخزن',
          subtitle: 'معاينة رصيد سيارة أو مخزن',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'van-collection',
          title: 'تحصيل وسند قبض',
          subtitle: 'إثبات تحصيل دفعة أو شيك',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
        {
          id: 'van-reps-tracking',
          title: 'المناديب وسيارات الفان',
          subtitle: 'متابعة خطوط السير والعهد',
          to: '/delivery-reps',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'reps',
        },
      ];

    case 'warehousing':
      return [
        {
          id: 'warehouse-transfer',
          title: 'تحويل بين المستودعات',
          subtitle: 'نقل بضاعة بين مستودعين',
          to: '/inventory?tab=transfers',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'inventory',
        },
        {
          id: 'warehouse-issue-order',
          title: 'إذن صرف / إضافة',
          subtitle: 'تسجيل حركة مخزنية جديدة',
          to: '/inventory/issue-orders/new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'invoice',
        },
        {
          id: 'warehouse-item',
          title: 'إضافة صنف جديد',
          subtitle: 'تسجيل باركود وتوصيف صنف',
          to: '/products/new',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'product',
        },
        {
          id: 'warehouse-audit',
          title: 'جلسة جرد مخزني',
          subtitle: 'مطابقة الأرصدة والباركود',
          to: '/inventory?tab=counts',
          bg: '#f3e8ff',
          color: '#7e22ce',
          iconType: 'checker',
        },
        {
          id: 'warehouse-purchase',
          title: 'فاتورة توريد وشراء',
          subtitle: 'استلام بضاعة من مورد',
          to: '/purchases/new',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'purchase',
        },
        {
          id: 'warehouse-dispatches',
          title: 'صرف بضاعة لعميل',
          subtitle: 'فاتورة بيع وصرف مستودع',
          to: '/sales?action=new',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'customer',
        },
      ];

    case 'manufacturing':
      return [
        {
          id: 'mfg-work-order',
          title: 'أمر تشغيل وإنتاج',
          subtitle: 'إصدار أمر تشغيل على خط',
          to: '/manufacturing/work-orders?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'gear',
        },
        {
          id: 'mfg-bom',
          title: 'هيكل منتج (BOM)',
          subtitle: 'تعديل أو إنشاء مقادير خامات',
          to: '/manufacturing/boms?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'bom',
        },
        {
          id: 'mfg-raw-receipt',
          title: 'استلام خامات ومشتريات',
          subtitle: 'إدخال توريدة خامات من مورد',
          to: '/purchases/new',
          bg: '#cffafe',
          color: '#0e7490',
          iconType: 'purchase',
        },
        {
          id: 'mfg-stock-checker',
          title: 'فاحص أرصدة الخامات',
          subtitle: 'مطابقة الخامات والتام',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'mfg-supplier',
          title: 'إضافة مورد خامات',
          subtitle: 'تسجيل مورد أو مقاول تصنيع',
          to: '/suppliers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'supplier',
        },
        {
          id: 'mfg-treasury',
          title: 'الخزينة والمصروفات',
          subtitle: 'تسجيل تكاليف أو سند قبض',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'retail_general':
    default:
      return [
        isPosActive
          ? {
              id: 'pos',
              title: 'نقطة البيع (POS)',
              subtitle: 'كاشير وبيع مباشر سريع',
              to: '/pos',
              bg: '#ede9fe',
              color: '#6d28d9',
              iconType: 'pos',
            }
          : {
              id: 'sales',
              title: 'سجل الفواتير والمبيعات',
              subtitle: 'فواتير الشركات والمبيعات',
              to: '/sales',
              bg: '#ede9fe',
              color: '#6d28d9',
              iconType: 'invoice',
            },
        {
          id: 'price-checker',
          title: 'فاحص الأسعار والمخزون',
          subtitle: 'مسح باركود ومعاينة الرصيد',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'quick-product',
          title: 'إضافة صنف جديد',
          subtitle: 'تسجيل صنف أو خدمة فوراً',
          actionKey: 'quickProduct',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'product',
        },
        {
          id: 'new-purchase',
          title: 'فاتورة شراء جديدة',
          subtitle: 'إدخال بضاعة من مورد',
          to: '/purchases/new',
          bg: '#cffafe',
          color: '#0e7490',
          iconType: 'purchase',
        },
        {
          id: 'new-customer',
          title: 'إضافة عميل جديد',
          subtitle: 'تسجيل بيانات العميل وهاتفه',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'treasury-expense',
          title: 'الخزينة والمصروفات',
          subtitle: 'سند قبض أو تسجيل مصروف',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];
  }
}
