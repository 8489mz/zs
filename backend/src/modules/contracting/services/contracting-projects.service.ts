import { Logger, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { CreateProjectDto, UpdateProjectDto, MarkTenderLostDto, AwardTenderDto } from '../dto/contracting.dto';
import { ContractingProjectSummary } from '../contracting.types';

/**
 * ContractingProjectsService — slice C1 of the contracting split.
 * Pure move of 9 methods from ContractingService (projects CRUD (8) +
 * enrichProjectMetrics (private helper, called only by this slice's own
 * methods). No behavior change: the bodies are byte-identical; the
 * facade keeps thin delegates with the same names and signatures for
 * the 8 public methods. enrichProjectMetrics has NO facade delegate —
 * no facade code calls it after the move.
 * Deps: db only. The logger field moves with this slice (used once, in
 * createProject); the slice gets its own Logger named after this class
 * (prep-prescribed) and the facade drops the field + the Logger import.
 * accountingPosting is NOT a dep of this slice (C1 posts no journals).
 * Other slices call getProjectById through the facade delegate, never
 * by importing this slice. Date handling travels verbatim: createProject
 * resolves businessTz through getTenantTimezone (tenant day); the two
 * p.created_at?.toISOString?.() reads in enrichProjectMetrics are
 * value reads, not date keys. The core spec's :77 stub targets this
 * slice: (service as any).projectsSlice.projectsService.enrichProjectMetrics
 * (the facade constructs slices lazily; the stub goes through the
 * projects slice getter so it lands on the instance serving createProject).
 */

export interface ContractingProjectsDeps {
  db: Kysely<Database>;
}

@Injectable()
export class ContractingProjectsService {
  private readonly db: Kysely<Database>;
  private readonly logger = new Logger(ContractingProjectsService.name);

  constructor(deps: ContractingProjectsDeps) {
    this.db = deps.db;
  }

  async getProjects(auth: AuthContext, query?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_projects').selectAll().where('tenant_id', '=', tenantId);

    if (query?.status && query.status !== 'all') {
      q = q.where('status', '=', query.status as any);
    }

    if (query?.search) {
      const s = `%${query.search.trim()}%`;
      q = q.where((eb) => eb.or([eb('name', 'ilike', s), eb('code', 'ilike', s), eb('client_name', 'ilike', s)]));
    }

    const projects = await q.orderBy('created_at', 'desc').execute();

    // Map projects with summarized financial metrics
    return Promise.all(
      projects.map(async (p) => {
        return this.enrichProjectMetrics(tenantId, p);
      }),
    );
  }

  async getProjectById(auth: AuthContext, id: string): Promise<ContractingProjectSummary> {
    const { tenantId } = requireTenantScope(auth);
    const p = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!p) {
      throw new NotFoundException(`مشروع المقاولات برقم ${id} غير موجود`);
    }

    return this.enrichProjectMetrics(tenantId, p);
  }

  async createProject(auth: AuthContext, dto: CreateProjectDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    // 1. Resolve client name if clientId is provided (independent of the code).
    let clientName = dto.clientName || '';
    if (dto.clientId && !clientName) {
      const client = await this.db
        .selectFrom('customers')
        .select('name')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.clientId)
        .executeTakeFirst();
      if (client) clientName = client.name;
    }

    // 2. Resolve or create Cost Center automatically (dimension = 'project').
    // The cost-center code embeds the FINAL project code, so for a
    // generated code the cost center is resolved only after the
    // project row exists and its id-derived code is known (see below).
    const resolveCostCenter = async (projectCode: string): Promise<number | null> => {
      let costCenterId = dto.costCenterId ? Number(dto.costCenterId) : null;
      if (!costCenterId) {
        try {
          const ccCode = `CC-${projectCode}`;
          const existingCc = await this.db
            .selectFrom('cost_centers')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('code', '=', ccCode)
            .executeTakeFirst();

          if (existingCc) {
            costCenterId = Number(existingCc.id);
          } else {
            const ccName = `مشروع: ${dto.name.trim()}`;
            const [insertedCc] = await this.db
              .insertInto('cost_centers')
              .values({
                tenant_id: tenantId,
                code: ccCode,
                name: ccName,
                dimension: 'project',
                budget_amount: Number(dto.contractValue || 0),
                is_active: true,
              })
              .returning(['id'])
              .execute();
            if (insertedCc) {
              costCenterId = Number(insertedCc.id);
            }
          }
        } catch (err) {
          this.logger.warn(`Could not auto-create cost center for project ${projectCode}: ${err}`);
        }
      }
      return costCenterId;
    };

    const values: any = {
      tenant_id: tenantId,
      code: '',
      name: dto.name.trim(),
      client_id: dto.clientId ? Number(dto.clientId) : null,
      client_name: clientName,
      status: dto.status || 'planning',
      contract_value: Number(dto.contractValue || 0),
      revised_contract_value: Number(dto.contractValue || 0),
      down_payment_amount: Number(dto.downPaymentAmount || 0),
      down_payment_recovered: 0,
      retention_percent: dto.retentionPercent !== undefined ? Number(dto.retentionPercent) : 5.0,
      retention_total_held: 0,
      retention_released: 0,
      start_date: dto.startDate || null,
      expected_end_date: dto.expectedEndDate || null,
      actual_end_date: null,
      site_location_id: dto.siteLocationId ? Number(dto.siteLocationId) : null,
      cost_center_id: null,
      project_manager: dto.projectManager || null,
      location_address: dto.locationAddress || null,
      consultant_name: dto.consultantName || null,
      contract_ref: dto.contractRef || null,
      contract_date: dto.contractDate || null,
      loss_reason: dto.lossReason || null,
      loss_notes: dto.lossNotes || null,
      competitor_price: dto.competitorPrice !== undefined ? Number(dto.competitorPrice) : null,
      revision_number: dto.revisionNumber !== undefined ? Number(dto.revisionNumber) : 0,
      original_tender_id: dto.originalTenderId ? Number(dto.originalTenderId) : null,
      submitted_at: dto.submittedAt ? new Date(dto.submittedAt) : dto.status === 'submitted' ? new Date() : null,
      awarded_at: dto.awardedAt ? new Date(dto.awardedAt) : dto.status === 'active' ? new Date() : null,
      notes: dto.notes || null,
    };

    const suppliedCode = dto.code ? dto.code.trim().toUpperCase() : '';
    if (suppliedCode) {
      values.code = suppliedCode;
      values.cost_center_id = await resolveCostCenter(suppliedCode);
      const [created] = await this.db.insertInto('contracting_projects').values(values).returningAll().execute();
      return this.enrichProjectMetrics(tenantId, created);
    }

    // INV-CONTRACTING-ID-DERIVED-NUMBERS: no COUNT(*) numbering (the
    // old count-then-retry loop still raced under concurrency and
    // reused numbers after deletions). The row is inserted with a
    // unique temp code, the final code is derived from the row id
    // inside the same transaction (the DRG/MOM pattern), and only
    // then is the cost center resolved against the final code.
    const tempCode = `PRJ-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    values.code = tempCode;
    const created = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contracting_projects')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
      const finalCode = `${getDailyDocumentPrefix('PRJ', undefined, businessTz)}${String(inserted.id).padStart(4, '0')}`;
      const updated = await trx
        .updateTable('contracting_projects')
        .set({ code: finalCode, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    const costCenterId = await resolveCostCenter(created.code);
    if (costCenterId) {
      await this.db
        .updateTable('contracting_projects')
        .set({ cost_center_id: costCenterId, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', created.id)
        .execute();
      created.cost_center_id = costCenterId;
    }

    return this.enrichProjectMetrics(tenantId, created);
  }

  async updateProject(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`مشروع المقاولات برقم ${id} غير موجود`);
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date(),
    };

    if (dto.code !== undefined) updatePayload.code = dto.code ? dto.code.trim() : null;
    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.clientId !== undefined) updatePayload.client_id = dto.clientId ? Number(dto.clientId) : null;
    if (dto.clientName !== undefined) {
      updatePayload.client_name = dto.clientName ? dto.clientName.trim() : '';
    } else if (dto.clientId) {
      const client = await this.db
        .selectFrom('customers')
        .select('name')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.clientId)
        .executeTakeFirst();
      if (client) updatePayload.client_name = client.name;
    }
    if (dto.status !== undefined) updatePayload.status = dto.status;
    if (dto.contractValue !== undefined) {
      updatePayload.contract_value = Number(dto.contractValue);
      // Recalculate revised value with approved change orders
      const coSum = await this.db
        .selectFrom('contracting_change_orders')
        .select(sql<number>`COALESCE(SUM(cost_impact), 0)`.as('sum'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', id)
        .where('status', '=', 'approved')
        .executeTakeFirst();
      updatePayload.revised_contract_value = Number(dto.contractValue) + Number(coSum?.sum || 0);
    }
    if (dto.downPaymentAmount !== undefined) updatePayload.down_payment_amount = Number(dto.downPaymentAmount);
    if (dto.retentionPercent !== undefined) updatePayload.retention_percent = Number(dto.retentionPercent);
    if (dto.startDate !== undefined) {
      const s = typeof dto.startDate === 'string' ? dto.startDate.trim() : dto.startDate;
      updatePayload.start_date = s ? s : null;
    }
    if (dto.expectedEndDate !== undefined) {
      const s = typeof dto.expectedEndDate === 'string' ? dto.expectedEndDate.trim() : dto.expectedEndDate;
      updatePayload.expected_end_date = s ? s : null;
    }
    if (dto.actualEndDate !== undefined) {
      const s = typeof dto.actualEndDate === 'string' ? dto.actualEndDate.trim() : dto.actualEndDate;
      updatePayload.actual_end_date = s ? s : null;
    }
    if (dto.siteLocationId !== undefined) updatePayload.site_location_id = dto.siteLocationId;
    if (dto.costCenterId !== undefined) updatePayload.cost_center_id = dto.costCenterId;
    if (dto.projectManager !== undefined) updatePayload.project_manager = dto.projectManager;
    if (dto.locationAddress !== undefined) updatePayload.location_address = dto.locationAddress;
    if (dto.consultantName !== undefined) updatePayload.consultant_name = dto.consultantName;
    if (dto.contractRef !== undefined) updatePayload.contract_ref = dto.contractRef;
    if (dto.contractDate !== undefined) {
      const s = typeof dto.contractDate === 'string' ? dto.contractDate.trim() : dto.contractDate;
      updatePayload.contract_date = s ? s : null;
    }
    if (dto.lossReason !== undefined) updatePayload.loss_reason = dto.lossReason;
    if (dto.lossNotes !== undefined) updatePayload.loss_notes = dto.lossNotes;
    if (dto.competitorPrice !== undefined)
      updatePayload.competitor_price = dto.competitorPrice !== null ? Number(dto.competitorPrice) : null;
    if (dto.revisionNumber !== undefined) updatePayload.revision_number = Number(dto.revisionNumber);
    if (dto.originalTenderId !== undefined)
      updatePayload.original_tender_id = dto.originalTenderId ? Number(dto.originalTenderId) : null;
    if (dto.submittedAt !== undefined) updatePayload.submitted_at = dto.submittedAt ? new Date(dto.submittedAt) : null;
    if (dto.awardedAt !== undefined) updatePayload.awarded_at = dto.awardedAt ? new Date(dto.awardedAt) : null;
    if (dto.status === 'active' && !(existing as any).awarded_at && dto.awardedAt === undefined) {
      updatePayload.awarded_at = new Date();
    }
    if (dto.status === 'submitted' && !(existing as any).submitted_at && dto.submittedAt === undefined) {
      updatePayload.submitted_at = new Date();
    }
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const [updated] = await this.db
      .updateTable('contracting_projects')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return this.enrichProjectMetrics(tenantId, updated);
  }

  async createTenderRevision(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`عطاء المقاولات برقم ${id} غير موجود`);
    }

    const currentRev = Number((existing as any).revision_number || 0);
    const nextRev = currentRev + 1;
    const cleanBaseCode = existing.code.replace(/-REV\d+$/i, '');
    const newCode = `${cleanBaseCode}-REV${nextRev}`;
    const newName = `${existing.name.replace(/\s*\(مراجعة\s*\d+\)$/i, '')} (مراجعة ${nextRev})`;

    const [cloned] = await this.db
      .insertInto('contracting_projects')
      .values({
        tenant_id: tenantId,
        code: newCode,
        name: newName,
        client_id: existing.client_id,
        client_name: existing.client_name,
        status: 'negotiation',
        contract_value: existing.contract_value,
        revised_contract_value: existing.revised_contract_value,
        down_payment_amount: existing.down_payment_amount,
        down_payment_recovered: 0,
        retention_percent: existing.retention_percent,
        retention_total_held: 0,
        retention_released: 0,
        start_date: existing.start_date,
        expected_end_date: existing.expected_end_date,
        actual_end_date: null,
        site_location_id: existing.site_location_id,
        cost_center_id: existing.cost_center_id,
        project_manager: existing.project_manager,
        location_address: existing.location_address,
        notes: `مراجعة تفاوضية ${nextRev} للعطاء الأصلي [${existing.code}]`,
        revision_number: nextRev,
        original_tender_id: (existing as any).original_tender_id || existing.id,
      } as any)
      .returningAll()
      .execute();

    // Copy BOQ items
    const originalBoqItems = await this.db
      .selectFrom('contracting_boq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .execute();

    for (const item of originalBoqItems) {
      const contractQty = Number(item.contract_qty || 0);
      const unitPrice = Number(item.unit_price || 0);
      await this.db
        .insertInto('contracting_boq_items')
        .values({
          tenant_id: tenantId,
          project_id: cloned.id,
          item_code: item.item_code,
          description: item.description,
          category: item.category,
          unit: item.unit,
          contract_qty: item.contract_qty,
          revised_qty: item.revised_qty,
          unit_price: item.unit_price,
          total_price: contractQty * unitPrice,
          estimated_unit_cost: item.estimated_unit_cost,
          executed_qty: 0,
          notes: item.notes,
        })
        .execute();
    }

    return this.enrichProjectMetrics(tenantId, cloned);
  }

  async markTenderLost(auth: AuthContext, id: string, dto: MarkTenderLostDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`عطاء المقاولات برقم ${id} غير موجود`);
    }

    const [updated] = await this.db
      .updateTable('contracting_projects')
      .set({
        status: 'lost',
        loss_reason: dto.lossReason,
        loss_notes: dto.lossNotes || null,
        competitor_price: dto.competitorPrice !== undefined ? Number(dto.competitorPrice) : null,
        updated_at: new Date(),
      } as any)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return this.enrichProjectMetrics(tenantId, updated);
  }

  async awardTender(auth: AuthContext, id: string, dto: AwardTenderDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`عطاء المقاولات برقم ${id} غير موجود`);
    }

    const updatePayload: Record<string, any> = {
      status: 'active',
      awarded_at: new Date(),
      updated_at: new Date(),
    };

    if (dto.contractRef) updatePayload.contract_ref = dto.contractRef;
    if (dto.contractDate) updatePayload.contract_date = dto.contractDate;
    if (dto.downPaymentAmount !== undefined) updatePayload.down_payment_amount = Number(dto.downPaymentAmount);
    if (dto.retentionPercent !== undefined) updatePayload.retention_percent = Number(dto.retentionPercent);
    if (dto.projectManager) updatePayload.project_manager = dto.projectManager;
    if (dto.consultantName) updatePayload.consultant_name = dto.consultantName;
    if (dto.startDate) updatePayload.start_date = dto.startDate;

    const [updated] = await this.db
      .updateTable('contracting_projects')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return this.enrichProjectMetrics(tenantId, updated);
  }

  async deleteProject(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    // Check if there are approved invoices
    const hasApprovedInvoices = await this.db
      .selectFrom('contracting_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();

    if (hasApprovedInvoices) {
      throw new BadRequestException('لا يمكن حذف هذا المشروع لوجود مستخلصات معتمدة مسجلة عليه.');
    }

    await this.db.deleteFrom('contracting_projects').where('tenant_id', '=', tenantId).where('id', '=', id).execute();

    return { success: true, message: 'تم حذف المشروع وجميع بنوده بنجاح' };
  }

  private async enrichProjectMetrics(tenantId: string, p: any): Promise<ContractingProjectSummary> {
    // 1. Total Billed Client
    const clientBilledRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount + stored_materials_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', p.id)
      .where('ipc_type', '=', 'client')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    const totalBilledClient = Number(clientBilledRes?.sum || 0);

    // 2. Total Billed Subcontractors
    const subBilledRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', p.id)
      .where('ipc_type', '=', 'subcontractor')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    const totalBilledSubcontractors = Number(subBilledRes?.sum || 0);

    // 3. Approved Change Orders
    const coRes = await this.db
      .selectFrom('contracting_change_orders')
      .select(sql<number>`COALESCE(SUM(cost_impact), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', p.id)
      .where('status', '=', 'approved')
      .executeTakeFirst();
    const changeOrdersTotalCost = Number(coRes?.sum || 0);

    // 4. Committed Subcontracts Total
    const subcontractsRes = await this.db
      .selectFrom('contracting_subcontracts')
      .select(sql<number>`COALESCE(SUM(total_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', p.id)
      .executeTakeFirst();
    const totalCostCommitted = Number(subcontractsRes?.sum || 0);

    const revisedContractValue = Number(p.revised_contract_value || p.contract_value || 0);
    const completionRatePercent =
      revisedContractValue > 0 ? Math.min(100, Math.round((totalBilledClient / revisedContractValue) * 100)) : 0;

    const actualCostIncurred = totalBilledSubcontractors;
    const grossMarginForecast = revisedContractValue - Math.max(totalCostCommitted, actualCostIncurred);

    return {
      id: String(p.id),
      code: p.code,
      name: p.name,
      clientId: p.client_id ? Number(p.client_id) : null,
      clientName: p.client_name || '',
      status: p.status,
      contractValue: Number(p.contract_value || 0),
      revisedContractValue: revisedContractValue,
      downPaymentAmount: Number(p.down_payment_amount || 0),
      downPaymentRecovered: Number(p.down_payment_recovered || 0),
      retentionPercent: Number(p.retention_percent || 5.0),
      retentionTotalHeld: Number(p.retention_total_held || 0),
      retentionReleased: Number(p.retention_released || 0),
      startDate: p.start_date || null,
      expectedEndDate: p.expected_end_date || null,
      actualEndDate: p.actual_end_date || null,
      siteLocationId: p.site_location_id ? Number(p.site_location_id) : null,
      costCenterId: p.cost_center_id ? Number(p.cost_center_id) : null,
      projectManager: p.project_manager || null,
      locationAddress: p.location_address || null,
      notes: p.notes || null,
      createdAt: p.created_at?.toISOString?.() || String(p.created_at),
      updatedAt: p.updated_at?.toISOString?.() || String(p.updated_at),

      totalBilledClient,
      totalBilledSubcontractors,
      changeOrdersTotalCost,
      completionRatePercent,
      totalCostCommitted,
      actualCostIncurred,
      grossMarginForecast,
    };
  }
}
