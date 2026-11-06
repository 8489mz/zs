import type { AuditLog } from '@/types/domain';
import { translateUiText } from '@/lib/auto-translator';

export type AuditActivityType =
  | 'auth'
  | 'import'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'maintenance'
  | 'hr'
  | 'settings'
  | 'backup'
  | 'sensitive'
  | 'general';

type ActivityMeta = {
  type: AuditActivityType;
  label: string;
  badgeClass: string;
};

const ACTION_PATTERNS: Array<{ pattern: RegExp; label: string; labelEn: string }> = [
  { pattern: /(login|user login|تسجيل دخول)/i, label: 'تسجيل دخول', labelEn: 'User Login' },
  { pattern: /(logout|تسجيل خروج)/i, label: 'تسجيل خروج', labelEn: 'User Logout' },
  { pattern: /(failed login|تسجيل دخول فاشل)/i, label: 'تسجيل دخول فاشل', labelEn: 'Failed Login' },
  // The dismiss branch logs a DISTINCT action ('تخطي تغيير كلمة المرور'
  // / 'continue with current password'): it must be matched BEFORE the
  // password-change pattern below, whose 'تغيير كلمة المرور' also matches
  // inside the dismiss text — and before the reset-password pattern
  // further down, whose bare 'كلمة مرور' matches it too. First match
  // wins in getAuditActionLabel, so order is the fix.
  { pattern: /(تخطي تغيير كلمة المرور|تخطي.*كلمة المرور|المتابعة بكلمة المرور الحالية|skip.*password|dismiss.*password|continue with current password)/i, label: 'تخطي تغيير كلمة المرور', labelEn: 'Skipped Password Change' },
  { pattern: /(password change|change password|تغيير كلمة المرور)/i, label: 'تغيير كلمة المرور', labelEn: 'Password Change' },
  
  // Maintenance tickets
  { pattern: /(update ticket status|تحديث حالة التذكرة|تحديث حالة تذكرة)/i, label: 'تحديث حالة تذكرة الصيانة', labelEn: 'Update Ticket Status' },
  { pattern: /(create maintenance ticket|إنشاء تذكرة صيانة|إضافة تذكرة صيانة)/i, label: 'إنشاء تذكرة صيانة', labelEn: 'Create Maintenance Ticket' },
  { pattern: /(update maintenance ticket|تعديل تذكرة صيانة)/i, label: 'تعديل تذكرة صيانة', labelEn: 'Update Maintenance Ticket' },
  { pattern: /(delete maintenance ticket|حذف تذكرة صيانة)/i, label: 'حذف تذكرة صيانة', labelEn: 'Delete Maintenance Ticket' },
  { pattern: /(add ticket part|إضافة قطعة غيار)/i, label: 'إضافة قطعة غيار لتذكرة', labelEn: 'Add Spare Part to Ticket' },
  { pattern: /(remove ticket part|حذف قطعة غيار من تذكرة)/i, label: 'حذف قطعة غيار من تذكرة', labelEn: 'Remove Spare Part from Ticket' },

  // Addons
  { pattern: /(create addon|إضافة ملحق)/i, label: 'إضافة ملحق', labelEn: 'Create Addon' },
  { pattern: /(update addon|تعديل ملحق)/i, label: 'تعديل ملحق', labelEn: 'Update Addon' },
  { pattern: /(delete addon|حذف ملحق)/i, label: 'حذف ملحق', labelEn: 'Delete Addon' },

  // HR & Attendance
  { pattern: /(bulk import hr attendance|استيراد حضور جماعي)/i, label: 'استيراد حضور جماعي', labelEn: 'Bulk Import Attendance' },
  { pattern: /(upsert hr attendance record|attendance record|حضور موظف)/i, label: 'تسجيل أو تعديل حضور موظف', labelEn: 'Record/Update Attendance' },
  { pattern: /(save hr attendance day|حفظ حضور)/i, label: 'حفظ حضور اليوم', labelEn: 'Save Daily Attendance' },
  { pattern: /(cancel hr attendance checkout|إلغاء انصراف)/i, label: 'إلغاء تسجيل انصراف', labelEn: 'Cancel Checkout' },
  { pattern: /(new attendance session for hr employee|جلسة حضور)/i, label: 'جلسة حضور جديدة', labelEn: 'New Attendance Session' },
  { pattern: /(create quick cash advance|quick cash advance|سلفة نقدية سريعة)/i, label: 'سلفة نقدية سريعة', labelEn: 'Quick Cash Advance' },
  { pattern: /(create hr employee loan|إنشاء سلفة)/i, label: 'إنشاء سلفة موظف', labelEn: 'Create Employee Loan' },
  { pattern: /(update hr employee loan|تعديل سلفة)/i, label: 'تعديل سلفة موظف', labelEn: 'Update Employee Loan' },
  { pattern: /(approve hr employee loan|اعتماد سلفة)/i, label: 'اعتماد سلفة موظف', labelEn: 'Approve Employee Loan' },
  { pattern: /(pay hr employee loan|صرف سلفة)/i, label: 'صرف سلفة موظف', labelEn: 'Disburse Employee Loan' },
  { pattern: /(repay hr employee loan|سداد سلفة)/i, label: 'سداد سلفة موظف', labelEn: 'Repay Employee Loan' },
  { pattern: /(create hr payroll run|إعداد مسير)/i, label: 'إعداد مسير الرواتب', labelEn: 'Create Payroll Run' },
  { pattern: /(recalculate hr payroll run|إعادة احتساب مسير)/i, label: 'إعادة احتساب مسير الرواتب', labelEn: 'Recalculate Payroll Run' },
  { pattern: /(apply hr attendance deductions|تطبيق خصومات)/i, label: 'تطبيق خصومات الحضور', labelEn: 'Apply Attendance Deductions' },
  { pattern: /(review hr payroll run|مراجعة مسير)/i, label: 'مراجعة مسير الرواتب', labelEn: 'Review Payroll Run' },
  { pattern: /(approve hr payroll run|اعتماد مسير)/i, label: 'اعتماد مسير الرواتب', labelEn: 'Approve Payroll Run' },
  { pattern: /(pay hr payroll run|صرف مسير)/i, label: 'صرف مسير الرواتب', labelEn: 'Disburse Payroll Run' },
  { pattern: /(cancel hr payroll run|إلغاء مسير)/i, label: 'إلغاء مسير الرواتب', labelEn: 'Cancel Payroll Run' },
  { pattern: /(update hr payroll item|تعديل بند مسير)/i, label: 'تعديل بند مسير', labelEn: 'Update Payroll Item' },
  { pattern: /(create hr payroll adjustment|إضافة تسوية مسير)/i, label: 'إضافة تسوية لمسير الرواتب', labelEn: 'Add Payroll Adjustment' },
  { pattern: /(delete hr payroll adjustment|حذف تسوية مسير)/i, label: 'حذف تسوية مسير الرواتب', labelEn: 'Delete Payroll Adjustment' },
  { pattern: /(create hr leave request|طلب إجازة)/i, label: 'تقديم طلب إجازة', labelEn: 'Submit Leave Request' },
  { pattern: /(approve hr leave request|اعتماد إجازة)/i, label: 'الموافقة على الإجازة', labelEn: 'Approve Leave Request' },
  { pattern: /(reject hr leave request|رفض إجازة)/i, label: 'رفض طلب الإجازة', labelEn: 'Reject Leave Request' },
  { pattern: /(cancel hr leave request|إلغاء إجازة)/i, label: 'إلغاء طلب الإجازة', labelEn: 'Cancel Leave Request' },
  { pattern: /(create hr employee|إضافة موظف)/i, label: 'إضافة موظف جديد', labelEn: 'Create Employee' },
  { pattern: /(update hr employee|تعديل موظف)/i, label: 'تعديل بيانات موظف', labelEn: 'Update Employee' },
  { pattern: /(deactivate hr employee|تعطيل حساب موظف|تعطيل موظف)/i, label: 'تعطيل حساب موظف', labelEn: 'Deactivate Employee' },
  { pattern: /(end of service|إنهاء خدمة)/i, label: 'إنهاء خدمة موظف', labelEn: 'End Employee Service' },
  { pattern: /(hr employee contact|بيانات اتصال)/i, label: 'تحديث بيانات اتصال موظف', labelEn: 'Update Employee Contact' },
  { pattern: /(hr employee document|مستندات موظف)/i, label: 'تحديث وثائق موظف', labelEn: 'Update Employee Document' },
  { pattern: /(hr employment contract|عقد عمل)/i, label: 'تحديث عقد عمل', labelEn: 'Update Employment Contract' },
  { pattern: /(hr compensation|بيانات راتب)/i, label: 'تحديث راتب موظف', labelEn: 'Update Employee Compensation' },
  { pattern: /(hr employee adjustment|تسوية موظف)/i, label: 'تسوية لموظف', labelEn: 'Employee Adjustment' },
  { pattern: /(hr employee asset|عهدة موظف)/i, label: 'تحديث عهدة موظف', labelEn: 'Update Employee Asset Custody' },
  { pattern: /(hr leave type|نوع إجازة)/i, label: 'تحديث نوع إجازة', labelEn: 'Update Leave Type' },

  // Import
  { pattern: /(import.+products|استيراد.+أصناف|استيراد أصناف)/i, label: 'استيراد أصناف', labelEn: 'Import Products' },
  { pattern: /(import.+customers|استيراد.+عملاء|استيراد عملاء)/i, label: 'استيراد عملاء', labelEn: 'Import Customers' },
  { pattern: /(import.+suppliers|استيراد.+موردين|استيراد موردين)/i, label: 'استيراد موردين', labelEn: 'Import Suppliers' },
  { pattern: /(opening stock|opening inventory|استيراد.+افتتاحي|استيراد مخزون افتتاحي)/i, label: 'استيراد مخزون افتتاحي', labelEn: 'Import Opening Stock' },
  { pattern: /(import.+employees|استيراد.+موظفين|استيراد موظفين)/i, label: 'استيراد موظفين', labelEn: 'Import Employees' },

  // Categories & Inventory
  { pattern: /(إضافة تصنيف|create category)/i, label: 'إضافة تصنيف', labelEn: 'Create Category' },
  { pattern: /(تعديل تصنيف|update category)/i, label: 'تعديل تصنيف', labelEn: 'Update Category' },
  { pattern: /(حذف تصنيف|delete category)/i, label: 'حذف تصنيف', labelEn: 'Delete Category' },
  { pattern: /(نقل أصناف|transfer products)/i, label: 'نقل أصناف بين التصنيفات', labelEn: 'Transfer Products' },
  { pattern: /(إضافة صنف|create product)/i, label: 'إضافة صنف', labelEn: 'Create Product' },
  { pattern: /(تعديل صنف|update product)/i, label: 'تعديل صنف', labelEn: 'Update Product' },
  { pattern: /(حذف صنف|delete product)/i, label: 'حذف صنف', labelEn: 'Delete Product' },
  { pattern: /(ترحيل دفعة جرد|post inventory batch)/i, label: 'ترحيل دفعة جرد', labelEn: 'Post Inventory Batch' },
  { pattern: /(حذف مسودة جلسة جرد|delete inventory draft)/i, label: 'حذف مسودة جلسة جرد', labelEn: 'Delete Inventory Session Draft' },
  { pattern: /(اعتماد جلسة جرد|post inventory session)/i, label: 'اعتماد جلسة جرد', labelEn: 'Post Inventory Session' },
  { pattern: /(جلسة جرد مخزون|جلسة جرد|inventory session)/i, label: 'جلسة جرد مخزون', labelEn: 'Inventory Session' },
  { pattern: /(تسجيل تالف|damaged stock)/i, label: 'تسجيل تالف', labelEn: 'Record Damaged Stock' },
  { pattern: /(نقل قسم|transfer department)/i, label: 'نقل أرصدة قسم', labelEn: 'Transfer Department' },

  // POS & Cashier Security Actions
  { pattern: /(حدث أمني.*إلغاء.*فاتورة|draft_cancel|draft.*cancelled|إلغاء\/حذف فاتورة)/i, label: 'حدث أمني - إلغاء/حذف فاتورة', labelEn: 'Security Event - Cancel Draft Invoice' },
  { pattern: /(حدث أمني.*حذف.*عنصر|cart_remove|cart.*item.*removed|حذف عنصر من السلة)/i, label: 'حدث أمني - حذف عنصر من السلة', labelEn: 'Security Event - Remove Item from Cart' },
  { pattern: /(حدث أمني.*خصم|discount_override|تجاوز الخصم)/i, label: 'حدث أمني - تجاوز الخصم', labelEn: 'Security Event - Discount Override' },
  { pattern: /(حدث أمني|security event)/i, label: 'حدث أمني', labelEn: 'Security Event' },

  // Sales & Purchases Actions
  { pattern: /(create sales invoice|إنشاء فاتورة مبيعات|إضافة فاتورة مبيعات)/i, label: 'إنشاء فاتورة مبيعات', labelEn: 'Create Sales Invoice' },
  { pattern: /(update sales invoice|تعديل فاتورة مبيعات)/i, label: 'تعديل فاتورة مبيعات', labelEn: 'Update Sales Invoice' },
  { pattern: /(cancel sales invoice|إلغاء فاتورة مبيعات)/i, label: 'إلغاء فاتورة مبيعات', labelEn: 'Cancel Sales Invoice' },
  { pattern: /(sales return|مرتجع مبيعات)/i, label: 'مرتجع مبيعات', labelEn: 'Sales Return' },
  { pattern: /(create purchase invoice|إنشاء فاتورة مشتريات|إضافة فاتورة مشتريات)/i, label: 'إنشاء فاتورة مشتريات', labelEn: 'Create Purchase Invoice' },
  { pattern: /(update purchase invoice|تعديل فاتورة مشتريات)/i, label: 'تعديل فاتورة مشتريات', labelEn: 'Update Purchase Invoice' },
  { pattern: /(cancel purchase invoice|إلغاء فاتورة مشتريات)/i, label: 'إلغاء فاتورة مشتريات', labelEn: 'Cancel Purchase Invoice' },
  { pattern: /(purchase return|مرتجع مشتريات)/i, label: 'مرتجع مشتريات', labelEn: 'Purchase Return' },
  { pattern: /(receipt voucher|سند قبض)/i, label: 'سند قبض', labelEn: 'Receipt Voucher' },
  { pattern: /(payment voucher|سند صرف)/i, label: 'سند صرف', labelEn: 'Payment Voucher' },
  { pattern: /(treasury transfer|تحويل بين الخزائن)/i, label: 'تحويل بين الخزائن', labelEn: 'Treasury Transfer' },

  // Delivery
  { pattern: /(إضافة مندوب توصيل|create delivery rep)/i, label: 'إضافة مندوب توصيل', labelEn: 'Create Delivery Rep' },
  { pattern: /(تعديل مندوب توصيل|update delivery rep)/i, label: 'تعديل مندوب توصيل', labelEn: 'Update Delivery Rep' },
  { pattern: /(حذف مندوب توصيل|delete delivery rep)/i, label: 'حذف مندوب توصيل', labelEn: 'Delete Delivery Rep' },
  { pattern: /(تسوية طلب توصيل|settle delivery order)/i, label: 'تسوية طلب توصيل', labelEn: 'Settle Delivery Order' },
  { pattern: /(تسوية كل الطلبات|settle all delivery orders)/i, label: 'تسوية كل طلبات التوصيل', labelEn: 'Settle All Delivery Orders' },

  // SaaS & Tenants & Passwords
  { pattern: /(إعادة كلمة مرور|reset owner password|reset password|كلمة مرور)/i, label: 'إعادة كلمة المرور', labelEn: 'Reset Password' },
  { pattern: /(إنشاء نسخة تجريبية|create trial tenant|create tenant|إنشاء نسخة)/i, label: 'إنشاء نسخة تجريبية', labelEn: 'Create Trial Tenant' },
  { pattern: /(تعديل خطة اشتراك|update plan|تحديث باقة)/i, label: 'تعديل باقة الاشتراك', labelEn: 'Update Subscription Plan' },
  { pattern: /(تجديد اشتراك|renew tenant)/i, label: 'تجديد اشتراك', labelEn: 'Renew Subscription' },
  { pattern: /(تسجيل دفعة|record payment)/i, label: 'تسجيل دفعة مالية', labelEn: 'Record Payment' },
  { pattern: /(تمديد تجربة|extend trial)/i, label: 'تمديد الفترة التجريبية', labelEn: 'Extend Trial' },
  { pattern: /(إيقاف نسخة|suspend tenant)/i, label: 'إيقاف النسخة مؤقتاً', labelEn: 'Suspend Tenant' },
  { pattern: /(حذف نسخة|delete tenant)/i, label: 'حذف نسخة سحابية', labelEn: 'Delete Tenant' },

  // System & Settings
  { pattern: /(backup created|نسخ احتياطي|backup)/i, label: 'نسخة احتياطية', labelEn: 'Backup Created' },
  { pattern: /(branch created|إضافة فرع)/i, label: 'إضافة فرع', labelEn: 'Create Branch' },
  { pattern: /(location created|إضافة مخزن)/i, label: 'إضافة مخزن', labelEn: 'Create Location' },
  { pattern: /(settings updated|تعديل الإعدادات|update settings)/i, label: 'تعديل الإعدادات', labelEn: 'Update Settings' },
];

