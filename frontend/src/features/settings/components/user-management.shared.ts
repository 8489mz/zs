import type { ManagedUserRecord } from '@/features/settings/api/settings.api';
import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';

export const DEFAULT_ADMIN_PERMS = [
  'dashboard','products','sales','kitchen','purchases','inventory','suppliers','customers','crm','accounts','accounting','returns','reports','audit','treasury','services','hr','hrEmployees','hrAttendance','hrContracts','hrLoans','hrPayrollView','hrPayrollManage','hrPayrollApprove','hrSalaryView','hrSalaryManage','settings','pricingCenterView','pricingCenterManage','canEditUsers','canManageUsers','canManageSettings','canManageBackups','canPrint','canDiscount','canEditPrice','canSellWholesale','canViewProfit','canDelete','canEditInvoices','canDirectReturn','canAdjustInventory','canManageBranchStock','cashDrawer','deliveryReps',
  'maritimeJobs','maritimeContainers','maritimeInquiries','maritimeQuotations','maritimeRfqs','maritimePolicies',
  'contractingProjects','contractingInvoices','contractingBoq','contractingDailyLogs','contractingChangeOrders','contractingSubcontractors'
];
export const MARITIME_PERMISSIONS = [
  'maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'maritimePolicies',
];
export const CONTRACTING_PERMISSIONS = [
  'contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors',
];
/* INV-USER-GRANT-NAMES-PERMISSION: DEFAULT_ADMIN_PERMS is 57 keys =
 * the 45 retail keys the activation owner actually holds
 * (backend/src/core/auth/constants/super-admin-permissions.ts) PLUS
 * the 12 maritime/contracting keys above. A retail/clothes tenant
 * has no maritime or contracting in it at all, so its owner template
 * must never carry those 12: the form never shows them
 * (getFilteredPermissionGroups shows only the tenant's vertical),
 * the user can never untick them, and the grant guard
 * (INV-USER-GRANT-SUBSET) refuses the whole save because the actor
 * does not hold them. The retail template is therefore the admin
 * list minus the two verticals; a vertical tenant adds back only
 * its own 6 keys. */
export const DEFAULT_RETAIL_ADMIN_PERMS = DEFAULT_ADMIN_PERMS.filter(
  (permission) => !MARITIME_PERMISSIONS.includes(permission) && !CONTRACTING_PERMISSIONS.includes(permission),
);
export function getAdminTemplatePermissions(vertical?: string): string[] {
  if (vertical === 'maritime') return [...DEFAULT_RETAIL_ADMIN_PERMS, ...MARITIME_PERMISSIONS];
  if (vertical === 'contracting') return [...DEFAULT_RETAIL_ADMIN_PERMS, ...CONTRACTING_PERMISSIONS];
  return [...DEFAULT_RETAIL_ADMIN_PERMS];
}
export const DEFAULT_OPERATOR_PERMS = [
  'dashboard','products','sales','kitchen','purchases','inventory','suppliers','customers','crm','accounts','accounting','returns','reports','treasury','services','hr','hrEmployees','hrAttendance','hrContracts','hrLoans','hrPayrollView','hrPayrollManage','settings','pricingCenterView','pricingCenterManage','cashDrawer','deliveryReps','canPrint','canDiscount','canEditPrice','canSellWholesale','canViewProfit','canEditInvoices','canDirectReturn','canAdjustInventory','canManageBranchStock','canManageSettings'
];
export const DEFAULT_CASHIER_PERMS = [
  'sales', 'kitchen', 'cashDrawer', 'customers', 'suppliers', 'accounts', 'purchases', 'products', 'returns', 'deliveryReps', 'hr', 'hrAttendance', 'canPrint', 'services', 'treasury'
];

export const DEFAULT_MARITIME_OPS_PERMS = [
  'dashboard', 'maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'customers', 'suppliers', 'accounts', 'reports', 'canPrint'
];

export const DEFAULT_CONTRACTING_OPS_PERMS = [
  'dashboard', 'contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors', 'suppliers', 'accounts', 'reports', 'canPrint'
];

