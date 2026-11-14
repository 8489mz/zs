/* INV-USER-GRANT-NAMES-PERMISSION: Arabic labels for permission keys,
 * used ONLY in user-facing refusal messages (the grant guard). The
 * wording is the single source the merchant already sees on the
 * checkbox in the add-user form, so the refusal names the permission
 * in the same plain Arabic words — never the English key alone.
 * Wording authority: frontend/src/features/settings/components/
 * user-management.shared.ts PERMISSION_LABELS. Keep the two maps in
 * sync when a label changes; an unknown key falls back to the key
 * itself so the message never goes blank. */

export const PERMISSION_ARABIC_LABELS: Record<string, string> = {
  dashboard: 'الشاشة الرئيسية',
  sales: 'سجل الفواتير',
  kitchen: 'شاشة المطبخ (KDS)',
  customers: 'العملاء',
  crm: 'إدارة علاقات العملاء والصفقات (CRM)',
  cashDrawer: 'وردية الكاشير',
  products: 'الأصناف',
  inventory: 'المخزون',
  purchases: 'المشتريات',
  returns: 'المرتجعات',
  suppliers: 'الموردون',
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
  maritimeJobs: 'أوامر تشغيل الشحن (Jobs)',
  maritimeContainers: 'تتبع وإدارة الحاويات',
  maritimeInquiries: 'استفسارات الشحن',
  maritimeQuotations: 'عروض أسعار النولون',
  maritimeRfqs: 'مقارنة أسعار الخطوط (RFQ)',
  maritimePolicies: 'سياسات الشحن والخطوط',
  contractingProjects: 'المشاريع الإنشائية',
  contractingInvoices: 'المستخلصات الجارية والختامية (IPC)',
  contractingBoq: 'المقايسات وجداول الكميات (BOQ)',
  contractingDailyLogs: 'يوميات وتقارير الموقع',
  contractingChangeOrders: 'أوامر التغيير والمطالبات',
  contractingSubcontractors: 'مقاولو الباطن',
};

export function getPermissionArabicLabel(permission: string): string {
  return PERMISSION_ARABIC_LABELS[permission] || permission;
}