const TYPE_META: Record<AuditActivityType, ActivityMeta> = {
  auth: { type: 'auth', label: 'أمان ودخول', badgeClass: 'audit-badge-auth' },
  maintenance: { type: 'maintenance', label: 'صيانة', badgeClass: 'audit-badge-maintenance' },
  import: { type: 'import', label: 'استيراد', badgeClass: 'audit-badge-import' },
  inventory: { type: 'inventory', label: 'مخزون', badgeClass: 'audit-badge-inventory' },
  sales: { type: 'sales', label: 'مبيعات ومدفوعات', badgeClass: 'audit-badge-sales' },
  purchases: { type: 'purchases', label: 'مشتريات', badgeClass: 'audit-badge-purchases' },
  hr: { type: 'hr', label: 'موارد بشرية', badgeClass: 'audit-badge-hr' },
  settings: { type: 'settings', label: 'منظومة وإعدادات', badgeClass: 'audit-badge-settings' },
  backup: { type: 'backup', label: 'نسخ احتياطي', badgeClass: 'audit-badge-backup' },
  sensitive: { type: 'sensitive', label: 'عمليات حساسة', badgeClass: 'audit-badge-sensitive' },
  general: { type: 'general', label: 'عام', badgeClass: 'audit-badge-general' },
};

