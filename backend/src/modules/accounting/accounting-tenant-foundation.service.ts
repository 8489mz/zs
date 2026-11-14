import { Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {
  buildSettingsMapping,
  findMissingAccountCodes,
  findMissingSettingsColumns,
} from './engines/accounting-foundation.engine';

type DbOrTx = Kysely<Database> | Transaction<Database>;
type Scope = { tenantId: string; accountId: string };

type SeedAccount = {
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra_asset' | 'contra_revenue';
  normalBalance: 'debit' | 'credit';
  sortOrder: number;
  parentCode: string | null;
  accountGroup: string;
  allowManualEntries: boolean;
  isControlAccount: boolean;
  isCashBank: boolean;
  isReceivable: boolean;
  isPayable: boolean;
  isInventory: boolean;
  isTax: boolean;
};

const DEFAULT_SEED_ACCOUNTS: SeedAccount[] = [
  { code: '1000', nameAr: 'الأصول', nameEn: 'Assets', accountType: 'asset', normalBalance: 'debit', sortOrder: 1000, parentCode: null, accountGroup: 'assets', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1100', nameAr: 'الأصول المتداولة', nameEn: 'Current Assets', accountType: 'asset', normalBalance: 'debit', sortOrder: 1100, parentCode: '1000', accountGroup: 'current_assets', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1110', nameAr: 'الخزينة', nameEn: 'Cash', accountType: 'asset', normalBalance: 'debit', sortOrder: 1110, parentCode: '1100', accountGroup: 'cash_bank', allowManualEntries: true, isControlAccount: false, isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1111', nameAr: 'الخزينة الآمنة', nameEn: 'Safe / Cash Box', accountType: 'asset', normalBalance: 'debit', sortOrder: 1111, parentCode: '1100', accountGroup: 'cash_bank', allowManualEntries: true, isControlAccount: false, isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1120', nameAr: 'البنك', nameEn: 'Bank', accountType: 'asset', normalBalance: 'debit', sortOrder: 1120, parentCode: '1100', accountGroup: 'cash_bank', allowManualEntries: true, isControlAccount: false, isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1130', nameAr: 'العملاء', nameEn: 'Accounts Receivable', accountType: 'asset', normalBalance: 'debit', sortOrder: 1130, parentCode: '1100', accountGroup: 'receivable', allowManualEntries: true, isControlAccount: true, isCashBank: false, isReceivable: true, isPayable: false, isInventory: false, isTax: false },
  { code: '1140', nameAr: 'المخزون', nameEn: 'Inventory', accountType: 'asset', normalBalance: 'debit', sortOrder: 1140, parentCode: '1100', accountGroup: 'inventory', allowManualEntries: true, isControlAccount: true, isCashBank: false, isReceivable: false, isPayable: false, isInventory: true, isTax: false },
  { code: '1150', nameAr: 'ضريبة مشتريات قابلة للخصم', nameEn: 'Purchase VAT Receivable', accountType: 'asset', normalBalance: 'debit', sortOrder: 1150, parentCode: '1100', accountGroup: 'tax', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: true },
  { code: '1155', nameAr: 'ضريبة خصم وتحصيل قابلة للخصم', nameEn: 'Withholding Tax Receivable', accountType: 'asset', normalBalance: 'debit', sortOrder: 1155, parentCode: '1100', accountGroup: 'tax', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: true },
  { code: '1160', nameAr: 'عهد وسلف موظفين', nameEn: 'Employee Advances', accountType: 'asset', normalBalance: 'debit', sortOrder: 1160, parentCode: '1100', accountGroup: 'current_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1170', nameAr: 'مصروفات مدفوعة مقدمًا', nameEn: 'Prepaid Expenses', accountType: 'asset', normalBalance: 'debit', sortOrder: 1170, parentCode: '1100', accountGroup: 'current_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1180', nameAr: 'تأمينات الحاويات المستردة', nameEn: 'Container Deposits', accountType: 'asset', normalBalance: 'debit', sortOrder: 1180, parentCode: '1100', accountGroup: 'current_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1181', nameAr: 'عهد المخلصين الجمركيين', nameEn: 'Customs Broker Advances', accountType: 'asset', normalBalance: 'debit', sortOrder: 1181, parentCode: '1100', accountGroup: 'current_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT (migration 0323): dedicated
   * supplier-advance asset — an advance posts Dr 1185 / Cr cash
   * instead of netting the 2110 payable. */
  { code: '1185', nameAr: 'دفعات مقدمة للموردين', nameEn: 'Supplier Advances', accountType: 'asset', normalBalance: 'debit', sortOrder: 1185, parentCode: '1100', accountGroup: 'current_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1200', nameAr: 'الأصول الثابتة', nameEn: 'Fixed Assets', accountType: 'asset', normalBalance: 'debit', sortOrder: 1200, parentCode: '1000', accountGroup: 'fixed_assets', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1210', nameAr: 'معدات وأجهزة', nameEn: 'Equipment', accountType: 'asset', normalBalance: 'debit', sortOrder: 1210, parentCode: '1200', accountGroup: 'fixed_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1220', nameAr: 'أثاث وتجهيزات', nameEn: 'Furniture and Fixtures', accountType: 'asset', normalBalance: 'debit', sortOrder: 1220, parentCode: '1200', accountGroup: 'fixed_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '1290', nameAr: 'مجمع الإهلاك', nameEn: 'Accumulated Depreciation', accountType: 'contra_asset', normalBalance: 'credit', sortOrder: 1290, parentCode: '1200', accountGroup: 'fixed_assets', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2000', nameAr: 'الخصوم', nameEn: 'Liabilities', accountType: 'liability', normalBalance: 'credit', sortOrder: 2000, parentCode: null, accountGroup: 'liabilities', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2100', nameAr: 'الخصوم المتداولة', nameEn: 'Current Liabilities', accountType: 'liability', normalBalance: 'credit', sortOrder: 2100, parentCode: '2000', accountGroup: 'current_liabilities', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2110', nameAr: 'الموردون', nameEn: 'Accounts Payable', accountType: 'liability', normalBalance: 'credit', sortOrder: 2110, parentCode: '2100', accountGroup: 'payable', allowManualEntries: true, isControlAccount: true, isCashBank: false, isReceivable: false, isPayable: true, isInventory: false, isTax: false },
  { code: '2120', nameAr: 'ضريبة مبيعات مستحقة', nameEn: 'Sales VAT Payable', accountType: 'liability', normalBalance: 'credit', sortOrder: 2120, parentCode: '2100', accountGroup: 'tax', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: true },
  { code: '2125', nameAr: 'بضاعة مستلمة غير مفوترة (GRNI)', nameEn: 'Goods Received Not Invoiced', accountType: 'liability', normalBalance: 'credit', sortOrder: 2125, parentCode: '2100', accountGroup: 'current_liabilities', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2126', nameAr: 'أمانات ضريبة الخصم والإضافة', nameEn: 'Withholding Tax Payable', accountType: 'liability', normalBalance: 'credit', sortOrder: 2126, parentCode: '2100', accountGroup: 'tax', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: true },
  { code: '2130', nameAr: 'مصروفات مستحقة', nameEn: 'Accrued Expenses', accountType: 'liability', normalBalance: 'credit', sortOrder: 2130, parentCode: '2100', accountGroup: 'current_liabilities', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2135', nameAr: 'أوراق دفع (شيكات مؤجلة)', nameEn: 'Notes Payable (PDC)', accountType: 'liability', normalBalance: 'credit', sortOrder: 2135, parentCode: '2100', accountGroup: 'current_liabilities', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2140', nameAr: 'رواتب مستحقة', nameEn: 'Payroll Payable', accountType: 'liability', normalBalance: 'credit', sortOrder: 2140, parentCode: '2100', accountGroup: 'current_liabilities', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '2150', nameAr: 'دفعات مقدمة من العملاء', nameEn: 'Customer Advances', accountType: 'liability', normalBalance: 'credit', sortOrder: 2150, parentCode: '2100', accountGroup: 'current_liabilities', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '3000', nameAr: 'حقوق الملكية', nameEn: 'Equity', accountType: 'equity', normalBalance: 'credit', sortOrder: 3000, parentCode: null, accountGroup: 'equity', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '3100', nameAr: 'رأس المال', nameEn: 'Capital', accountType: 'equity', normalBalance: 'credit', sortOrder: 3100, parentCode: '3000', accountGroup: 'equity', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '3200', nameAr: 'أرباح محتجزة', nameEn: 'Retained Earnings', accountType: 'equity', normalBalance: 'credit', sortOrder: 3200, parentCode: '3000', accountGroup: 'equity', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '3300', nameAr: 'مسحوبات المالك', nameEn: 'Owner Drawings', accountType: 'equity', normalBalance: 'debit', sortOrder: 3300, parentCode: '3000', accountGroup: 'equity', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '4000', nameAr: 'الإيرادات', nameEn: 'Income', accountType: 'revenue', normalBalance: 'credit', sortOrder: 4000, parentCode: null, accountGroup: 'income', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '4100', nameAr: 'مبيعات المنتجات', nameEn: 'Product Sales', accountType: 'revenue', normalBalance: 'credit', sortOrder: 4100, parentCode: '4000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '4200', nameAr: 'مبيعات الخدمات', nameEn: 'Service Sales', accountType: 'revenue', normalBalance: 'credit', sortOrder: 4200, parentCode: '4000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '4300', nameAr: 'خصومات المبيعات', nameEn: 'Sales Discounts', accountType: 'contra_revenue', normalBalance: 'debit', sortOrder: 4300, parentCode: '4000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '4400', nameAr: 'مردودات المبيعات', nameEn: 'Sales Returns', accountType: 'contra_revenue', normalBalance: 'debit', sortOrder: 4400, parentCode: '4000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '5000', nameAr: 'تكلفة البضاعة المباعة', nameEn: 'Cost of Goods Sold', accountType: 'expense', normalBalance: 'debit', sortOrder: 5000, parentCode: null, accountGroup: 'cogs', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '5100', nameAr: 'تكلفة بضاعة مباعة', nameEn: 'COGS', accountType: 'expense', normalBalance: 'debit', sortOrder: 5100, parentCode: '5000', accountGroup: 'cogs', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '5200', nameAr: 'فروق تكلفة مخزون', nameEn: 'Inventory Cost Variance', accountType: 'expense', normalBalance: 'debit', sortOrder: 5200, parentCode: '5000', accountGroup: 'cogs', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '5300', nameAr: 'هالك وتالف مخزون', nameEn: 'Damaged Inventory Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 5300, parentCode: '5000', accountGroup: 'cogs', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6000', nameAr: 'المصروفات التشغيلية', nameEn: 'Operating Expenses', accountType: 'expense', normalBalance: 'debit', sortOrder: 6000, parentCode: null, accountGroup: 'operating_expenses', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6100', nameAr: 'إيجار', nameEn: 'Rent Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6100, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6200', nameAr: 'مرتبات وأجور', nameEn: 'Salaries and Wages', accountType: 'expense', normalBalance: 'debit', sortOrder: 6200, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6300', nameAr: 'كهرباء ومرافق', nameEn: 'Utilities', accountType: 'expense', normalBalance: 'debit', sortOrder: 6300, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6400', nameAr: 'مصاريف نقل وشحن', nameEn: 'Delivery and Freight Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6400, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6500', nameAr: 'مصاريف تسويق', nameEn: 'Marketing Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6500, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6600', nameAr: 'مصاريف صيانة', nameEn: 'Maintenance Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6600, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6700', nameAr: 'مصاريف إدارية', nameEn: 'Administrative Expenses', accountType: 'expense', normalBalance: 'debit', sortOrder: 6700, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6800', nameAr: 'مصاريف بنكية', nameEn: 'Bank Fees', accountType: 'expense', normalBalance: 'debit', sortOrder: 6800, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6900', nameAr: 'مواد ومستلزمات تشغيل مصروفة', nameEn: 'Issued Operating Materials Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6900, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6950', nameAr: 'مصروفات أخرى', nameEn: 'Other Expenses', accountType: 'expense', normalBalance: 'debit', sortOrder: 6950, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '6960', nameAr: 'مصروف إهلاك الأصول الثابتة', nameEn: 'Depreciation Expense', accountType: 'expense', normalBalance: 'debit', sortOrder: 6960, parentCode: '6000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7000', nameAr: 'إيرادات ومصروفات أخرى', nameEn: 'Other Income and Expenses', accountType: 'revenue', normalBalance: 'credit', sortOrder: 7000, parentCode: null, accountGroup: 'income', allowManualEntries: false, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7100', nameAr: 'إيرادات أخرى', nameEn: 'Other Income', accountType: 'revenue', normalBalance: 'credit', sortOrder: 7100, parentCode: '7000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7110', nameAr: 'زيادة نقدية الصندوق', nameEn: 'Cash Over', accountType: 'revenue', normalBalance: 'credit', sortOrder: 7110, parentCode: '7000', accountGroup: 'income', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7200', nameAr: 'خسائر أو فروق تسوية', nameEn: 'Adjustment Losses', accountType: 'expense', normalBalance: 'debit', sortOrder: 7200, parentCode: '7000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7210', nameAr: 'عجز نقدية الصندوق', nameEn: 'Cash Short', accountType: 'expense', normalBalance: 'debit', sortOrder: 7210, parentCode: '7000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
  { code: '7290', nameAr: 'فروق التقريب المحاسبي', nameEn: 'Rounding Differences', accountType: 'expense', normalBalance: 'debit', sortOrder: 7290, parentCode: '7000', accountGroup: 'operating_expenses', allowManualEntries: true, isControlAccount: false, isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
];

@Injectable()
export class AccountingTenantFoundationService {
  private readonly initializedTenants = new Set<string>();

  private toScope(auth: AuthContext): Scope {
    const scoped = requireTenantScope(auth);
    return { tenantId: scoped.tenantId, accountId: scoped.accountId };
  }

  async ensureForAuth(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.ensureForScope(queryable, this.toScope(auth));
  }

  /**
   * يضمن أن المنشأة تملك شجرة حسابات وخريطة إعدادات **كافيتين للترحيل**.
   *
   * ثلاثة أشياء تغيّرت هنا بعد أن كشفت جولة حِمل على الإنتاج أن منصةً كاملة تبيع بلا دفاتر:
   *
   * 1. **الاكتمال بدل الوجود.** كان الشرط `count === 0` و`!settingsRow`. الهجرة 106 زرعت حسابين
   *    (GRNI وPPV) في كل منشأة فأطفأت الأول للأبد، وصفُّ إعدادات فارغ أطفأ الثاني. الآن نسأل عن
   *    الأكواد المطلوبة بالاسم وعن الأعمدة الحرجة بالاسم — `accounting-foundation.engine.ts`.
   *
   * 2. **لا نسخ من منشأة أخرى.** الكود القديم كان ينسخ شجرة «أي منشأة عندها حسابات»
   *    (`resolveSourceTenantId`). هذا تسريب بين المستأجرين: أسماء حسابات عميل وأوصافه تنتقل إلى
   *    عميل آخر. والشجرة القياسية في `DEFAULT_SEED_ACCOUNTS` تغطي كل ما تحتاجه الخريطة، فهي
   *    المصدر الوحيد الآن.
   *
   * 3. **لا ابتلاع.** كان `catch { logger.error }` يكتم فشل التهيئة، فيصل الترحيل إلى حسابات غير
   *    موجودة ويفشل هو الآخر بصمت. الخطأ يُرمى الآن ليراه من ينادي.
   */
  async ensureForScope(queryable: DbOrTx, target: Scope): Promise<void> {
    if (this.initializedTenants.has(target.tenantId)) {
      return;
    }

    let state = await this.readFoundationState(queryable, target.tenantId);

    if (findMissingAccountCodes(state.accounts.map((row) => String(row.code || ''))).length > 0) {
      await this.seedStandardChart(queryable, target);
      state = await this.readFoundationState(queryable, target.tenantId);
      const stillMissing = findMissingAccountCodes(state.accounts.map((row) => String(row.code || '')));
      if (stillMissing.length > 0) {
        throw new Error(
          `Accounting foundation incomplete for tenant "${target.tenantId}": `
          + `account codes ${stillMissing.join(', ')} are still missing after seeding.`,
        );
      }
    }

    if (findMissingSettingsColumns(state.settings).length > 0) {
      await this.writeSettingsMapping(queryable, target, state.accounts, !state.settings);
      const after = await this.readFoundationState(queryable, target.tenantId);
      const stillEmpty = findMissingSettingsColumns(after.settings);
      if (stillEmpty.length > 0) {
        throw new Error(
          `Accounting foundation incomplete for tenant "${target.tenantId}": `
          + `settings columns ${stillEmpty.join(', ')} are still empty after repair.`,
        );
      }
    }

    // A transaction may roll back after seeding. Cache only changes already committed.
    if (!(queryable as Transaction<Database>).isTransaction) {
      this.initializedTenants.add(target.tenantId);
    }
  }

  private async readFoundationState(queryable: DbOrTx, tenantId: string) {
    const accounts = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', tenantId)
      .execute();
    const settings = await queryable
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
    return {
      accounts: accounts as Array<{ id: number; code: string | null }>,
      settings: (settings as Record<string, unknown> | undefined) ?? null,
    };
  }

  /** يزرع الشجرة القياسية. `onConflict doNothing` يجعلها آمنة على منشأة نصف مزروعة. */
  private async seedStandardChart(queryable: DbOrTx, target: Scope): Promise<void> {
    for (const account of DEFAULT_SEED_ACCOUNTS) {
      await queryable
        .insertInto('accounting_accounts')
        .values({
          tenant_id: target.tenantId,
          account_id: target.accountId,
          code: account.code,
          name_ar: account.nameAr,
          name_en: account.nameEn,
          account_type: account.accountType,
          parent_id: null,
          account_group: account.accountGroup,
          normal_balance: account.normalBalance,
          is_active: true,
          is_system: true,
          allow_manual_entries: account.allowManualEntries,
          is_control_account: account.isControlAccount,
          is_cash_bank: account.isCashBank,
          is_receivable: account.isReceivable,
          is_payable: account.isPayable,
          is_inventory: account.isInventory,
          is_tax: account.isTax,
          description_ar: '',
          sort_order: account.sortOrder,
        } as any)
        .onConflict((oc) => oc.columns(['tenant_id', 'code']).doNothing())
        .execute();
    }

    for (const account of DEFAULT_SEED_ACCOUNTS) {
      if (!account.parentCode) continue;
      await sql`
        UPDATE accounting_accounts
        SET parent_id = (
          SELECT id FROM accounting_accounts
          WHERE tenant_id = ${target.tenantId} AND code = ${account.parentCode} LIMIT 1
        )
        WHERE tenant_id = ${target.tenantId} AND code = ${account.code} AND parent_id IS NULL
      `.execute(queryable);
    }
  }

  /**
   * يكتب خريطة الحسابات. يُنشئ الصف إن لم يوجد، و**يُصلح الفارغ** إن وُجد — وهذه هي الحالة التي
   * كان الكود القديم يعميها: صفٌّ قائم بكل أعمدته `NULL`.
   *
   * التحديث مشروط بـ`IS NULL` لكل عمود على حدة: خريطة ضبطها المحاسب بيده لا تُمَس.
   */
  private async writeSettingsMapping(
    queryable: DbOrTx,
    target: Scope,
    accounts: Array<{ id: number; code: string | null }>,
    insert: boolean,
  ): Promise<void> {
    const idByCode = new Map(accounts.map((row) => [String(row.code || ''), Number(row.id)]));
    const mapping = buildSettingsMapping(idByCode);

    if (insert) {
      await queryable
        .insertInto('accounting_settings')
        .values({
          tenant_id: target.tenantId,
          account_id: target.accountId,
          id: 1,
          ...mapping,
          manufacturing_overhead_account_id: null,
        } as any)
        .onConflict((oc) => oc.columns(['tenant_id', 'id']).doNothing())
        .execute();
      return;
    }

    for (const [column, value] of Object.entries(mapping)) {
      if (!value || value <= 0) continue;
      await sql`
        UPDATE accounting_settings
        SET ${sql.raw(column)} = ${value}, updated_at = NOW()
        WHERE tenant_id = ${target.tenantId} AND id = 1 AND ${sql.raw(column)} IS NULL
      `.execute(queryable);
    }
  }
}