export const PERMISSION_LABELS: Record<string, string> = {
  dashboard: 'الشاشة الرئيسية',
  sales: 'سجل الفواتير',
  // R4-E I18: kitchen (KDS) mutations require this permission.
  kitchen: 'شاشة المطبخ (KDS)',
  customers: 'العملاء',
  crm: 'إدارة علاقات العملاء والصفقات (CRM)',
  cashDrawer: 'وردية الكاشير',
  products: 'الأصناف',
  inventory: 'المخزون',
  purchases: 'المشتريات',
  returns: 'المرتجعات',
  suppliers: 'الموردون',
  // الاسمان يتشابهان والصلاحيتان لا تتشابهان، وقد كلّف ذلك ثغرة: `accounts` شاشة كشوف حسابات
  // العملاء والموردين وسنداتهم — يحتاجها الكاشير — و`accounting` دفاتر المنشأة نفسها. كان
  // المعروض «الحسابات» و«المحاسبة»، فمنحها المالك للكاشير ظنّاً أنها حسابات الشركاء.
  accounts: 'حسابات العملاء والموردين (كشوف وسندات)',
  accounting: 'دفاتر المنشأة المالية (ميزانية وقيود وتدفقات)',
  reports: 'التقارير',
  pricingCenterView: 'عرض مركز التسعير',
  pricingCenterManage: 'إدارة مركز التسعير',
  canPrint: 'الطباعة',
  canDiscount: 'تعديل الخصم',
  canEditPrice: 'تعديل السعر',
  canSellWholesale: 'البيع بسعر الجملة',
  canEditInvoices: 'تعديل الفواتير',
  canDirectReturn: 'المرتجع المباشر بدون باسورد المشرف',
  canAdjustInventory: 'تعديل رصيد المخزون',
  canManageBranchStock: 'إدارة مخزون الفروع',
  settings: 'الإعدادات',
  canManageSettings: 'إدارة الإعدادات',
  canEditUsers: 'تعديل المستخدمين',
  canManageUsers: 'إدارة المستخدمين',
  canManageBackups: 'النسخ الاحتياطي والاسترداد',
  canViewProfit: 'عرض الأرباح',
  audit: 'سجل المراجعة',
  treasury: 'الخزينة',
  services: 'الخدمات',
  hr: 'الموارد البشرية',
  hrEmployees: 'ملفات الموظفين',
  hrAttendance: 'التحضير والانصراف',
  hrContracts: 'العقود',
  hrLoans: 'السلف والقروض',
  hrPayrollView: 'عرض مسير الرواتب',
  hrPayrollManage: 'إدارة مسير الرواتب',
  hrPayrollApprove: 'اعتماد مسير الرواتب',
  hrSalaryView: 'عرض بيانات الراتب',
  hrSalaryManage: 'إدارة بيانات الراتب',
  canDelete: 'الحذف',
  deliveryReps: 'إدارة المناديب',

  // Maritime Freight
  maritimeJobs: 'أوامر تشغيل الشحن (Jobs)',
  maritimeContainers: 'تتبع وإدارة الحاويات',
  maritimeInquiries: 'استفسارات الشحن',
  maritimeQuotations: 'عروض أسعار النولون',
  maritimeRfqs: 'مقارنة أسعار الخطوط (RFQ)',
  maritimePolicies: 'سياسات الشحن والخطوط',

  // Contracting & Construction
  contractingProjects: 'المشاريع الإنشائية',
  contractingInvoices: 'المستخلصات الجارية والختامية (IPC)',
  contractingBoq: 'المقايسات وجداول الكميات (BOQ)',
  contractingDailyLogs: 'يوميات وتقارير الموقع',
  contractingChangeOrders: 'أوامر التغيير والمطالبات',
  contractingSubcontractors: 'مقاولو الباطن',
};

