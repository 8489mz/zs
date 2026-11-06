import React from 'react';
import { buildStorePublicUrl } from '@/lib/store-public-url';
import {
  UsersIcon,
  SmartphoneIcon,
  TruckIcon,
  PackageIcon,
  UtensilsIcon,
  MonitorIcon,
  TagIcon,
  QrCodeIcon,
  BarChartIcon,
  BuildingIcon,
  ShipIcon,
  GlobeIcon,
  CompassIcon,
  ToolIcon,
  LayersIcon,
} from '@/shared/components/icons/AppIcons';

export interface PortalItem {
  id: string;
  title: string;
  category: 'staff' | 'logistics' | 'projects' | 'field' | 'branch' | 'management';
  categoryName: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  badgeText?: string;
  keywords: string[];
}

export const PORTALS_LIST: PortalItem[] = [  // 1. Employee Self-Service
  {
    id: 'employee-portal',
    title: 'بوابة الموظف الذاتية',
    category: 'staff',
    categoryName: 'خدمة ذاتية',
    description: 'استعراض مسيرات الرواتب، أرصدة الإجازات، طلب سلفة، وتفاصيل العقد.',
    path: '/portal',
    icon: <UsersIcon size={20} color="#170e5e" />,
    iconBg: '#eff6ff',
    iconColor: '#170e5e',
    badgeText: 'للموظفين',
    keywords: ['موظف', 'رواتب', 'إجازات', 'سلف', 'عقد', 'حضور', 'portal', 'ess'],
  },
  {
    id: 'mobile-punch',
    title: 'بصمة الموبايل الذكية (GPS)',
    category: 'staff',
    categoryName: 'خدمة ذاتية',
    description: 'تسجيل الحضور والانصراف بالسيلفي وفحص النطاق الجغرافي للفرع.',
    path: '/punch',
    icon: <SmartphoneIcon size={20} color="#16a34a" />,
    iconBg: '#f0fdf4',
    iconColor: '#16a34a',
    badgeText: 'سيلفي + GPS',
    keywords: ['بصمة', 'حضور', 'انصراف', 'موبايل', 'سيلفي', 'gps', 'punch'],
  },

  // 2. Logistics & International Freight
  {
    id: 'shipment-tracking',
    title: 'بوابة تتبع الشحنات والحاويات',
    category: 'logistics',
    categoryName: 'شحن ولوجستيات',
    description: 'تتبع مسار الحاويات وبوالص الشحن البحري والجوي للعملاء لحظياً.',
    path: '/track',
    icon: <ShipIcon size={20} color="#0284c7" />,
    iconBg: '#f0f9ff',
    iconColor: '#0284c7',
    badgeText: 'تتبع البوالص',
    keywords: ['شحن', 'تتبع', 'حاوية', 'بوليصة', 'لوجستيات', 'بحري', 'جوي', 'track', 'shipment'],
  },
  {
    id: 'freight-portal',
    title: 'بوابة عملاء الشحن واللوجستيات',
    category: 'logistics',
    categoryName: 'شحن ولوجستيات',
    description: 'منصة العملاء لاستعراض بوالص الشحن، مستندات التخليص، وكشوف الحساب.',
    path: '/freight-portal',
    icon: <GlobeIcon size={20} color="#0369a1" />,
    iconBg: '#e0f2fe',
    iconColor: '#0369a1',
    badgeText: 'لعملاء الشحن',
    keywords: ['عملاء الشحن', 'تخليص', 'بوالص', 'شحن دولي', 'لوجستيات', 'freight', 'maritime', 'portal'],
  },
  {
    id: 'carrier-quote-portal',
    title: 'بوابة تسعير الخطوط والناقلين',
    category: 'logistics',
    categoryName: 'شحن ولوجستيات',
    description: 'بوابة الخطوط الملاحية والجوية لتقديم عروض أسعار النوالين والـ RFQs.',
    path: '/portal/carrier-quote/rfq-demo',
    icon: <CompassIcon size={20} color="#0891b2" />,
    iconBg: '#ecfeff',
    iconColor: '#0891b2',
    badgeText: 'لوكلاء الشحن',
    keywords: ['تسعير', 'نولون', 'خطوط ملاحية', 'ناقلين', 'rfq', 'carrier', 'quote'],
  },

  // 3. Contracting & Engineering Projects
  {
    id: 'contracting-field-portal',
    title: 'بوابة العمليات ويوميات الموقع',
    category: 'projects',
    categoryName: 'مشاريع ومقاولات',
    description: 'تسجيل وقائع اليومية الميدانية، حصر الأعمال المنفذة، وحركة العمالة والمعدات.',
    path: '/contracting/field',
    icon: <ToolIcon size={20} color="#d97706" />,
    iconBg: '#fffbeb',
    iconColor: '#d97706',
    badgeText: 'مهندس الموقع',
    keywords: ['مقاولات', 'موقع', 'يومية', 'مهندس', 'مشاريع', 'حصر', 'عمالة', 'معدات', 'contracting', 'field'],
  },
  {
    id: 'contracting-ipc-station',
    title: 'محطة المشاريع والمستخلصات',
    category: 'projects',
    categoryName: 'مشاريع ومقاولات',
    description: 'استعراض بنود المقايسات SOV، مستخلصات المقاولين والاستشاري، ومراكز التكلفة.',
    path: '/contracting/projects',
    icon: <LayersIcon size={20} color="#7c3aed" />,
    iconBg: '#faf5ff',
    iconColor: '#7c3aed',
    badgeText: 'إدارة المشاريع',
    keywords: ['مستخلص', 'مقايسة', 'sov', 'ipc', 'مشاريع', 'مقاولين', 'projects'],
  },

  // 4. Field & Delivery
  {
    id: 'driver-portal',
    title: 'بوابة مندوبي التوصيل',
    category: 'field',
    categoryName: 'توصيل وميداني',
    description: 'استلام أوردرات الدليفري، تحديث التسليم، والاتصال المباشر بالعملاء.',
    path: '/driver',
    icon: <TruckIcon size={20} color="#ea580c" />,
    iconBg: '#fff7ed',
    iconColor: '#ea580c',
    badgeText: 'طيارين الدليفري',
    keywords: ['طيار', 'مندوب', 'توصيل', 'دليفري', 'شحنات', 'أوردر', 'driver'],
  },
  {
    id: 'van-sales',
    title: 'مبيعات سيارات التوزيع والفان',
    category: 'field',
    categoryName: 'توصيل وميداني',
    description: 'محطة بيع وفواتير متنقلة لمندوبي الفان، جرد السيارة والتحصيل الميداني.',
    path: '/van-sales',
    icon: <PackageIcon size={20} color="#0284c7" />,
    iconBg: '#f0f9ff',
    iconColor: '#0284c7',
    badgeText: 'فان كاشير',
    keywords: ['فان', 'سيارة', 'توزيع', 'مبيعات متنقلة', 'مندوب كاشير', 'van'],
  },

  // 5. Branch & POS Displays
  {
    id: 'kds',
    title: 'شاشة المطبخ (KDS)',
    category: 'branch',
    categoryName: 'تشغيل وصالة',
    description: 'متابعة أوامر تحضير وتجهيز الوجبات بالمطاعم والكافيهات لحظياً.',
    path: '/kds',
    icon: <UtensilsIcon size={20} color="#d97706" />,
    iconBg: '#fffbeb',
    iconColor: '#d97706',
    badgeText: 'شاشة تحضير',
    keywords: ['مطبخ', 'تحضير', 'وجبات', 'طلبات', 'كافيه', 'مطعم', 'kds'],
  },
  {
    id: 'customer-display',
    title: 'شاشة العميل بنقطة البيع (CFD)',
    category: 'branch',
    categoryName: 'تشغيل وصالة',
    description: 'شاشة كاونتر لعرض تفاصيل الفاتورة الحية، السعر، وعروض الولاء للمشتري.',
    path: '/pos/customer-display',
    icon: <MonitorIcon size={20} color="#059669" />,
    iconBg: '#ecfdf5',
    iconColor: '#059669',
    badgeText: 'كاونتر الكاشير',
    keywords: ['عميل', 'شاشة عميل', 'كاونتر', 'كاشير', 'عرض أسعار', 'cfd', 'display'],
  },
  {
    id: 'digital-signage',
    title: 'شاشة العروض الرقمية (Signage)',
    category: 'branch',
    categoryName: 'تشغيل وصالة',
    description: 'لوحة تفاعلية لشاشات التلفزيون بالمعرض لعرض الأسعار والخصومات التسويقية.',
    path: '/signage',
    icon: <TagIcon size={20} color="#7c3aed" />,
    iconBg: '#faf5ff',
    iconColor: '#7c3aed',
    badgeText: 'شاشة المعرض',
    keywords: ['عروض', 'تلفزيون', 'شاشة عرض', 'أسعار', 'معرض', 'signage'],
  },
  {
    id: 'table-qr',
    title: 'الطلب الذاتي من الطاولة (QR)',
    category: 'branch',
    categoryName: 'تشغيل وصالة',
    description: 'تصفح المنيو والطلب الفوري من طاولة الصالة عبر مسح كود الـ QR بالهاتف.',
    path: '/table/1',
    icon: <QrCodeIcon size={20} color="#db2777" />,
    iconBg: '#fdf2f8',
    iconColor: '#db2777',
    badgeText: 'منيو الطاولة',
    keywords: ['طاولة', 'qr', 'منيو', 'طلب ذاتي', 'طاولات', 'table'],
  },

  // 6. Management & Enterprise
  {
    id: 'owner-companion',
    title: 'رادار متابعة المالك المتنقل',
    category: 'management',
    categoryName: 'إدارة ورقابة',
    description: 'مؤشرات أداء سريعة، مبيعات الفروع الحية، ومراجعة الخزينة من الهاتف.',
    path: '/owner-companion',
    icon: <BarChartIcon size={20} color="#170e5e" />,
    iconBg: '#f1f5f9',
    iconColor: '#170e5e',
    badgeText: 'للمدير التنفيذي',
    keywords: ['مالك', 'رادار', 'مؤشرات', 'مبيعات', 'موبايل', 'owner', 'companion'],
  },
  {
    id: 'storefront',
    title: 'المتجر الإلكتروني العام',
    category: 'management',
    categoryName: 'إدارة ورقابة',
    description: 'كتالوج المنتجات السحابي للجمهور مع سلة الشراء والطلب أونلاين.',
    path: '/store',
    icon: <BuildingIcon size={20} color="#0891b2" />,
    iconBg: '#ecfeff',
    iconColor: '#0891b2',
    badgeText: 'للعملاء أونلاين',
    keywords: ['متجر', 'أونلاين', 'كتالوج', 'سلة', 'طلبات', 'store', 'ecommerce'],
  },
];

/**
 * INV-HUB-DEAD-END: resolve the real destination of a hub portal.
 *
 * The storefront card used to link to the bare `/store` path, which matches
 * no route (only `/store/:slug`, `/st/:slug` and `/shop/:slug` exist), so
 * opening it landed on the NotFound page — a dead end inside the hub. The
 * public store lives at the tenant's public URL, derived from the tenant
 * slug with the same helper the storefront settings tab uses
 * (`buildStorePublicUrl`, SF-10 mirror of the backend engine). When no
 * tenant slug is known, fall back to the shared `/st/store` destination —
 * the same fallback `MerchantOnlineOrdersPage` uses — never the bare
 * `/store`. Every other portal keeps its own in-app path unchanged.
 */
export function resolvePortalDestination(portal: PortalItem, tenantSlug?: string | null): string {
  if (portal.id !== 'storefront') return portal.path;
  const slug = tenantSlug?.trim() ? tenantSlug.trim() : 'store';
  return buildStorePublicUrl(slug);
}