const TYPE_META_EN: Record<AuditActivityType, ActivityMeta> = {
  auth: { type: 'auth', label: 'Security & Auth', badgeClass: 'audit-badge-auth' },
  maintenance: { type: 'maintenance', label: 'Maintenance', badgeClass: 'audit-badge-maintenance' },
  import: { type: 'import', label: 'Data Import', badgeClass: 'audit-badge-import' },
  inventory: { type: 'inventory', label: 'Inventory', badgeClass: 'audit-badge-inventory' },
  sales: { type: 'sales', label: 'Sales & Payments', badgeClass: 'audit-badge-sales' },
  purchases: { type: 'purchases', label: 'Purchases', badgeClass: 'audit-badge-purchases' },
  hr: { type: 'hr', label: 'Human Resources', badgeClass: 'audit-badge-hr' },
  settings: { type: 'settings', label: 'System & Settings', badgeClass: 'audit-badge-settings' },
  backup: { type: 'backup', label: 'Backups', badgeClass: 'audit-badge-backup' },
  sensitive: { type: 'sensitive', label: 'Critical Actions', badgeClass: 'audit-badge-sensitive' },
  general: { type: 'general', label: 'General', badgeClass: 'audit-badge-general' },
};

const STATUS_DICTIONARY: Record<string, string> = {
  received: 'تم الاستلام',
  inspecting: 'قيد الفحص والتسعير',
  in_progress: 'قيد الصيانة والإصلاح',
  repaired: 'تم الإصلاح وجاهز للتسليم',
  delivered: 'تم التسليم للعميل',
  unrepairable: 'غير قابل للإصلاح',
  cancelled: 'ملغاة',
  canceled: 'ملغاة',
};