export function getPermissionLabel(permission: string, vertical?: string) {
  if (vertical === 'maritime') {
    if (permission === 'canPrint') return 'طباعة بوالص الشحن والفواتير';
    if (permission === 'canEditInvoices') return 'تعديل فواتير ومطالبات الشحن';
    if (permission === 'suppliers') return 'الخطوط الملاحية والناقلون';
    if (permission === 'accounts') return 'كشوف حسابات العملاء والخطوط';
  }
  if (vertical === 'contracting') {
    if (permission === 'canPrint') return 'طباعة المستخلصات والمقايسات';
    if (permission === 'canEditInvoices') return 'تعديل المستخلصات والمطالبات';
    if (permission === 'suppliers') return 'موردو المواد والمعدات';
    if (permission === 'accounts') return 'كشوف حسابات الموردين ومقاولي الباطن';
  }
  return PERMISSION_LABELS[permission] || permission;
}

export const PERMISSION_FEATURE_MAP: Record<string, string> = {
  // Catalog / Products
  products: 'catalog',
  pricingCenterView: 'catalog',
  pricingCenterManage: 'catalog',

  // Sales & POS
  sales: 'sales',
  // R4-E I18: the kitchen permission is shown when the restaurant feature is on.
  kitchen: 'restaurant',
  crm: 'sales',
  returns: 'sales',
  canPrint: 'sales',
  canDiscount: 'sales',
  canEditPrice: 'sales',
  canSellWholesale: 'sales',
  canEditInvoices: 'sales',
  canDirectReturn: 'sales',

  // Maritime Freight
  maritimeJobs: 'maritime',
  maritimeContainers: 'maritime',
  maritimeInquiries: 'maritime',
  maritimeQuotations: 'maritime',
  maritimeRfqs: 'maritime',
  maritimePolicies: 'maritime',

  // Contracting & Construction
  contractingProjects: 'contracting',
  contractingInvoices: 'contracting',
  contractingBoq: 'contracting',
  contractingDailyLogs: 'contracting',
  contractingChangeOrders: 'contracting',
  contractingSubcontractors: 'contracting',

  // Sessions & Cash Drawer
  cashDrawer: 'cashDrawer',
  treasury: 'cashDrawer',

  // Purchases & Suppliers
  purchases: 'purchases',
  suppliers: 'purchases',

  // Inventory
  inventory: 'inventory',
  canAdjustInventory: 'inventory',
  canManageBranchStock: 'inventory',

  // Reports & Auditing
  dashboard: 'reports',
  reports: 'reports',
  audit: 'reports',
  canViewProfit: 'reports',

  // Accounting & Accounts
  accounts: 'accounting',
  accounting: 'accounting',
  customers: 'accounting',
  services: 'accounting',

  // Human Resources
  hr: 'hr',
  hrEmployees: 'hr',
  hrAttendance: 'hr',
  hrContracts: 'hr',
  hrLoans: 'hr',
  hrPayrollView: 'hr',
  hrPayrollManage: 'hr',
  hrPayrollApprove: 'hr',
  hrSalaryView: 'hr',
  hrSalaryManage: 'hr',

  // Delivery Reps
  deliveryReps: 'deliveryReps',

  // Manufacturing
  manufacturing: 'manufacturing',

  // Core & System Management (Always Available to Tenant Admins)
  settings: 'core',
  canManageSettings: 'core',
  canEditUsers: 'core',
  canManageUsers: 'core',
  canManageBackups: 'core',
  canDelete: 'core',
};

export interface PermissionGroup {
  title: string;
  items: string[];
}

export const USER_PERMISSION_GROUPS: PermissionGroup[] = [
  { title: 'شاشات التشغيل اليومية', items: ['dashboard', 'sales', 'kitchen', 'customers', 'crm', 'cashDrawer', 'products', 'inventory', 'purchases', 'returns', 'suppliers', 'accounts', 'accounting', 'reports', 'pricingCenterView', 'deliveryReps'] },
  { title: 'الموارد البشرية', items: ['hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove'] },
  { title: 'تنفيذ العمليات', items: ['canPrint', 'canDiscount', 'canEditPrice', 'canSellWholesale', 'canEditInvoices', 'canDirectReturn', 'canAdjustInventory', 'canManageBranchStock', 'pricingCenterManage'] },
  { title: 'إدارة النظام', items: ['settings', 'canManageSettings', 'canEditUsers', 'canManageUsers', 'canManageBackups'] },
  { title: 'بيانات حساسة', items: ['canViewProfit', 'hrSalaryView', 'hrSalaryManage', 'audit', 'treasury', 'services', 'canDelete'] }
];

