import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  CreateInspectionRequestDto,
  UpdateInspectionRequestStatusDto,
  CreateSnagItemDto,
  UpdateSnagItemStatusDto,
  CreateProjectHandoverDto,
  ApproveProjectHandoverDto,
  CreateSubmittalDto,
  UpdateSubmittalStatusDto,
  CreateMaterialEscalationDto,
  UpdateMaterialEscalationStatusDto,
  CreateSubcontractorBackchargeDto,
  UpdateBackchargeStatusDto,
} from '../dto/contracting.dto';
import {
  ContractingInspectionRequest,
  ContractingSnagItem,
  ContractingProjectHandover,
  ContractingSubmittal,
  ContractingMaterialEscalation,
  ContractingSubcontractorBackcharge,
} from '../contracting.types';

/**
 * ContractingQualityService — slice C11 of the contracting split.
 * Pure move of 20 methods from ContractingService (WIR (4) + snag items (4)
 * + project handovers (3) + submittals (3) + material escalations (3) +
 * subcontractor back-charges (3)). The 2 equipment fuel-log methods (95L)
 * were held in the facade by the merge fallback and move into C14 instead.
 * No behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures for all 20 public methods.
 * This slice takes db only: it posts no journals (the 2 posting methods live
 * in C4), has no FX sites (resolveFxRate 0 in the whole file), and moves
 * toFixed2 0 + inlineRound 0 (facade stays 3/24). The clock-p9 §C source pins
 * for submittal submission_date + backcharge occurrence_date follow these
 * methods into this file — the spec repoints its readSource path here,
 * assertion text unchanged; the fuel-log log_date pin follows the fuel-log
 * methods into C14 at the C14 merge. Date sites travel verbatim:
 * resolveBusinessDateKey / todayTenantDate tenant-day fallbacks, no instant
 * comparison, no UTC-slice normalizer.
 */

export interface ContractingQualityDeps {
  db: Kysely<any>;
}

@Injectable()
export class ContractingQualityService {
  private readonly db: Kysely<any>;

  constructor(deps: ContractingQualityDeps) {
    this.db = deps.db;
  }

