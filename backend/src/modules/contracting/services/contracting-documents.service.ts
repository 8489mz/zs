import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import {
  CreateContractingDocumentDto,
  CreateContractingDocumentRevisionDto,
  UpdateContractingDocumentRevisionStatusDto,
  DistributeContractingDocumentDto,
  CreateMeetingMinuteDto,
  CreateMeetingActionItemDto,
  CreateEquipmentFuelLogDto,
} from '../dto/contracting.dto';
import { ContractingEquipmentFuelLog } from '../contracting.types';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';

/**
 * ContractingDocumentsService — slice C14 of the contracting split.
 * Pure move of 15 methods from ContractingService (§41 Document Register
 * (8) + §42 Meeting Minutes & Action Items (7)). No behavior change:
 * the bodies are byte-identical; the facade keeps thin delegates with
 * the same names and signatures for the 11 public methods. The 4 map*
 * row mappers (mapDocumentRow, mapRevisionRow, mapMeetingMinuteRow,
 * mapActionItemRow) are private sync helpers called only by this slice's
 * own methods — they stay private in the slice and have NO facade
 * delegate. Deps: db only (no postings in this slice — the file's only
 * 2 posting methods are C4; no cross-slice calls). Other slices never
 * import this slice. Date handling travels verbatim: createDocument
 * supplies issued_date from todayTenantDate(businessTz) (tenant day —
 * clock-b4 §E pin, repointed to this file); the new Date() sites are
 * created_at/updated_at server stamps and Date.now() temp-code tokens.
 * C11 fuel-log fallback APPLIED AT MERGE: the 2 equipment-fuel-log
 * methods (95L) were appended below, byte-identical from the facade.
 */

export interface ContractingDocumentsDeps {
  db: Kysely<Database>;
}

@Injectable()
export class ContractingDocumentsService {
  private readonly db: Kysely<Database>;

  constructor(deps: ContractingDocumentsDeps) {
    this.db = deps.db;
  }