export const MARITIME_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'عمليات وتشغيل الشحن الملاحي',
    items: [
      'dashboard',
      'maritimeJobs',
      'maritimeContainers',
      'maritimeInquiries',
      'maritimeQuotations',
      'maritimeRfqs',
      'maritimePolicies',
      'customers',
      'suppliers',
      'accounts',
      'accounting',
      'reports'
    ]
  },
  {
    title: 'الموارد البشرية',
    items: ['hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']
  },
  {
    title: 'تنفيذ الإجراءات والمستندات',
    items: ['canPrint', 'canEditInvoices']
  },
  {
    title: 'إدارة النظام',
    items: ['settings', 'canManageSettings', 'canEditUsers', 'canManageUsers', 'canManageBackups']
  },
  {
    title: 'بيانات حساسة',
    items: ['canViewProfit', 'hrSalaryView', 'hrSalaryManage', 'audit', 'treasury', 'canDelete']
  }
];

export const CONTRACTING_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'إدارة المشاريع والعمليات الميدانية',
    items: [
      'dashboard',
      'contractingProjects',
      'contractingInvoices',
      'contractingBoq',
      'contractingDailyLogs',
      'contractingChangeOrders',
      'contractingSubcontractors',
      'suppliers',
      'accounts',
      'accounting',
      'reports'
    ]
  },
  {
    title: 'الموارد البشرية',
    items: ['hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']
  },
  {
    title: 'تنفيذ الإجراءات والاعتمادات',
    items: ['canPrint', 'canEditInvoices']
  },
  {
    title: 'إدارة النظام',
    items: ['settings', 'canManageSettings', 'canEditUsers', 'canManageUsers', 'canManageBackups']
  },
  {
    title: 'بيانات حساسة',
    items: ['canViewProfit', 'hrSalaryView', 'hrSalaryManage', 'audit', 'treasury', 'canDelete']
  }
];

export function getFilteredPermissionGroups(tenantFeatures?: string[] | null, vertical?: string): PermissionGroup[] {
  const baseGroups = vertical === 'maritime'
    ? MARITIME_PERMISSION_GROUPS
    : vertical === 'contracting'
    ? CONTRACTING_PERMISSION_GROUPS
    : USER_PERMISSION_GROUPS;

  if (!tenantFeatures || !Array.isArray(tenantFeatures) || tenantFeatures.length === 0) {
    return baseGroups;
  }

  const enabledSet = new Set<string>([...tenantFeatures, 'core', 'sessions']);
  if (vertical === 'maritime') enabledSet.add('maritime');
  if (vertical === 'contracting') enabledSet.add('contracting');
  if (enabledSet.has('sessions')) enabledSet.add('cashDrawer');
  if (enabledSet.has('cashDrawer')) enabledSet.add('sessions');
  // If sales or catalog is enabled, allow customers if not strictly accounting
  if (enabledSet.has('sales') || enabledSet.has('catalog')) {
    enabledSet.add('sales_basic');
  }

  return baseGroups.map((group) => {
    const filteredItems = group.items.filter((itemKey) => {
      const requiredFeature = PERMISSION_FEATURE_MAP[itemKey];
      if (!requiredFeature || requiredFeature === 'core') return true;
      if (itemKey === 'customers' && (enabledSet.has('sales') || enabledSet.has('accounting') || enabledSet.has('maritime') || enabledSet.has('contracting'))) {
        return true;
      }
      if (itemKey === 'canPrint') return true;
      return enabledSet.has(requiredFeature);
    });

    return {
      title: group.title,
      items: filteredItems,
    };
  }).filter((group) => group.items.length > 0);
}