  async getInspectionRequests(
    auth: AuthContext,
    projectId: string,
    status?: string,
  ): Promise<ContractingInspectionRequest[]> {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_inspection_requests as w')
      .leftJoin('contracting_boq_items as b', 'b.id', 'w.boq_item_id')
      .leftJoin('contracting_subcontracts as s', 's.id', 'w.subcontract_id')
      .select([
        'w.id',
        'w.project_id',
        'w.wir_number',
        'w.boq_item_id',
        'b.item_code as boq_item_code',
        'b.description as boq_item_description',
        'w.subcontract_id',
        's.contract_number as subcontract_number',
        'w.location_grid',
        'w.trade_category',
        'w.inspection_type',
        'w.scheduled_date',
        'w.status',
        'w.consultant_name',
        'w.consultant_notes',
        'w.inspected_at',
        'w.attachments',
        'w.created_at',
        'w.updated_at',
      ])
      .where('w.tenant_id', '=', tenantId)
      .where('w.project_id', '=', projectId as any);

    if (status && status !== 'all') {
      q = q.where('w.status', '=', status);
    }

    const rows = await q.orderBy('w.scheduled_date', 'desc').orderBy('w.created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      wirNumber: r.wir_number,
      boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
      boqItemCode: r.boq_item_code || null,
      boqItemDescription: r.boq_item_description || null,
      subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
      subcontractNumber: r.subcontract_number || null,
      locationGrid: r.location_grid,
      tradeCategory: r.trade_category,
      inspectionType: r.inspection_type,
      scheduledDate: r.scheduled_date,
      status: r.status,
      consultantName: r.consultant_name,
      consultantNotes: r.consultant_notes,
      inspectedAt: r.inspected_at,
      attachments: r.attachments,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createInspectionRequest(
    auth: AuthContext,
    projectId: string,
    dto: CreateInspectionRequestDto,
  ): Promise<ContractingInspectionRequest> {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): a generated number derives from the row id inside one
    // transaction. A caller-supplied number is kept verbatim.
    const suppliedNumber = dto.wirNumber?.trim().toUpperCase() || '';
    const prefix = getDailyDocumentPrefix('WIR', undefined, businessTz);
    const tempNumber = `WIR-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const values: any = {
      tenant_id: tenantId,
      project_id: projectId as any,
      wir_number: suppliedNumber || tempNumber,
      boq_item_id: dto.boqItemId ? Number(dto.boqItemId) : null,
      subcontract_id: dto.subcontractId ? Number(dto.subcontractId) : null,
      location_grid: dto.locationGrid.trim(),
      trade_category: dto.tradeCategory,
      inspection_type: dto.inspectionType || 'work_inspection',
      scheduled_date: dto.scheduledDate,
      status: 'submitted',
      consultant_name: dto.consultantName || null,
      consultant_notes: dto.consultantNotes || null,
      attachments: dto.attachments || null,
    };

    let row: any;
    if (suppliedNumber) {
      [row] = await (this.db as any)
        .insertInto('contracting_inspection_requests')
        .values(values)
        .returningAll()
        .execute();
    } else {
      row = await this.db.transaction().execute(async (trx) => {
        const inserted = await (trx as any)
          .insertInto('contracting_inspection_requests')
          .values(values)
          .returning('id')
          .executeTakeFirstOrThrow();
        const updated = await (trx as any)
          .updateTable('contracting_inspection_requests')
          .set({
            wir_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', String(inserted.id))
          .returningAll()
          .executeTakeFirstOrThrow();
        return updated;
      });
    }

    const list = await this.getInspectionRequests(auth, projectId);
    return list.find((i) => i.id === String(row.id)) || (row as any);
  }

  async updateInspectionRequestStatus(auth: AuthContext, id: string, dto: UpdateInspectionRequestStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await (this.db as any)
      .updateTable('contracting_inspection_requests')
      .set({
        status: dto.status,
        consultant_name: dto.consultantName || undefined,
        consultant_notes: dto.consultantNotes || undefined,
        inspected_at: dto.status !== 'submitted' ? new Date() : null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`طلب الفحص برقم ${id} غير موجود`);
    }

    return updated;
  }

  async deleteInspectionRequest(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db as any)
      .deleteFrom('contracting_inspection_requests')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();
    return { success: true };
  }

  async getSnagItems(
    auth: AuthContext,
    projectId: string,
    status?: string,
    severity?: string,
  ): Promise<ContractingSnagItem[]> {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_snag_items as s')
      .leftJoin('contracting_boq_items as b', 'b.id', 's.boq_item_id')
      .leftJoin('suppliers as sup', 'sup.id', 's.subcontractor_id')
      .select([
        's.id',
        's.project_id',
        's.boq_item_id',
        'b.item_code as boq_item_code',
        's.item_title',
        's.location_desc',
        's.severity',
        's.responsible_party',
        's.subcontractor_id',
        'sup.name as subcontractor_name',
        's.subcontract_id',
        's.assigned_to',
        's.due_date',
        's.status',
        's.rectified_date',
        's.verified_by',
        's.notes',
        's.created_at',
        's.updated_at',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.project_id', '=', projectId as any);

    if (status && status !== 'all') {
      q = q.where('s.status', '=', status);
    }
    if (severity && severity !== 'all') {
      q = q.where('s.severity', '=', severity);
    }

    const rows = await q.orderBy('s.created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
      boqItemCode: r.boq_item_code || null,
      itemTitle: r.item_title,
      locationDesc: r.location_desc,
      severity: r.severity,
      responsibleParty: r.responsible_party,
      subcontractorId: r.subcontractor_id ? Number(r.subcontractor_id) : null,
      subcontractorName: r.subcontractor_name || null,
      subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
      assignedTo: r.assigned_to,
      dueDate: r.due_date,
      status: r.status,
      rectifiedDate: r.rectified_date,
      verifiedBy: r.verified_by,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createSnagItem(auth: AuthContext, projectId: string, dto: CreateSnagItemDto): Promise<ContractingSnagItem> {
    const { tenantId } = requireTenantScope(auth);
    const [row] = await (this.db as any)
      .insertInto('contracting_snag_items')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        boq_item_id: dto.boqItemId ? Number(dto.boqItemId) : null,
        item_title: dto.itemTitle.trim(),
        location_desc: dto.locationDesc.trim(),
        severity: dto.severity || 'minor',
        responsible_party: dto.responsibleParty || 'subcontractor',
        subcontractor_id: dto.subcontractorId ? Number(dto.subcontractorId) : null,
        subcontract_id: dto.subcontractId ? Number(dto.subcontractId) : null,
        assigned_to: dto.assignedTo || null,
        due_date: dto.dueDate || null,
        status: 'open',
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    const list = await this.getSnagItems(auth, projectId);
    return list.find((s) => s.id === String(row.id)) || (row as any);
  }

  async updateSnagItemStatus(auth: AuthContext, id: string, dto: UpdateSnagItemStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await (this.db as any)
      .updateTable('contracting_snag_items')
      .set({
        status: dto.status,
        rectified_date:
          dto.status !== 'open'
            ? dto.rectifiedDate || (await resolveBusinessDateKey(this.db, tenantId, new Date()))
            : null,
        verified_by: dto.status === 'verified_closed' ? dto.verifiedBy || auth.username || 'المهندس المشرف' : null,
        notes: dto.notes || undefined,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`الملاحظة برقم ${id} غير موجودة`);
    }

    return updated;
  }

  async deleteSnagItem(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db as any)
      .deleteFrom('contracting_snag_items')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();
    return { success: true };
  }

  async getProjectHandovers(auth: AuthContext, projectId: string): Promise<ContractingProjectHandover[]> {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_project_handovers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('handover_date', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      handoverType: r.handover_type,
      handoverDate: r.handover_date,
      committeeMembers: r.committee_members,
      warrantyStartDate: r.warranty_start_date,
      warrantyEndDate: r.warranty_end_date,
      retentionReleaseAmount: Number(r.retention_release_amount || 0),
      status: r.status,
      certificateRef: r.certificate_ref,
      notes: r.notes,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createProjectHandover(
    auth: AuthContext,
    projectId: string,
    dto: CreateProjectHandoverDto,
  ): Promise<ContractingProjectHandover> {
    const { tenantId } = requireTenantScope(auth);
    const warrantyStart = dto.warrantyStartDate || dto.handoverDate;
    const d = new Date(warrantyStart);
    d.setFullYear(d.getFullYear() + 1);
    const warrantyEnd = dto.warrantyEndDate || d.toISOString().split('T')[0];

    const [row] = await (this.db as any)
      .insertInto('contracting_project_handovers')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        handover_type: dto.handoverType,
        handover_date: dto.handoverDate,
        committee_members: dto.committeeMembers.trim(),
        warranty_start_date: warrantyStart,
        warranty_end_date: warrantyEnd,
        retention_release_amount: Number(dto.retentionReleaseAmount || 0),
        status: 'draft',
        certificate_ref: dto.certificateRef || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      handoverType: row.handover_type,
      handoverDate: row.handover_date,
      committeeMembers: row.committee_members,
      warrantyStartDate: row.warranty_start_date,
      warrantyEndDate: row.warranty_end_date,
      retentionReleaseAmount: Number(row.retention_release_amount || 0),
      status: row.status,
      certificateRef: row.certificate_ref,
      notes: row.notes,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async approveProjectHandover(auth: AuthContext, id: string, dto: ApproveProjectHandoverDto) {
    const { tenantId } = requireTenantScope(auth);
    const handover = await (this.db as any)
      .selectFrom('contracting_project_handovers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!handover) {
      throw new NotFoundException(`محضر التسليم برقم ${id} غير موجود`);
    }

    const [approved] = await (this.db as any)
      .updateTable('contracting_project_handovers')
      .set({
        status: 'approved',
        approved_by: dto.approvedBy || auth.username || 'الإدارة العليا',
        approved_at: new Date(),
        notes: dto.notes ? `${handover.notes || ''}\n${dto.notes}`.trim() : handover.notes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (handover.handover_type === 'preliminary') {
      await this.db
        .updateTable('contracting_projects')
        .set({
          status: 'handed_over',
          actual_end_date: handover.handover_date,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', handover.project_id)
        .execute();
    }

    return approved;
  }

  async getSubmittals(auth: AuthContext, projectId: string): Promise<ContractingSubmittal[]> {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_submittals')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      submittalNumber: r.submittal_number,
      submittalType: r.submittal_type,
      title: r.title,
      specificationSection: r.specification_section,
      supplierManufacturer: r.supplier_manufacturer,
      boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
      subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
      submissionDate: r.submission_date,
      reviewDueDate: r.review_due_date,
      consultantReviewDate: r.consultant_review_date,
      status: r.status,
      consultantName: r.consultant_name,
      consultantComments: r.consultant_comments,
      attachments: r.attachments,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createSubmittal(auth: AuthContext, projectId: string, dto: CreateSubmittalDto): Promise<ContractingSubmittal> {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): the number derives from the row id inside one
    // transaction, never from a COUNT(*).
    const prefix = getDailyDocumentPrefix(
      dto.submittalType === 'shop_drawing' ? 'DWG-SUB' : 'MAT-SUB',
      undefined,
      businessTz,
    );
    const tempNumber = `SUB-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const row = await this.db.transaction().execute(async (trx) => {
      const inserted = await (trx as any)
        .insertInto('contracting_submittals')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          submittal_number: tempNumber,
          submittal_type: dto.submittalType,
          title: dto.title,
          specification_section: dto.specificationSection || null,
          supplier_manufacturer: dto.supplierManufacturer || null,
          boq_item_id: dto.boqItemId ? (dto.boqItemId as any) : null,
          subcontract_id: dto.subcontractId ? (dto.subcontractId as any) : null,
          submission_date: dto.submissionDate || todayTenantDate(businessTz, new Date()),
          review_due_date: dto.reviewDueDate || null,
          status: 'submitted',
          attachments: dto.notes || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await (trx as any)
        .updateTable('contracting_submittals')
        .set({
          submittal_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      submittalNumber: row.submittal_number,
      submittalType: row.submittal_type,
      title: row.title,
      specificationSection: row.specification_section,
      supplierManufacturer: row.supplier_manufacturer,
      boqItemId: row.boq_item_id ? String(row.boq_item_id) : null,
      subcontractId: row.subcontract_id ? String(row.subcontract_id) : null,
      submissionDate: row.submission_date,
      reviewDueDate: row.review_due_date,
      consultantReviewDate: row.consultant_review_date,
      status: row.status,
      consultantName: row.consultant_name,
      consultantComments: row.consultant_comments,
      attachments: row.attachments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateSubmittalStatus(auth: AuthContext, id: string, dto: UpdateSubmittalStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await (this.db as any)
      .updateTable('contracting_submittals')
      .set({
        status: dto.status,
        consultant_name: dto.consultantName || null,
        consultant_comments: dto.consultantComments || null,
        consultant_review_date: dto.consultantReviewDate || new Date(),
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`طلب الاعتماد برقم ${id} غير موجود`);
    }

    return updated;
  }

  async getMaterialEscalations(auth: AuthContext, projectId: string): Promise<ContractingMaterialEscalation[]> {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_material_escalations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      claimNumber: r.claim_number,
      materialType: r.material_type,
      materialName: r.material_name,
      basePriceContract: Number(r.base_price_contract || 0),
      currentMarketPrice: Number(r.current_market_price || 0),
      priceDifference: Number(r.price_difference || 0),
      executedQuantity: Number(r.executed_quantity || 0),
      unit: r.unit,
      totalCompensationAmount: Number(r.total_compensation_amount || 0),
      bulletinSourceReference: r.bulletin_source_reference,
      status: r.status,
      ipcInvoiceId: r.ipc_invoice_id ? String(r.ipc_invoice_id) : null,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createMaterialEscalation(
    auth: AuthContext,
    projectId: string,
    dto: CreateMaterialEscalationDto,
  ): Promise<ContractingMaterialEscalation> {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): the number derives from the row id inside one
    // transaction, never from a COUNT(*).
    const prefix = getDailyDocumentPrefix('ESC', undefined, businessTz);
    const tempNumber = `ESC-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const priceDifference = Math.max(0, dto.currentMarketPrice - dto.basePriceContract);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const totalCompensationAmount = roundMoney(priceDifference * dto.executedQuantity, moneyDigits);

    const row = await this.db.transaction().execute(async (trx) => {
      const inserted = await (trx as any)
        .insertInto('contracting_material_escalations')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          claim_number: tempNumber,
          material_type: dto.materialType,
          material_name: dto.materialName,
          base_price_contract: dto.basePriceContract,
          current_market_price: dto.currentMarketPrice,
          price_difference: priceDifference,
          executed_quantity: dto.executedQuantity,
          unit: dto.unit,
          total_compensation_amount: totalCompensationAmount,
          bulletin_source_reference: dto.bulletinSourceReference || null,
          status: 'draft',
          notes: dto.notes || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await (trx as any)
        .updateTable('contracting_material_escalations')
        .set({
          claim_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      claimNumber: row.claim_number,
      materialType: row.material_type,
      materialName: row.material_name,
      basePriceContract: Number(row.base_price_contract),
      currentMarketPrice: Number(row.current_market_price),
      priceDifference: Number(row.price_difference),
      executedQuantity: Number(row.executed_quantity),
      unit: row.unit,
      totalCompensationAmount: Number(row.total_compensation_amount),
      bulletinSourceReference: row.bulletin_source_reference,
      status: row.status,
      ipcInvoiceId: row.ipc_invoice_id ? String(row.ipc_invoice_id) : null,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateMaterialEscalationStatus(auth: AuthContext, id: string, dto: UpdateMaterialEscalationStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await (this.db as any)
      .updateTable('contracting_material_escalations')
      .set({
        status: dto.status,
        ipc_invoice_id: dto.ipcInvoiceId ? (dto.ipcInvoiceId as any) : null,
        notes: dto.notes || undefined,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`مطالبة فروق الأسعار برقم ${id} غير موجودة`);
    }

    return updated;
  }

  async getSubcontractorBackcharges(
    auth: AuthContext,
    projectId: string,
  ): Promise<ContractingSubcontractorBackcharge[]> {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_subcontractor_backcharges as cb')
      .leftJoin('contracting_subcontracts as cs', 'cs.id', 'cb.subcontract_id')
      .leftJoin('contracting_subcontracts as ben', 'ben.id', 'cb.beneficiary_subcontract_id')
      .select([
        'cb.id',
        'cb.project_id',
        'cb.voucher_number',
        'cb.subcontract_id',
        'cs.subcontractor_name as subcontractor_name',
        'cb.beneficiary_subcontract_id',
        'ben.subcontractor_name as beneficiary_subcontractor_name',
        'cb.backcharge_category',
        'cb.amount',
        'cb.description',
        'cb.occurrence_date',
        'cb.status',
        'cb.applied_ipc_invoice_id',
        'cb.created_at',
        'cb.updated_at',
      ])
      .where('cb.tenant_id', '=', tenantId)
      .where('cb.project_id', '=', projectId as any)
      .orderBy('cb.created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      voucherNumber: r.voucher_number,
      subcontractId: String(r.subcontract_id),
      subcontractorName: r.subcontractor_name,
      beneficiarySubcontractId: r.beneficiary_subcontract_id ? String(r.beneficiary_subcontract_id) : null,
      beneficiarySubcontractorName: r.beneficiary_subcontractor_name,
      backchargeCategory: r.backcharge_category,
      amount: Number(r.amount || 0),
      description: r.description,
      occurrenceDate: r.occurrence_date,
      status: r.status,
      appliedIpcInvoiceId: r.applied_ipc_invoice_id ? String(r.applied_ipc_invoice_id) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createSubcontractorBackcharge(
    auth: AuthContext,
    projectId: string,
    dto: CreateSubcontractorBackchargeDto,
  ): Promise<ContractingSubcontractorBackcharge> {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): the number derives from the row id inside one
    // transaction, never from a COUNT(*).
    const prefix = getDailyDocumentPrefix('BCH', undefined, businessTz);
    const tempNumber = `BCH-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const row = await this.db.transaction().execute(async (trx) => {
      const inserted = await (trx as any)
        .insertInto('contracting_subcontractor_backcharges')
        .values({
          tenant_id: tenantId,
          project_id: projectId as any,
          voucher_number: tempNumber,
          subcontract_id: dto.subcontractId as any,
          beneficiary_subcontract_id: dto.beneficiarySubcontractId ? (dto.beneficiarySubcontractId as any) : null,
          backcharge_category: dto.backchargeCategory,
          amount: dto.amount,
          description: dto.description,
          occurrence_date: dto.occurrenceDate || todayTenantDate(businessTz, new Date()),
          status: 'pending_approval',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await (trx as any)
        .updateTable('contracting_subcontractor_backcharges')
        .set({
          voucher_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      voucherNumber: row.voucher_number,
      subcontractId: String(row.subcontract_id),
      beneficiarySubcontractId: row.beneficiary_subcontract_id ? String(row.beneficiary_subcontract_id) : null,
      backchargeCategory: row.backcharge_category,
      amount: Number(row.amount),
      description: row.description,
      occurrenceDate: row.occurrence_date,
      status: row.status,
      appliedIpcInvoiceId: row.applied_ipc_invoice_id ? String(row.applied_ipc_invoice_id) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateBackchargeStatus(auth: AuthContext, id: string, dto: UpdateBackchargeStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await (this.db as any)
      .updateTable('contracting_subcontractor_backcharges')
      .set({
        status: dto.status,
        applied_ipc_invoice_id: dto.appliedIpcInvoiceId ? (dto.appliedIpcInvoiceId as any) : null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`سند الخصم برقم ${id} غير موجود`);
    }

    return updated;
  }
}
