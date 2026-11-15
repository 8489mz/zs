import type { AppItemDefinition } from '../types/apps-store.types';
import type { CSSProperties } from 'react';

// Institutional SVG Icons (0 Emojis Policy)
function PosIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h12" />
    </svg>
  );
}

function ScaleIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}

function ComboIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function RestaurantIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2" />
      <path d="M15 2v18" />
      <path d="M5 2v8a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V2" />
      <path d="M8 2v18" />
    </svg>
  );
}

function InventoryIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function PurchasesIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

function ClothingIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function PharmacyIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M12 5v6" />
      <path d="M9 8h6" />
    </svg>
  );
}

function MaintenanceIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function FactoryIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M17 18h1M12 18h1M7 18h1" />
    </svg>
  );
}

function MaritimeIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.26.94 4.3 2.45 5.82" />
      <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      <path d="M12 2v4" />
    </svg>
  );
}

function ContractingIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h6M9 13h6M9 17h6" />
    </svg>
  );
}

function HrIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DeliveryIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  );
}

function VanSalesIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M1 3h15v13H1V3zm15 5h4l3 3v5h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function StorefrontIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function AccountingIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </svg>
  );
}

function InstallmentsIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  );
}

function FixedAssetsIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9z" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

function TaxIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ImportIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M8 21h8" />
      <rect x="2" y="15" width="20" height="6" rx="2" />
    </svg>
  );
}

function ServicesIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CartMetaIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function CrmIcon({ size = 22, color = '#170e5e', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export const APPS_CATALOG: AppItemDefinition[] = [
  // 1. المبيعات ونقاط البيع
  {
    key: 'crmModuleEnabled',
    title: 'إدارة علاقات العملاء والصفقات (CRM)',
    category: 'pos',
    categoryLabel: 'المبيعات والعملاء',
    shortDesc: 'متابعة مسار الصفقات ومراحل التفاوض والأنشطة والاتصالات وقيمة الصفقات المتوقعة.',
    features: ['مراحل الصفقات كانبان', 'تسجيل المكالمات والاجتماعات', 'حساب احتمالات الإغلاق', 'ربط الصفقات بالعملاء'],
    requiredPlan: 'plan_pro',
    icon: CrmIcon,
    accentColor: '#4f46e5',
    accentBg: '#eef2ff',
    routePath: '/crm',
    featureFlag: 'crm',
  },
  {
    key: 'posModuleEnabled',
    title: 'نقاط البيع السريعة والكاشير (POS)',
    category: 'pos',
    categoryLabel: 'المبيعات والكاشير',
    shortDesc: 'شاشات الفوترة والبيع السريع بالباركود والورديات وإغلاق الخزينة اليومية.',
    features: ['باركود سريع', 'إدارة الورديات', 'طباعة الإيصالات', 'صندوق النقدية'],
    requiredPlan: 'plan_basic',
    icon: PosIcon,
    accentColor: '#170e5e',
    accentBg: '#eef2ff',
    routePath: '/pos',
  },
  {
    key: 'weightedBarcodeEnabled',
    title: 'تشفير باركود الموازين الإلكترونية',
    category: 'pos',
    categoryLabel: 'المبيعات والكاشير',
    shortDesc: 'قراءة باركود الوزن من موازين السوبرماركت واستخراج الوزن والسعر لحظياً.',
    features: ['دعم موازين التجزئة', 'احتساب تلقائي للسعر', 'تسريع الفوترة'],
    requiredPlan: 'plan_basic',
    dependencies: ['posModuleEnabled'],
    icon: ScaleIcon,
    accentColor: '#0369a1',
    accentBg: '#f0f9ff',
  },
  {
    key: 'comboModuleEnabled',
    title: 'الأطقم والعروض المجمعة (Bundles / Combo)',
    category: 'pos',
    categoryLabel: 'المبيعات والكاشير',
    shortDesc: 'تعريف أطقم وباقات تضم عدة أصناف بسعر موحد مع استقطاع مكوناتها من المخزون.',
    features: ['باقات وأطقم ترويجية', 'خصم المخزون المركب', 'تسعير مجمع'],
    requiredPlan: 'plan_pro',
    icon: ComboIcon,
    accentColor: '#7c3aed',
    accentBg: '#faf5ff',
  },
  {
    key: 'posShowCartMeta',
    title: 'تحديد الطاولة والعميل بالسلة',
    category: 'pos',
    categoryLabel: 'المبيعات والكاشير',
    shortDesc: 'إظهار حقول العميل ورقم الطاولة أعلى السلة مباشرة لتسريع طلبات الصالة والضيافة.',
    features: ['أرقام الطاولات', 'ربط فوري بالعميل', 'تسريع الطلبات'],
    requiredPlan: 'plan_ultimate',
    dependencies: ['posModuleEnabled'],
    icon: CartMetaIcon,
    accentColor: '#d97706',
    accentBg: '#fffbeb',
  },
  {
    key: 'restaurantModuleEnabled',
    title: 'المطاعم وشاشات المطبخ (KDS)',
    category: 'pos',
    categoryLabel: 'المبيعات والكاشير',
    shortDesc: 'إدارة الطاولات، صالة وتيك أواي، شاشات المطبخ اللحظية، وتوزيع طلبات الطهاة.',
    features: ['شاشات المطبخ KDS', 'إدارة الطاولات', 'تخصيص الإضافات Modifiers'],
    requiredPlan: 'plan_ultimate',
    dependencies: ['posModuleEnabled'],
    icon: RestaurantIcon,
    accentColor: '#ea580c',
    accentBg: '#fff7ed',
    routePath: '/kds',
    featureFlag: 'restaurant',
  },

  // 2. المخزون وسلاسل الإمداد
  {
    key: 'inventoryModuleEnabled',
    title: 'المخازن والمستودعات المتقدمة',
    category: 'inventory',
    categoryLabel: 'المخازن وسلاسل الإمداد',
    shortDesc: 'التحويلات بين المخازن، أذون الإضافة والصرف، جرد المستودعات، وتتبع الأرصدة.',
    features: ['تعدد المستودعات', 'أذون الصرف والإضافة', 'محاضر الجرد الدوري'],
    requiredPlan: 'plan_pro',
    icon: InventoryIcon,
    accentColor: '#059669',
    accentBg: '#ecfdf5',
    routePath: '/inventory',
    featureFlag: 'inventory',
  },
  {
    key: 'purchasesModuleEnabled',
    title: 'المشتريات وإدارة الموردين',
    category: 'inventory',
    categoryLabel: 'المخازن وسلاسل الإمداد',
    shortDesc: 'أوامر وفواتير الشراء، حسابات الموردين، مرتجع الشراء، وإشعارات الخصم.',
    features: ['أوامر الشراء RFQ', 'كشوف حساب الموردين', 'متابعة الاستحقاقات'],
    requiredPlan: 'plan_pro',
    icon: PurchasesIcon,
    accentColor: '#2563eb',
    accentBg: '#eff6ff',
    routePath: '/purchases',
    featureFlag: 'purchases',
  },
  {
    key: 'clothingModuleEnabled',
    title: 'الأصناف المتغيرة (ألوان ومقاسات)',
    category: 'inventory',
    categoryLabel: 'المخازن وسلاسل الإمداد',
    shortDesc: 'إدارة الأصناف المتغيرة بالمقاسات والألوان مع طباعة ملصقات الباركود التفصيلية.',
    features: ['شبكة الألوان والمقاسات', 'توليد باركود الأصناف', 'جرد الموديلات'],
    requiredPlan: 'plan_ultimate',
    icon: ClothingIcon,
    accentColor: '#4f46e5',
    accentBg: '#eef2ff',
  },
  {
    key: 'enablePharmacyModule',
    title: 'أرقام التشغيلات وتواريخ الصلاحية (FEFO)',
    category: 'inventory',
    categoryLabel: 'المخازن وسلاسل الإمداد',
    shortDesc: 'تتبع الباتشات وتواريخ الانتهاء والصرف الأسبق صلاحية ومنع بيع المنتهي نهائياً.',
    features: ['تتبع أرقام التشغيلات', 'الصرف الأسبق FEFO', 'حماية تواريخ الصلاحية'],
    requiredPlan: 'plan_ultimate',
    icon: PharmacyIcon,
    accentColor: '#0d9488',
    accentBg: '#f0fdfa',
    routePath: '/pharmacy/drugs',
    featureFlag: 'pharmacy',
  },

  // 3. المقاولات وإدارة المشاريع
  {
    key: 'contractingModuleEnabled',
    title: 'المقاولات وإدارة المشاريع الهندسية',
    category: 'contracting',
    categoryLabel: 'المقاولات والمشاريع',
    shortDesc: 'جداول الكميات (BOQ)، مستخلصات المالك والاستشاري، الأوامر التغييرية ومقاولي الباطن.',
    features: ['مستخلصات AIA G702/G703', 'بنك بنود المقايسات', 'الأوامر التغييرية', 'عقود مقاولي الباطن'],
    requiredPlan: 'plan_ultimate',
    icon: ContractingIcon,
    accentColor: '#0f172a',
    accentBg: '#f8fafc',
    routePath: '/contracting',
    featureFlag: 'contracting',
  },

  // 4. الشحن البحري واللوجستيات
  {
    key: 'maritimeFreightModuleEnabled',
    title: 'الشحن واللوجستيات والموانئ',
    category: 'maritime',
    categoryLabel: 'الشحن واللوجستيات',
    shortDesc: 'أتمتة تسعير الخطوط الملاحية، تتبع الحاويات، فترات السماح، وحركات التخليص الجمركي.',
    features: ['مصفوفة تسعير الخطوط', 'تتبع الحاويات وفترة السماح', 'بوالص الشحن والأوامر'],
    requiredPlan: 'plan_ultimate',
    icon: MaritimeIcon,
    accentColor: '#0284c7',
    accentBg: '#f0f9ff',
    routePath: '/maritime-freight',
    featureFlag: 'maritime_freight',
  },

  // 5. التخصصات والعمليات
  {
    key: 'enableMobileStoreFeatures',
    title: 'إدارة الصيانة وتتبع السيريال (IMEI)',
    category: 'specialized',
    categoryLabel: 'العمليات والخدمات',
    shortDesc: 'استلام الأجهزة، كروت الفحص، الضمان، تتبع أرقام السيريال، واستبدال المستعمل.',
    features: ['كروت فحص وتسليم', 'سجل السيريال IMEI', 'إدارة الضمان وقطع الغيار'],
    requiredPlan: 'plan_ultimate',
    icon: MaintenanceIcon,
    accentColor: '#b45309',
    accentBg: '#fef3c7',
    routePath: '/maintenance',
    featureFlag: 'maintenance',
  },
  {
    key: 'manufacturingModuleEnabled',
    title: 'التصنيع وقوائم المواد (BOM)',
    category: 'specialized',
    categoryLabel: 'العمليات والخدمات',
    shortDesc: 'تحديد شجرة المنتج، استهلاك المواد الخام، أوامر التشغيل، وحساب تكلفة الإنتاج.',
    features: ['شجرة المنتج BOM', 'أوامر التشغيل وتكلفة التصنيع', 'الاستهلاك الآلي للمواد'],
    requiredPlan: 'plan_ultimate',
    icon: FactoryIcon,
    accentColor: '#4338ca',
    accentBg: '#e0e7ff',
    routePath: '/manufacturing/work-orders',
    featureFlag: 'manufacturing',
  },
  {
    key: 'servicesModuleEnabled',
    title: 'خدمات الصيانة والمصنعيات السريعة',
    category: 'specialized',
    categoryLabel: 'العمليات والخدمات',
    shortDesc: 'إصدار فواتير الخدمات السريعة والمصنعيات وحساب عمولات الفنيين والعمالة.',
    features: ['فواتير الخدمات والمصنعيات', 'عمولات الفنيين', 'أجور العمل المباشر'],
    requiredPlan: 'plan_pro',
    icon: ServicesIcon,
    accentColor: '#6366f1',
    accentBg: '#eef2ff',
    routePath: '/services',
  },
  {
    key: 'importModuleEnabled',
    title: 'الاستيراد والشحن الدولي والحاويات',
    category: 'specialized',
    categoryLabel: 'العمليات والخدمات',
    shortDesc: 'تتبع الشحنات الدولية، احتساب مصاريف الشحن والجمارك، وتوزيع الأرباح على الشركاء.',
    features: ['توزيع تكاليف الاستيراد', 'حساب أرباح الحاويات', 'إدارة اعتمادات الموردين'],
    requiredPlan: 'plan_ultimate',
    icon: ImportIcon,
    accentColor: '#0f766e',
    accentBg: '#f0fdfa',
    routePath: '/import/shipments',
    featureFlag: 'import',
  },
  {
    key: 'hrModuleEnabled',
    title: 'الموارد البشرية والرواتب (HR)',
    category: 'specialized',
    categoryLabel: 'العمليات والخدمات',
    shortDesc: 'مسير الرواتب، تسجيل الحضور والانصراف، السلف، الإجازات، وتصفية نهاية الخدمة.',
    features: ['مسير الرواتب الشهري', 'تسجيل الحضور والبصمة', 'السلف والإجازات'],
    requiredPlan: 'plan_ultimate',
    icon: HrIcon,
    accentColor: '#be185d',
    accentBg: '#fdf2f8',
    routePath: '/hr',
    featureFlag: 'hr',
  },

  // 6. المالية والمحاسبة والمؤسسات
  {
    key: 'enableEnterpriseFeatures',
    title: 'المحاسبة المتقدمة وشجرة الحسابات',
    category: 'finance',
    categoryLabel: 'المالية والمحاسبة',
    shortDesc: 'دليل الحسابات الشجري، قيود اليومية، ميزان المراجعة، وقائمة الأرباح والخسائر.',
    features: ['شجرة حسابات معتمدة', 'قيود يومية مزدوجة', 'القوائم المالية والختامية'],
    requiredPlan: 'plan_ultimate',
    icon: AccountingIcon,
    accentColor: '#170e5e',
    accentBg: '#eef2ff',
    routePath: '/accounting/accounts',
    featureFlag: 'accounting',
  },
  {
    key: 'installmentsModuleEnabled',
    title: 'مبيعات وجدولة التقسيط وإدارة الديون',
    category: 'finance',
    categoryLabel: 'المالية والمحاسبة',
    shortDesc: 'جدولة أقساط العملاء، احتساب الفوائد، غرامات التأخير، وتنبيهات التحصيل الدورية.',
    features: ['جداول الأقساط الشهرية', 'حساب الفوائد والمقدم', 'سجل سداد الأقساط'],
    requiredPlan: 'plan_ultimate',
    icon: InstallmentsIcon,
    accentColor: '#15803d',
    accentBg: '#f0fdf4',
    routePath: '/installments',
    featureFlag: 'installments',
  },
  {
    key: 'fixedAssetsModuleEnabled',
    title: 'الأصول الثابتة وإهلاك المعدات',
    category: 'finance',
    categoryLabel: 'المالية والمحاسبة',
    shortDesc: 'سجل الأصول، جداول الإهلاك الآلي، القيمة الدفترية، وقيود الإهلاك الدورية.',
    features: ['سجل الأصول والعدد', 'حساب الإهلاك الآلي', 'الربط بشجرة الحسابات'],
    requiredPlan: 'plan_ultimate',
    icon: FixedAssetsIcon,
    accentColor: '#334155',
    accentBg: '#f1f5f9',
    routePath: '/accounting/fixed-assets',
    featureFlag: 'fixed_assets',
  },
  {
    key: 'taxDeclarationModuleEnabled',
    title: 'الإقرار الضريبي والفاتورة الإلكترونية',
    category: 'finance',
    categoryLabel: 'المالية والمحاسبة',
    shortDesc: 'تجميع إقرارات ضريبة القيمة المضافة (VAT) والربط مع منظومة الفاتورة الإلكترونية.',
    features: ['نموذج الإقرار الضريبي', 'تجهيز الفاتورة الإلكترونية', 'مطابقة الحركات'],
    requiredPlan: 'plan_ultimate',
    icon: TaxIcon,
    accentColor: '#b91c1c',
    accentBg: '#fef2f2',
    routePath: '/vat-declaration',
    featureFlag: 'vat_declaration',
  },

  // 7. اللوجستيات والتجارة السحابية
  {
    key: 'deliveryRepsModuleEnabled',
    title: 'إدارة مناديب التوصيل والدليفري',
    category: 'logistics',
    categoryLabel: 'اللوجستيات والتجارة السحابية',
    shortDesc: 'إسناد الطلبات للكباتن، تتبع الشحنات، تصفية العهد النقدية، وبوابة السائق PWA.',
    features: ['بوابة السائقين PWA', 'إسناد الطلبات للكباتن', 'تصفية العهد النقدية'],
    requiredPlan: 'plan_ultimate',
    icon: DeliveryIcon,
    accentColor: '#ca8a04',
    accentBg: '#fefce8',
    routePath: '/delivery-reps',
    featureFlag: 'deliveryReps',
  },
  {
    key: 'vanSalesModuleEnabled',
    title: 'مبيعات وتوزيع الفان (الأسطول الميداني)',
    category: 'logistics',
    categoryLabel: 'اللوجستيات والتجارة السحابية',
    shortDesc: 'مخازن السيارات المتنقلة، أذونات التحميل والتفريغ، البيع الميداني، وجرد الفان.',
    features: ['مخازن السيارات المتنقلة', 'أذونات التحميل والتفريغ', 'البيع المباشر وجرد الفان'],
    requiredPlan: 'plan_ultimate',
    icon: VanSalesIcon,
    accentColor: '#0369a1',
    accentBg: '#f0f9ff',
    routePath: '/inventory/van-sales',
    featureFlag: 'deliveryReps',
  },
  {
    key: 'storefrontModuleEnabled',
    title: 'المتجر الإلكتروني السحابي وبوابات الدفع',
    category: 'logistics',
    categoryLabel: 'اللوجستيات والتجارة السحابية',
    shortDesc: 'كتالوج بيع رقمي متكامل لزبائنك مع بوابات الدفع الإلكتروني وربط شركات الشحن.',
    features: ['متجر PWA سحابي', 'بوابات الدفع الرقمية', 'ربط منصات أمازون ونون'],
    requiredPlan: 'plan_omnichannel',
    icon: StorefrontIcon,
    accentColor: '#059669',
    accentBg: '#ecfdf5',
    routePath: '/settings/storefront',
    featureFlag: 'storefront',
  },
];