export const USER_ROLE_TEMPLATES = {
  cashier: { label: 'كاشير (مستخدم عادي)', role: 'cashier', permissions: [...DEFAULT_CASHIER_PERMS] },
  owner: { label: 'مدير / مالك المنشأة', role: 'admin', permissions: [...DEFAULT_RETAIL_ADMIN_PERMS] },
  inventory: { label: 'مسؤول مخزون', role: 'admin', permissions: ['dashboard','products','inventory','purchases','suppliers','reports','pricingCenterView','pricingCenterManage','canPrint','canAdjustInventory','canManageBranchStock'] },
  accountant: { label: 'محاسب', role: 'admin', permissions: ['dashboard','accounts','accounting','reports','customers','suppliers','treasury','canPrint','canViewProfit'] }
} as const;

export function getUserRoleTemplates(vertical?: string) {
  if (vertical === 'maritime') {
    return {
      cashier: { label: 'مسؤول عمليات وتتبع ملاحي', role: 'cashier' as const, permissions: [...DEFAULT_MARITIME_OPS_PERMS] },
      owner: { label: 'مدير / مالك المكتب الملاحي', role: 'admin' as const, permissions: getAdminTemplatePermissions('maritime') },
      inventory: { label: 'مسؤول حاويات ومستودعات', role: 'admin' as const, permissions: ['dashboard', 'maritimeContainers', 'maritimeJobs', 'suppliers', 'reports', 'canPrint'] },
      accountant: { label: 'محاسب نولون وتخليص', role: 'admin' as const, permissions: ['dashboard', 'maritimeJobs', 'maritimeQuotations', 'accounts', 'accounting', 'reports', 'customers', 'suppliers', 'treasury', 'canPrint', 'canViewProfit'] }
    };
  }
  if (vertical === 'contracting') {
    return {
      cashier: { label: 'مهندس موقع / مسؤول مشاريع ومستخلصات', role: 'cashier' as const, permissions: [...DEFAULT_CONTRACTING_OPS_PERMS] },
      owner: { label: 'مدير عام / مالك شركة المقاولات', role: 'admin' as const, permissions: getAdminTemplatePermissions('contracting') },
      inventory: { label: 'مسؤول تشوين ومهمات', role: 'admin' as const, permissions: ['dashboard', 'contractingProjects', 'contractingBoq', 'suppliers', 'reports', 'canPrint'] },
      accountant: { label: 'محاسب مشاريع ومستخلصات', role: 'admin' as const, permissions: ['dashboard', 'contractingProjects', 'contractingInvoices', 'contractingSubcontractors', 'accounts', 'accounting', 'reports', 'customers', 'suppliers', 'treasury', 'canPrint', 'canViewProfit'] }
    };
  }
  return USER_ROLE_TEMPLATES;
}

/* INV-USER-GRANT-NAMES-PERMISSION: a template (owner/admin/...) must
 * never pre-tick a permission the current actor does not hold — the
 * server guard (INV-USER-GRANT-SUBSET) refuses the whole save when
 * it does, and the merchant only learns it after the failed save.
 * Split a requested list into what the actor may grant and what they
 * may not, so the form pre-ticks only the grantable part. An actor
 * holding '*' may grant everything; an unknown actor (no session
 * permissions — first-run setup) is not filtered, so setup keeps
 * working. Order of the requested list is preserved in both parts. */
export function splitPermissionsByActorGrant(
  requested: string[],
  actorPermissions?: string[] | null,
): { granted: string[]; withheld: string[] } {
  if (!actorPermissions || actorPermissions.includes('*')) {
    return { granted: [...requested], withheld: [] };
  }
  const held = new Set(actorPermissions);
  const granted: string[] = [];
  const withheld: string[] = [];
  for (const permission of requested) {
    if (held.has(permission)) granted.push(permission);
    else withheld.push(permission);
  }
  return { granted, withheld };
}

