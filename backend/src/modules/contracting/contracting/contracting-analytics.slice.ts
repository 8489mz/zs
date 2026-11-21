import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  ContractingProjectCostBreakdown,
  ContractingProjectEvmMetrics,
  ContractingProjectSummary,
} from '../contracting.types';
import { ContractingAnalyticsService } from '../services/contracting-analytics.service';

export interface ContractingAnalyticsSliceBoundDeps {
  // getProjectById lives in the projects slice (ContractingProjectsSlice);
  // getBoqItems lives in the boq slice (ContractingBoqSlice);
  // getEngineeringConstants lives in the pricing slice (ContractingPricingSlice);
  // getMaterialRequisitions + getScheduleTasks live in the site-ops slice
  // (ContractingSiteOperationsSlice); getGovernmentLicenses + getPaymentHolds
  // live in the money-ops slice (ContractingMoneyOperationsSlice);
  // getMobilizationExpenses lives in the field-ops slice
  // (ContractingFieldOperationsSlice). getProjectById uses the annotated form
  // (the S-boq precedent — the facade delegate annotates it); the other 7
  // use (...args: any[]) => any per the sub-services' own precedent
  // (boq service L40, guarantees service L60-61).
  getProjectById: (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>;
  getBoqItems: (...args: any[]) => any;
  getEngineeringConstants: (...args: any[]) => any;
  getMaterialRequisitions: (...args: any[]) => any;
  getScheduleTasks: (...args: any[]) => any;
  getGovernmentLicenses: (...args: any[]) => any;
  getPaymentHolds: (...args: any[]) => any;
  getMobilizationExpenses: (...args: any[]) => any;
}

export class ContractingAnalyticsSlice {
  private readonly analyticsService: ContractingAnalyticsService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingAnalyticsSliceBoundDeps,
  ) {
    this.analyticsService = new ContractingAnalyticsService({
      db: this.db,
      getProjectById: this.bound.getProjectById,
      getBoqItems: this.bound.getBoqItems,
      getEngineeringConstants: this.bound.getEngineeringConstants,
      getMaterialRequisitions: this.bound.getMaterialRequisitions,
      getScheduleTasks: this.bound.getScheduleTasks,
      getGovernmentLicenses: this.bound.getGovernmentLicenses,
      getPaymentHolds: this.bound.getPaymentHolds,
      getMobilizationExpenses: this.bound.getMobilizationExpenses,
    });
  }

  // ==========================================================================
  // 21. Executive Intelligence: Project Health Score & Cash Forecasting
  // ==========================================================================

  async getProjectHealthScore(auth: AuthContext, projectId: string) {
    return this.analyticsService.getProjectHealthScore(auth, projectId);
  }

  async getCashForecast(auth: AuthContext, query?: { projectId?: string }) {
    return this.analyticsService.getCashForecast(auth, query);
  }

  // ==========================================================================
  // 22. Material Requirements Planning (MRP) & Bill of Materials Breakdown
  // ==========================================================================

  async getProjectMaterialRequirements(auth: AuthContext, projectId: string) {
    return this.analyticsService.getProjectMaterialRequirements(auth, projectId);
  }

  // ==========================================================================
  // 23. Item-Level Profit & Loss (P&L) & Cost Variance Analyzer
  // ==========================================================================

  async getBoqProfitabilityAnalysis(auth: AuthContext, projectId: string) {
    return this.analyticsService.getBoqProfitabilityAnalysis(auth, projectId);
  }

  // ==========================================================================
  // 31. Item-Level Direct Cost & Profitability Ledger (ربحية البند اللحظية)
  // ==========================================================================

  async getItemProfitabilityLedger(auth: AuthContext, projectId: string) {
    return this.analyticsService.getItemProfitabilityLedger(auth, projectId);
  }

  // ==========================================================================
  // 32. Comprehensive Project Actual Cost Breakdown (تحليل التكاليف الفعلية ومقارنة الميزانية)
  // ==========================================================================

  async getProjectCostBreakdown(auth: AuthContext, projectId: string): Promise<ContractingProjectCostBreakdown> {
    return this.analyticsService.getProjectCostBreakdown(auth, projectId);
  }

  // ==========================================================================
  // 16. Earned Value Management (EVM) & S-Curve Calculation Engine
  // ==========================================================================

  async getProjectEvmMetrics(auth: AuthContext, projectId: string): Promise<ContractingProjectEvmMetrics> {
    return this.analyticsService.getProjectEvmMetrics(auth, projectId);
  }
}
