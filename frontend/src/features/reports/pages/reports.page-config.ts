export type ReportsSectionKey = 'overview' | 'sales' | 'purchases' | 'inventory' | 'food_cost_variance' | 'menu_engineering' | 'balances' | 'treasury' | 'net_profit' | 'employees' | 'aging' | 'forecasting' | 'customers';

export interface ReportsSectionConfig {
  key: ReportsSectionKey;
  label: string;
  description?: string;
  restaurantOnly?: boolean;
}

export const reportsSections: ReportsSectionConfig[] = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'sales', label: 'المبيعات' },
  { key: 'treasury', label: 'الخزنة والربحية' },
  // INV-VAN-PROFIT-REP-REPORTING: standalone net-profit view.
  { key: 'net_profit', label: 'صافي الربح' },
  { key: 'inventory', label: 'المخزون' },
  { key: 'food_cost_variance', label: 'تكاليف الأغذية وانحراف الهدر (F&B)', restaurantOnly: true },
  { key: 'menu_engineering', label: 'هندسة المنيو وربحية الأطباق (BCG Matrix)', restaurantOnly: true },
  { key: 'balances', label: 'الذمم' },
  { key: 'customers', label: 'سلوك العملاء (RFM)' },
  { key: 'aging', label: 'أعمار الديون' },
  { key: 'forecasting', label: 'التنبؤ بالطلب' },
  { key: 'purchases', label: 'المشتريات' },
  { key: 'employees', label: 'الموظفون' },
];

export function isReportsSection(value: string | undefined): value is ReportsSectionKey {
  return reportsSections.some((section) => section.key === value);
}