function readCombinedText(row: AuditLog): string {
  return `${String(row.action || '')} ${String(row.detailsSummary || '')} ${String(row.details || '')}`.toLowerCase();
}

export function getAuditActionLabel(action: string, isEn = false): string {
  const raw = String(action || '').trim();
  if (!raw) return isEn ? 'Operation' : 'عملية';
  const mapped = ACTION_PATTERNS.find((entry) => entry.pattern.test(raw));
  if (isEn) {
    if (mapped?.labelEn) return mapped.labelEn;
    return translateUiText(mapped?.label || raw) || mapped?.label || raw;
  }
  return mapped?.label || raw;
}

function detectType(row: AuditLog): AuditActivityType {
  const text = readCombinedText(row);

  if (/(login|logout|session|password|كلمة مرور|تسجيل دخول|تسجيل خروج)/i.test(text)) return 'auth';
  if (/(maintenance|ticket|صيانة|تذكرة)/i.test(text)) return 'maintenance';
  if (/(import|استيراد|csv|excel)/i.test(text)) return 'import';
  if (/(backup|نسخ احتياطي)/i.test(text)) return 'backup';
  if (/(attendance|موظف|hr|حضور|انصراف|سلفة|رواتب|payroll|leave|إجازة)/i.test(text)) return 'hr';
  if (/(delete|remove|حذف|إلغاء|إبطال|revoke|إيقاف)/i.test(text)) return 'sensitive';
  if (/(tenant|slug|نسخة|مستأجر|اشتراك|باقة|plan|settings|إعدادات|branch|location|فرع|مخزن)/i.test(text)) return 'settings';
  if (/(inventory|stock|مخزون|جرد|صنف|تالف|category|تصنيف)/i.test(text)) return 'inventory';
  if (/(purchase|supplier|مشتريات|مورد)/i.test(text)) return 'purchases';
  if (/(payment|sale|invoice|customer|مبيعات|فاتورة|عميل|مندوب|دفعة)/i.test(text)) return 'sales';
  return 'general';
}

