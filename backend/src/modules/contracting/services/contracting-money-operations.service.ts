import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  CreateRetentionRecordDto,
  ReleaseRetentionDto,
  CreatePaymentHoldDto,
  ReleasePaymentHoldDto,
  CreateSupplierReturnDto,
  CreateLaborAttendanceDto,
  CreatePettyCashDto,
  SettlePettyCashDto,
  CreateGovernmentLicenseDto,
} from '../dto/contracting.dto';

/**
 * ContractingMoneyOperationsService — slice C7 of the contracting split.
 * Pure move of 15 methods from ContractingService (retention (3) + payment
 * holds (3) + supplier returns (2) + site labor attendance (2) + petty cash
 * (3) + government licenses (2)). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures for all 15 public methods. This slice takes db only: it posts
 * no journals (the 2 posting methods live in C4), has no FX sites
 * (resolveFxRate 0 in the whole file), and its 1 inline Math.round(x*100)/100
 * site (createLaborAttendance) stays as-is (dispositioned in the allowlist,
 * not roundMoney — prep §7.8a). No clock pin follows these methods (zero C7
 * names in the 5 clock specs, ground-proven); date sites travel verbatim
 * (tenant-day via resolveBusinessDateKey + getTenantTimezone, server
 * instants for created_at/updated_at stamps).
 */

export interface ContractingMoneyOperationsDeps {
  db: Kysely<any>;
}

@Injectable()
export class ContractingMoneyOperationsService {
  private readonly db: Kysely<any>;

  constructor(deps: ContractingMoneyOperationsDeps) {
    this.db = deps.db;
  }

