import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  CreateDailyLogDto,
  CreateRfiDto,
  AnswerRfiDto,
  CreateScheduleTaskDto,
  UpdateScheduleTaskDto,
  CreateMaterialRequisitionDto,
} from '../dto/contracting.dto';

/**
 * ContractingSiteOperationsService — slice C5 of the contracting split.
 * Pure move of 14 methods from ContractingService (site daily logs (2) +
 * RFIs (3) + schedule tasks & Gantt / CPM (6, incl. the private
 * mapScheduleTaskRow helper) + material requisitions (3)).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures. The slice takes db
 * only — no posting methods, no accountingPosting, no cross-slice deps
 * (C5 calls no other slice's methods; C8 binds getScheduleTasks +
 * getMaterialRequisitions through the facade delegates at merge time).
 * Date handling travels verbatim: createScheduleTask's endStr and the
 * histogram weekStart/weekEnd are UTC-slice date keys on named
 * receivers (pre-existing, not part of this split); createRfi +
 * createMaterialRequisition resolve the tenant day through
 * resolveBusinessDateKey + getTenantTimezone. No instant comparison,
 * no UTC-slice normalizer, no client/mobile clock.
 * mapScheduleTaskRow stays private in the slice (its only callers move
 * with it); zero forced visibility changes in this slice.
 */

export interface ContractingSiteOperationsDeps {
  db: Kysely<any>;
}

@Injectable()
export class ContractingSiteOperationsService {
  private readonly db: Kysely<any>;

  constructor(deps: ContractingSiteOperationsDeps) {
    this.db = deps.db;
  }

  async getDailyLogs(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('contracting_site_daily_logs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('log_date', 'desc')
      .execute();
  }

  async createDailyLog(auth: AuthContext, projectId: string, dto: CreateDailyLogDto) {
    const { tenantId } = requireTenantScope(auth);
    const [log] = await this.db
      .insertInto('contracting_site_daily_logs')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        log_date: dto.logDate,
        weather_conditions: dto.weatherConditions || null,
        labor_count: Number(dto.laborCount || 0),
        subcontractor_labor_count: Number(dto.subcontractorLaborCount || 0),
        equipment_on_site: dto.equipmentOnSite || null,
        work_performed: dto.workPerformed.trim(),
        delays_or_obstacles: dto.delaysOrObstacles || null,
        materials_received: dto.materialsReceived || null,
        logged_by: auth.username || 'مشرف الموقع',
      })
      .returningAll()
      .execute();