export function getAuditActivityMeta(row: AuditLog, isEn = false): ActivityMeta {
  return (isEn ? TYPE_META_EN : TYPE_META)[detectType(row)];
}

export function normalizeAuditDetailText(detailText: string, isEn = false): string {
  let raw = String(detailText || '').trim();
  if (!raw) return '—';

  // Strip raw UUIDs and redundant trailing actor text
  raw = raw.replace(/\s*\([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\)/g, '');
  raw = raw.replace(/\s*\([0-9a-fA-F-]{36}\)/g, '');
  raw = raw.replace(/\s*بواسطة:\s*[a-zA-Z0-9_.-]+$/gi, '');
  raw = raw.trim();

  if (isEn) {
    // 0. Entity action by actor: "تم تحديث الصنف #55164 بواسطة zs"
    const entityActionMatch = raw.match(/^تم\s+(تحديث|تعديل|إضافة|انشاء|إنشاء|حذف|تسجيل|إلغاء|الغاء|ترحيل)\s+(الصنف|المنتج|العميل|المورد|المستخدم|الفرع|المخزن|الفاتورة|السجل|الطلب|العقد|المشروع|دفعة جرد|جلسة جرد|مسودة جلسة جرد)\s*(#?\S+)?(?:\s+بواسطة\s+(.+))?$/);
    if (entityActionMatch) {
      const verbMap: Record<string, string> = {
        'تحديث': 'updated',
        'تعديل': 'updated',
        'إضافة': 'created',
        'إنشاء': 'created',
        'انشاء': 'created',
        'حذف': 'deleted',
        'تسجيل': 'recorded',
        'إلغاء': 'cancelled',
        'الغاء': 'cancelled',
        'ترحيل': 'posted',
      };
      const entityMap: Record<string, string> = {
        'الصنف': 'Product',
        'المنتج': 'Product',
        'العميل': 'Customer',
        'المورد': 'Supplier',
        'المستخدم': 'User',
        'الفرع': 'Branch',
        'المخزن': 'Warehouse',
        'الفاتورة': 'Invoice',
        'السجل': 'Record',
        'الطلب': 'Order',
        'العقد': 'Contract',
        'المشروع': 'Project',
        'دفعة جرد': 'Inventory Batch',
        'جلسة جرد': 'Inventory Session',
        'مسودة جلسة جرد': 'Inventory Session Draft',
      };
      const verb = verbMap[entityActionMatch[1]] || 'updated';
      const entity = entityMap[entityActionMatch[2]] || entityActionMatch[2];
      const id = entityActionMatch[3] ? ` ${entityActionMatch[3]}` : '';
      const actor = entityActionMatch[4] ? ` by ${entityActionMatch[4]}` : '';
      return `${entity}${id} ${verb}${actor}`;
    }

    // 1. Maintenance ticket status change
    const ticketStatusMatch = raw.match(/Updated ticket\s+([A-Za-z0-9_-]+)\s+status to\s+([A-Za-z0-9_]+)/i);
    if (ticketStatusMatch) {
      const [, ticketNo, status] = ticketStatusMatch;
      return `Ticket ${ticketNo} status changed to "${status}"`;
    }

    // 2. Maintenance ticket created
    const ticketCreateMatch = raw.match(/Created ticket\s+([A-Za-z0-9_-]+)\s+for\s+(.+)/i);
    if (ticketCreateMatch) {
      const [, ticketNo, customer] = ticketCreateMatch;
      return `Created maintenance ticket ${ticketNo} for customer: ${customer}`;
    }

    // 3. Maintenance ticket updated
    const ticketUpdateMatch = raw.match(/Updated ticket\s+([A-Za-z0-9_-]+)$/i);
    if (ticketUpdateMatch) {
      const [, ticketNo] = ticketUpdateMatch;
      return `Updated maintenance ticket ${ticketNo}`;
    }

    // 4. Maintenance ticket deleted
    const ticketDeleteMatch = raw.match(/Deleted ticket ID\s+(\d+)\s+and restored\s+(\d+)\s+parts to stock/i);
    if (ticketDeleteMatch) {
      const [, id, count] = ticketDeleteMatch;
      return `Deleted maintenance ticket #${id} and restored ${count} parts to stock`;
    }

    // 5. Addon operations
    const addonCreatedMatch = raw.match(/Created addon\s+(.+)/i);
    if (addonCreatedMatch) return `Created addon: ${addonCreatedMatch[1]}`;
    const addonUpdatedMatch = raw.match(/Updated addon\s+(.+)/i);
    if (addonUpdatedMatch) return `Updated addon #${addonUpdatedMatch[1]}`;
    const addonDeletedMatch = raw.match(/Deleted addon\s+(.+)/i);
    if (addonDeletedMatch) return `Deleted addon #${addonDeletedMatch[1]}`;

    // 6. HR Attendance record saved
    const attendanceMatch = raw.match(/attendance record saved for employee\s*#?(\d+)\s*on\s*([0-9-]+)\s*by\s*([A-Za-z0-9_.-]+)/i);
    if (attendanceMatch) {
      const [, employeeId, date, actor] = attendanceMatch;
      return `Attendance recorded for employee #${employeeId} on ${date} by ${actor}`;
    }

    // 7. HR Loans
    const loanMatch = raw.match(/Employee loan\s*#?(\d+)\s*(created|updated|approved|disbursed|repayment recorded)\s*by\s*(.+)/i);
    if (loanMatch) {
      const [, id, action, actor] = loanMatch;
      return `Employee loan #${id} ${action} by ${actor}`;
    }

    // 8. Quick cash advance
    const advanceMatch = raw.match(/Cash advance of\s*([\d.]+)\s*for employee\s*#?(\d+)\s*by\s*(.+)/i);
    if (advanceMatch) {
      const [, amount, empId, actor] = advanceMatch;
      return `Cash advance of ${amount} for employee #${empId} by ${actor}`;
    }

    // 9. HR Leaves
    const leaveMatch = raw.match(/Leave request\s*#?(\d+)\s*(created|approved|rejected|cancelled)\s*by\s*(.+)/i);
    if (leaveMatch) {
      const [, id, action, actor] = leaveMatch;
      return `Leave request #${id} ${action} by ${actor}`;
    }

    // 10. HR Payroll run
    const payrollPrepMatch = raw.match(/Payroll run\s*(\S+)\s*prepared by\s*(.+)/i);
    if (payrollPrepMatch) {
      const [, period, actor] = payrollPrepMatch;
      return `Payroll run for period ${period} prepared by ${actor}`;
    }

    const payrollMatch = raw.match(/Payroll run\s*#?(\d+)\s*(recalculated|reviewed|approved|paid|cancelled)\s*by\s*(.+)/i);
    if (payrollMatch) {
      const [, id, action, actor] = payrollMatch;
      return `Payroll run #${id} ${action} by ${actor}`;
    }

    return translateUiText(raw) || raw;
  }

  // 1. Maintenance ticket status change
  const ticketStatusMatch = raw.match(/Updated ticket\s+([A-Za-z0-9_-]+)\s+status to\s+([A-Za-z0-9_]+)/i);
  if (ticketStatusMatch) {
    const [, ticketNo, status] = ticketStatusMatch;
    const statusAr = STATUS_DICTIONARY[status.toLowerCase()] || status;
    return `تم تغيير حالة التذكرة ${ticketNo} إلى "${statusAr}"`;
  }

  // 2. Maintenance ticket created
  const ticketCreateMatch = raw.match(/Created ticket\s+([A-Za-z0-9_-]+)\s+for\s+(.+)/i);
  if (ticketCreateMatch) {
    const [, ticketNo, customer] = ticketCreateMatch;
    return `تم إنشاء تذكرة الصيانة ${ticketNo} للعميل: ${customer}`;
  }

  // 3. Maintenance ticket updated
  const ticketUpdateMatch = raw.match(/Updated ticket\s+([A-Za-z0-9_-]+)$/i);
  if (ticketUpdateMatch) {
    const [, ticketNo] = ticketUpdateMatch;
    return `تم تعديل بيانات تذكرة الصيانة ${ticketNo}`;
  }

  // 4. Maintenance ticket deleted
  const ticketDeleteMatch = raw.match(/Deleted ticket ID\s+(\d+)\s+and restored\s+(\d+)\s+parts to stock/i);
  if (ticketDeleteMatch) {
    const [, id, count] = ticketDeleteMatch;
    return `تم حذف تذكرة الصيانة #${id} واسترجاع ${count} قطعة غيار إلى المخزون`;
  }

  // 5. Addon operations
  const addonCreatedMatch = raw.match(/Created addon\s+(.+)/i);
  if (addonCreatedMatch) return `تم إنشاء ملحق جديد: ${addonCreatedMatch[1]}`;
  const addonUpdatedMatch = raw.match(/Updated addon\s+(.+)/i);
  if (addonUpdatedMatch) return `تم تعديل بيانات الملحق #${addonUpdatedMatch[1]}`;
  const addonDeletedMatch = raw.match(/Deleted addon\s+(.+)/i);
  if (addonDeletedMatch) return `تم حذف الملحق #${addonDeletedMatch[1]}`;

  // 6. HR Attendance record saved
  const attendanceMatch = raw.match(/attendance record saved for employee\s*#?(\d+)\s*on\s*([0-9-]+)\s*by\s*([A-Za-z0-9_.-]+)/i);
  if (attendanceMatch) {
    const [, employeeId, date, actor] = attendanceMatch;
    return `تم تسجيل حضور الموظف رقم ${employeeId} بتاريخ ${date} بواسطة ${actor}`;
  }

  // 7. HR Loans
  const loanMatch = raw.match(/Employee loan\s*#?(\d+)\s*(created|updated|approved|disbursed|repayment recorded)\s*by\s*(.+)/i);
  if (loanMatch) {
    const [, id, action, actor] = loanMatch;
    const actionMap: Record<string, string> = {
      created: 'إنشاء',
      updated: 'تعديل',
      approved: 'اعتماد',
      disbursed: 'صرف',
      'repayment recorded': 'سداد',
    };
    return `تم ${actionMap[action.toLowerCase()] || action} سلفة الموظف #${id} بواسطة ${actor}`;
  }

  // 8. Quick cash advance
  const advanceMatch = raw.match(/Cash advance of\s*([\d.]+)\s*for employee\s*#?(\d+)\s*by\s*(.+)/i);
  if (advanceMatch) {
    const [, amount, empId, actor] = advanceMatch;
    return `تم تسجيل سلفة نقدية بقيمة ${amount} للموظف #${empId} بواسطة ${actor}`;
  }

  // 9. HR Leaves
  const leaveMatch = raw.match(/Leave request\s*#?(\d+)\s*(created|approved|rejected|cancelled)\s*by\s*(.+)/i);
  if (leaveMatch) {
    const [, id, action, actor] = leaveMatch;
    const actionMap: Record<string, string> = {
      created: 'تقديم',
      approved: 'الموافقة على',
      rejected: 'رفض',
      cancelled: 'إلغاء',
    };
    return `تم ${actionMap[action.toLowerCase()] || action} طلب الإجازة #${id} بواسطة ${actor}`;
  }

  // 10. HR Payroll run
  const payrollPrepMatch = raw.match(/Payroll run\s*(\S+)\s*prepared by\s*(.+)/i);
  if (payrollPrepMatch) {
    const [, period, actor] = payrollPrepMatch;
    return `تم إعداد مسير رواتب شهر ${period} بواسطة ${actor}`;
  }

  const payrollMatch = raw.match(/Payroll run\s*#?(\d+)\s*(recalculated|reviewed|approved|paid|cancelled)\s*by\s*(.+)/i);
  if (payrollMatch) {
    const [, id, action, actor] = payrollMatch;
    const actionMap: Record<string, string> = {
      recalculated: 'إعادة احتساب',
      reviewed: 'مراجعة',
      approved: 'اعتماد',
      paid: 'صرف',
      cancelled: 'إلغاء',
    };
    return `تم ${actionMap[action.toLowerCase()] || action} مسير الرواتب #${id} بواسطة ${actor}`;
  }

  // General string cleanup & translation replacements
  return raw
    .replace(/Upsert HR attendance record/gi, 'تسجيل أو تعديل حضور موظف')
    .replace(/Attendance record saved for employee\s*#?(\d+)\s*on\s*([0-9-]+)/gi, 'تسجيل حضور الموظف رقم $1 بتاريخ $2')
    .replace(/Attendance saved for\s*([0-9-]+)/gi, 'حفظ الحضور لتاريخ $1')
    .replace(/Imported\s*(\d+)\s*attendance records/gi, 'استيراد $1 سجل حضور')
    .replace(/Checkout cancelled for employee\s*#?(\d+)\s*on\s*([0-9-]+)/gi, 'إلغاء تسجيل انصراف الموظف #$1 لتاريخ $2')
    .replace(/New session started for employee\s*#?(\d+)\s*on\s*([0-9-]+)/gi, 'بدء جلسة حضور جديدة للموظف #$1 بتاريخ $2')
    .replace(/Ended service for employee\s*#?(\d+)\s*on\s*([0-9-]+)/gi, 'إنهاء خدمة الموظف #$1 بتاريخ $2')
    .replace(/Employee\s*(.+)\s*saved/gi, 'تم حفظ بيانات الموظف $1')
    .replace(/Employee\s*#?(\d+)\s*deactivated/gi, 'تم تعطيل حساب الموظف #$1')
    .replace(/saved by/gi, 'تم الحفظ بواسطة')
    .replace(/deactivated by/gi, 'تم التعطيل بواسطة')
    .replace(/cancelled by/gi, 'تم الإلغاء بواسطة')
    .replace(/approved by/gi, 'تم الاعتماد بواسطة')
    .replace(/created by/gi, 'تم الإنشاء بواسطة')
    .replace(/updated by/gi, 'تم التحديث بواسطة')
    .replace(/\s+by\s+/gi, ' بواسطة ');
}

export function normalizeAuditUserDisplay(row: AuditLog): string {
  const display = String(row.createdByName || row.createdBy || '').trim();
  return display || '—';
}
