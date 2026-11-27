import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { ContractingProjectCostBreakdown, ContractingProjectEvmMetrics } from '../contracting.types';

/**
 * ContractingAnalyticsService — slice C8 of the contracting split.
 * Pure move of 8 methods from ContractingService (executive intelligence
 * §21, MRP §22, BoQ P&L §23, item profitability §31, project cost
 * breakdown §32, EVM §16b). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures for the 7 public methods. bucketByDueDate is PRIVATE (called
 * only by this slice's own methods) and has NO facade delegate. This
 * slice takes db + 8 bound deps (import-sales S3 pattern): getProjectById
 * (C1, x3), getBoqItems (C2, x3), getEngineeringConstants (C6, x1) +
 * getMaterialRequisitions (C5, x1), getScheduleTasks (C5, x1),
 * getGovernmentLicenses (C7, x2), getPaymentHolds (C7, x1),
 * getMobilizationExpenses (C10, x1). It posts no journals (the 2 posting
 * methods live in C4), has no FX sites (resolveFxRate 0 in the whole
 * file), and moves toFixed2 3 + inlineRound 11 (all 3 toFixed2 sites in
 * getProjectEvmMetrics; inlineRound 4+1+3+3). C8 is the LAST slice and
 * the ONLY toFixed2 mover — the facade's toFixed2 goes 3 -> 0 at C8.
 * Clock: no pin follows C8 methods (business-date-display :251 + d6c
 * :647-648 drive getProjectEvmMetrics via real service calls, behavior
 * only — no repoint); date sites travel verbatim (resolveBusinessDateKey
 * 1, new Date() 2 server stamps; the business-date-tenant-local §8 pin
 * still holds — 19 getTenantTimezone hits remain in the facade after C8,
 * the moved text has zero).
 */

export interface ContractingAnalyticsDeps {
  db: Kysely<any>;
  // Bound facade members (same names as the facade members, so the moved
  // bodies stay byte-identical): getProjectById lives in the C1 slice
  // (ContractingProjectsService), getBoqItems in the C2 slice
  // (ContractingBoqService), getEngineeringConstants in the C6 slice
  // (ContractingPricingService), getMaterialRequisitions + getScheduleTasks
  // in the C5 slice (ContractingSiteOperationsService),
  // getGovernmentLicenses + getPaymentHolds in the C7 slice
  // (ContractingMoneyOperationsService), getMobilizationExpenses in the
  // C10 slice (ContractingFieldOperationsService). All are called here
  // via the facade delegates.
  // Signatures: getProjectById(auth: AuthContext, id: string) =>
  // Promise<ContractingProjectSummary>; getBoqItems(auth: AuthContext,
  // projectId: string); getEngineeringConstants(auth: AuthContext,
  // projectId: string); getMaterialRequisitions(auth: AuthContext,
  // projectId: string); getScheduleTasks(auth: AuthContext, projectId:
  // string); getGovernmentLicenses(auth: AuthContext, projectId: string);
  // getPaymentHolds(auth: AuthContext, projectId: string);
  // getMobilizationExpenses(auth: AuthContext, projectId: string).
  getProjectById: (...args: any[]) => any;
  getBoqItems: (auth: AuthContext, projectId: string) => Promise<any[]>;
  getEngineeringConstants: (...args: any[]) => any;
  getMaterialRequisitions: (...args: any[]) => any;
  getScheduleTasks: (auth: AuthContext, projectId: string) => Promise<any[]>;
  getGovernmentLicenses: (...args: any[]) => any;
  getPaymentHolds: (...args: any[]) => any;
  getMobilizationExpenses: (...args: any[]) => any;
}

@Injectable()
export class ContractingAnalyticsService {
  private readonly db: Kysely<any>;
  private readonly getProjectById: (...args: any[]) => any;
  private readonly getBoqItems: (auth: AuthContext, projectId: string) => Promise<any[]>;
  private readonly getEngineeringConstants: (...args: any[]) => any;
  private readonly getMaterialRequisitions: (...args: any[]) => any;
  private readonly getScheduleTasks: (auth: AuthContext, projectId: string) => Promise<any[]>;
  private readonly getGovernmentLicenses: (...args: any[]) => any;
  private readonly getPaymentHolds: (...args: any[]) => any;
  private readonly getMobilizationExpenses: (...args: any[]) => any;

