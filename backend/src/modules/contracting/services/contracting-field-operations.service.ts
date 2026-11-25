import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  CreateSiteMobilizationExpenseDto,
  RecordLaborAttendanceRecordDto,
  CreateClientPaymentMilestoneDto,
  RecordInKindBarterDeductionDto,
  CreateEquipmentAssetDto,
  TransferEquipmentAssetDto,
  RecordSupplierPriceMemoryDto,
} from '../dto/contracting.dto';
import { type ContractingProjectSummary } from '../contracting.types';

/**
 * ContractingFieldOperationsService — slice C10 of the contracting split.
 * Pure move of 16 methods from ContractingService (§26 Site Mobilization
 * & Worker Housing (3) + §27 Labor Attendance, Overtime & Bonus (3) +
 * §28 Client Payment Milestones & In-Kind Barter (4) + §29 Equipment &
 * Tools Asset Tracking (4) + §30 Supplier Price Memory & Directory (2)).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for all 16 public
 * methods. Deps: db + getProjectById bound from the facade (C1, 4 call
 * sites — createMobilizationExpense, recordLaborAttendance,
 * createClientPaymentMilestone, transferEquipmentAsset; S8 precedent:
 * same-name field, so the moved bodies stay byte-identical). No postings
 * in this slice — the file's only 2 posting methods are C4; no
 * accountingPosting dep, no fallback. Other slices never import this
 * slice. One inline 2dp rounding site travels with the slice
 * (recordLaborAttendance — dispositioned in the allowlist, not
 * roundMoney, prep §7.8a). Date handling travels verbatim:
 * resolveBusinessDateKey 5x (tenant day); the 9 new Date() sites are
 * created_at/updated_at server stamps. No clock pin follows these
 * methods (zero C10 names in all 5 clock specs, ground-proven). No
 * driving spec exists for any C10 method (gap recorded for the merge
 * coordinator — same class as C6/C9); proof comes from the critical
 * chain + RED control + byte-identity.
 */

export interface ContractingFieldOperationsDeps {
  db: Kysely<Database>;
  // Bound facade member (same name as the facade member, so the moved
  // bodies are byte-identical). getProjectById lives in the C1 projects
  // slice and is reached through the facade delegate.
  getProjectById: (auth: AuthContext, projectId: string) => Promise<ContractingProjectSummary>;
}

@Injectable()
export class ContractingFieldOperationsService {
  private readonly db: Kysely<Database>;
  private readonly getProjectById: (auth: AuthContext, projectId: string) => Promise<ContractingProjectSummary>;

  constructor(deps: ContractingFieldOperationsDeps) {
    this.db = deps.db;
    this.getProjectById = deps.getProjectById;
  }

  async getMobilizationExpenses(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_site_mobilization_expenses')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('expense_date', 'desc')
      .execute();

    const totalAmount = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);