  private mapDocumentRow(row: any) {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      docNumber: row.doc_number,
      title: row.title,
      discipline: row.discipline,
      docType: row.doc_type,
      currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRevisionRow(row: any) {
    return {
      id: String(row.id),
      documentId: String(row.document_id),
      revCode: row.rev_code,
      fileRef: row.file_ref,
      reviewStatus: row.review_status,
      issuedDate: row.issued_date,
      reviewedBy: row.reviewed_by,
      reviewDate: row.review_date,
      reviewComments: row.review_comments,
      notes: row.notes,
      createdAt: row.created_at,
    };
  }

  async listDocuments(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('contracting_documents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => this.mapDocumentRow(r));
  }

  async getDocumentDetail(auth: AuthContext, documentId: string) {
    const { tenantId } = requireTenantScope(auth);
    const doc = await this.db
      .selectFrom('contracting_documents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', documentId)
      .executeTakeFirst();
    if (!doc) throw new NotFoundException(`المستند برقم ${documentId} غير موجود`);

    const revisions = await this.db
      .selectFrom('contracting_document_revisions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('document_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .execute();

    const revisionIds = revisions.map((r) => String(r.id));
    const distributions = revisionIds.length
      ? await this.db
          .selectFrom('contracting_document_distributions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('revision_id', 'in', revisionIds)
          .orderBy('distributed_at', 'desc')
          .execute()
      : [];

    return {
      document: this.mapDocumentRow(doc),
      revisions: revisions.map((r) => this.mapRevisionRow(r)),
      distributions: distributions.map((d) => ({
        id: String(d.id),
        revisionId: String(d.revision_id),
        recipientName: d.recipient_name,
        recipientRole: d.recipient_role,
        distributionMethod: d.distribution_method,
        distributedAt: d.distributed_at,
        acknowledgedAt: d.acknowledged_at,
        notes: d.notes,
      })),
    };
  }

  async createDocument(auth: AuthContext, projectId: string, dto: CreateContractingDocumentDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    return this.db.transaction().execute(async (trx) => {
      const tempDocNumber = `DRG-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const inserted = await trx
        .insertInto('contracting_documents')
        .values({
          tenant_id: tenantId,
          project_id: projectId,
          doc_number: tempDocNumber,
          title: dto.title,
          discipline: dto.discipline || 'architectural',
          doc_type: dto.docType || 'drawing',
          status: 'draft',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
          issued_date: todayTenantDate(businessTz),
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const documentId = String(inserted.id);
      const prefix = getDailyDocumentPrefix('DRG', undefined, businessTz);
      const docNumber = `${prefix}${String(inserted.id).padStart(4, '0')}`;

      await trx
        .updateTable('contracting_documents')
        .set({ doc_number: docNumber, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', documentId)
        .execute();

      const revisionRow = await trx
        .insertInto('contracting_document_revisions')
        .values({
          tenant_id: tenantId,
          document_id: documentId,
          rev_code: dto.revCode || 'A',
          file_ref: dto.fileRef || null,
          review_status: 'for_review',
          issued_date: todayTenantDate(businessTz),
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('contracting_documents')
        .set({ current_revision_id: String(revisionRow.id), status: 'for_review', updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', documentId)
        .execute();

      return {
        document: this.mapDocumentRow({
          ...(await trx
            .selectFrom('contracting_documents')
            .selectAll()
            .where('id', '=', documentId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirstOrThrow()),
        }),
        revision: this.mapRevisionRow(revisionRow),
      };
    });
  }

  async addDocumentRevision(auth: AuthContext, documentId: string, dto: CreateContractingDocumentRevisionDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    return this.db.transaction().execute(async (trx) => {
      const doc = await trx
        .selectFrom('contracting_documents')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', documentId)
        .forUpdate()
        .executeTakeFirst();
      if (!doc) throw new NotFoundException(`المستند برقم ${documentId} غير موجود`);

      // Prior revision, if still open for review, is implicitly superseded by the new one.
      if (doc.current_revision_id) {
        await trx
          .updateTable('contracting_document_revisions')
          .set({ review_status: 'superseded', updated_at: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', doc.current_revision_id)
          .where('review_status', '=', 'for_review')
          .execute();
      }

      const revisionRow = await trx
        .insertInto('contracting_document_revisions')
        .values({
          tenant_id: tenantId,
          document_id: documentId,
          rev_code: dto.revCode,
          file_ref: dto.fileRef || null,
          review_status: 'for_review',
          issued_date: todayTenantDate(businessTz),
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('contracting_documents')
        .set({ current_revision_id: String(revisionRow.id), status: 'for_review', updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', documentId)
        .execute();

      return this.mapRevisionRow(revisionRow);
    });
  }

  async updateDocumentRevisionStatus(
    auth: AuthContext,
    revisionId: string,
    dto: UpdateContractingDocumentRevisionStatusDto,
  ) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    return this.db.transaction().execute(async (trx) => {
      const revision = await trx
        .selectFrom('contracting_document_revisions')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', revisionId)
        .forUpdate()
        .executeTakeFirst();
      if (!revision) throw new NotFoundException(`مراجعة المستند برقم ${revisionId} غير موجودة`);

      const updated = await trx
        .updateTable('contracting_document_revisions')
        .set({
          review_status: dto.reviewStatus,
          reviewed_by: dto.reviewedBy || null,
          review_date: todayTenantDate(businessTz),
          review_comments: dto.reviewComments || null,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', revisionId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Reflect terminal outcomes back onto the parent document's headline status.
      if (['approved', 'approved_as_noted'].includes(dto.reviewStatus)) {
        await trx
          .updateTable('contracting_documents')
          .set({ status: 'approved', updated_at: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', revision.document_id)
          .execute();
      } else if (dto.reviewStatus === 'revise_resubmit' || dto.reviewStatus === 'rejected') {
        await trx
          .updateTable('contracting_documents')
          .set({ status: 'draft', updated_at: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', revision.document_id)
          .execute();
      }

      return this.mapRevisionRow(updated);
    });
  }

  async distributeDocument(auth: AuthContext, revisionId: string, dto: DistributeContractingDocumentDto) {
    const { tenantId } = requireTenantScope(auth);
    const revision = await this.db
      .selectFrom('contracting_document_revisions')
      .select(['id', 'document_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', revisionId)
      .executeTakeFirst();
    if (!revision) throw new NotFoundException(`مراجعة المستند برقم ${revisionId} غير موجودة`);

    const row = await this.db
      .insertInto('contracting_document_distributions')
      .values({
        tenant_id: tenantId,
        document_id: revision.document_id,
        revision_id: revisionId,
        recipient_name: dto.recipientName,
        recipient_role: dto.recipientRole || 'internal',
        distribution_method: dto.distributionMethod || 'email',
        notes: dto.notes || null,
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: String(row.id),
      revisionId: String(row.revision_id),
      recipientName: row.recipient_name,
      recipientRole: row.recipient_role,
      distributionMethod: row.distribution_method,
      distributedAt: row.distributed_at,
      acknowledgedAt: row.acknowledged_at,
    };
  }

  private mapMeetingMinuteRow(row: any) {
    let attendees: any[] = [];
    try {
      attendees = typeof row.attendees === 'string' ? JSON.parse(row.attendees) : row.attendees || [];
    } catch {
      attendees = [];
    }
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      minuteNumber: row.minute_number,
      meetingType: row.meeting_type,
      meetingDate: row.meeting_date,
      location: row.location,
      attendees,
      agenda: row.agenda,
      summary: row.summary,
      preparedBy: row.prepared_by,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapActionItemRow(row: any) {
    return {
      id: String(row.id),
      minuteId: String(row.minute_id),
      description: row.description,
      ownerName: row.owner_name,
      dueDate: row.due_date,
      status: row.status,
      linkedRfiId: row.linked_rfi_id ? String(row.linked_rfi_id) : null,
      linkedChangeOrderId: row.linked_change_order_id ? String(row.linked_change_order_id) : null,
      closedAt: row.closed_at,
      notes: row.notes,
    };
  }

  async listMeetingMinutes(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('contracting_meeting_minutes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('meeting_date', 'desc')
      .execute();
    return rows.map((r) => this.mapMeetingMinuteRow(r));
  }

  async getMeetingMinuteDetail(auth: AuthContext, minuteId: string) {
    const { tenantId } = requireTenantScope(auth);
    const minute = await this.db
      .selectFrom('contracting_meeting_minutes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', minuteId)
      .executeTakeFirst();
    if (!minute) throw new NotFoundException(`محضر الاجتماع برقم ${minuteId} غير موجود`);

    const actionItems = await this.db
      .selectFrom('contracting_meeting_action_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('minute_id', '=', minuteId)
      .orderBy('created_at', 'asc')
      .execute();

    return {
      minute: this.mapMeetingMinuteRow(minute),
      actionItems: actionItems.map((a) => this.mapActionItemRow(a)),
    };
  }

  async createMeetingMinute(auth: AuthContext, projectId: string, dto: CreateMeetingMinuteDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    return this.db.transaction().execute(async (trx) => {
      const tempNumber = `MOM-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const inserted = await trx
        .insertInto('contracting_meeting_minutes')
        .values({
          tenant_id: tenantId,
          project_id: projectId,
          minute_number: tempNumber,
          meeting_type: dto.meetingType || 'site_progress',
          meeting_date: dto.meetingDate || todayTenantDate(businessTz),
          location: dto.location || null,
          attendees: JSON.stringify(dto.attendees || []),
          agenda: dto.agenda || null,
          summary: dto.summary || null,
          prepared_by: dto.preparedBy || null,
          status: 'draft',
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const prefix = getDailyDocumentPrefix('MOM', undefined, businessTz);
      const minuteNumber = `${prefix}${String(inserted.id).padStart(4, '0')}`;

      const finalRow = await trx
        .updateTable('contracting_meeting_minutes')
        .set({ minute_number: minuteNumber, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapMeetingMinuteRow(finalRow);
    });
  }

  async addMeetingActionItem(auth: AuthContext, minuteId: string, dto: CreateMeetingActionItemDto) {
    const { tenantId } = requireTenantScope(auth);
    const minute = await this.db
      .selectFrom('contracting_meeting_minutes')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', minuteId)
      .executeTakeFirst();
    if (!minute) throw new NotFoundException(`محضر الاجتماع برقم ${minuteId} غير موجود`);

    const row = await this.db
      .insertInto('contracting_meeting_action_items')
      .values({
        tenant_id: tenantId,
        minute_id: minuteId,
        description: dto.description,
        owner_name: dto.ownerName || null,
        due_date: dto.dueDate || null,
        status: 'open',
        linked_rfi_id: dto.linkedRfiId || null,
        linked_change_order_id: dto.linkedChangeOrderId || null,
        notes: dto.notes || null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapActionItemRow(row);
  }

  async updateMeetingActionItemStatus(auth: AuthContext, actionItemId: string, status: 'open' | 'closed') {
    const { tenantId } = requireTenantScope(auth);
    const updated = await this.db
      .updateTable('contracting_meeting_action_items')
      .set({
        status,
        closed_at: status === 'closed' ? new Date() : null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', actionItemId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) throw new NotFoundException(`بند المتابعة برقم ${actionItemId} غير موجود`);
    return this.mapActionItemRow(updated);
  }

  async getEquipmentFuelLogs(auth: AuthContext, projectId: string): Promise<ContractingEquipmentFuelLog[]> {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_equipment_fuel_logs as fl')
      .leftJoin('contracting_boq_items as bi', 'bi.id', 'fl.boq_item_id')
      .select([
        'fl.id',
        'fl.project_id',
        'fl.equipment_id',
        'fl.equipment_name',
        'fl.log_date',
        'fl.start_meter_hours',
        'fl.end_meter_hours',
        'fl.operating_hours',
        'fl.fuel_liters_added',
        'fl.fuel_cost_total',
        'fl.driver_operator_name',
        'fl.boq_item_id',
        'bi.item_code as boq_item_code',
        'fl.notes',
        'fl.created_at',
        'fl.updated_at',
      ])
      .where('fl.tenant_id', '=', tenantId)
      .where('fl.project_id', '=', projectId as any)
      .orderBy('fl.log_date', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      equipmentId: r.equipment_id ? String(r.equipment_id) : null,
      equipmentName: r.equipment_name,
      logDate: r.log_date,
      startMeterHours: Number(r.start_meter_hours || 0),
      endMeterHours: Number(r.end_meter_hours || 0),
      operatingHours: Number(r.operating_hours || 0),
      fuelLitersAdded: Number(r.fuel_liters_added || 0),
      fuelCostTotal: Number(r.fuel_cost_total || 0),
      driverOperatorName: r.driver_operator_name,
      boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
      boqItemCode: r.boq_item_code,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createEquipmentFuelLog(
    auth: AuthContext,
    projectId: string,
    dto: CreateEquipmentFuelLogDto,
  ): Promise<ContractingEquipmentFuelLog> {
    const { tenantId } = requireTenantScope(auth);
    const startMeter = Number(dto.startMeterHours || 0);
    const endMeter = Number(dto.endMeterHours || startMeter);
    const operatingHours = Math.max(0, endMeter - startMeter);
    const fuelLiters = Number(dto.fuelLitersAdded || 0);
    const fuelCost = Number(dto.fuelCostTotal || fuelLiters * 14.5); // 14.5 EGP average diesel price 2026

    const [row] = await (this.db as any)
      .insertInto('contracting_equipment_fuel_logs')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        equipment_id: dto.equipmentId ? (dto.equipmentId as any) : null,
        equipment_name: dto.equipmentName,
        log_date: dto.logDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        start_meter_hours: startMeter,
        end_meter_hours: endMeter,
        operating_hours: operatingHours,
        fuel_liters_added: fuelLiters,
        fuel_cost_total: fuelCost,
        driver_operator_name: dto.driverOperatorName || null,
        boq_item_id: dto.boqItemId ? (dto.boqItemId as any) : null,
        notes: dto.notes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      equipmentId: row.equipment_id ? String(row.equipment_id) : null,
      equipmentName: row.equipment_name,
      logDate: row.log_date,
      startMeterHours: Number(row.start_meter_hours),
      endMeterHours: Number(row.end_meter_hours),
      operatingHours: Number(row.operating_hours),
      fuelLitersAdded: Number(row.fuel_liters_added),
      fuelCostTotal: Number(row.fuel_cost_total),
      driverOperatorName: row.driver_operator_name,
      boqItemId: row.boq_item_id ? String(row.boq_item_id) : null,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
