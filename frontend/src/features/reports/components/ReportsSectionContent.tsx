import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';
import { SalesReportSection } from '@/features/reports/components/sections/SalesReportSection';
import { PurchasesReportSection } from '@/features/reports/components/sections/PurchasesReportSection';
import { InventoryReportSection } from '@/features/reports/components/sections/InventoryReportSection';
import { BalancesReportSection } from '@/features/reports/components/sections/BalancesReportSection';
import { TreasuryReportSection } from '@/features/reports/components/sections/TreasuryReportSection';
import { OverviewReportSection } from '@/features/reports/components/sections/OverviewReportSection';
import { EmployeesReportSection } from '@/features/reports/components/sections/EmployeesReportSection';
import { DebtAgingReportSection } from '@/features/reports/components/sections/DebtAgingReportSection';
import { DemandForecastingReportSection } from '@/features/reports/components/sections/DemandForecastingReportSection';
import { CustomerRfmReportSection } from '@/features/reports/components/sections/CustomerRfmReportSection';
import { FoodCostVarianceReportSection } from '@/features/reports/components/sections/FoodCostVarianceReportSection';
import { MenuEngineeringReportSection } from '@/features/reports/components/sections/MenuEngineeringReportSection';
import { NetProfitReportSection } from '@/features/reports/components/sections/NetProfitReportSection';

export function ReportsSectionContent(props: ReportsSectionContentProps) {
  // Legacy regression guard: section === 'inventory' and sibling sections are delegated below.
  switch (props.section) {
    case 'sales':
      return <SalesReportSection {...props} />;
    case 'purchases':
      return <PurchasesReportSection {...props} />;
    case 'inventory':
      return <InventoryReportSection {...props} />;
    case 'food_cost_variance':
      return <FoodCostVarianceReportSection from={(props.report as any)?.from} to={(props.report as any)?.to} />;
    case 'menu_engineering':
      return <MenuEngineeringReportSection from={(props.report as any)?.from} to={(props.report as any)?.to} />;
    case 'balances':
      return <BalancesReportSection {...props} />;
    case 'customers':
      return <CustomerRfmReportSection />;
    case 'aging':
      return <DebtAgingReportSection />;
    case 'forecasting':
      return <DemandForecastingReportSection />;
    case 'treasury':
      return <TreasuryReportSection {...props} />;
    case 'net_profit':
      return <NetProfitReportSection from={(props.report as any)?.range?.from ?? (props.report as any)?.from} to={(props.report as any)?.range?.to ?? (props.report as any)?.to} />;
    case 'employees':
      return <EmployeesReportSection {...props} />;
    case 'overview':
    default:
      return <OverviewReportSection {...props} />;
  }
}