    return log;
  }

  async getRfiList(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('contracting_rfis')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async createRfi(auth: AuthContext, projectId: string, dto: CreateRfiDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS: the number is derived from
    // the row id inside one transaction (DRG/MOM pattern), never
    // from a COUNT(*) that races and reuses numbers after deletions.
    const prefix = getDailyDocumentPrefix('RFI', undefined, businessTz);
    const tempNumber = `RFI-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const rfi = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contracting_rfis')
        .values({
          tenant_id: tenantId,
          project_id: projectId,
          rfi_number: tempNumber,
          subject: dto.subject.trim(),
          question: dto.question.trim(),
          assigned_to: dto.assignedTo || null,
          status: 'open',
          date_requested: await resolveBusinessDateKey(this.db, tenantId, new Date()),
          date_required: dto.dateRequired || null,
          notes: dto.notes || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('contracting_rfis')
        .set({
          rfi_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return rfi;
  }

  async answerRfi(auth: AuthContext, id: string, dto: AnswerRfiDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('contracting_rfis')
      .set({
        answer: dto.answer.trim(),
        answered_by: auth.username || 'الاستشاري',
        answered_at: new Date(),
        status: 'answered',
        notes: dto.notes || null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return updated;
  }

  private mapScheduleTaskRow(r: any) {
    if (!r) {
      return {
        id: '',
        projectId: '',
        taskCode: '',
        taskName: '',
        wbsCode: '1.0',
        startDate: '',
        endDate: '',
        durationDays: 1,
        progressPercent: 0,
        predecessorId: null,
        isCriticalPath: false,
        status: 'not_started',
        boqItemId: null,
        assignedTeam: null,
        plannedManpowerCount: 0,
        plannedEquipmentCount: 0,
        resourceTrade: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        project_id: '',
        task_code: '',
        task_name: '',
        wbs_code: '1.0',
        start_date: '',
        end_date: '',
        duration_days: 1,
        progress_percent: 0,
        predecessor_id: null,
        is_critical_path: false,
        boq_item_id: null,
        assigned_team: null,
      };
    }
    // start_date / end_date are PG DATE columns: node-postgres returns
    // them as local-midnight Dates, so their day key comes from local
    // calendar parts, never a UTC slice (a UTC slice renders the
    // previous day on any host east of UTC).
    const startDate =
      r.start_date instanceof Date
        ? formatLocalCalendarDay(r.start_date)
        : r.start_date
          ? String(r.start_date).slice(0, 10)
          : '';
    const endDate =
      r.end_date instanceof Date
        ? formatLocalCalendarDay(r.end_date)
        : r.end_date
          ? String(r.end_date).slice(0, 10)
          : '';
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      taskCode: r.task_code,
      taskName: r.task_name,
      wbsCode: r.wbs_code || '1.0',
      startDate,
      endDate,
      durationDays: Number(r.duration_days || 1),
      progressPercent: Number(r.progress_percent || 0),
      predecessorId: r.predecessor_id ? String(r.predecessor_id) : null,
      isCriticalPath: Boolean(r.is_critical_path),
      status: r.status || 'not_started',
      boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
      assignedTeam: r.assigned_team || null,
      plannedManpowerCount: Number(r.planned_manpower_count || 0),
      plannedEquipmentCount: Number(r.planned_equipment_count || 0),
      resourceTrade: r.resource_trade || null,
      notes: r.notes || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      // Backward-compatibility snake_case access
      project_id: r.project_id,
      task_code: r.task_code,
      task_name: r.task_name,
      wbs_code: r.wbs_code,
      start_date: startDate,
      end_date: endDate,
      duration_days: r.duration_days,
      progress_percent: r.progress_percent,
      predecessor_id: r.predecessor_id,
      is_critical_path: r.is_critical_path,
      boq_item_id: r.boq_item_id,
      assigned_team: r.assigned_team,
    };
  }

  async getScheduleTasks(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('contracting_schedule_tasks')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('start_date', 'asc')
      .execute();

    return rows.map((r: any) => this.mapScheduleTaskRow(r));
  }

  async createScheduleTask(auth: AuthContext, projectId: string, dto: CreateScheduleTaskDto) {
    const { tenantId } = requireTenantScope(auth);

    let taskCode = dto.taskCode?.trim().toUpperCase();
    if (!taskCode) {
      const countRes = await this.db
        .selectFrom('contracting_schedule_tasks')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const count = (countRes?.count || 0) + 1;
      taskCode = `TSK-${String(count).padStart(3, '0')}`;
    }

    // Ensure unique task_code within project
    const existingCode = await this.db
      .selectFrom('contracting_schedule_tasks')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('task_code', '=', taskCode)
      .executeTakeFirst();

    if (existingCode) {
      const countRes = await this.db
        .selectFrom('contracting_schedule_tasks')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      let count = (countRes?.count || 0) + 1;
      let candidate = `TSK-${String(count).padStart(3, '0')}`;
      while (
        await this.db
          .selectFrom('contracting_schedule_tasks')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .where('task_code', '=', candidate)
          .executeTakeFirst()
      ) {
        count++;
        candidate = `TSK-${String(count).padStart(3, '0')}`;
      }
      taskCode = candidate;
    }

    const startStr = (
      dto.startDate ||
      (dto as any).start_date ||
      (await resolveBusinessDateKey(this.db, tenantId, new Date()))
    ).trim();
    let endStr = (dto.endDate || (dto as any).end_date || '').trim();

    let durationDays = Number(dto.durationDays || (dto as any).duration_days || 0);
    if (!endStr && durationDays > 0) {
      const s = new Date(startStr);
      s.setDate(s.getDate() + durationDays);
      endStr = s.toISOString().slice(0, 10);
    } else if (!endStr) {
      endStr = startStr;
    }

    if (!durationDays) {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      durationDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    const [task] = await this.db
      .insertInto('contracting_schedule_tasks')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        task_code: taskCode,
        task_name: (dto.taskName || (dto as any).task_name || '').trim(),
        wbs_code: (dto.wbsCode || (dto as any).wbs_code)?.trim() || '1.0',
        start_date: startStr,
        end_date: endStr,
        duration_days: durationDays,
        progress_percent: dto.progressPercent !== undefined ? Number(dto.progressPercent) : 0,
        predecessor_id: dto.predecessorId ? dto.predecessorId : null,
        is_critical_path: Boolean(dto.isCriticalPath || (dto as any).is_critical_path),
        status: dto.status || 'not_started',
        boq_item_id: dto.boqItemId ? dto.boqItemId : null,
        assigned_team: dto.assignedTeam || (dto as any).assigned_team || null,
        planned_manpower_count: dto.plannedManpowerCount !== undefined ? Number(dto.plannedManpowerCount) : 0,
        planned_equipment_count: dto.plannedEquipmentCount !== undefined ? Number(dto.plannedEquipmentCount) : 0,
        resource_trade: dto.resourceTrade || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return this.mapScheduleTaskRow(task);
  }

  async updateScheduleTask(auth: AuthContext, id: string, dto: UpdateScheduleTaskDto) {
    const { tenantId } = requireTenantScope(auth);

    const updatePayload: any = { updated_at: new Date() };
    const taskName = dto.taskName !== undefined ? dto.taskName : (dto as any).task_name;
    if (taskName !== undefined) updatePayload.task_name = String(taskName).trim();

    const rawStartDate = dto.startDate !== undefined ? dto.startDate : (dto as any).start_date;
    if (rawStartDate !== undefined) {
      const trimmed = typeof rawStartDate === 'string' ? rawStartDate.trim() : rawStartDate;
      if (trimmed) {
        updatePayload.start_date = trimmed;
      }
    }

    const rawEndDate = dto.endDate !== undefined ? dto.endDate : (dto as any).end_date;
    if (rawEndDate !== undefined) {
      const trimmed = typeof rawEndDate === 'string' ? rawEndDate.trim() : rawEndDate;
      if (trimmed) {
        updatePayload.end_date = trimmed;
      }
    }

    const durationDays = dto.durationDays !== undefined ? dto.durationDays : (dto as any).duration_days;
    if (durationDays !== undefined && durationDays !== null && durationDays !== '') {
      updatePayload.duration_days = Number(durationDays);
    }

    const progressPercent = dto.progressPercent !== undefined ? dto.progressPercent : (dto as any).progress_percent;
    if (progressPercent !== undefined && progressPercent !== null && progressPercent !== '') {
      updatePayload.progress_percent = Number(progressPercent);
      if (Number(progressPercent) >= 100) updatePayload.status = 'completed';
      else if (Number(progressPercent) > 0) updatePayload.status = 'in_progress';
    }

    const predecessorId = dto.predecessorId !== undefined ? dto.predecessorId : (dto as any).predecessor_id;
    if (predecessorId !== undefined) updatePayload.predecessor_id = predecessorId || null;

    const isCriticalPath = dto.isCriticalPath !== undefined ? dto.isCriticalPath : (dto as any).is_critical_path;
    if (isCriticalPath !== undefined) updatePayload.is_critical_path = Boolean(isCriticalPath);

    if (dto.status !== undefined) updatePayload.status = dto.status;

    const boqItemId = dto.boqItemId !== undefined ? dto.boqItemId : (dto as any).boq_item_id;
    if (boqItemId !== undefined) updatePayload.boq_item_id = boqItemId || null;

    const assignedTeam = dto.assignedTeam !== undefined ? dto.assignedTeam : (dto as any).assigned_team;
    if (assignedTeam !== undefined) updatePayload.assigned_team = assignedTeam || null;

    if (dto.plannedManpowerCount !== undefined) updatePayload.planned_manpower_count = Number(dto.plannedManpowerCount);
    if (dto.plannedEquipmentCount !== undefined)
      updatePayload.planned_equipment_count = Number(dto.plannedEquipmentCount);
    if (dto.resourceTrade !== undefined) updatePayload.resource_trade = dto.resourceTrade || null;

    if (dto.notes !== undefined) updatePayload.notes = dto.notes || null;

    const [updated] = await this.db
      .updateTable('contracting_schedule_tasks')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return this.mapScheduleTaskRow(updated);
  }

  async deleteScheduleTask(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .deleteFrom('contracting_schedule_tasks')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return { success: true, message: 'تم حذف المهمة الجدولية بنجاح' };
  }

  /**
   * Resource-loaded schedule (Primavera P6 / MS Project style weekly histogram):
   * sums planned manpower and equipment across every task whose date range
   * overlaps each week of the project schedule, so over-allocation (too many
   * trades on site the same week) becomes visible instead of only existing as
   * a free-text "assigned team" label with no aggregable count.
   */
  async getResourceLoadingHistogram(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const tasks = await this.db
      .selectFrom('contracting_schedule_tasks')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('start_date', 'asc')
      .execute();

    const activeTasks = tasks.filter(
      (t) => Number(t.planned_manpower_count || 0) > 0 || Number(t.planned_equipment_count || 0) > 0,
    );

    if (activeTasks.length === 0) {
      return { projectId, weeks: [], tradeBreakdown: [], peakManpowerWeek: null, peakEquipmentWeek: null };
    }

    const allStarts = tasks.map((t) => new Date(t.start_date).getTime());
    const allEnds = tasks.map((t) => new Date(t.end_date).getTime());
    const scheduleStart = new Date(Math.min(...allStarts));
    const scheduleEnd = new Date(Math.max(...allEnds));

    // Calendar-day buckets in UTC (stored task dates are DATEs); local-midnight math shifts the labels on a non-UTC host.
    const weekStart = new Date(scheduleStart);
    weekStart.setUTCHours(0, 0, 0, 0);

    const weeks: {
      weekStart: string;
      weekEnd: string;
      totalManpower: number;
      totalEquipment: number;
      taskCount: number;
    }[] = [];
    const cursor = new Date(weekStart);
    const maxWeeks = 260; // 5-year safety cap so a bad date range can't loop forever
    let guard = 0;
    while (cursor.getTime() <= scheduleEnd.getTime() && guard < maxWeeks) {
      const wStart = new Date(cursor);
      const wEnd = new Date(cursor);
      wEnd.setUTCDate(wEnd.getUTCDate() + 6);

      let totalManpower = 0;
      let totalEquipment = 0;
      let taskCount = 0;
      for (const t of activeTasks) {
        const tStart = new Date(t.start_date).getTime();
        const tEnd = new Date(t.end_date).getTime();
        if (tStart <= wEnd.getTime() && tEnd >= wStart.getTime()) {
          totalManpower += Number(t.planned_manpower_count || 0);
          totalEquipment += Number(t.planned_equipment_count || 0);
          taskCount += 1;
        }
      }

      weeks.push({
        weekStart: wStart.toISOString().slice(0, 10),
        weekEnd: wEnd.toISOString().slice(0, 10),
        totalManpower,
        totalEquipment,
        taskCount,
      });

      cursor.setUTCDate(cursor.getUTCDate() + 7);
      guard += 1;
    }

    const tradeMap = new Map<string, { manpower: number; equipment: number }>();
    for (const t of activeTasks) {
      const trade = t.resource_trade || 'غير محدد';
      const entry = tradeMap.get(trade) || { manpower: 0, equipment: 0 };
      entry.manpower += Number(t.planned_manpower_count || 0);
      entry.equipment += Number(t.planned_equipment_count || 0);
      tradeMap.set(trade, entry);
    }
    const tradeBreakdown = Array.from(tradeMap.entries()).map(([trade, v]) => ({ trade, ...v }));

    const peakManpowerWeek = weeks.reduce(
      (peak, w) => (!peak || w.totalManpower > peak.totalManpower ? w : peak),
      null as (typeof weeks)[number] | null,
    );
    const peakEquipmentWeek = weeks.reduce(
      (peak, w) => (!peak || w.totalEquipment > peak.totalEquipment ? w : peak),
      null as (typeof weeks)[number] | null,
    );

    return { projectId, weeks, tradeBreakdown, peakManpowerWeek, peakEquipmentWeek };
  }

  async getMaterialRequisitions(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('contracting_material_requisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('issue_date', 'desc')
      .execute();
  }

  async createMaterialRequisition(auth: AuthContext, projectId: string, dto: CreateMaterialRequisitionDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);

    // INV-CONTRACTING-ID-DERIVED-NUMBERS: a generated number is
    // derived from the row id inside one transaction (DRG/MOM
    // pattern), never from a COUNT(*) that races and reuses numbers
    // after deletions; a caller-supplied number is kept verbatim.
    const suppliedNumber = dto.requisitionNumber?.trim().toUpperCase() || '';
    const prefix = getDailyDocumentPrefix('MR', undefined, businessTz);
    const tempNumber = `MR-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const qty = Number(dto.quantity || 0);
    const unitCost = Number(dto.unitCost || 0);
    const totalCost = qty * unitCost;

    const values: any = {
      tenant_id: tenantId,
      project_id: projectId,
      requisition_number: suppliedNumber || tempNumber,
      boq_item_id: dto.boqItemId ? dto.boqItemId : null,
      warehouse_id: dto.warehouseId ? Number(dto.warehouseId) : null,
      product_id: dto.productId ? Number(dto.productId) : null,
      item_name: dto.itemName.trim(),
      unit: dto.unit || 'unit',
      quantity: qty,
      unit_cost: unitCost,
      total_cost: totalCost,
      issue_date: dto.issueDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
      recipient_name: dto.recipientName || null,
      status: 'issued',
      notes: dto.notes || null,
    };

    if (suppliedNumber) {
      const [req] = await this.db
        .insertInto('contracting_material_requisitions')
        .values(values)
        .returningAll()
        .execute();
      return req;
    }

    const req = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contracting_material_requisitions')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('contracting_material_requisitions')
        .set({
          requisition_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return req;
  }

  async deleteMaterialRequisition(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .deleteFrom('contracting_material_requisitions')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return { success: true, message: 'تم إلغاء إذن صرف المواد بنجاح' };
  }
}
