import { useMemo } from 'react';
import type { ReportSummary } from '@/types/domain';
import type { CashMovementResponse, FinancialSummaryResponse, InventoryValueResponse, ReceivablesPayablesResponse } from '@/shared/api/accounting-reports';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { reportsSections, type ReportsSectionKey } from '@/features/reports/pages/reports.page-config';
import { formatPercent, relativePercent } from '@/features/reports/lib/reports-format';

import type { EmployeeReportsSummary } from '@/features/reports/api/reports.api';

type InventorySummary = { totalItems?: number; lowStock?: number; outOfStock?: number; healthy?: number; trackedLocations?: number };
type BalancesSummary = { totalItems?: number; overLimit?: number };

type MetricsInput = {
  currentSection: ReportsSectionKey;
  submittedRange: { from: string; to: string };
  report: ReportSummary | null;
  accountingFinancialSummary?: FinancialSummaryResponse | null;
  accountingCashMovement?: CashMovementResponse | null;
  accountingReceivablesPayables?: ReceivablesPayablesResponse | null;
  accountingInventoryValue?: InventoryValueResponse | null;
  inventoryQuery: { data?: { summary?: InventorySummary } };
  balancesQuery: { data?: { summary?: BalancesSummary } };
  employeesQuery?: { data?: { summary?: EmployeeReportsSummary; pagination?: { totalItems?: number } } };
};