    return {
      projectId,
      totalAmount,
      itemsCount: rows.length,
      expenses: rows.map((r: any) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        expenseCategory: r.expense_category,
        title: r.title,
        amount: Number(r.amount || 0),
        expenseDate: r.expense_date,
        paidTo: r.paid_to,
        paymentMethod: r.payment_method,
        referenceReceipt: r.reference_receipt,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async createMobilizationExpense(auth: AuthContext, projectId: string, dto: CreateSiteMobilizationExpenseDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const [inserted] = await (this.db as any)
      .insertInto('contracting_site_mobilization_expenses')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        expense_category: dto.expenseCategory,
        title: dto.title.trim(),
        amount: Number(dto.amount || 0),
        expense_date: dto.expenseDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        paid_to: dto.paidTo.trim(),
        payment_method: dto.paymentMethod || 'petty_cash',
        reference_receipt: dto.referenceReceipt || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async deleteMobilizationExpense(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db as any)
      .deleteFrom('contracting_site_mobilization_expenses')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();

    return { success: true };
  }

  async getLaborAttendanceRecords(auth: AuthContext, projectId: string, date?: string) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_labor_attendance_records as l')
      .leftJoin('contracting_boq_items as b', 'b.id', 'l.boq_item_id')
      .select([
        'l.id',
        'l.project_id',
        'l.boq_item_id',
        'b.item_code as boq_item_code',
        'b.description as boq_description',
        'l.worker_name',
        'l.worker_role',
        'l.attendance_date',
        'l.status',
        'l.daily_base_wage',
        'l.overtime_hours',
        'l.overtime_rate_per_hour',
        'l.night_shift_allowance',
        'l.bonus_amount',
        'l.deduction_amount',
        'l.total_payable',
        'l.is_paid',
        'l.payment_batch_ref',
        'l.notes',
        'l.created_at',
        'l.updated_at',
      ])
      .where('l.tenant_id', '=', tenantId)
      .where('l.project_id', '=', projectId as any);

    if (date) {
      q = q.where('l.attendance_date', '=', date);
    }

    const rows = await q.orderBy('l.attendance_date', 'desc').orderBy('l.worker_name', 'asc').execute();
    const totalPayable = rows.reduce((sum: number, r: any) => sum + Number(r.total_payable || 0), 0);
    const totalOvertimeHours = rows.reduce((sum: number, r: any) => sum + Number(r.overtime_hours || 0), 0);

    return {
      projectId,
      totalPayable,
      totalOvertimeHours,
      recordsCount: rows.length,
      records: rows.map((r: any) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        boqItemId: r.boq_item_id ? String(r.boq_item_id) : null,
        boqItemCode: r.boq_item_code || null,
        boqDescription: r.boq_description || null,
        workerName: r.worker_name,
        workerRole: r.worker_role,
        attendanceDate: r.attendance_date,
        status: r.status,
        dailyBaseWage: Number(r.daily_base_wage || 0),
        overtimeHours: Number(r.overtime_hours || 0),
        overtimeRatePerHour: Number(r.overtime_rate_per_hour || 0),
        nightShiftAllowance: Number(r.night_shift_allowance || 0),
        bonusAmount: Number(r.bonus_amount || 0),
        deductionAmount: Number(r.deduction_amount || 0),
        totalPayable: Number(r.total_payable || 0),
        isPaid: Boolean(r.is_paid),
        paymentBatchRef: r.payment_batch_ref,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async recordLaborAttendance(auth: AuthContext, projectId: string, dto: RecordLaborAttendanceRecordDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const baseWage = Number(dto.dailyBaseWage || 0);
    const otHours = Number(dto.overtimeHours || 0);
    const otRate = Number(dto.overtimeRatePerHour || 0);
    const nightShift = Number(dto.nightShiftAllowance || 0);
    const bonus = Number(dto.bonusAmount || 0);
    const deduction = Number(dto.deductionAmount || 0);

    const statusFactor = dto.status === 'absent' ? 0 : dto.status === 'half_day' ? 0.5 : 1.0;
    const earnedBase = baseWage * statusFactor;
    const totalPayable = Math.max(0, earnedBase + otHours * otRate + nightShift + bonus - deduction);

    const [inserted] = await (this.db as any)
      .insertInto('contracting_labor_attendance_records')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        boq_item_id: dto.boqItemId ? (dto.boqItemId as any) : null,
        worker_name: dto.workerName.trim(),
        worker_role: dto.workerRole || 'technician',
        attendance_date: dto.attendanceDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        status: dto.status || 'present',
        daily_base_wage: baseWage,
        overtime_hours: otHours,
        overtime_rate_per_hour: otRate,
        night_shift_allowance: nightShift,
        bonus_amount: bonus,
        deduction_amount: deduction,
        total_payable: Math.round((totalPayable + Number.EPSILON) * 100) / 100,
        is_paid: Boolean(dto.isPaid),
        payment_batch_ref: dto.paymentBatchRef || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async deleteLaborAttendanceRecord(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db as any)
      .deleteFrom('contracting_labor_attendance_records')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();

    return { success: true };
  }

  async getClientPaymentMilestones(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('contracting_client_payment_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('due_date', 'asc')
      .execute();

    const totalScheduled = rows.reduce((sum: number, r: any) => sum + Number(r.scheduled_amount || 0), 0);
    const totalReceived = rows.reduce((sum: number, r: any) => sum + Number(r.received_amount || 0), 0);
    const totalInKindSettled = rows.reduce((sum: number, r: any) => sum + Number(r.in_kind_valuation || 0), 0);

    return {
      projectId,
      totalScheduled,
      totalReceived,
      totalInKindSettled,
      milestones: rows.map((r: any) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        milestoneName: r.milestone_name,
        dueDate: r.due_date,
        requiredProgressPercent: Number(r.required_progress_percent || 0),
        scheduledAmount: Number(r.scheduled_amount || 0),
        receivedAmount: Number(r.received_amount || 0),
        settlementType: r.settlement_type,
        inKindUnitRef: r.in_kind_unit_ref,
        inKindValuation: Number(r.in_kind_valuation || 0),
        status: r.status,
        settledAt: r.settled_at,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async createClientPaymentMilestone(auth: AuthContext, projectId: string, dto: CreateClientPaymentMilestoneDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const [inserted] = await (this.db as any)
      .insertInto('contracting_client_payment_milestones')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        milestone_name: dto.milestoneName.trim(),
        due_date: dto.dueDate || null,
        required_progress_percent: Number(dto.requiredProgressPercent || 0),
        scheduled_amount: Number(dto.scheduledAmount || 0),
        received_amount: 0,
        settlement_type: dto.settlementType || 'cash',
        status: 'pending',
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async recordInKindBarterDeduction(auth: AuthContext, milestoneId: string, dto: RecordInKindBarterDeductionDto) {
    const { tenantId } = requireTenantScope(auth);
    const milestone = await (this.db as any)
      .selectFrom('contracting_client_payment_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', milestoneId as any)
      .executeTakeFirst();

    if (!milestone) {
      throw new NotFoundException('دفعة العميل غير موجودة');
    }

    const valuation = Number(dto.inKindValuation || 0);

    const [updated] = await (this.db as any)
      .updateTable('contracting_client_payment_milestones')
      .set({
        settlement_type: 'in_kind_unit',
        in_kind_unit_ref: dto.inKindUnitRef.trim(),
        in_kind_valuation: valuation,
        received_amount: valuation,
        status: 'in_kind_settled',
        settled_at: new Date() as any,
        notes: dto.notes ? `${milestone.notes || ''} [مقايضة عينية: ${dto.notes}]` : milestone.notes,
        updated_at: new Date() as any,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', milestoneId as any)
      .returningAll()
      .execute();

    return updated;
  }

  async deleteClientPaymentMilestone(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await (this.db as any)
      .deleteFrom('contracting_client_payment_milestones')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();

    return { success: true };
  }

  async getEquipmentAssets(
    auth: AuthContext,
    query?: { projectId?: string; operationalStatus?: string; search?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_equipment_assets as e')
      .leftJoin('contracting_projects as p', 'p.id', 'e.current_project_id')
      .select([
        'e.id',
        'e.asset_code',
        'e.name',
        'e.category',
        'e.serial_number',
        'e.current_project_id',
        'p.name as current_project_name',
        'e.current_location_desc',
        'e.assigned_supervisor',
        'e.operational_status',
        'e.purchase_cost',
        'e.purchase_date',
        'e.notes',
        'e.created_at',
        'e.updated_at',
      ])
      .where('e.tenant_id', '=', tenantId);

    if (query?.projectId) {
      q = q.where('e.current_project_id', '=', query.projectId as any);
    }

    if (query?.operationalStatus) {
      q = q.where('e.operational_status', '=', query.operationalStatus);
    }

    if (query?.search) {
      const s = `%${query.search.trim()}%`;
      q = q.where((eb: any) =>
        eb.or([
          eb('e.asset_code', 'ilike', s),
          eb('e.name', 'ilike', s),
          eb('e.assigned_supervisor', 'ilike', s),
          eb('e.current_location_desc', 'ilike', s),
        ]),
      );
    }

    const rows = await q.orderBy('e.asset_code', 'asc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      assetCode: r.asset_code,
      name: r.name,
      category: r.category,
      serialNumber: r.serial_number,
      currentProjectId: r.current_project_id ? String(r.current_project_id) : null,
      currentProjectName: r.current_project_name || null,
      currentLocationDesc: r.current_location_desc,
      assignedSupervisor: r.assigned_supervisor,
      operationalStatus: r.operational_status,
      purchaseCost: Number(r.purchase_cost || 0),
      purchaseDate: r.purchase_date,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createEquipmentAsset(auth: AuthContext, dto: CreateEquipmentAssetDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await (this.db as any)
      .insertInto('contracting_equipment_assets')
      .values({
        tenant_id: tenantId,
        asset_code: dto.assetCode.trim().toUpperCase(),
        name: dto.name.trim(),
        category: dto.category || 'heavy_machinery',
        serial_number: dto.serialNumber || null,
        current_project_id: dto.currentProjectId ? (dto.currentProjectId as any) : null,
        current_location_desc: dto.currentLocationDesc || 'المخزن الرئيسي',
        assigned_supervisor: dto.assignedSupervisor || null,
        operational_status: dto.operationalStatus || 'active_working',
        purchase_cost: Number(dto.purchaseCost || 0),
        purchase_date: dto.purchaseDate || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async transferEquipmentAsset(auth: AuthContext, equipmentId: string, dto: TransferEquipmentAssetDto) {
    const { tenantId } = requireTenantScope(auth);
    const equip = await (this.db as any)
      .selectFrom('contracting_equipment_assets')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', equipmentId as any)
      .executeTakeFirst();

    if (!equip) {
      throw new NotFoundException('المعدة / العِدة غير موجودة');
    }

    const toProj = await this.getProjectById(auth, dto.toProjectId);

    // 1. Record transfer in ledger
    await (this.db as any)
      .insertInto('contracting_equipment_transfers')
      .values({
        tenant_id: tenantId,
        equipment_id: equipmentId as any,
        from_project_id: equip.current_project_id,
        to_project_id: dto.toProjectId as any,
        transfer_date: dto.transferDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        dispatched_by: dto.dispatchedBy.trim(),
        received_by: dto.receivedBy.trim(),
        condition_on_dispatch: dto.conditionOnDispatch || 'good',
        condition_on_receipt: dto.conditionOnReceipt || 'good',
        notes: dto.notes || null,
      })
      .execute();

    // 2. Update current asset location and project
    const [updated] = await (this.db as any)
      .updateTable('contracting_equipment_assets')
      .set({
        current_project_id: dto.toProjectId as any,
        current_location_desc: `موقع مشروع: ${toProj.name}`,
        assigned_supervisor: dto.receivedBy.trim(),
        updated_at: new Date() as any,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', equipmentId as any)
      .returningAll()
      .execute();

    return updated;
  }

  async getEquipmentTransfers(auth: AuthContext, equipmentId?: string) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_equipment_transfers as t')
      .innerJoin('contracting_equipment_assets as e', 'e.id', 't.equipment_id')
      .leftJoin('contracting_projects as pFrom', 'pFrom.id', 't.from_project_id')
      .leftJoin('contracting_projects as pTo', 'pTo.id', 't.to_project_id')
      .select([
        't.id',
        't.equipment_id',
        'e.asset_code as equipment_code',
        'e.name as equipment_name',
        't.from_project_id',
        'pFrom.name as from_project_name',
        't.to_project_id',
        'pTo.name as to_project_name',
        't.transfer_date',
        't.dispatched_by',
        't.received_by',
        't.condition_on_dispatch',
        't.condition_on_receipt',
        't.notes',
        't.created_at',
      ])
      .where('t.tenant_id', '=', tenantId);

    if (equipmentId) {
      q = q.where('t.equipment_id', '=', equipmentId as any);
    }

    const rows = await q.orderBy('t.transfer_date', 'desc').orderBy('t.created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      equipmentId: String(r.equipment_id),
      equipmentCode: r.equipment_code,
      equipmentName: r.equipment_name,
      fromProjectId: r.from_project_id ? String(r.from_project_id) : null,
      fromProjectName: r.from_project_name || 'المخزن الرئيسي',
      toProjectId: r.to_project_id ? String(r.to_project_id) : null,
      toProjectName: r.to_project_name || 'المخزن الرئيسي',
      transferDate: r.transfer_date,
      dispatchedBy: r.dispatched_by,
      receivedBy: r.received_by,
      conditionOnDispatch: r.condition_on_dispatch,
      conditionOnReceipt: r.condition_on_receipt,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  async getSupplierPriceMemory(
    auth: AuthContext,
    query?: { supplierId?: number; materialName?: string; governorate?: string; paymentTerms?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    let q = (this.db as any)
      .selectFrom('contracting_supplier_price_memory as m')
      .leftJoin('contracting_projects as p', 'p.id', 'm.last_project_id')
      .select([
        'm.id',
        'm.supplier_id',
        'm.supplier_name',
        'm.material_name',
        'm.unit',
        'm.last_unit_price',
        'm.last_purchase_date',
        'm.last_project_id',
        'p.name as last_project_name',
        'm.governorate',
        'm.payment_terms',
        'm.quality_rating',
        'm.delivery_speed_rating',
        'm.notes',
        'm.created_at',
        'm.updated_at',
      ])
      .where('m.tenant_id', '=', tenantId);

    if (query?.supplierId) {
      q = q.where('m.supplier_id', '=', query.supplierId);
    }
    if (query?.materialName) {
      q = q.where('m.material_name', 'ilike', `%${query.materialName.trim()}%`);
    }
    if (query?.governorate && query.governorate !== 'all') {
      q = q.where('m.governorate', '=', query.governorate);
    }
    if (query?.paymentTerms && query.paymentTerms !== 'all') {
      q = q.where('m.payment_terms', '=', query.paymentTerms);
    }

    const rows = await q.orderBy('m.last_purchase_date', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      supplierId: Number(r.supplier_id),
      supplierName: r.supplier_name,
      materialName: r.material_name,
      unit: r.unit,
      lastUnitPrice: Number(r.last_unit_price || 0),
      lastPurchaseDate: r.last_purchase_date,
      lastProjectId: r.last_project_id ? String(r.last_project_id) : null,
      lastProjectName: r.last_project_name || null,
      governorate: r.governorate,
      paymentTerms: r.payment_terms,
      qualityRating: Number(r.quality_rating || 5.0),
      deliverySpeedRating: Number(r.delivery_speed_rating || 5.0),
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async recordSupplierPriceMemory(auth: AuthContext, dto: RecordSupplierPriceMemoryDto) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await (this.db as any)
      .selectFrom('contracting_supplier_price_memory')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('supplier_id', '=', dto.supplierId)
      .where('material_name', '=', dto.materialName.trim())
      .executeTakeFirst();

    if (existing) {
      const [updated] = await (this.db as any)
        .updateTable('contracting_supplier_price_memory')
        .set({
          unit: dto.unit || existing.unit,
          last_unit_price: Number(dto.lastUnitPrice),
          last_purchase_date: dto.lastPurchaseDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
          last_project_id: dto.lastProjectId ? (dto.lastProjectId as any) : existing.last_project_id,
          governorate: dto.governorate || existing.governorate,
          payment_terms: dto.paymentTerms || existing.payment_terms,
          quality_rating: dto.qualityRating !== undefined ? Number(dto.qualityRating) : existing.quality_rating,
          delivery_speed_rating:
            dto.deliverySpeedRating !== undefined ? Number(dto.deliverySpeedRating) : existing.delivery_speed_rating,
          notes: dto.notes || existing.notes,
          updated_at: new Date() as any,
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      return updated;
    } else {
      const [inserted] = await (this.db as any)
        .insertInto('contracting_supplier_price_memory')
        .values({
          tenant_id: tenantId,
          supplier_id: dto.supplierId,
          supplier_name: 'مورد معتمد',
          material_name: dto.materialName.trim(),
          unit: dto.unit || 'item',
          last_unit_price: Number(dto.lastUnitPrice),
          last_purchase_date: dto.lastPurchaseDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
          last_project_id: dto.lastProjectId ? (dto.lastProjectId as any) : null,
          governorate: dto.governorate || 'القاهرة',
          payment_terms: dto.paymentTerms || 'cash',
          quality_rating: Number(dto.qualityRating ?? 5.0),
          delivery_speed_rating: Number(dto.deliverySpeedRating ?? 5.0),
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      return inserted;
    }
  }
}