export function blankUserDraft(role: 'super_admin' | 'admin' | 'cashier' = 'cashier', vertical?: string): ManagedUserRecord {
  let perms: string[];
  if (role === 'super_admin') {
    // Platform-only role: the platform actor holds '*', so the full
    // list passes the grant guard; the platform tenant has no shop
    // vertical to scope by.
    perms = [...DEFAULT_ADMIN_PERMS];
  } else if (role === 'admin') {
    // INV-USER-GRANT-NAMES-PERMISSION: vertical-scoped (retail 45,
    // maritime/contracting 51) — never the full 57, so no hidden
    // vertical key is ever sent from a tenant that has no such
    // vertical in it.
    perms = getAdminTemplatePermissions(vertical);
  } else if (vertical === 'maritime') {
    perms = [...DEFAULT_MARITIME_OPS_PERMS];
  } else if (vertical === 'contracting') {
    perms = [...DEFAULT_CONTRACTING_OPS_PERMS];
  } else {
    perms = [...DEFAULT_CASHIER_PERMS];
  }
  return {
    id: null,
    username: '',
    phone: '',
    password: '',
    role,
    permissions: perms,
    name: '',
    branchIds: [],
    defaultBranchId: '',
    isActive: true,
    mustChangePassword: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null
  };
}

export function normalizeUserRecord(user: Partial<ManagedUserRecord> | null | undefined, verticalOrIndex?: string | number): ManagedUserRecord {
  const vertical = typeof verticalOrIndex === 'string' ? verticalOrIndex : undefined;
  const role = user?.role === 'super_admin' ? 'super_admin' : user?.role === 'admin' ? 'admin' : 'cashier';
  const fallback = blankUserDraft(role, vertical);
  return {
    ...fallback,
    ...user,
    id: user?.id ? String(user.id) : null,
    username: String(user?.username || ''),
    phone: user?.phone ? String(user.phone) : '',
    password: typeof user?.password === 'string' ? user.password : '',
    role,
    permissions: Array.isArray(user?.permissions) && (user?.id || user.permissions.length > 0)
      ? Array.from(new Set((user.permissions || []).map((permission) => String(permission)).filter(Boolean)))
      : fallback.permissions,
    name: String(user?.name || user?.username || ''),
    branchIds: Array.isArray(user?.branchIds) ? (user.branchIds || []).map((branchId) => String(branchId)).filter(Boolean) : [],
    defaultBranchId: String(user?.defaultBranchId || ''),
    isActive: user?.isActive !== false,
    mustChangePassword: user?.mustChangePassword === true,
    failedLoginCount: Number(user?.failedLoginCount || 0),
    lockedUntil: user?.lockedUntil || null,
    lastLoginAt: user?.lastLoginAt || null
  };
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ar-EG');
}

export function exportUsersCsv(filename: string, users: ManagedUserRecord[]) {
  downloadExcelFile(filename, ['name', 'username', 'role', 'status', 'defaultBranch', 'branches', 'permissions', 'failedLogins', 'lockedUntil', 'lastLoginAt'], users.map((user) => [
    user.name || '',
    user.username || '',
    user.role === 'super_admin' ? 'super_admin' : user.role === 'admin' ? 'admin' : 'cashier',
    user.isActive === false ? 'inactive' : 'active',
    user.defaultBranchId || '',
    (user.branchIds || []).join(' | '),
    (user.permissions || []).join(' | '),
    Number(user.failedLoginCount || 0),
    user.lockedUntil || '',
    user.lastLoginAt || ''
  ]));
}

export function printUsersList(title: string, users: ManagedUserRecord[]) {
  const rows = users.map((user) => `
    <tr>
      <td>${escapeHtml(String(user.name || ''))}</td>
      <td>${escapeHtml(String(user.username || ''))}</td>
      <td>${escapeHtml(user.role === 'super_admin' ? 'سوبر أدمن' : user.role === 'admin' ? 'مدير نظام' : 'كاشير')}</td>
      <td>${escapeHtml(user.isActive === false ? 'موقوف' : 'نشط')}</td>
      <td>${escapeHtml(String(user.defaultBranchId || ''))}</td>
      <td>${escapeHtml(String((user.permissions || []).length))}</td>
      <td>${escapeHtml(formatDateTime(user.lastLoginAt))}</td>
    </tr>
  `).join('');
  printHtmlDocument(title, `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th>الاسم</th>
          <th>المستخدم</th>
          <th>الدور</th>
          <th>الحالة</th>
          <th>الفرع الافتراضي</th>
          <th>عدد الصلاحيات</th>
          <th>آخر دخول</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