export function useReportsWorkspaceMetrics({
  currentSection,
  submittedRange,
  report,
  accountingFinancialSummary,
  accountingCashMovement,
  accountingReceivablesPayables,
  accountingInventoryValue,
  inventoryQuery,
  balancesQuery,
  employeesQuery,
}: MetricsInput) {
  const financialCards = accountingFinancialSummary?.cards;
  const cashTotals = accountingCashMovement?.totals;
  const receivablesTotals = accountingReceivablesPayables?.totals;
  const inventoryTotals = accountingInventoryValue?.totals;
  const accountingGrossMarginPercent = financialCards?.netSales
    ? Number(((financialCards.grossProfit / Math.max(1, financialCards.netSales)) * 100).toFixed(2))
    : null;

  const executiveRows = useMemo<[string, number][]>(() => ([
    ['إجمالي البيع', report?.sales.total ?? financialCards?.grossSales ?? 0],
    ['صافي البيع', report?.sales.netSales ?? financialCards?.netSales ?? 0],
    ['إيراد الخدمات', report?.services?.total || 0],
    ['إجمالي الشراء', report?.purchases.total || 0],
    ['صافي الشراء', report?.purchases.netPurchases || 0],
    ['إجمالي المصروفات', report?.expenses.total ?? financialCards?.operatingExpenses ?? 0],
    ['مردودات وخصومات', report?.returns.total ?? (financialCards ? financialCards.salesReturns + financialCards.salesDiscounts : 0)],
    ['داخل النقدية والبنك', report?.treasury.cashIn ?? cashTotals?.totalIn ?? 0],
    ['خارج النقدية والبنك', report?.treasury.cashOut ?? cashTotals?.totalOut ?? 0],
    ['صافي حركة النقدية', report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0],
    ['مجمل الربح', report?.commercial.grossProfit ?? financialCards?.grossProfit ?? 0],
    ['هامش الربح %', report?.commercial.grossMarginPercent ?? accountingGrossMarginPercent ?? 0],
    ['صافي الربح', report?.commercial.netOperatingProfit ?? financialCards?.netProfit ?? 0],
  ]), [accountingGrossMarginPercent, cashTotals, financialCards, report]);

  const rangeDays = useMemo(() => {
    const start = new Date(submittedRange.from);
    const end = new Date(submittedRange.to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  }, [submittedRange]);

  const reportHealthRows = useMemo(() => {
    switch (currentSection) {
      case 'inventory':
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'أصناف نافدة', value: `${inventoryQuery.data?.summary?.outOfStock ?? 0} صنف` },
          { label: 'أصناف حرجة / منخفضة', value: `${inventoryQuery.data?.summary?.lowStock ?? 0} صنف` },
          { label: 'أصناف بحالة سليمة', value: `${inventoryQuery.data?.summary?.healthy ?? 0} صنف` },
        ];
      case 'sales':
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'صافي المبيعات', value: formatCurrency(report?.sales.netSales ?? financialCards?.netSales ?? 0) },
          { label: 'عدد الفواتير', value: `${report?.sales.count ?? 0} فاتورة` },
          { label: 'المرتجعات والخصم', value: formatCurrency(report?.returns.total ?? (financialCards ? financialCards.salesReturns + financialCards.salesDiscounts : 0)) },
        ];
      case 'treasury':
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'المقبوضات الكاش', value: formatCurrency(report?.treasury.cashIn ?? cashTotals?.totalIn ?? 0) },
          { label: 'المدفوعات والمصروفات', value: formatCurrency(report?.treasury.cashOut ?? cashTotals?.totalOut ?? 0) },
          { label: 'صافي حركة النقدية', value: formatCurrency(report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0) },
        ];
      case 'purchases':
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'صافي المشتريات', value: formatCurrency(report?.purchases.netPurchases ?? report?.purchases.total ?? 0) },
          { label: 'فواتير الشراء', value: `${report?.purchases.count ?? 0} فاتورة` },
          { label: 'مرتجعات الشراء', value: formatCurrency(report?.returns.purchasesTotal ?? 0) },
        ];
      case 'balances':
        return [
          { label: 'مديونيات العملاء', value: formatCurrency(receivablesTotals?.customerReceivables ?? 0) },
          { label: 'مستحقات الموردين', value: formatCurrency(receivablesTotals?.supplierPayables ?? 0) },
          { label: 'عملاء بمديونية', value: `${balancesQuery.data?.summary?.totalItems ?? 0} عميل` },
          { label: 'تجاوزوا الحد الائتماني', value: `${balancesQuery.data?.summary?.overLimit ?? 0} عميل` },
        ];
      case 'employees':
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'إجمالي الموظفين', value: `${employeesQuery?.data?.summary?.totalUsers ?? 0} موظف` },
          { label: 'سجلات النشاط', value: `${employeesQuery?.data?.pagination?.totalItems ?? 0} حركة` },
          { label: 'الموظفون النشطون', value: `${employeesQuery?.data?.summary?.activeUsers ?? 0} نشط` },
        ];
      case 'overview':
      default:
        return [
          { label: 'الأيام المغطاة', value: `${rangeDays} يوم` },
          { label: 'أصناف حرجة', value: `${inventoryQuery.data?.summary?.lowStock ?? 0} صنف` },
          { label: 'عملاء بمديونية', value: `${balancesQuery.data?.summary?.totalItems ?? 0} عميل` },
          { label: 'صافي حركة النقدية', value: formatCurrency(report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0) },
        ];
    }
  }, [
    currentSection,
    rangeDays,
    inventoryQuery.data?.summary?.outOfStock,
    inventoryQuery.data?.summary?.lowStock,
    inventoryQuery.data?.summary?.healthy,
    balancesQuery.data?.summary?.totalItems,
    balancesQuery.data?.summary?.overLimit,
    cashTotals?.totalIn,
    cashTotals?.totalOut,
    cashTotals?.netMovement,
    financialCards,
    report,
    receivablesTotals,
    employeesQuery?.data?.summary,
    employeesQuery?.data?.pagination?.totalItems,
  ]);

  const operatingSignalRows = useMemo(() => ([
    { label: 'الفجوة بيع/شراء', value: formatCurrency((report?.sales.netSales ?? financialCards?.netSales ?? 0) - (report?.purchases.netPurchases || 0)) },
    { label: 'صافي الربح', value: formatCurrency(report?.commercial.netOperatingProfit ?? financialCards?.netProfit ?? 0) },
    { label: 'هامش الربح', value: formatPercent(report?.commercial.grossMarginPercent ?? accountingGrossMarginPercent ?? 0) },
    { label: 'مردودات وخصومات', value: formatCurrency(report?.returns.total ?? (financialCards ? financialCards.salesReturns + financialCards.salesDiscounts : 0)) },
  ]), [accountingGrossMarginPercent, financialCards, report]);

  const topProducts = useMemo(() => (Array.isArray(report?.topProducts) ? report.topProducts : []), [report]);
  // INV-FE3-FRONTEND-BOOK-DIGITS: daily averages are money; they round
  // at the tenant's book digits, not hardcoded 2dp.
  const salesDailyAverage = rangeDays > 0 ? roundMoneyValue(Number(report?.sales.netSales || 0) / rangeDays, currencyMoneyDigits(getGlobalSystemCurrency())) : 0;
  const purchaseDailyAverage = rangeDays > 0 ? roundMoneyValue(Number(report?.purchases.netPurchases || 0) / rangeDays, currencyMoneyDigits(getGlobalSystemCurrency())) : 0;
  const returnRatePercent = Number(report?.sales.netSales || 0) > 0 ? Number(((Number(report?.returns.total || 0) / Math.max(1, Number(report?.sales.total || 0))) * 100).toFixed(2)) : 0;

  const spotlightValues = useMemo(() => ([
    report?.sales.netSales ?? financialCards?.netSales ?? 0,
    report?.commercial.grossProfit ?? financialCards?.grossProfit ?? 0,
    report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0,
    report?.commercial.grossMarginPercent ?? accountingGrossMarginPercent ?? 0,
  ]), [accountingGrossMarginPercent, cashTotals?.netMovement, financialCards, report]);

  const spotlightCards = useMemo(() => ([
    {
      label: 'صافي البيع',
      helper: 'بعد المرتجعات والخصومات',
      value: report?.sales.netSales ?? financialCards?.netSales ?? 0,
      tone: 'primary' as const,
      formatter: formatCurrency,
      progress: relativePercent(report?.sales.netSales ?? financialCards?.netSales ?? 0, spotlightValues),
    },
    {
      label: 'مجمل الربح',
      helper: 'بعد تكلفة البضاعة',
      value: report?.commercial.grossProfit ?? financialCards?.grossProfit ?? 0,
      tone: 'success' as const,
      formatter: formatCurrency,
      progress: relativePercent(report?.commercial.grossProfit ?? financialCards?.grossProfit ?? 0, spotlightValues),
    },
    {
      label: 'صافي حركة النقدية',
      helper: 'داخل مطروحًا منه خارج خلال الفترة',
      value: report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0,
      tone: (report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0) >= 0 ? 'success' as const : 'danger' as const,
      formatter: formatCurrency,
      progress: relativePercent(report?.treasury.net ?? cashTotals?.netMovement ?? financialCards?.netCashMovement ?? 0, spotlightValues),
    },
    {
      label: 'هامش الربح',
      helper: 'نسبة مباشرة للنطاق الحالي',
      value: accountingGrossMarginPercent ?? report?.commercial.grossMarginPercent ?? 0,
      tone: 'warning' as const,
      formatter: (value: number) => formatPercent(value),
      decimals: 2,
      progress: Math.max(10, Math.min(100, Math.round(accountingGrossMarginPercent ?? report?.commercial.grossMarginPercent ?? 0))),
    },
  ]), [accountingGrossMarginPercent, cashTotals?.netMovement, financialCards, report, spotlightValues]);

  const movementBars = useMemo(() => ([
    { label: 'البيع', value: financialCards?.netSales ?? report?.sales.netSales ?? 0, tone: 'primary' as const },
    { label: 'الخدمات', value: report?.services?.total || 0, tone: 'success' as const },
    { label: 'الشراء', value: report?.purchases.netPurchases || 0, tone: 'warning' as const },
    { label: 'المصروفات', value: financialCards?.operatingExpenses ?? report?.expenses.total ?? 0, tone: 'danger' as const },
    { label: 'المرتجعات والخصومات', value: financialCards ? financialCards.salesReturns + financialCards.salesDiscounts : report?.returns.total || 0, tone: 'danger' as const },
  ]), [financialCards, report]);

  const sectionMeta = reportsSections.find((entry) => entry.key === currentSection) || reportsSections[0];
  const sectionGuidanceCards = useMemo(() => {
    const nextStepBySection: Record<ReportsSectionKey, string> = {
      overview: 'ابدأ بالملخص التنفيذي ثم انتقل للتبويب الذي يحتاج قرارًا مباشرًا.',
      sales: 'راجع صافي البيع ومتوسط اليوم ثم انتقل إلى أعلى الأصناف لاتخاذ قرار سريع.',
      purchases: 'قارن صافي الشراء بالبيع ثم راجع التبويب لمعرفة أين يزيد الصرف.',
      inventory: 'ابدأ بالأصناف الحرجة ثم صدّر القائمة إذا احتجت متابعة تشغيلية.',
      balances: 'راجع العملاء والموردين الأعلى رصيدًا ثم اطبع أو صدّر الذمم للمراجعة.',
      customers: 'حلل شرائح العملاء ومعدلات ولائهم ومتوسط إنفاقهم لتنشيط المبيعات.',
      treasury: 'ركز على صافي حركة النقدية وصافي الربح قبل اتخاذ أي قرار صرف.',
      employees: 'ابدأ بفلترة الموظف ثم راجع تفاصيل نشاطه وملخصاته قبل أي إجراء إداري.',
      aging: 'راجع فئات تأخر السداد واتخذ إجراءات التحصيل للديون المتأخرة لأكثر من 60 يوماً.',
      forecasting: 'راجع توقعات الطلب واقتراحات إعادة الطلب للأصناف المعرضة للنفاد.',
      food_cost_variance: 'قارن الاستهلاك النظري والفعلي للمكونات وحدد الفروقات والهدر لمعالجتها.',
      menu_engineering: 'حلل ربحية وشعبية أصناف المنيو ورتب أولويات تعديل الأسعار وتطوير الوصفات.'
    };
    const attentionBySection: Record<ReportsSectionKey, string> = {
      overview: formatCurrency(financialCards?.netProfit ?? report?.commercial.netOperatingProfit ?? 0),
      sales: formatCurrency(salesDailyAverage),
      purchases: formatCurrency(purchaseDailyAverage),
      inventory: inventoryTotals ? formatCurrency(inventoryTotals.totalInventoryValue) : `${inventoryQuery.data?.summary?.lowStock || 0} صنف منخفض`,
      balances: receivablesTotals ? formatCurrency(receivablesTotals.customerReceivables - receivablesTotals.supplierPayables) : `${balancesQuery.data?.summary?.overLimit || 0} فوق الحد`,
      customers: 'تحليل ولاء وشرائح العملاء',
      treasury: formatCurrency(cashTotals?.netMovement ?? financialCards?.netCashMovement ?? report?.treasury.net ?? 0),
      employees: 'راجع سجل الموظفين بالتفصيل',
      aging: 'متابعة الديون والتحصيل',
      forecasting: 'تنبؤات حركة المخزون',
      food_cost_variance: 'مراقبة تكلفة الهدر وفروقات المكونات',
      menu_engineering: 'تحليل مصفوفة هندسة المنيو (BCG)'
    };

    return [
      { key: 'section', label: 'القسم الحالي', value: sectionMeta.label },
      { key: 'next', label: 'الخطوة الأنسب الآن', value: nextStepBySection[currentSection] },
      { key: 'range', label: 'الفترة المراجعة', value: `${rangeDays} يوم` },
      { key: 'attention', label: 'أهم رقم الآن', value: attentionBySection[currentSection] },
    ];
  }, [balancesQuery.data?.summary?.overLimit, cashTotals?.netMovement, currentSection, financialCards, inventoryQuery.data?.summary?.lowStock, inventoryTotals, purchaseDailyAverage, rangeDays, receivablesTotals, report, salesDailyAverage, sectionMeta.label]);

  return {
    executiveRows,
    rangeDays,
    reportHealthRows,
    operatingSignalRows,
    topProducts,
    salesDailyAverage,
    purchaseDailyAverage,
    returnRatePercent,
    spotlightCards,
    movementBars,
    sectionMeta,
    sectionGuidanceCards,
  };
}
