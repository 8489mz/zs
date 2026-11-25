import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  CreateGuaranteeDto,
  UpdateGuaranteeDto,
  ExtendGuaranteeDto,
  ReleaseGuaranteeDto,
  InvokeGuaranteeDto,
  CreateCostPoolDto,
  CreateIndirectExpenseDto,
  CreateAllocationBatchDto,
} from '../dto/contracting.dto';
import { evaluateGuaranteeExpiryAlerts, BankGuarantee } from '../guarantee-gateway.engine';
import {
  computeBatchAllocation,
  CostPoolInput,
  BoqDriverMetricsInput,
  BatchAllocationSummary,
} from '../field-indirect-allocation.engine';

/**
 * ContractingGuaranteesService — slice C13 of the contracting split.
 * Pure move of 17 methods from ContractingService (bank guarantees +
 * cost pools + indirect expenses + batch allocations, §38). No behavior
 * change: the bodies are byte-identical; the facade keeps thin delegates
 * with the same names and signatures for all 17 public methods. This
 * slice takes db + 4 bound deps (import-sales S3 pattern): getProjectById
 * (C1, x3 — createGuarantee, createCostPool, createIndirectExpense),
 * getBoqItems (C2, x1 — previewBatchAllocation), getSubcontractById +
 * getSubcontractorById (C12, x1 each — createGuarantee). It posts no
 * journals (the 2 posting methods live in C4), has no FX sites
 * (resolveFxRate 0 in the whole file), and moves toFixed2 0 +
 * inlineRound 1 (the one site is in createIndirectExpense). Clock-p4 §D
 * drives getGuaranteesRaw + getGuarantees through the repointed
 * construction (new ContractingService(db, {} as never)); date sites
 * travel verbatim (getTenantTimezone 1, resolveBusinessDateKey 3,
 * formatLocalCalendarDay 6, new Date() 10, Date.now() 1 temp-code token;
 * the business-date-tenant-local §8 pin still holds — 18
 * getTenantTimezone hits remain in the facade after C13).
 */

export interface ContractingGuaranteesDeps {
  db: Kysely<any>;
  // Bound facade members (same names as the facade members, so the moved
  // bodies stay byte-identical): getProjectById lives in the C1 slice
  // (ContractingProjectsService), getBoqItems in the C2 slice
  // (ContractingBoqService), getSubcontractById + getSubcontractorById in
  // the C12 slice (ContractingSubcontractorsService). All are called here
  // via the facade delegates.
  // Signatures: getProjectById(auth: AuthContext, id: string) =>
  // Promise<ContractingProjectSummary>; getBoqItems(auth: AuthContext,
  // projectId: string); getSubcontractById(auth: AuthContext, id: string);
  // getSubcontractorById(auth: AuthContext, id: number).
  getProjectById: (...args: any[]) => any;
  getBoqItems: (...args: any[]) => any;
  getSubcontractById: (...args: any[]) => any;
  getSubcontractorById: (...args: any[]) => any;
}

@Injectable()
export class ContractingGuaranteesService {
  private readonly db: Kysely<any>;
  private readonly getProjectById: (...args: any[]) => any;
  private readonly getBoqItems: (...args: any[]) => any;
  private readonly getSubcontractById: (...args: any[]) => any;
  private readonly getSubcontractorById: (...args: any[]) => any;

  constructor(deps: ContractingGuaranteesDeps) {
    this.db = deps.db;
    this.getProjectById = deps.getProjectById;
    this.getBoqItems = deps.getBoqItems;
    this.getSubcontractById = deps.getSubcontractById;
    this.getSubcontractorById = deps.getSubcontractorById;
  }

  async getGuaranteesRaw(
    tenantId: string,
    filters: { projectId?: string; subcontractId?: string; status?: string } = {},
  ): Promise<BankGuarantee[]> {
    let query = (this.db as any).selectFrom('contracting_guarantees').selectAll().where('tenant_id', '=', tenantId);

    if (filters.projectId) {
      query = query.where('project_id', '=', String(filters.projectId));
    }
    if (filters.subcontractId) {
      query = query.where('subcontract_id', '=', String(filters.subcontractId));
    }
    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }

    const rows = await query.orderBy('expiry_date', 'asc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      tenant_id: String(r.tenant_id),
      project_id: String(r.project_id),
      subcontract_id: r.subcontract_id ? String(r.subcontract_id) : null,
      subcontractor_id: r.subcontractor_id ? String(r.subcontractor_id) : null,
      guarantee_number: r.guarantee_number,
      guarantee_type: r.guarantee_type,
      issuing_bank: r.issuing_bank,
      amount: Number(r.amount),
      currency: r.currency || 'EGP',
      issue_date: typeof r.issue_date === 'string' ? r.issue_date : formatLocalCalendarDay(new Date(r.issue_date)),
      expiry_date: typeof r.expiry_date === 'string' ? r.expiry_date : formatLocalCalendarDay(new Date(r.expiry_date)),
      claim_expiry_date: r.claim_expiry_date
        ? typeof r.claim_expiry_date === 'string'
          ? r.claim_expiry_date
          : formatLocalCalendarDay(new Date(r.claim_expiry_date))
        : null,
      reduction_schedule: r.reduction_schedule,
      status: r.status,
    }));
  }

  async getGuarantees(
    auth: AuthContext,
    query: {
      projectId?: string;
      subcontractId?: string;
      subcontractorId?: number;
      status?: string;
      guaranteeType?: string;
    } = {},
  ) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_guarantees as g')
      .leftJoin('contracting_projects as p', 'p.id', 'g.project_id')
      .leftJoin('contracting_subcontracts as s', 's.id', 'g.subcontract_id')
      .leftJoin('contracting_subcontractors as sub', 'sub.id', 'g.subcontractor_id')
      .select([
        'g.id',
        'g.tenant_id',
        'g.project_id',
        'p.name as project_name',
        'p.code as project_code',
        'g.subcontract_id',
        's.contract_number as subcontract_number',
        's.scope_of_work as subcontract_title',
        'g.subcontractor_id',
        'sub.name as subcontractor_name',
        'g.guarantee_number',
        'g.guarantee_type',
        'g.issuing_bank',
        'g.amount',
        'g.currency',
        'g.issue_date',
        'g.expiry_date',
        'g.claim_expiry_date',
        'g.reduction_schedule',
        'g.status',
        'g.document_url',
        'g.notes',
        'g.created_at',
        'g.updated_at',
      ])
      .where('g.tenant_id', '=', tenantId);

    if (query.projectId) {
      q = q.where('g.project_id', '=', String(query.projectId));
    }
    if (query.subcontractId) {
      q = q.where('g.subcontract_id', '=', String(query.subcontractId));
    }
    if (query.subcontractorId) {
      q = q.where('g.subcontractor_id', '=', Number(query.subcontractorId));
    }
    if (query.status) {
      q = q.where('g.status', '=', query.status);
    }
    if (query.guaranteeType) {
      q = q.where('g.guarantee_type', '=', query.guaranteeType);
    }

    const rows = await q.orderBy('g.expiry_date', 'asc').execute();
    const todayStr = await resolveBusinessDateKey(this.db, tenantId, new Date());

    return rows.map((r: any) => {
      const expDate = new Date(r.expiry_date);
      const diffMs = expDate.getTime() - new Date(todayStr).getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      let alertTier: 'critical_t7' | 'warning_t30' | 'info_t60' | 'expired' | 'healthy' = 'healthy';
      if (r.status === 'active') {
        if (daysRemaining < 0) alertTier = 'expired';
        else if (daysRemaining <= 7) alertTier = 'critical_t7';
        else if (daysRemaining <= 30) alertTier = 'warning_t30';
        else if (daysRemaining <= 60) alertTier = 'info_t60';
      }

      return {
        id: String(r.id),
        projectId: String(r.project_id),
        projectName: r.project_name || null,
        projectCode: r.project_code || null,
        subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
        subcontractNumber: r.subcontract_number || null,
        subcontractTitle: r.subcontract_title || null,
        subcontractorId: r.subcontractor_id ? Number(r.subcontractor_id) : null,
        subcontractorName: r.subcontractor_name || null,
        guaranteeNumber: r.guarantee_number,
        guaranteeType: r.guarantee_type,
        issuingBank: r.issuing_bank,
        amount: Number(r.amount),
        currency: r.currency || 'EGP',
        issueDate: typeof r.issue_date === 'string' ? r.issue_date : formatLocalCalendarDay(new Date(r.issue_date)),
        expiryDate: typeof r.expiry_date === 'string' ? r.expiry_date : formatLocalCalendarDay(new Date(r.expiry_date)),
        claimExpiryDate: r.claim_expiry_date
          ? typeof r.claim_expiry_date === 'string'
            ? r.claim_expiry_date
            : formatLocalCalendarDay(new Date(r.claim_expiry_date))
          : null,
        reductionSchedule: r.reduction_schedule,
        status: r.status,
        documentUrl: r.document_url || null,
        notes: r.notes || null,
        daysRemaining,
        alertTier,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async getGuaranteeById(auth: AuthContext, id: string) {
    const list = await this.getGuarantees(auth);
    const found = list.find((g: any) => g.id === id);
    if (!found) {
      throw new NotFoundException(`خطاب الضمان برقم ${id} غير موجود`);
    }
    return found;
  }

  async createGuarantee(auth: AuthContext, dto: CreateGuaranteeDto) {
    const { tenantId } = requireTenantScope(auth);
    const amount = Number(dto.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('قيمة خطاب الضمان يجب أن تكون أكبر من الصفر');
    }

    if (dto.issueDate > dto.expiryDate) {
      throw new BadRequestException('تاريخ انتهاء الضمان يجب أن يكون بعد تاريخ الإصدار');
    }

    await this.getProjectById(auth, dto.projectId);

    if (dto.subcontractId) {
      await this.getSubcontractById(auth, dto.subcontractId);
    }

    if (dto.subcontractorId) {
      await this.getSubcontractorById(auth, dto.subcontractorId);
    }

    const [inserted] = await (this.db as any)
      .insertInto('contracting_guarantees')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId,
        subcontract_id: dto.subcontractId ? String(dto.subcontractId) : null,
        subcontractor_id: dto.subcontractorId ? Number(dto.subcontractorId) : null,
        guarantee_number: dto.guaranteeNumber.trim(),
        guarantee_type: dto.guaranteeType,
        issuing_bank: dto.issuingBank.trim(),
        amount,
        currency: dto.currency || 'EGP',
        issue_date: dto.issueDate,
        expiry_date: dto.expiryDate,
        claim_expiry_date: dto.claimExpiryDate || null,
        reduction_schedule: dto.reductionSchedule ? JSON.stringify(dto.reductionSchedule) : null,
        status: 'active',
        document_url: dto.documentUrl?.trim() || null,
        notes: dto.notes?.trim() || null,
      })
      .returningAll()
      .execute();

    return this.getGuaranteeById(auth, String(inserted.id));
  }

  async updateGuarantee(auth: AuthContext, id: string, dto: UpdateGuaranteeDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getGuaranteeById(auth, id);

    const updates: any = {
      updated_at: new Date(),
    };

    if (dto.issuingBank !== undefined) updates.issuing_bank = dto.issuingBank.trim();
    if (dto.amount !== undefined) {
      const amt = Number(dto.amount);
      if (isNaN(amt) || amt <= 0) throw new BadRequestException('قيمة خطاب الضمان يجب أن تكون أكبر من الصفر');
      updates.amount = amt;
    }
    if (dto.currency !== undefined) updates.currency = dto.currency;
    if (dto.claimExpiryDate !== undefined) updates.claim_expiry_date = dto.claimExpiryDate || null;
    if (dto.reductionSchedule !== undefined) updates.reduction_schedule = JSON.stringify(dto.reductionSchedule);
    if (dto.documentUrl !== undefined) updates.document_url = dto.documentUrl?.trim() || null;
    if (dto.notes !== undefined) updates.notes = dto.notes?.trim() || null;

    await (this.db as any)
      .updateTable('contracting_guarantees')
      .set(updates)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return this.getGuaranteeById(auth, id);
  }

  async extendGuarantee(auth: AuthContext, id: string, dto: ExtendGuaranteeDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.getGuaranteeById(auth, id);

    if (dto.newExpiryDate <= existing.issueDate) {
      throw new BadRequestException('تاريخ التمديد يجب أن يكون بعد تاريخ إصدار خطاب الضمان');
    }

    const noteAppend = dto.notes
      ? ` | تمديد حتى ${dto.newExpiryDate}: ${dto.notes}`
      : ` | تمديد بنكي حتى ${dto.newExpiryDate}`;
    const combinedNotes = existing.notes ? `${existing.notes}${noteAppend}` : noteAppend.replace(/^ \| /, '');

    await (this.db as any)
      .updateTable('contracting_guarantees')
      .set({
        expiry_date: dto.newExpiryDate,
        claim_expiry_date: dto.newClaimExpiryDate || existing.claimExpiryDate,
        status: 'active',
        notes: combinedNotes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return this.getGuaranteeById(auth, id);
  }

  async releaseGuarantee(auth: AuthContext, id: string, dto: ReleaseGuaranteeDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.getGuaranteeById(auth, id);

    const noteAppend = dto.notes
      ? ` | إفراج بتاريخ ${dto.releaseDate}: ${dto.notes}`
      : ` | تم الإفراج ورد أصل الخطاب بتاريخ ${dto.releaseDate}`;
    const combinedNotes = existing.notes ? `${existing.notes}${noteAppend}` : noteAppend.replace(/^ \| /, '');

    await (this.db as any)
      .updateTable('contracting_guarantees')
      .set({
        status: 'released',
        notes: combinedNotes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return this.getGuaranteeById(auth, id);
  }

  async invokeGuarantee(auth: AuthContext, id: string, dto: InvokeGuaranteeDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.getGuaranteeById(auth, id);

    if (existing.status !== 'active') {
      throw new BadRequestException(`لا يمكن تسييل أو مصادرة خطاب ضمان بحالة (${existing.status})`);
    }

    const noteAppend = ` | تسييل/مصادرة بتاريخ ${dto.invocationDate} بمبلغ (${dto.invokedAmount || existing.amount} ${existing.currency}). السبب: ${dto.reason}`;
    const combinedNotes = existing.notes ? `${existing.notes}${noteAppend}` : noteAppend.replace(/^ \| /, '');

    await (this.db as any)
      .updateTable('contracting_guarantees')
      .set({
        status: 'confiscated_invoked',
        notes: combinedNotes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return this.getGuaranteeById(auth, id);
  }

  async getGuaranteeExpiryAlerts(auth: AuthContext, projectId?: string) {
    const { tenantId } = requireTenantScope(auth);
    const rawGuarantees = await this.getGuaranteesRaw(tenantId, { projectId });
    const todayStr = await resolveBusinessDateKey(this.db, tenantId, new Date());
    return evaluateGuaranteeExpiryAlerts(rawGuarantees, todayStr);
  }

  async initializeDefaultCostPools(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await (this.db as any)
      .selectFrom('contracting_cost_pools')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .execute();

    if (existing.length > 0) return;

    const defaults = [
      {
        pool_code: 'P1_LABOR_CARE',
        pool_name: 'سكن وإعاشة وانتقالات العمالة',
        pool_type: 'labor_care',
        driver_type: 'labor_days',
        description: 'إيجار سكن العمال والمشرفين، الوجبات والإعاشة، وحافلات النقل الميدانية',
      },
      {
        pool_code: 'P2_LABOR_BURDEN',
        pool_name: 'أعباء وتأمينات ومزايا العمالة',
        pool_type: 'labor_burden',
        driver_type: 'labor_cost',
        description: 'التأمينات الاجتماعية، رسوم الإقامات، تصاريح العمل، وتذاكر السفر الميدانية',
      },
      {
        pool_code: 'P3_EQUIP_SHARED',
        pool_name: 'المعدات العامة ومولدات الموقع والمحروقات',
        pool_type: 'equipment_shared',
        driver_type: 'equipment_hours',
        description: 'مولدات الكهرباء المشتركة، أبراج الإنارة، صهاريج المياه، والوقود المشترك',
      },
      {
        pool_code: 'P4_SITE_SUPERVISION',
        pool_name: 'إدارة وإشراف الموقع وكرفانات المهندسين',
        pool_type: 'site_supervision',
        driver_type: 'direct_effort',
        description: 'رواتب الجهاز الهندسي بالموقع، كرفان الإدارة، تراخيص مؤقتة، وأمن وحراسة',
      },
    ];

    for (const d of defaults) {
      await (this.db as any)
        .insertInto('contracting_cost_pools')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          pool_code: d.pool_code,
          pool_name: d.pool_name,
          pool_type: d.pool_type,
          driver_type: d.driver_type,
          description: d.description,
          is_active: true,
        })
        .execute();
    }
  }

  async getCostPools(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.initializeDefaultCostPools(auth, projectId);

    const pools = await (this.db as any)
      .selectFrom('contracting_cost_pools')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('pool_code', 'asc')
      .execute();

    return pools.map((p: any) => ({
      id: String(p.id),
      projectId: String(p.project_id),
      poolCode: p.pool_code,
      poolName: p.pool_name,
      poolType: p.pool_type,
      driverType: p.driver_type,
      description: p.description,
      isActive: Boolean(p.is_active),
      createdAt: p.created_at,
    }));
  }

  async createCostPool(auth: AuthContext, projectId: string, dto: CreateCostPoolDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const [inserted] = await (this.db as any)
      .insertInto('contracting_cost_pools')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        pool_code: dto.poolCode.trim().toUpperCase(),
        pool_name: dto.poolName.trim(),
        pool_type: dto.poolType,
        driver_type: dto.driverType,
        description: dto.description || null,
        is_active: true,
      })
      .returningAll()
      .execute();

    return {
      id: String(inserted.id),
      projectId: String(inserted.project_id),
      poolCode: inserted.pool_code,
      poolName: inserted.pool_name,
      poolType: inserted.pool_type,
      driverType: inserted.driver_type,
      description: inserted.description,
      isActive: Boolean(inserted.is_active),
      createdAt: inserted.created_at,
    };
  }

  async getIndirectExpenses(auth: AuthContext, projectId: string, poolId?: string) {
    const { tenantId } = requireTenantScope(auth);
    let query = (this.db as any)
      .selectFrom('contracting_indirect_expenses as ie')
      .innerJoin('contracting_cost_pools as cp', 'cp.id', 'ie.pool_id')
      .select([
        'ie.id',
        'ie.project_id',
        'ie.pool_id',
        'ie.batch_id',
        'ie.mobilization_expense_id',
        'ie.expense_title',
        'ie.gross_amount',
        'ie.recovered_amount',
        'ie.net_amount',
        'ie.expense_date',
        'ie.voucher_ref',
        'ie.created_at',
        'cp.pool_code',
        'cp.pool_name',
        'cp.pool_type',
        'cp.driver_type',
      ])
      .where('ie.tenant_id', '=', tenantId)
      .where('ie.project_id', '=', projectId as any);

    if (poolId) {
      query = query.where('ie.pool_id', '=', poolId as any);
    }

    const rows = await query.orderBy('ie.expense_date', 'desc').execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      poolId: String(r.pool_id),
      poolCode: r.pool_code,
      poolName: r.pool_name,
      poolType: r.pool_type,
      driverType: r.driver_type,
      batchId: r.batch_id ? String(r.batch_id) : null,
      mobilizationExpenseId: r.mobilization_expense_id ? String(r.mobilization_expense_id) : null,
      expenseTitle: r.expense_title,
      grossAmount: Number(r.gross_amount || 0),
      recoveredAmount: Number(r.recovered_amount || 0),
      netAmount: Number(r.net_amount || 0),
      expenseDate: r.expense_date,
      voucherRef: r.voucher_ref,
      createdAt: r.created_at,
    }));
  }

  async createIndirectExpense(auth: AuthContext, projectId: string, dto: CreateIndirectExpenseDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const gross = Number(dto.grossAmount || 0);
    const recovered = Number(dto.recoveredAmount || 0);
    const net = Math.round(Math.max(0, gross - recovered) * 1000) / 1000;

    const [inserted] = await (this.db as any)
      .insertInto('contracting_indirect_expenses')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        pool_id: dto.poolId as any,
        expense_title: dto.expenseTitle.trim(),
        gross_amount: gross,
        recovered_amount: recovered,
        net_amount: net,
        expense_date: dto.expenseDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        voucher_ref: dto.voucherRef || null,
        mobilization_expense_id: dto.mobilizationExpenseId ? (dto.mobilizationExpenseId as any) : null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async getAllocationBatches(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const batches = await (this.db as any)
      .selectFrom('contracting_allocation_batches')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('period_start', 'desc')
      .execute();

    return batches.map((b: any) => ({
      id: String(b.id),
      projectId: String(b.project_id),
      batchNumber: b.batch_number,
      periodStart: b.period_start,
      periodEnd: b.period_end,
      status: b.status,
      totalGrossExpenses: Number(b.total_gross_expenses || 0),
      totalRecoveredBackcharges: Number(b.total_recovered_backcharges || 0),
      totalNetPoolCost: Number(b.total_net_pool_cost || 0),
      totalAllocatedAmount: Number(b.total_allocated_amount || 0),
      deferredInAmount: Number(b.deferred_in_amount || 0),
      deferredOutAmount: Number(b.deferred_out_amount || 0),
      postedAt: b.posted_at,
      postedBy: b.posted_by,
      notes: b.notes,
      createdAt: b.created_at,
    }));
  }

  async previewBatchAllocation(
    auth: AuthContext,
    projectId: string,
    dto: CreateAllocationBatchDto,
  ): Promise<BatchAllocationSummary> {
    const { tenantId } = requireTenantScope(auth);
    const pools = await this.getCostPools(auth, projectId);
    const boqItems = await this.getBoqItems(auth, projectId);

    // Fetch unallocated or in-period indirect expenses
    const expenses = await (this.db as any)
      .selectFrom('contracting_indirect_expenses')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where((eb: any) =>
        eb.or([
          eb('batch_id', 'is', null),
          eb.and([eb('expense_date', '>=', dto.periodStart), eb('expense_date', '<=', dto.periodEnd)]),
        ]),
      )
      .execute();

    // Map expenses by pool
    const poolExpenseMap = new Map<string, { gross: number; recovered: number }>();
    for (const exp of expenses) {
      const pId = String(exp.pool_id);
      const curr = poolExpenseMap.get(pId) || { gross: 0, recovered: 0 };
      curr.gross += Number(exp.gross_amount || 0);
      curr.recovered += Number(exp.recovered_amount || 0);
      poolExpenseMap.set(pId, curr);
    }

    // Prepare CostPoolInput array
    const poolInputs: CostPoolInput[] = pools.map((p: any) => {
      const exp = poolExpenseMap.get(p.id) || { gross: 0, recovered: 0 };
      return {
        poolId: p.id,
        poolCode: p.poolCode,
        poolName: p.poolName,
        poolType: p.poolType,
        driverType: p.driverType,
        grossExpenseAmount: exp.gross,
        recoveredBackchargeAmount: exp.recovered,
        deferredInAmount: p.poolCode === 'P1_LABOR_CARE' ? Number(dto.deferredInAmount || 0) : 0,
      };
    });

    // Fetch labor attendance driver metrics in period
    const attendanceRecords = await (this.db as any)
      .selectFrom('contracting_labor_attendance_records')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('attendance_date', '>=', dto.periodStart)
      .where('attendance_date', '<=', dto.periodEnd)
      .execute();

    const laborMetricsByBoq = new Map<string, { days: number; cost: number }>();
    for (const att of attendanceRecords) {
      if (att.boq_item_id) {
        const idStr = String(att.boq_item_id);
        const curr = laborMetricsByBoq.get(idStr) || { days: 0, cost: 0 };
        curr.days += att.status === 'present' ? 1 : att.status === 'half_day' ? 0.5 : 0;
        curr.cost += Number(att.total_payable || 0);
        laborMetricsByBoq.set(idStr, curr);
      }
    }

    // Fetch equipment fuel/meter logs driver metrics in period
    const equipmentLogs = await (this.db as any)
      .selectFrom('contracting_equipment_fuel_logs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('log_date', '>=', dto.periodStart)
      .where('log_date', '<=', dto.periodEnd)
      .execute();

    const equipMetricsByBoq = new Map<string, { hours: number; cost: number }>();
    for (const eq of equipmentLogs) {
      if (eq.boq_item_id) {
        const idStr = String(eq.boq_item_id);
        const curr = equipMetricsByBoq.get(idStr) || { hours: 0, cost: 0 };
        curr.hours += Number(eq.operating_hours || 0);
        curr.cost += Number(eq.fuel_cost_total || 0);
        equipMetricsByBoq.set(idStr, curr);
      }
    }

    // Prepare BoqDriverMetricsInput array
    const boqDrivers: BoqDriverMetricsInput[] = (boqItems as any[]).map((it) => {
      const idStr = String(it.id);
      const labor = laborMetricsByBoq.get(idStr) || { days: 0, cost: 0 };
      const equip = equipMetricsByBoq.get(idStr) || { hours: 0, cost: 0 };

      return {
        boqItemId: idStr,
        boqCode: it.item_code || it.itemCode || `BOQ-${idStr}`,
        description: it.description || '',
        laborDays: labor.days,
        laborCost: labor.cost,
        equipmentHours: equip.hours,
        directEquipmentCost: equip.cost,
        directMaterialCost: 0, // Material cost strictly NOT used as driver!
      };
    });

    // Run pure calculation engine
    return computeBatchAllocation(poolInputs, boqDrivers);
  }

  async postBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    const summary = await this.previewBatchAllocation(auth, projectId, dto);

    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): the batch number derives from the row id inside one
    // transaction, never from a COUNT(*) over all tenant batches.
    const prefix = getDailyDocumentPrefix('ALLOC', undefined, businessTz);
    const tempNumber = `ALLOC-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Insert batch
    const batch = await this.db.transaction().execute(async (trx) => {
      const inserted = await (trx as any)
        .insertInto('contracting_allocation_batches')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          batch_number: tempNumber,
          period_start: dto.periodStart,
          period_end: dto.periodEnd,
          status: 'posted',
          total_gross_expenses: summary.totalGrossExpense,
          total_recovered_backcharges: summary.totalRecoveredBackcharge,
          total_net_pool_cost: summary.totalNetCost,
          total_allocated_amount: summary.totalAllocated,
          deferred_in_amount: summary.totalDeferredIn,
          deferred_out_amount: summary.totalDeferredOut,
          posted_at: new Date(),
          posted_by: auth.username || 'system',
          notes: dto.notes || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await (trx as any)
        .updateTable('contracting_allocation_batches')
        .set({
          batch_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    // Link expenses to batch
    await (this.db as any)
      .updateTable('contracting_indirect_expenses')
      .set({ batch_id: batch.id })
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('batch_id', 'is', null)
      .where('expense_date', '>=', dto.periodStart)
      .where('expense_date', '<=', dto.periodEnd)
      .execute();

    // Insert itemized allocations
    for (const pool of summary.poolSummaries) {
      for (const alloc of pool.allocations) {
        if (alloc.allocatedAmount > 0 || alloc.driverQty > 0) {
          await (this.db as any)
            .insertInto('contracting_boq_indirect_allocations')
            .values({
              tenant_id: tenantId,
              project_id: projectId as any,
              batch_id: batch.id,
              pool_id: pool.poolId as any,
              boq_item_id: alloc.boqItemId as any,
              driver_type: pool.driverType,
              driver_qty: alloc.driverQty,
              total_pool_driver_qty: pool.totalDriverQty,
              allocation_ratio: alloc.allocationRatio,
              pool_net_cost: pool.netPoolCost,
              allocated_amount: alloc.allocatedAmount,
            })
            .execute();
        }
      }
    }

    // Update BOQ items' allocated_indirect_cost & total_actual_cost
    for (const itemSummary of summary.boqItemSummaries) {
      if (itemSummary.totalAllocatedIndirectCost > 0) {
        await (this.db as any)
          .updateTable('contracting_boq_items')
          .set({
            allocated_indirect_cost: sql`COALESCE(allocated_indirect_cost, 0) + ${itemSummary.totalAllocatedIndirectCost}`,
            total_actual_cost: sql`COALESCE(direct_labor_cost, 0) + COALESCE(direct_material_cost, 0) + COALESCE(direct_equipment_cost, 0) + COALESCE(allocated_indirect_cost, 0) + ${itemSummary.totalAllocatedIndirectCost}`,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', itemSummary.boqItemId as any)
          .execute();
      }
    }

    return {
      batch: {
        id: String(batch.id),
        batchNumber: batch.batch_number,
        periodStart: batch.period_start,
        periodEnd: batch.period_end,
        status: batch.status,
        totalNetPoolCost: Number(batch.total_net_pool_cost),
        totalAllocatedAmount: Number(batch.total_allocated_amount),
        deferredOutAmount: Number(batch.deferred_out_amount),
      },
      summary,
    };
  }
}
