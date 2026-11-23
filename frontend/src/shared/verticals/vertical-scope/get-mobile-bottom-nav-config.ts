import type { BusinessVertical, MobileBottomNavConfig } from './vertical-scope.types';

/**
 * Mobile Bottom Navigation Configuration per Vertical
 */
export function getMobileBottomNavConfig(vertical: BusinessVertical, settings?: any): MobileBottomNavConfig {
  const isPosActive = settings?.posModuleEnabled !== false;

  switch (vertical) {
    case 'maritime':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/quotations'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/maritime/jobs',
          label: 'أوامر التشغيل',
          iconType: 'maritime-jobs',
          activeMatchPrefixes: ['/maritime/jobs', '/maritime/containers', '/maritime'],
        },
      };

    case 'contracting':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/contracting/projects',
          label: 'المشاريع',
          iconType: 'contracting-projects',
          activeMatchPrefixes: ['/contracting/projects'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/contracting/invoices',
          label: 'المستخلصات',
          iconType: 'contracting-invoices',
          activeMatchPrefixes: ['/contracting/invoices', '/contracting/financials', '/contracting'],
        },
      };

    case 'wholesale_van':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'فواتير الجملة',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/sales/orders'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/van-sales/admin',
          label: 'المناديب والتوزيع',
          iconType: 'van-sales',
          activeMatchPrefixes: ['/van-sales', '/delivery-reps', '/inventory/van-sales'],
        },
      };

    case 'warehousing':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/inventory',
          label: 'المستودعات والتحويلات',
          iconType: 'inventory',
          activeMatchPrefixes: ['/inventory'],
        },
        centerActionLabel: 'إجراء مخزني',
        primary: {
          to: '/purchases',
          label: 'المشتريات والتوريد',
          iconType: 'sales',
          activeMatchPrefixes: ['/purchases'],
        },
      };

    case 'manufacturing':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/manufacturing/work-orders',
          label: 'أوامر الإنتاج',
          iconType: 'manufacturing-orders',
          activeMatchPrefixes: ['/manufacturing/work-orders', '/manufacturing'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/inventory',
          label: 'الخامات والمخزون',
          iconType: 'inventory',
          activeMatchPrefixes: ['/inventory', '/products'],
        },
      };

    case 'import_export':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/purchases',
          label: 'المشتريات',
          iconType: 'sales',
          activeMatchPrefixes: ['/purchases'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/import/shipments',
          label: 'الشحنات',
          iconType: 'inventory',
          activeMatchPrefixes: ['/import'],
        },
      };

    case 'services':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/quotations'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/services',
          label: 'الخدمات',
          iconType: 'quotations',
          activeMatchPrefixes: ['/services'],
        },
      };

    case 'retail_general':
    default:
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/returns'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: isPosActive
          ? {
              to: '/pos',
              label: 'نقطة البيع',
              iconType: 'pos',
              activeMatchPrefixes: ['/pos'],
            }
          : {
              to: '/inventory',
              label: 'المخزون',
              iconType: 'inventory',
              activeMatchPrefixes: ['/inventory', '/products'],
            },
      };
  }
}