  constructor(deps: ContractingAnalyticsDeps) {
    this.db = deps.db;
    this.getProjectById = deps.getProjectById;
    this.getBoqItems = deps.getBoqItems;
    this.getEngineeringConstants = deps.getEngineeringConstants;
    this.getMaterialRequisitions = deps.getMaterialRequisitions;
    this.getScheduleTasks = deps.getScheduleTasks;
    this.getGovernmentLicenses = deps.getGovernmentLicenses;
    this.getPaymentHolds = deps.getPaymentHolds;
    this.getMobilizationExpenses = deps.getMobilizationExpenses;
  }

  async getProjectHealthScore(auth: AuthContext, projectId: string) {
    const project = await this.getProjectById(auth, projectId);
    const licenses = await this.getGovernmentLicenses(auth, { projectId });
    const holds = await this.getPaymentHolds(auth, { projectId, isReleased: false });

    // 1. SPI: Schedule Performance Index (completionRate / expectedProgress)
    const completionRate = project.completionRatePercent;
    const spi = completionRate >= 90 ? 1.0 : completionRate >= 70 ? 0.85 : 0.65;

    // 2. CPI: Cost Performance Index
    const budget = project.revisedContractValue || 1;
    const costIncurred = project.actualCostIncurred;
    const cpi = costIncurred <= budget ? 1.0 : Math.max(0.5, budget / (costIncurred || 1));

    // 3. Compliance & Risk deductions
    let complianceScore = 100;
    const expiredLicenses = licenses.filter((l: any) => l.status === 'expired').length;
    const expiringLicenses = licenses.filter((l: any) => l.status === 'expiring_soon').length;
    complianceScore -= expiredLicenses * 25;
    complianceScore -= expiringLicenses * 10;
    complianceScore = Math.max(0, complianceScore);

    const holdsTotal = holds.reduce((acc: number, h: any) => acc + Number(h.holdAmount || 0), 0);
    const retentionRisk = holdsTotal > 0 ? 80 : 100;

    // Composite Score calculation (0 to 100)
    let finalScore = Math.round(spi * 30 + cpi * 30 + (complianceScore / 100) * 20 + (retentionRisk / 100) * 20);
    finalScore = Math.min(100, Math.max(0, finalScore));

    const healthStatus: 'green' | 'yellow' | 'red' = finalScore >= 80 ? 'green' : finalScore >= 60 ? 'yellow' : 'red';

    const recommendations: string[] = [];
    if (expiredLicenses > 0) {
      recommendations.push(
        `يوجد ${expiredLicenses} تراخيص حكومية منتهية للمشروع يجب تجديدها فوراً لتجنب الغرامات وتوقف الأعمال.`,
      );
    }
    if (expiringLicenses > 0) {
      recommendations.push(`يوجد ${expiringLicenses} تصاريح تقترب من موعد الانتهاء خلال 30 يوماً.`);
    }
    if (holdsTotal > 0) {
      recommendations.push(
        `توجد دفعات محتجزة بقيمة ${holdsTotal.toLocaleString()} ر.س بسبب ملاحظات فنية أو عيوب استلام.`,
      );
    }
    if (project.grossMarginForecast < 0) {
      recommendations.push(`توقعات هامش الربح سالبة، يلزم مراجعة تكاليف مقاولي الباطن والمواد.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('المشروع يسير بمؤشرات إيجابية ممتازة ومتوافقة مع الميزانية والجدول الزمني.');
    }

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      score: finalScore,
      status: healthStatus,
      breakdown: {
        schedulePerformanceIndex: spi,
        costPerformanceIndex: cpi,
        budgetVariancePercent: Math.round(
          ((project.revisedContractValue - project.actualCostIncurred) / (project.revisedContractValue || 1)) * 100,
        ),
        licensesComplianceScore: complianceScore,
        retentionRiskScore: retentionRisk,
      },
      recommendations,
    };
  }

  /**
   * Buckets a set of dated amounts into 0-30 / 31-60 / 61-90 / beyond-90 windows
   * from `referenceDate`. Rows without a real due date fall into `undated`
   * rather than being silently split by a guessed percentage.
   */
  private bucketByDueDate(
    rows: { amount: number; dueDate: string | null }[],
    referenceDate: Date,
  ): { d30: number; d60: number; d90: number; beyond: number; undated: number } {
    const result = { d30: 0, d60: 0, d90: 0, beyond: 0, undated: 0 };
    const refTime = referenceDate.getTime();
    for (const row of rows) {
      if (!row.dueDate) {
        result.undated += row.amount;
        continue;
      }
      const dueTime = new Date(row.dueDate).getTime();
      const daysOut = Math.ceil((dueTime - refTime) / (1000 * 60 * 60 * 24));
      if (daysOut <= 30) result.d30 += row.amount;
      else if (daysOut <= 60) result.d60 += row.amount;
      else if (daysOut <= 90) result.d90 += row.amount;
      else result.beyond += row.amount;
    }
    return result;
  }

  /**
   * Real time-phased cash-flow forecast (replaces the earlier fixed 50/30/20%
   * heuristic split): inflows/outflows are bucketed by each IPC's actual
   * `payment_due_date`, not by a guessed distribution — a project with all
   * pending IPCs due in 10 days now correctly shows a 30-day crunch instead of
   * an evenly-smeared forecast. Rows without a due date are surfaced
   * separately (`undated`) instead of being silently folded into a bucket.
   */
  async getCashForecast(auth: AuthContext, query?: { projectId?: string }) {
    const { tenantId } = requireTenantScope(auth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Inflows: Approved but un-paid client IPC invoices
    let clientIpcsQuery = this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('ipc_type', '=', 'client')
      .where('status', 'in', ['approved', 'under_review']);

    if (query?.projectId && query.projectId !== 'all') {
      clientIpcsQuery = clientIpcsQuery.where('project_id', '=', query.projectId);
    }
    const pendingClientIpcs = await clientIpcsQuery.execute();
    const totalExpectedInflow = pendingClientIpcs.reduce((acc: number, r: any) => acc + Number(r.net_payable || 0), 0);
    const inflowBuckets = this.bucketByDueDate(
      pendingClientIpcs.map((r: any) => ({
        amount: Number(r.net_payable || 0),
        dueDate: r.payment_due_date || r.certification_due_date || null,
      })),
      today,
    );

    // Outflows: Subcontractor IPCs + Government Licenses Fees
    let subIpcsQuery = this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('ipc_type', '=', 'subcontractor')
      .where('status', 'in', ['approved', 'under_review']);

    if (query?.projectId && query.projectId !== 'all') {
      subIpcsQuery = subIpcsQuery.where('project_id', '=', query.projectId);
    }
    const pendingSubIpcs = await subIpcsQuery.execute();
    const totalPendingSubIpcs = pendingSubIpcs.reduce((acc: number, r: any) => acc + Number(r.net_payable || 0), 0);
    const subIpcOutflowBuckets = this.bucketByDueDate(
      pendingSubIpcs.map((r: any) => ({ amount: Number(r.net_payable || 0), dueDate: r.payment_due_date || null })),
      today,
    );

    const licenses = await this.getGovernmentLicenses(auth, query);
    const upcomingLicenseFees = licenses.reduce((acc: number, l: any) => acc + Number(l.feeAmount || 0), 0);
    const licenseBuckets = this.bucketByDueDate(
      licenses.map((l: any) => ({ amount: Number(l.feeAmount || 0), dueDate: l.expiryDate || null })),
      today,
    );

    const buildBucket = (period: string, label: string, inflow: number, subOut: number, licenseOut: number) => ({
      period,
      label,
      expectedInflows: Math.round(inflow),
      expectedOutflows: Math.round(subOut + licenseOut),
      netCashFlow: Math.round(inflow - (subOut + licenseOut)),
    });

    return {
      projectId: query?.projectId || 'all',
      totalCurrentCashPosition: 0,
      forecastBasis: 'due_date' as const,
      buckets: [
        buildBucket('30_days', 'خلال 30 يوماً', inflowBuckets.d30, subIpcOutflowBuckets.d30, licenseBuckets.d30),
        buildBucket('60_days', 'من 31 إلى 60 يوماً', inflowBuckets.d60, subIpcOutflowBuckets.d60, licenseBuckets.d60),
        buildBucket('90_days', 'من 61 إلى 90 يوماً', inflowBuckets.d90, subIpcOutflowBuckets.d90, licenseBuckets.d90),
        buildBucket(
          'beyond_90_days',
          'بعد 90 يوماً',
          inflowBuckets.beyond,
          subIpcOutflowBuckets.beyond,
          licenseBuckets.beyond,
        ),
      ],
      // Amounts with no recorded due date — shown separately rather than guessed into a bucket.
      undated: buildBucket(
        'undated',
        'بلا تاريخ استحقاق مسجل',
        inflowBuckets.undated,
        subIpcOutflowBuckets.undated,
        licenseBuckets.undated,
      ),
      upcomingCommitmentsSummary: {
        pendingSubcontractorIpcs: totalPendingSubIpcs,
        // Supplier payables (purchases module) and payroll are not yet linked to a specific
        // contracting project and are intentionally left out rather than estimated — see
        // ARCHITECTURE_INVARIANTS.md open items for the cash-flow forecast follow-up.
        pendingSupplierInvoices: null,
        upcomingWages: null,
        upcomingLicenseRenewals: upcomingLicenseFees,
      },
      totalExpectedInflow: Math.round(totalExpectedInflow),
      totalExpectedOutflow: Math.round(totalPendingSubIpcs + upcomingLicenseFees),
    };
  }

  async getProjectMaterialRequirements(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const boqItems = await this.getBoqItems(auth, projectId);
    const constants = await this.getEngineeringConstants(auth);
    const constMap = new Map<string, any>(constants.map((c: any) => [c.itemCode, c]));

    // Aggregator for all project materials
    const materialTotals = new Map<
      string,
      {
        code: string;
        name: string;
        unit: string;
        type: string;
        requiredQuantity: number;
        dispatchedQuantity: number;
        unitRate: number;
        totalEstimatedCost: number;
      }
    >();

    for (const item of boqItems as any[]) {
      const qty = Number(item.revised_qty || item.contract_qty || item.revisedQty || item.contractQty || 0);
      const code = (item.item_code || item.itemCode || '').trim().toUpperCase();
      const constant = constMap.get(code);

      if (constant && Array.isArray(constant.components)) {
        for (const comp of constant.components) {
          const compCode = comp.componentCode || comp.code || comp.name;
          const wasteFactor = 1 + Number(constant.wastePercent || 5) / 100;
          const reqQty = Number(comp.qtyPerUnit || 0) * qty * wasteFactor;
          const rate = Number(comp.unitRate || 0);

          const existing = materialTotals.get(compCode) || {
            code: compCode,
            name: comp.componentName || comp.name || compCode,
            unit: comp.unit || 'وحدة',
            type: comp.componentType || 'material',
            requiredQuantity: 0,
            dispatchedQuantity: 0,
            unitRate: rate,
            totalEstimatedCost: 0,
          };

          existing.requiredQuantity += reqQty;
          existing.totalEstimatedCost += reqQty * rate;
          materialTotals.set(compCode, existing);
        }
      } else {
        // Generic fallback item
        const fallbackCode = `MAT-${item.item_code || item.itemCode || 'ITEM'}`;
        const existing = materialTotals.get(fallbackCode) || {
          code: fallbackCode,
          name: `خامات بند: ${item.description}`,
          unit: item.unit,
          type: 'material',
          requiredQuantity: 0,
          dispatchedQuantity: 0,
          unitRate: Number(item.estimated_unit_cost || item.estimatedUnitCost || 0),
          totalEstimatedCost: 0,
        };
        existing.requiredQuantity += qty;
        existing.totalEstimatedCost += qty * Number(item.estimated_unit_cost || item.estimatedUnitCost || 0);
        materialTotals.set(fallbackCode, existing);
      }
    }

    // Get dispatched material requisitions for this project
    const requisitions = await this.getMaterialRequisitions(auth, projectId);
    for (const req of requisitions as any[]) {
      const itemName = (req.item_name || req.itemName || '').trim();
      for (const [key, val] of materialTotals.entries()) {
        if (
          val.name.includes(itemName) ||
          itemName.includes(val.name) ||
          key.includes(req.boq_item_id || req.boqItemId || '')
        ) {
          val.dispatchedQuantity += Number(req.quantity || 0);
        }
      }
    }

    const items = Array.from(materialTotals.values()).map((m) => {
      const remaining = Math.max(0, m.requiredQuantity - m.dispatchedQuantity);
      const fulfillmentPercent =
        m.requiredQuantity > 0 ? Math.min(100, Math.round((m.dispatchedQuantity / m.requiredQuantity) * 100)) : 0;
      return {
        ...m,
        requiredQuantity: Math.round(m.requiredQuantity * 100) / 100,
        dispatchedQuantity: Math.round(m.dispatchedQuantity * 100) / 100,
        remainingQuantity: Math.round(remaining * 100) / 100,
        fulfillmentPercent,
        totalEstimatedCost: Math.round(m.totalEstimatedCost * 100) / 100,
      };
    });

    const totalMaterialsCost = items.reduce((acc, i) => acc + i.totalEstimatedCost, 0);

    return {
      projectId,
      totalDistinctMaterialsCount: items.length,
      totalMaterialsCost,
      items,
    };
  }

  async getBoqProfitabilityAnalysis(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const boqItems = await this.getBoqItems(auth, projectId);

    // Fetch actual material costs incurred per BOQ item
    const materialReqs = await this.db
      .selectFrom('contracting_material_requisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();

    const actualMatCostByBoq = new Map<string, number>();
    for (const req of materialReqs) {
      if (req.boq_item_id) {
        const cost = Number(req.total_cost || Number(req.quantity) * Number(req.unit_cost));
        actualMatCostByBoq.set(String(req.boq_item_id), (actualMatCostByBoq.get(String(req.boq_item_id)) || 0) + cost);
      }
    }

    let totalProjectRevenue = 0;
    let totalProjectEstimatedCost = 0;
    let totalProjectActualCost = 0;
    let lossMakingItemsCount = 0;

    const analyzedItems = (boqItems as any[]).map((it) => {
      const contractQty = Number(it.contract_qty || it.contractQty || 0);
      const executedQty = Number(it.executed_qty || it.executedQty || 0);
      const unitPrice = Number(it.unit_price || it.unitPrice || 0);
      const estimatedUnitCost = Number(it.estimated_unit_cost || it.estimatedUnitCost || 0);

      const contractRevenue = Number(it.total_price || it.totalPrice || contractQty * unitPrice);
      const estimatedCost = contractQty * estimatedUnitCost;

      // True operational actual costs (Direct Labor + Direct Material + Direct Equipment + Allocated Site Indirects)
      const allocatedIndirect = Number(it.allocated_indirect_cost || it.allocatedIndirectCost || 0);
      const directLabor = Number(it.direct_labor_cost || it.directLaborCost || 0);
      const directMaterial =
        actualMatCostByBoq.get(String(it.id)) || Number(it.direct_material_cost || it.directMaterialCost || 0);
      const directEquipment = Number(it.direct_equipment_cost || it.directEquipmentCost || 0);

      const hasTrueActuals = allocatedIndirect + directLabor + directMaterial + directEquipment > 0;
      const actualCost = hasTrueActuals
        ? Math.round((allocatedIndirect + directLabor + directMaterial + directEquipment) * 1000) / 1000
        : executedQty * estimatedUnitCost;

      const earnedRevenue = executedQty * unitPrice;

      const projectedProfit = contractRevenue - estimatedCost;
      const profitMarginPercent = contractRevenue > 0 ? Math.round((projectedProfit / contractRevenue) * 100) : 0;
      const realizedProfit = earnedRevenue - actualCost;

      totalProjectRevenue += contractRevenue;
      totalProjectEstimatedCost += estimatedCost;
      totalProjectActualCost += actualCost;

      let status: 'profitable' | 'at_risk' | 'loss' = 'profitable';
      if (profitMarginPercent < 0 || actualCost > estimatedCost) {
        status = 'loss';
        lossMakingItemsCount++;
      } else if (profitMarginPercent < 15) {
        status = 'at_risk';
      }

      return {
        id: it.id,
        itemCode: it.item_code || it.itemCode,
        description: it.description,
        category: it.category,
        unit: it.unit,
        contractQty,
        executedQty,
        unitPrice,
        estimatedUnitCost,
        contractRevenue,
        estimatedCost,
        actualCost,
        directLaborCost: directLabor,
        directMaterialCost: directMaterial,
        directEquipmentCost: directEquipment,
        allocatedIndirectCost: allocatedIndirect,
        projectedProfit,
        profitMarginPercent,
        realizedProfit,
        status,
      };
    });

    const totalProjectProfit = totalProjectRevenue - totalProjectEstimatedCost;
    const overallMarginPercent =
      totalProjectRevenue > 0 ? Math.round((totalProjectProfit / totalProjectRevenue) * 100) : 0;

    return {
      projectId,
      totalProjectRevenue,
      totalProjectEstimatedCost,
      totalProjectActualCost,
      totalProjectProfit,
      overallMarginPercent,
      lossMakingItemsCount,
      itemsCount: analyzedItems.length,
      items: analyzedItems,
    };
  }

  async getItemProfitabilityLedger(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const boqItems = await this.getBoqItems(auth, projectId);

    // Fetch materials tagged with boq_item_id
    const materials = await this.db
      .selectFrom('contracting_material_requisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();

    // Fetch labor wages tagged with boq_item_id
    const laborRecords = await this.db
      .selectFrom('contracting_labor_attendance_records')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();

    // Fetch site mobilization total
    const mobRes = await this.getMobilizationExpenses(auth, projectId);
    const totalMobilization = mobRes.totalAmount;
    const nonHeaderCount = boqItems.filter((i: any) => !i.isSectionHeader && !i.is_section_header).length || 1;
    const mobilizationPerItem = totalMobilization / nonHeaderCount;

    const analyzedItems = boqItems.map((item: any) => {
      const contractQty = Number(item.revisedQty || item.contractQty || item.contract_qty || 0);
      const unitPrice = Number(item.unitPrice || item.unit_price || 0);
      const totalRevenue = contractQty * unitPrice;

      // Sum materials cost for this item
      const itemMaterials = materials.filter((m: any) => String(m.boq_item_id) === String(item.id));
      const materialsCost = itemMaterials.reduce((sum: number, m: any) => sum + Number(m.estimated_cost || 0), 0);

      // Sum labor cost for this item
      const itemLabor = laborRecords.filter((l: any) => String(l.boq_item_id) === String(item.id));
      const laborCost = itemLabor.reduce((sum: number, l: any) => sum + Number(l.total_payable || 0), 0);

      const subcontractsCost = 0; // Linked via subcontractor subcontracts if assigned
      const allocatedMobCost = item.isSectionHeader || item.is_section_header ? 0 : mobilizationPerItem;
      const totalActualCost = materialsCost + laborCost + subcontractsCost + allocatedMobCost;

      const grossProfit = totalRevenue - totalActualCost;
      const profitMarginPercent = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

      return {
        boqItemId: String(item.id),
        itemCode: item.itemCode,
        description: item.description,
        unit: item.unit,
        contractQty,
        revisedQty: contractQty,
        unitPrice,
        totalContractRevenue: totalRevenue,
        materialsCost,
        laborCost,
        subcontractsCost,
        allocatedMobilizationCost: Math.round(allocatedMobCost * 100) / 100,
        totalActualCost: Math.round(totalActualCost * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        profitMarginPercent,
        isProfitable: grossProfit >= 0,
      };
    });

    const totalRevenue = analyzedItems.reduce((s, i) => s + i.totalContractRevenue, 0);
    const totalActualCost = analyzedItems.reduce((s, i) => s + i.totalActualCost, 0);
    const totalProfit = totalRevenue - totalActualCost;
    const overallMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

    return {
      projectId,
      totalRevenue,
      totalActualCost,
      totalProfit,
      overallMarginPercent: overallMargin,
      items: analyzedItems,
    };
  }

  async getProjectCostBreakdown(auth: AuthContext, projectId: string): Promise<ContractingProjectCostBreakdown> {
    const { tenantId } = requireTenantScope(auth);
    const project = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .executeTakeFirst();

    if (!project) {
      throw new NotFoundException(`المشروع برقم ${projectId} غير موجود`);
    }

    // 1. Latest Cost Baseline
    const latestSnapshot = await this.db
      .selectFrom('contracting_cost_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const costBaseline = Number(latestSnapshot?.total_budget_cost || project.contract_value || 0);

    // 2. Total Billed Client (Approved client invoices)
    const billedClientRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount + stored_materials_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('ipc_type', '=', 'client')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    const totalBilledClient = Number(billedClientRes?.sum || 0);

    // 3. Materials Cost from Requisitions
    const materialsCostRes = await this.db
      .selectFrom('contracting_material_requisitions')
      .select(sql<number>`COALESCE(SUM(total_cost), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    const materialsCost = Number(materialsCostRes?.sum || 0);

    // 4. Labor Cost from Attendance Records
    const laborCostRes = await this.db
      .selectFrom('contracting_labor_attendance_records')
      .select(sql<number>`COALESCE(SUM(total_payable), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    const laborCost = Number(laborCostRes?.sum || 0);

    // 5. Subcontracts Cost from Subcontractor Invoices (or committed subcontracts)
    const subcontractsCostRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount + stored_materials_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('ipc_type', '=', 'subcontractor')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    let subcontractsCost = Number(subcontractsCostRes?.sum || 0);
    if (subcontractsCost === 0) {
      const subCommitments = await this.db
        .selectFrom('contracting_subcontracts')
        .select(sql<number>`COALESCE(SUM(total_amount), 0)`.as('sum'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      subcontractsCost = Number(subCommitments?.sum || 0);
    }

    // 6. Mobilization & Setup Expenses
    const mobilizationCostRes = await this.db
      .selectFrom('contracting_site_mobilization_expenses')
      .select(sql<number>`COALESCE(SUM(amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    const mobilizationCost = Number(mobilizationCostRes?.sum || 0);

    // 7. Petty Cash Settled Expenses
    const pettyCashRes = await this.db
      .selectFrom('contracting_petty_cash')
      .select(sql<number>`COALESCE(SUM(spent_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('status', '=', 'settled')
      .executeTakeFirst();
    const pettyCashCost = Number(pettyCashRes?.sum || 0);

    const totalActualCost =
      Math.round((materialsCost + laborCost + subcontractsCost + mobilizationCost + pettyCashCost) * 100) / 100;
    const costVariance = Math.round((totalActualCost - costBaseline) * 100) / 100;
    const revenueBasis = totalBilledClient > 0 ? totalBilledClient : Number(project.contract_value);
    const actualGrossProfit = Math.round((revenueBasis - totalActualCost) * 100) / 100;
    const actualProfitMarginPercent = revenueBasis > 0 ? Math.round((actualGrossProfit / revenueBasis) * 100) : 0;

    const safeTotal = totalActualCost > 0 ? totalActualCost : 1;
    const costDistribution = {
      materialsPercent: Math.round((materialsCost / safeTotal) * 100),
      laborPercent: Math.round((laborCost / safeTotal) * 100),
      subcontractsPercent: Math.round((subcontractsCost / safeTotal) * 100),
      mobilizationPercent: Math.round((mobilizationCost / safeTotal) * 100),
      pettyCashPercent: Math.round((pettyCashCost / safeTotal) * 100),
    };

    return {
      projectId: String(project.id),
      projectCode: project.code,
      projectName: project.name,
      contractValue: Number(project.contract_value),
      revisedContractValue: Number(project.revised_contract_value),
      costBaseline,
      totalBilledClient,
      materialsCost,
      laborCost,
      subcontractsCost,
      mobilizationCost,
      pettyCashCost,
      totalActualCost,
      costVariance,
      actualGrossProfit,
      actualProfitMarginPercent,
      costDistribution,
    };
  }

  async getProjectEvmMetrics(auth: AuthContext, projectId: string): Promise<ContractingProjectEvmMetrics> {
    const { tenantId } = requireTenantScope(auth);
    const project = await this.getProjectById(auth, projectId);
    const breakdown = await this.getProjectCostBreakdown(auth, projectId);

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const bac = project.revisedContractValue || project.contractValue || 1;
    const ev = Number(project.totalBilledClient || bac * (project.completionRatePercent / 100) || 0);
    const ac = Number(breakdown.totalActualCost || 0);

    // Calculate Planned Value from Schedule Tasks scheduled till today
    const tasks = await this.getScheduleTasks(auth, projectId);
    let pv = 0;
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    if (tasks.length > 0) {
      const scheduledTasks = tasks.filter((t) => (t.start_date || '') <= today);
      pv = (scheduledTasks.length / tasks.length) * bac;
    } else {
      pv = Math.max(ev, bac * 0.5);
    }

    const cv = roundMoney(ev - ac, moneyDigits);
    const sv = roundMoney(ev - pv, moneyDigits);
    const cpi = ac > 0 ? Number((ev / ac).toFixed(2)) : 1.0;
    const spi = pv > 0 ? Number((ev / pv).toFixed(2)) : 1.0;
    const eac = cpi > 0 ? roundMoney(bac / cpi, moneyDigits) : bac;
    const vac = roundMoney(bac - eac, moneyDigits);
    const tcpi = bac - ac > 0 ? Number(((bac - ev) / (bac - ac)).toFixed(2)) : 1.0;

    let healthIndicator: 'excellent' | 'good' | 'at_risk' | 'critical' = 'good';
    if (cpi >= 1.05 && spi >= 1.0) healthIndicator = 'excellent';
    else if (cpi >= 0.95 && spi >= 0.9) healthIndicator = 'good';
    else if (cpi >= 0.85 || spi >= 0.8) healthIndicator = 'at_risk';
    else healthIndicator = 'critical';

    // Generate S-Curve Data points (6 monthly points)
    const sCurvePoints = [
      {
        periodName: 'الشهر 1',
        plannedCumulative: Number((bac * 0.1).toFixed(0)),
        earnedCumulative: Number((ev * 0.15).toFixed(0)),
        actualCumulative: Number((ac * 0.12).toFixed(0)),
      },
      {
        periodName: 'الشهر 2',
        plannedCumulative: Number((bac * 0.25).toFixed(0)),
        earnedCumulative: Number((ev * 0.3).toFixed(0)),
        actualCumulative: Number((ac * 0.28).toFixed(0)),
      },
      {
        periodName: 'الشهر 3',
        plannedCumulative: Number((bac * 0.45).toFixed(0)),
        earnedCumulative: Number((ev * 0.5).toFixed(0)),
        actualCumulative: Number((ac * 0.48).toFixed(0)),
      },
      {
        periodName: 'الشهر 4',
        plannedCumulative: Number((bac * 0.7).toFixed(0)),
        earnedCumulative: Number((ev * 0.72).toFixed(0)),
        actualCumulative: Number((ac * 0.75).toFixed(0)),
      },
      {
        periodName: 'الشهر 5',
        plannedCumulative: Number((bac * 0.9).toFixed(0)),
        earnedCumulative: Number((ev * 0.88).toFixed(0)),
        actualCumulative: Number((ac * 0.92).toFixed(0)),
      },
      {
        periodName: 'الشهر 6 (الختامي)',
        plannedCumulative: Number(bac.toFixed(0)),
        earnedCumulative: Number(ev.toFixed(0)),
        actualCumulative: Number(ac.toFixed(0)),
      },
    ];

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      plannedValue: roundMoney(pv, moneyDigits),
      earnedValue: roundMoney(ev, moneyDigits),
      actualCost: roundMoney(ac, moneyDigits),
      budgetAtCompletion: roundMoney(bac, moneyDigits),
      costVariance: cv,
      scheduleVariance: sv,
      cpi,
      spi,
      estimateAtCompletion: eac,
      varianceAtCompletion: vac,
      toCompletePerformanceIndex: tcpi,
      healthIndicator,
      sCurvePoints,
    };
  }
}
