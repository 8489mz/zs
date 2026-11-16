import { useAuthStore } from '@/stores/auth-store';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import i18n from '@/lib/i18n';

export interface CustomerTypeOption {
  value: 'cash' | 'vip' | 'credit' | 'wholesale' | 'half_wholesale';
  label: string;
  badgeLabel: string;
  badgeStyle: {
    bg: string;
    color: string;
  };
}

export interface CustomerProfile {
  id: 'maritime' | 'contracting' | 'general' | 'distribution';
  pageTitle: string;
  pageDescription: string;
  badgeUnit: string;
  addBtnText: string;
  modalAddTitle: string;
  modalAddSubtitle: string;
  modalEditSubtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  addressLabel: string;
  addressPlaceholder: string;
  typeLabel: string;
  types: CustomerTypeOption[];
  balanceLabel: string;
  balanceHint: string;
  creditLimitLabel: string;
  creditLimitHint: string;
  submitCreateText: string;
  submitEditText: string;
  showLoyalty: boolean;
  showMarketingCampaign: boolean;
}

export const MARITIME_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'maritime',
  pageTitle: 'سجل العملاء والمستوردين / الشاحنين',
  pageDescription: 'إدارة حسابات الشاحنين، المستوردين والمصدرين، وتسهيلات وسقوف ائتمان النولون مع إمكانية التعديل السريع.',
  badgeUnit: 'جهة شحن / عميل',
  addBtnText: '+ إضافة شاحن / مستورد جديد',
  modalAddTitle: 'تسجيل عميل / شاحن أو مستورد جديد',
  modalAddSubtitle: 'تسجيل بيانات الشاحن أو المستورد، ممثل التنسيق، وتسهيلات ائتمان النولون البحري والجوي.',
  modalEditSubtitle: 'تحديث بيانات الشاحن أو المستورد، سقف التسهيلات الائتمانية والبيانات الرسمية.',
  nameLabel: 'اسم العميل / المستورد أو الشاحن *',
  namePlaceholder: 'مثال: شركة النيل للاستيراد والتصدير / م. أحمد سالم',
  phoneLabel: 'هاتف مسؤول الشحن والتنسيق',
  phonePlaceholder: 'مثال: 010xxxxxxxx أو +2010xxxxxxxx',
  addressLabel: 'العنوان والمقر الرئيسي / الميناء التابع',
  addressPlaceholder: 'المدينة، المنطقة الصناعية، أو بالقرب من ميناء...',
  typeLabel: 'نوع وتصنيف حساب الشحن',
  types: [
    { value: 'cash', label: 'مستورد / شاحن نقدي (سداد مسبق مع كل بوليصة)', badgeLabel: 'مستورد نقدي', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'عميل استراتيجي VIP (أولوية حجز وتفريغ وخصومات نولون)', badgeLabel: 'VIP استراتيجي', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'شاحن تعاقدي آجل (سحب بوالص على الحساب مع فترات سماح)', badgeLabel: 'تعاقدي آجل', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'وكيل شحن / مجمع بضائع (Forwarder / Co-Loader)', badgeLabel: 'وكيل شحن / مجمع', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'نصف جملة (سعر نصف الجملة)', badgeLabel: 'نصف جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'الرصيد الافتتاحي للنولون',
  balanceHint: 'المبلغ المستحق على الشاحن/المستورد في بداية التسجيل (إن وجد)',
  creditLimitLabel: 'سقف التسهيل الائتماني للنولون',
  creditLimitHint: 'أقصى سقف مالي مسموح به لشحن الحاويات والبوالص آجلاً (0 = نقدي فقط)',
  submitCreateText: 'حفظ وتسجيل الشاحن',
  submitEditText: 'حفظ تعديلات الشاحن',
  showLoyalty: false,
  showMarketingCampaign: true,
};

export const CONTRACTING_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'contracting',
  pageTitle: 'سجل العملاء وجهات الإسناد',
  pageDescription: 'إدارة بيانات ملاك المشاريع، جهات الإسناد الحكومية والخاصة، والمطورين العقاريين وحدود مستخلصاتهم.',
  badgeUnit: 'جهة إسناد / مالك',
  addBtnText: '+ جهة إسناد / مالك جديد',
  modalAddTitle: 'تسجيل جهة إسناد أو مالك مشروع جديد',
  modalAddSubtitle: 'تسجيل بيانات المالك أو جهة التعاقد، ممثل المشروع، وتسهيلات المستخلصات.',
  modalEditSubtitle: 'تحديث بيانات جهة الإسناد وسقوف تمويل المستخلصات والمشاريع.',
  nameLabel: 'اسم جهة الإسناد / المالك *',
  namePlaceholder: 'مثال: هيئة المجتمعات العمرانية / شركة إعمار للتطوير',
  phoneLabel: 'هاتف ممثل المالك / إدارة المشاريع',
  phonePlaceholder: 'مثال: 010xxxxxxxx',
  addressLabel: 'المقر الإداري / عنوان الإدارة الهندسية',
  addressPlaceholder: 'المدينة، الحي، رقم المبنى...',
  typeLabel: 'تصنيف جهة الإسناد والتعاقد',
  types: [
    { value: 'cash', label: 'مالك مشروع / قطاع خاص (دفعات نقدية فورية مع المستخلص)', badgeLabel: 'قطاع خاص / مباشر', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'مطور عقاري استراتيجي VIP (مشاريع كبرى وعقود حصرية)', badgeLabel: 'مطور استراتيجي VIP', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'جهة إسناد حكومية / تعاقد آجل (مستخلصات حكومية مع فترة صرف)', badgeLabel: 'جهة حكومية / تعاقدي', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'مقاول رئيسي (أعمال مقاولات باطن / كونسورتيوم)', badgeLabel: 'مقاول رئيسي / باطن', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'نصف جملة (سعر نصف الجملة)', badgeLabel: 'نصف جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'الرصيد الافتتاحي للتعاقدات',
  balanceHint: 'المستحقات السابقة على جهة الإسناد إن وجدت قبل بدء التسجيل',
  creditLimitLabel: 'سقف التسهيل الائتماني والتمويل',
  creditLimitHint: 'الحد الأقصى لتمويل وتنفيذ مستخلصات المشروع دون تحصيل (0 = دفعات مسبقة)',
  submitCreateText: 'حفظ جهة الإسناد',
  submitEditText: 'حفظ بيانات جهة الإسناد',
  showLoyalty: false,
  showMarketingCampaign: false,
};

export const DISTRIBUTION_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'distribution',
  pageTitle: 'سجل العملاء والمحلات ومنافذ التوزيع',
  pageDescription: 'إدارة منافذ التوزيع، البقالات ومحلات الجملة والتجزئة، خطوط السير، أكواد العملاء، والمواقع الجغرافية وسقوف المديونية.',
  badgeUnit: 'منفذ توزيع / محل',
  addBtnText: '+ محل / منفذ توزيع جديد',
  modalAddTitle: 'تسجيل منفذ توزيع أو محل جديد',
  modalAddSubtitle: 'تسجيل بيانات المحل، العنوان وخط السير، كود العميل، وسقف المديونية للمندوب.',
  modalEditSubtitle: 'تحديث بيانات المحل أو ضبط سقف المديونية وخط السير.',
  nameLabel: 'اسم المحل / المنفذ التجاري *',
  namePlaceholder: 'مثال: سوبرماركت الأمانة / بقالة البركة',
  phoneLabel: 'هاتف صاحب المحل أو المستلم',
  phonePlaceholder: 'مثال: 010xxxxxxxx',
  addressLabel: 'العنوان وخط السير والمنطقة',
  addressPlaceholder: 'الشارع، الحي، خط سير التوزيع...',
  typeLabel: 'نوع وتصنيف منفذ التوزيع',
  types: [
    { value: 'wholesale', label: 'محل جملة / نصف جملة (أسعار جملة خاصة)', badgeLabel: 'جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'نصف جملة (سعر نصف الجملة)', badgeLabel: 'نصف جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'credit', label: 'منفذ توزيع آجل (سداد مع دورة التوزيع القادمة)', badgeLabel: 'آجل / دورة', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'cash', label: 'محل قطاعي / سداد نقدي فوري مع التسليم', badgeLabel: 'نقدي فوري', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'منفذ استراتيجي كبار العملاء (VIP)', badgeLabel: 'VIP استراتيجي', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
  ],
  balanceLabel: 'الرصيد الافتتاحي للمحل',
  balanceHint: 'مديونية المحل السابقة إن وجدت قبل بدء خطوط التوزيع',
  creditLimitLabel: 'سقف مديونية المحل (Credit Limit)',
  creditLimitHint: 'الحد الأقصى للمديونية قبل منع المندوب من تفريغ فواتير جديدة للمحل (0 = نقدي فقط)',
  submitCreateText: 'حفظ منفذ التوزيع',
  submitEditText: 'حفظ تعديلات المحل',
  showLoyalty: false,
  showMarketingCampaign: true,
};

export const GENERAL_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'general',
  pageTitle: 'العملاء',
  pageDescription: 'إدارة سجل العملاء، الأرصدة والحدود الائتمانية مع إمكانية البحث والإضافة السريعة.',
  badgeUnit: 'عميل',
  addBtnText: '+ عميل جديد',
  modalAddTitle: 'إضافة عميل جديد',
  modalAddSubtitle: 'تسجيل بيانات العميل وتفاصيل الحساب وحد الائتمان في النظام.',
  modalEditSubtitle: 'تحديث بيانات العميل أو ضبط الرصيد وحد الائتمان.',
  nameLabel: 'اسم العميل *',
  namePlaceholder: 'مثال: شركة الأمل / أحمد محمود',
  phoneLabel: 'رقم الهاتف',
  phonePlaceholder: 'مثال: 010xxxxxxxx',
  addressLabel: 'العنوان / المنطقة',
  addressPlaceholder: 'المدينة، الحي، اسم الشارع...',
  typeLabel: 'نوع وتصنيف العميل',
  types: [
    { value: 'cash', label: 'عميل عادي / تجزئة (افتراضي)', badgeLabel: 'عادي', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'عميل مميز (VIP) - خصومات خاصة', badgeLabel: 'VIP مميز', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'عميل آجل (سحب على الحساب)', badgeLabel: 'آجل', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'عميل جملة (أسعار جملة)', badgeLabel: 'جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'نصف جملة (سعر نصف الجملة)', badgeLabel: 'نصف جملة', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'الرصيد الافتتاحي',
  balanceHint: 'المبلغ المستحق على العميل عند بداية التسجيل (إن وجد)',
  creditLimitLabel: 'حد الائتمان',
  creditLimitHint: 'أقصى مبلغ مسموح بالسحب الآجل (0 = نقدي فقط)',
  submitCreateText: 'حفظ العميل',
  submitEditText: 'حفظ التعديل',
  showLoyalty: true,
  showMarketingCampaign: true,
};


export const EN_DISTRIBUTION_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'distribution',
  pageTitle: 'Customers & Retail Outlets Directory',
  pageDescription: 'Manage distribution outlets, grocery and wholesale stores, delivery routes, customer codes, locations and credit limits.',
  badgeUnit: 'Outlets / Stores',
  addBtnText: '+ New Store / Outlet',
  modalAddTitle: 'Register New Outlet or Store',
  modalAddSubtitle: 'Enter store details, address, delivery route, customer code, and driver credit limit.',
  modalEditSubtitle: 'Update store details, credit limit, or delivery route.',
  nameLabel: 'Store / Commercial Name *',
  namePlaceholder: 'e.g. Al-Amana Supermarket',
  phoneLabel: 'Owner / Receiver Phone',
  phonePlaceholder: 'e.g. 010xxxxxxxx or +9665xxxxxxxx',
  addressLabel: 'Address, Route & Area',
  addressPlaceholder: 'Street, District, Route...',
  typeLabel: 'Outlet Type & Classification',
  types: [
    { value: 'wholesale', label: 'Wholesale / Semi-wholesale (Special wholesale rates)', badgeLabel: 'Wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'Half-wholesale (half-wholesale price)', badgeLabel: 'Half-wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'credit', label: 'Credit Outlet (Settlement with next cycle)', badgeLabel: 'Credit / Cycle', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'cash', label: 'Retail Outlet / Immediate cash on delivery', badgeLabel: 'Cash', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'Strategic Key Account (VIP)', badgeLabel: 'VIP Strategic', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
  ],
  balanceLabel: 'Opening Balance',
  balanceHint: 'Prior store debt before starting distribution routes',
  creditLimitLabel: 'Credit Limit',
  creditLimitHint: 'Maximum allowable balance before blocking new delivery orders (0 = cash only)',
  submitCreateText: 'Save Outlet',
  submitEditText: 'Save Changes',
  showLoyalty: false,
  showMarketingCampaign: true,
};

export const EN_CONTRACTING_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'contracting',
  pageTitle: 'Clients & Project Owners Directory',
  pageDescription: 'Manage project owners, developers, government assigning authorities, and contracting credit lines.',
  badgeUnit: 'Clients / Owners',
  addBtnText: '+ New Owner / Client',
  modalAddTitle: 'Register New Client or Owner',
  modalAddSubtitle: 'Register project owner or developer details, coordinator, and contractual facilities.',
  modalEditSubtitle: 'Update client details, contractual facilities, and corporate data.',
  nameLabel: 'Client / Developer Name *',
  namePlaceholder: 'e.g. Emaar Development / Eng. Ahmed',
  phoneLabel: 'Project Coordinator Phone',
  phonePlaceholder: 'e.g. 010xxxxxxxx or +9665xxxxxxxx',
  addressLabel: 'Headquarters / Main Project Site',
  addressPlaceholder: 'City, District, Site address...',
  typeLabel: 'Contractual Account Classification',
  types: [
    { value: 'cash', label: 'Private Sector Owner (Direct progress payments)', badgeLabel: 'Private / Direct', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'Strategic Developer VIP (Major projects & exclusive contracts)', badgeLabel: 'Strategic Developer', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'Government Authority / Deferred Contract (Progress certificates)', badgeLabel: 'Government / Contractual', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'Main Contractor (Subcontracting / Consortium)', badgeLabel: 'Main Contractor', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'Half-wholesale (half-wholesale price)', badgeLabel: 'Half-wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'Opening Contractual Balance',
  balanceHint: 'Prior receivables from this client (if any)',
  creditLimitLabel: 'Credit & Financing Limit',
  creditLimitHint: 'Maximum certificate funding without collection (0 = advance payments only)',
  submitCreateText: 'Save Client',
  submitEditText: 'Save Changes',
  showLoyalty: false,
  showMarketingCampaign: false,
};

export const EN_MARITIME_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'maritime',
  pageTitle: 'Shippers & Importers Directory',
  pageDescription: 'Manage shippers, importers, exporters, and freight credit facilities with quick editing.',
  badgeUnit: 'Shippers / Clients',
  addBtnText: '+ New Shipper / Importer',
  modalAddTitle: 'Register New Shipper or Importer',
  modalAddSubtitle: 'Register shipper or importer details, coordinator, and freight credit facilities.',
  modalEditSubtitle: 'Update shipper details, credit facilities, and official data.',
  nameLabel: 'Shipper / Importer Name *',
  namePlaceholder: 'e.g. Nile Import & Export Co.',
  phoneLabel: 'Shipping Coordinator Phone',
  phonePlaceholder: 'e.g. 010xxxxxxxx or +9665xxxxxxxx',
  addressLabel: 'Headquarters / Port Location',
  addressPlaceholder: 'City, Industrial Zone, or Port...',
  typeLabel: 'Freight Account Classification',
  types: [
    { value: 'cash', label: 'Cash Shipper (Advance payment per B/L)', badgeLabel: 'Cash Shipper', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'Strategic VIP Client (Priority booking & freight discounts)', badgeLabel: 'Strategic VIP', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'Credit Account (Monthly freight invoicing)', badgeLabel: 'Credit Shipper', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'Forwarder / Partner Agency', badgeLabel: 'Forwarder Agency', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'Half-wholesale (half-wholesale price)', badgeLabel: 'Half-wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'Opening Freight Balance',
  balanceHint: 'Prior shipper balance before system registration',
  creditLimitLabel: 'Freight Credit Facility Limit',
  creditLimitHint: 'Maximum allowable credit limit for freight orders (0 = cash only)',
  submitCreateText: 'Save Shipper',
  submitEditText: 'Save Changes',
  showLoyalty: false,
  showMarketingCampaign: false,
};

export const EN_GENERAL_CUSTOMER_PROFILE: CustomerProfile = {
  id: 'general',
  pageTitle: 'Customers',
  pageDescription: 'Manage customers directory, statements, balances, and credit limits.',
  badgeUnit: 'Customers',
  addBtnText: '+ New Customer',
  modalAddTitle: 'Add New Customer',
  modalAddSubtitle: 'Register customer account, contact information, and credit limit.',
  modalEditSubtitle: 'Update customer details, balance, or credit limit.',
  nameLabel: 'Customer Name *',
  namePlaceholder: 'e.g. Acme Corp / John Doe',
  phoneLabel: 'Phone Number',
  phonePlaceholder: 'e.g. +1234567890',
  addressLabel: 'Address / Area',
  addressPlaceholder: 'City, District, Street...',
  typeLabel: 'Customer Type',
  types: [
    { value: 'cash', label: 'Retail / Regular (Default)', badgeLabel: 'Retail', badgeStyle: { bg: '#f1f5f9', color: '#475569' } },
    { value: 'vip', label: 'VIP Customer - Special Discounts', badgeLabel: 'VIP', badgeStyle: { bg: '#fef3c7', color: '#92400e' } },
    { value: 'credit', label: 'Credit Account (On Account)', badgeLabel: 'Credit', badgeStyle: { bg: '#e0f2fe', color: '#0369a1' } },
    { value: 'wholesale', label: 'Wholesale Customer', badgeLabel: 'Wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
    { value: 'half_wholesale', label: 'Half-wholesale (half-wholesale price)', badgeLabel: 'Half-wholesale', badgeStyle: { bg: '#dcfce7', color: '#166534' } },
  ],
  balanceLabel: 'Opening Balance',
  balanceHint: 'Outstanding debt at the start of registration (if any)',
  creditLimitLabel: 'Credit Limit',
  creditLimitHint: 'Maximum allowable credit balance (0 = cash only)',
  submitCreateText: 'Save Customer',
  submitEditText: 'Save Changes',
  showLoyalty: true,
  showMarketingCampaign: true,
};

export function getCustomerProfileByRaw(rawActivity: string, pathname: string): CustomerProfile {
  const normActivity = (rawActivity || '').toLowerCase();
  const normPath = (pathname || '').toLowerCase();

  const isDistribution =
    normPath.includes('/van-sales') ||
    normPath.includes('/fleet') ||
    normActivity === 'wholesale_van' ||
    normActivity === 'wholesale' ||
    normActivity === 'distribution' ||
    normActivity === 'توزيع' ||
    normActivity === 'فان' ||
    normActivity === 'مناديب' ||
    normActivity === 'جملة' ||
    normActivity.includes('توزيع') ||
    normActivity.includes('فان') ||
    normActivity.includes('مناديب') ||
    normActivity.includes('جملة') ||
    normActivity.includes('wholesale') ||
    normActivity.includes('distribution');

  if (isDistribution) return DISTRIBUTION_CUSTOMER_PROFILE;

  const isMaritime =
    normPath.includes('/maritime') ||
    normPath.includes('/freight') ||
    normPath.includes('/shipping') ||
    normActivity === 'maritime_freight' ||
    normActivity === 'maritime' ||
    normActivity === 'freight' ||
    normActivity === 'shipping' ||
    normActivity === 'شحن';

  if (isMaritime) return MARITIME_CUSTOMER_PROFILE;

  const isContracting =
    normPath.includes('/contracting') ||
    normPath.includes('/construction') ||
    normActivity === 'contracting' ||
    normActivity === 'construction' ||
    normActivity === 'مقاولات';

  if (isContracting) return CONTRACTING_CUSTOMER_PROFILE;

  return GENERAL_CUSTOMER_PROFILE;
}

export function useCustomerProfile(): CustomerProfile {
  const tenant = useAuthStore((s) => s.tenant);
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data;

  const rawActivity = String(
    tenant?.activityType || tenant?.pillar || settings?.activityType || settings?.businessIndustry || ''
  ).trim();

  let pathname = '';
  try {
    pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  } catch {
    pathname = '';
  }

  const base = getCustomerProfileByRaw(rawActivity, pathname);
  const isEn = i18n.language?.startsWith('en');
  if (isEn) {
    if (base.id === 'distribution') return EN_DISTRIBUTION_CUSTOMER_PROFILE;
    if (base.id === 'contracting') return EN_CONTRACTING_CUSTOMER_PROFILE;
    if (base.id === 'maritime') return EN_MARITIME_CUSTOMER_PROFILE;
    return EN_GENERAL_CUSTOMER_PROFILE;
  }
  return base;
}