  async getRetentionRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_retention_records').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }
    if (query?.status && query.status !== 'all') {
      q = q.where('status', '=', query.status);
    }

    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
      partyType: r.party_type,
      partyId: r.party_id ? Number(r.party_id) : null,
      partyName: r.party_name,
      heldAmount: Number(r.held_amount || 0),
      releasedAmount: Number(r.released_amount || 0),
      retentionPercent: Number(r.retention_percent || 0),
      ipcInvoiceId: r.ipc_invoice_id ? String(r.ipc_invoice_id) : null,
      releaseDueDate: r.release_due_date || null,
      status: r.status,
      guaranteeCertificateRef: r.guarantee_certificate_ref || null,
      notes: r.notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
    }));
  }

  async createRetentionRecord(auth: AuthContext, projectId: string, dto: CreateRetentionRecordDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await this.db
      .insertInto('contracting_retention_records')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        subcontract_id: dto.subcontractId ? dto.subcontractId : null,
        party_type: dto.partyType,
        party_id: dto.partyId ? Number(dto.partyId) : null,
        party_name: dto.partyName.trim(),
        held_amount: Number(dto.heldAmount || 0),
        released_amount: 0,
        retention_percent: Number(dto.retentionPercent ?? 5.0),
        ipc_invoice_id: dto.ipcInvoiceId ? dto.ipcInvoiceId : null,
        release_due_date: dto.releaseDueDate || null,
        status: 'held',
        guarantee_certificate_ref: dto.guaranteeCertificateRef || null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async releaseRetentionRecord(auth: AuthContext, id: string, dto: ReleaseRetentionDto) {
    const { tenantId } = requireTenantScope(auth);
    const record = await this.db
      .selectFrom('contracting_retention_records')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!record) {
      throw new NotFoundException(`سجل ضمان الأعمال برقم ${id} غير موجود`);
    }

    const currentReleased = Number(record.released_amount || 0);
    const newReleased = currentReleased + Number(dto.releaseAmount);
    const totalHeld = Number(record.held_amount || 0);

    const newStatus = newReleased >= totalHeld ? 'fully_released' : 'partially_released';

    const [updated] = await this.db
      .updateTable('contracting_retention_records')
      .set({
        released_amount: newReleased,
        status: newStatus,
        notes: dto.notes ? `${record.notes || ''} [فك دفعة: ${dto.notes}]` : record.notes,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return updated;
  }

  async getPaymentHolds(auth: AuthContext, query?: { projectId?: string; isReleased?: boolean }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_payment_holds').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }
    if (query?.isReleased !== undefined) {
      q = q.where('is_released', '=', query.isReleased);
    }

    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      subcontractId: r.subcontract_id ? String(r.subcontract_id) : null,
      partyType: r.party_type,
      partyName: r.party_name,
      holdAmount: Number(r.hold_amount || 0),
      reason: r.reason,
      defectDescription: r.defect_description || null,
      isReleased: Boolean(r.is_released),
      releasedAt: r.released_at?.toISOString?.() || String(r.released_at || ''),
      releasedBy: r.released_by || null,
      releaseNotes: r.release_notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
    }));
  }

  async createPaymentHold(auth: AuthContext, projectId: string, dto: CreatePaymentHoldDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await this.db
      .insertInto('contracting_payment_holds')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        subcontract_id: dto.subcontractId ? dto.subcontractId : null,
        party_type: dto.partyType,
        party_name: dto.partyName.trim(),
        hold_amount: Number(dto.holdAmount || 0),
        reason: dto.reason.trim(),
        defect_description: dto.defectDescription || null,
        is_released: false,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async releasePaymentHold(auth: AuthContext, id: string, dto: ReleasePaymentHoldDto) {
    const { tenantId } = requireTenantScope(auth);
    const userEmail = (auth as any)?.user?.email || (auth as any)?.email || 'finance_manager';
    const [updated] = await this.db
      .updateTable('contracting_payment_holds')
      .set({
        is_released: true,
        released_at: new Date(),
        released_by: userEmail,
        release_notes: dto.releaseNotes || null,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    if (!updated) {
      throw new NotFoundException(`سجل حجز الدفعة برقم ${id} غير موجود`);
    }

    return updated;
  }

  async getSupplierReturns(auth: AuthContext, query?: { projectId?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_supplier_returns').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }

    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      returnNumber: r.return_number,
      supplierId: r.supplier_id ? Number(r.supplier_id) : null,
      supplierName: r.supplier_name,
      returnDate: r.return_date,
      totalAmount: Number(r.total_amount || 0),
      status: r.status,
      creditNoteNumber: r.credit_note_number || null,
      items: Array.isArray(r.items_json) ? r.items_json : [],
      notes: r.notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
    }));
  }

  async createSupplierReturn(auth: AuthContext, projectId: string, dto: CreateSupplierReturnDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): a generated number derives from the row id inside one
    // transaction; the credit-note number derives from the same
    // final number. A caller-supplied number is kept verbatim.
    const suppliedNumber = dto.returnNumber;
    const prefix = getDailyDocumentPrefix('RTN', undefined, businessTz);
    const tempNumber = `RTN-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const totalAmount = dto.items.reduce(
      (sum: number, it: any) => sum + Number(it.totalAmount || Number(it.quantity) * Number(it.unitCost)),
      0,
    );

    const values: any = {
      tenant_id: tenantId,
      project_id: projectId,
      return_number: suppliedNumber || tempNumber,
      supplier_id: dto.supplierId ? Number(dto.supplierId) : null,
      supplier_name: dto.supplierName.trim(),
      return_date: dto.returnDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
      total_amount: totalAmount,
      status: 'posted',
      credit_note_number: `CN-${suppliedNumber || tempNumber}`,
      items_json: JSON.stringify(dto.items),
      notes: dto.notes || null,
    };

    if (suppliedNumber) {
      const [inserted] = await this.db
        .insertInto('contracting_supplier_returns')
        .values(values)
        .returningAll()
        .execute();
      return inserted;
    }

    const inserted = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('contracting_supplier_returns')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
      const finalNumber = `${prefix}${String(row.id).padStart(4, '0')}`;
      const updated = await trx
        .updateTable('contracting_supplier_returns')
        .set({ return_number: finalNumber, credit_note_number: `CN-${finalNumber}`, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(row.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return inserted;
  }

  async getLaborAttendance(auth: AuthContext, query?: { projectId?: string; workDate?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_labor_attendance').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }
    if (query?.workDate) {
      q = q.where('work_date', '=', query.workDate);
    }

    const rows = await q.orderBy('work_date', 'desc').orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      workerName: r.worker_name,
      trade: r.trade,
      workDate: r.work_date,
      shiftType: r.shift_type,
      hoursWorked: Number(r.hours_worked || 0),
      splitProjectId: r.split_project_id ? String(r.split_project_id) : null,
      splitHours: Number(r.split_hours || 0),
      dailyRate: Number(r.daily_rate || 0),
      totalWage: Number(r.total_wage || 0),
      status: r.status,
      notes: r.notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
    }));
  }

  async createLaborAttendance(auth: AuthContext, projectId: string, dto: CreateLaborAttendanceDto) {
    const { tenantId } = requireTenantScope(auth);
    const hours = Number(dto.hoursWorked || 8);
    const dailyRate = Number(dto.dailyRate || 0);
    const totalWage = Math.round(dailyRate * (hours / 8) * 100) / 100;

    const [inserted] = await this.db
      .insertInto('contracting_labor_attendance')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        worker_name: dto.workerName.trim(),
        trade: dto.trade,
        work_date: dto.workDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        shift_type: dto.shiftType || 'full_day',
        hours_worked: hours,
        split_project_id: dto.splitProjectId ? dto.splitProjectId : null,
        split_hours: Number(dto.splitHours || 0),
        daily_rate: dailyRate,
        total_wage: totalWage,
        status: 'recorded',
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  async getPettyCashRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_petty_cash').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }
    if (query?.status && query.status !== 'all') {
      q = q.where('status', '=', query.status);
    }

    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      custodianName: r.custodian_name,
      custodianRole: r.custodian_role,
      disbursementNumber: r.disbursement_number,
      amountGiven: Number(r.amount_given || 0),
      amountSettled: Number(r.amount_settled || 0),
      remainingBalance: Number(r.remaining_balance || 0),
      issueDate: r.issue_date,
      settlementDueDate: r.settlement_due_date || null,
      status: r.status,
      receipts: Array.isArray(r.receipts_json) ? r.receipts_json : [],
      closureNotes: r.closure_notes || null,
      createdAt: r.created_at?.toISOString?.() || String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
    }));
  }

  async createPettyCash(auth: AuthContext, projectId: string, dto: CreatePettyCashDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // Strict Auditor Rule: Check if custodian already has an active, un-settled petty cash custody
    const activeCustody = await this.db
      .selectFrom('contracting_petty_cash')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('custodian_name', '=', dto.custodianName.trim())
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (activeCustody) {
      throw new BadRequestException(
        `لا يمكن صرف عهدة نقدية جديدة للمهندس/المشرف (${dto.custodianName}) لوجود عهدة نشطة سابقة برقم (${activeCustody.disbursement_number}) بمبلغ متبقي (${activeCustody.remaining_balance} ر.س) لم يتم تسويتها وإغلاقها بعد.`,
      );
    }

    // INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b, same invariant as
    // D6a): a generated number derives from the row id inside one
    // transaction. A caller-supplied number is kept verbatim.
    const suppliedNumber = dto.disbursementNumber;
    const prefix = getDailyDocumentPrefix('CSH', undefined, businessTz);
    const tempNumber = `CSH-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const values: any = {
      tenant_id: tenantId,
      project_id: projectId,
      custodian_name: dto.custodianName.trim(),
      custodian_role: dto.custodianRole || 'site_engineer',
      disbursement_number: suppliedNumber || tempNumber,
      amount_given: Number(dto.amountGiven),
      amount_settled: 0,
      remaining_balance: Number(dto.amountGiven),
      issue_date: dto.issueDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
      settlement_due_date: dto.settlementDueDate || null,
      status: 'active',
      receipts_json: '[]',
    };

    if (suppliedNumber) {
      const [inserted] = await this.db.insertInto('contracting_petty_cash').values(values).returningAll().execute();
      return inserted;
    }

    const inserted = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('contracting_petty_cash')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('contracting_petty_cash')
        .set({
          disbursement_number: `${prefix}${String(row.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(row.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return inserted;
  }

  async settlePettyCash(auth: AuthContext, id: string, dto: SettlePettyCashDto) {
    const { tenantId } = requireTenantScope(auth);
    const custody = await this.db
      .selectFrom('contracting_petty_cash')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!custody) {
      throw new NotFoundException(`سجل العهدة النقدية برقم ${id} غير موجود`);
    }

    const settledAmount = dto.receipts.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    const remaining = Math.max(0, Number(custody.amount_given) - settledAmount);
    const status = remaining === 0 ? 'settled' : 'active';

    const [updated] = await this.db
      .updateTable('contracting_petty_cash')
      .set({
        amount_settled: settledAmount,
        remaining_balance: remaining,
        status,
        receipts_json: JSON.stringify(dto.receipts),
        closure_notes: dto.closureNotes || null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return updated;
  }

  async getGovernmentLicenses(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_government_licenses').selectAll().where('tenant_id', '=', tenantId);

    if (query?.projectId && query.projectId !== 'all') {
      q = q.where('project_id', '=', query.projectId);
    }

    const rows = await q.orderBy('expiry_date', 'asc').execute();
    const today = new Date();

    return rows.map((r: any) => {
      const expDate = new Date(r.expiry_date);
      const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      let computedStatus = r.status;
      if (r.status !== 'renewed') {
        if (diffDays <= 0) computedStatus = 'expired';
        else if (diffDays <= (r.alert_lead_days || 30)) computedStatus = 'expiring_soon';
        else computedStatus = 'active';
      }

      return {
        id: String(r.id),
        projectId: String(r.project_id),
        licenseType: r.license_type,
        licenseNumber: r.license_number,
        issuingAuthority: r.issuing_authority,
        issueDate: r.issue_date || null,
        expiryDate: r.expiry_date,
        feeAmount: Number(r.fee_amount || 0),
        status: computedStatus,
        documentUrl: r.document_url || null,
        alertLeadDays: Number(r.alert_lead_days || 30),
        daysUntilExpiry: diffDays,
        notes: r.notes || null,
        createdAt: r.created_at?.toISOString?.() || String(r.created_at),
        updatedAt: r.updated_at?.toISOString?.() || String(r.updated_at),
      };
    });
  }

  async createGovernmentLicense(auth: AuthContext, projectId: string, dto: CreateGovernmentLicenseDto) {
    const { tenantId } = requireTenantScope(auth);
    const [inserted] = await this.db
      .insertInto('contracting_government_licenses')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        license_type: dto.licenseType,
        license_number: dto.licenseNumber.trim(),
        issuing_authority: dto.issuingAuthority.trim(),
        issue_date: dto.issueDate || null,
        expiry_date: dto.expiryDate,
        fee_amount: Number(dto.feeAmount || 0),
        status: 'active',
        document_url: dto.documentUrl || null,
        alert_lead_days: Number(dto.alertLeadDays || 30),
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    return inserted;
  }
}
