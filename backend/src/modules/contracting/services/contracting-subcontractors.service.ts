import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { CreateSubcontractDto, CreateSubcontractorDto, UpdateSubcontractorDto } from '../dto/contracting.dto';

/**
 * ContractingSubcontractorsService — slice C12 of the contracting split.
 * Pure move of 9 methods from ContractingService (§5 Subcontractors
 * Management (3) + §12c Subcontractors Directory & Financial Ledger minus
 * payment (6), 586L). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures for
 * all 9 public methods. This slice takes db only (ground-proven: no
 * cross-slice dep — getProjectById 0 hits; getSubcontractorById is internal
 * to this slice). It posts no journals (the 2 posting methods live in C4),
 * has no FX sites (resolveFxRate 0 in the whole file), and moves toFixed2 0
 * + inlineRound 0 (facade stays 3/24). No clock pin follows these methods
 * (zero C12 names in the 5 clock specs, ground-proven); date sites travel
 * verbatim (getTenantTimezone 2, todayTenantDate 6, new Date() 3 server
 * stamps, Date.now() 1 temp-code token; the business-date-tenant-local §8
 * pin still holds — 17 getTenantTimezone hits remain in the facade after C12).
 */

export interface ContractingSubcontractorsDeps {
  db: Kysely<any>;
}

@Injectable()
export class ContractingSubcontractorsService {
  private readonly db: Kysely<any>;

  constructor(deps: ContractingSubcontractorsDeps) {
    this.db = deps.db;
  }

  async getSubcontracts(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const subcontracts = await this.db
      .selectFrom('contracting_subcontracts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .execute();

    return Promise.all(
      subcontracts.map(async (sc) => {
        let subcontractorName = '';
        if (sc.subcontractor_id) {
          const subc = await this.db
            .selectFrom('contracting_subcontractors')
            .select('name')
            .where('tenant_id', '=', tenantId)
            .where('id', '=', sc.subcontractor_id)
            .executeTakeFirst();
          if (subc) {
            subcontractorName = subc.name;
          } else {
            const sup = await this.db
              .selectFrom('suppliers')
              .select('name')
              .where('tenant_id', '=', tenantId)
              .where('id', '=', sc.subcontractor_id)
              .executeTakeFirst();
            subcontractorName = sup?.name || '';
          }
        }

        const invTotals = await this.db
          .selectFrom('contracting_invoices')
          .select([
            sql<number>`COALESCE(SUM(net_payable), 0)`.as('total_invoiced'),
            sql<number>`COALESCE(SUM(retention_held_amount), 0)`.as('total_retention_held'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .where((eb) =>
            eb.or([
              eb('subcontract_id', '=', sc.id),
              eb.and([eb('ipc_type', '=', 'subcontractor'), eb('subcontractor_id', '=', sc.subcontractor_id)]),
            ]),
          )
          .where('status', 'in', ['approved', 'paid'])
          .executeTakeFirst();

        const totalInvoiced = Number(invTotals?.total_invoiced || 0);
        const totalRetentionHeld = Number(invTotals?.total_retention_held || 0);
        const totalAmount = Number(sc.total_amount || 0);
        const remainingCommitment = Math.max(0, totalAmount - totalInvoiced);

        return {
          id: String(sc.id),
          projectId: String(sc.project_id),
          subcontractorId: Number(sc.subcontractor_id),
          subcontractorName,
          contractNumber: sc.contract_number,
          contractType: sc.contract_type || 'supply_and_apply',
          scopeOfWork: sc.scope_of_work,
          totalAmount,
          retentionPercent: Number(sc.retention_percent || 0),
          advancePct: Number(sc.advance_pct || 0),
          advanceAmount: Number(sc.advance_amount || 0),
          advanceRecoveryStartPct: Number(sc.advance_recovery_start_pct || 10),
          advanceRecoveryEndPct: Number(sc.advance_recovery_end_pct || 80),
          retentionLimitPct: Number(sc.retention_limit_pct || 5),
          penaltyPerDay: Number(sc.penalty_per_day || 0),
          ldCapPct: Number(sc.ld_cap_pct || 10),
          paymentLinkageMode: sc.payment_linkage_mode || 'independent',
          paymentTermsDays: Number(sc.payment_terms_days || 30),
          tailReservePct: Number(sc.tail_reserve_pct || 10),
          wastageAllowancePct: Number(sc.wastage_allowance_pct || 5),
          mosAdmissiblePct: Number(sc.mos_admissible_pct || 0),
          mosCapPct: Number(sc.mos_cap_pct || 15),
          dlpMonths: Number(sc.dlp_months || 12),
          startDate: sc.start_date ? String(sc.start_date) : null,
          endDate: sc.end_date ? String(sc.end_date) : null,
          status: sc.status,
          notes: sc.notes,
          totalInvoiced,
          totalRetentionHeld,
          remainingCommitment,
          createdAt: String(sc.created_at),
          updatedAt: String(sc.updated_at),
        };
      }),
    );
  }

  async createSubcontract(auth: AuthContext, projectId: string, dto: CreateSubcontractDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    // INV-CONTRACTING-ID-DERIVED-NUMBERS: a generated number is
    // derived from the row id inside one transaction (DRG/MOM
    // pattern), never from a COUNT(*) that races and reuses numbers
    // after deletions; a caller-supplied number is kept verbatim.
    const suppliedNumber = dto.contractNumber ? dto.contractNumber.trim() : '';
    const prefix = getDailyDocumentPrefix('SC', undefined, businessTz);
    const tempNumber = `SC-TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const totalAmount = Number(dto.totalAmount || 0);
    const advancePct = Number(dto.advancePct || 0);
    const advanceAmount =
      dto.advanceAmount !== undefined ? Number(dto.advanceAmount) : (totalAmount * advancePct) / 100;

    const values: any = {
      tenant_id: tenantId,
      project_id: projectId,
      subcontractor_id: dto.subcontractorId,
      contract_number: suppliedNumber || tempNumber,
      contract_type: dto.contractType || 'supply_and_apply',
      scope_of_work: dto.scopeOfWork.trim(),
      total_amount: totalAmount,
      retention_percent: dto.retentionPercent !== undefined ? Number(dto.retentionPercent) : 5.0,
      advance_pct: advancePct,
      advance_amount: advanceAmount,
      advance_recovery_start_pct:
        dto.advanceRecoveryStartPct !== undefined ? Number(dto.advanceRecoveryStartPct) : 10.0,
      advance_recovery_end_pct: dto.advanceRecoveryEndPct !== undefined ? Number(dto.advanceRecoveryEndPct) : 80.0,
      retention_limit_pct: dto.retentionLimitPct !== undefined ? Number(dto.retentionLimitPct) : 5.0,
      penalty_per_day: Number(dto.penaltyPerDay || 0),
      ld_cap_pct: dto.ldCapPct !== undefined ? Number(dto.ldCapPct) : 10.0,
      liability_cap_amount: dto.liabilityCapAmount !== undefined ? Number(dto.liabilityCapAmount) : null,
      wht_rate: Number(dto.whtRate || 0),
      social_insurance_pct: Number(dto.socialInsurancePct || 0),
      payment_linkage_mode: dto.paymentLinkageMode || 'independent',
      payment_terms_days: Number(dto.paymentTermsDays || 30),
      tail_reserve_pct: Number(dto.tailReservePct || 10.0),
      wastage_allowance_pct: Number(dto.wastageAllowancePct || 5.0),
      mos_admissible_pct: Number(dto.mosAdmissiblePct || 0),
      mos_cap_pct: Number(dto.mosCapPct || 15.0),
      dlp_months: Number(dto.dlpMonths || 12),
      start_date: dto.startDate || null,
      end_date: dto.endDate || null,
      status: 'active',
      notes: dto.notes || null,
    };

    if (suppliedNumber) {
      const [sub] = await this.db.insertInto('contracting_subcontracts').values(values).returningAll().execute();
      return sub;
    }

    const sub = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('contracting_subcontracts')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('contracting_subcontracts')
        .set({
          contract_number: `${prefix}${String(inserted.id).padStart(4, '0')}`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(inserted.id))
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated;
    });

    return sub;
  }

  async getSubcontractById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const sub = await this.db
      .selectFrom('contracting_subcontracts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!sub) {
      throw new NotFoundException(`عقد مقاول الباطن برقم ${id} غير موجود`);
    }
    return sub;
  }

  async getSubcontractors(auth: AuthContext, query?: { search?: string; tradeSpecialty?: string; status?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let q = this.db.selectFrom('contracting_subcontractors').selectAll().where('tenant_id', '=', tenantId);

    if (query?.status) {
      q = q.where('status', '=', query.status);
    }
    if (query?.tradeSpecialty && query.tradeSpecialty !== 'all') {
      q = q.where('trade_specialty', '=', query.tradeSpecialty);
    }
    if (query?.search) {
      const term = `%${query.search.trim()}%`;
      q = q.where((eb: any) =>
        eb.or([
          eb('name', 'ilike', term),
          eb('phone', 'ilike', term),
          eb('mobile', 'ilike', term),
          eb('trade_specialty', 'ilike', term),
          eb('tax_number', 'ilike', term),
        ]),
      );
    }

    const rows = await q.orderBy('created_at', 'desc').execute();

    return Promise.all(
      rows.map(async (sub: any) => {
        const subId = Number(sub.id);

        const commitmentsRes = await this.db
          .selectFrom('contracting_subcontracts')
          .select([
            sql<number>`count(*)::int`.as('count'),
            sql<number>`COALESCE(SUM(total_amount), 0)`.as('total_committed'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('subcontractor_id', '=', subId)
          .executeTakeFirst();

        const invoicesRes = await this.db
          .selectFrom('contracting_invoices')
          .select([
            sql<number>`COALESCE(SUM(net_payable), 0)`.as('total_invoiced'),
            sql<number>`COALESCE(SUM(retention_held_amount), 0)`.as('total_retention_held'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('ipc_type', '=', 'subcontractor')
          .where('subcontractor_id', '=', subId)
          .where('status', 'in', ['approved', 'paid'])
          .executeTakeFirst();

        const paymentsRes = await this.db
          .selectFrom('contracting_subcontractor_payments')
          .select(sql<number>`COALESCE(SUM(amount), 0)`.as('total_paid'))
          .where('tenant_id', '=', tenantId)
          .where('subcontractor_id', '=', subId)
          .executeTakeFirst();

        const totalCommitted = Number(commitmentsRes?.total_committed || 0);
        const subcontractsCount = Number(commitmentsRes?.count || 0);
        const totalInvoiced = Number(invoicesRes?.total_invoiced || 0);
        const totalRetentionHeld = Number(invoicesRes?.total_retention_held || 0);
        const totalPaid = Number(paymentsRes?.total_paid || 0);
        const netBalance = totalInvoiced - totalPaid;

        return {
          id: Number(sub.id),
          name: sub.name,
          tradeSpecialty: sub.trade_specialty || 'مقاولات عامة',
          phone: sub.phone || '',
          mobile: sub.mobile || '',
          email: sub.email || '',
          address: sub.address || '',
          taxNumber: sub.tax_number || '',
          commercialReg: sub.commercial_reg || '',
          nationalId: sub.national_id || '',
          bankName: sub.bank_name || '',
          bankIban: sub.bank_iban || '',
          contactPerson: sub.contact_person || '',
          rating: Number(sub.rating || 5.0),
          status: sub.status || 'active',
          notes: sub.notes || '',
          createdAt: sub.created_at,
          subcontractsCount,
          totalCommitted,
          totalInvoiced,
          totalRetentionHeld,
          totalPaid,
          netBalance,
        };
      }),
    );
  }

  async getSubcontractorById(auth: AuthContext, id: number) {
    const { tenantId } = requireTenantScope(auth);
    const sub = await this.db
      .selectFrom('contracting_subcontractors')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!sub) {
      throw new NotFoundException(`مقاول الباطن رقم ${id} غير موجود`);
    }

    return {
      id: Number(sub.id),
      name: sub.name,
      tradeSpecialty: sub.trade_specialty || 'مقاولات عامة',
      phone: sub.phone || '',
      mobile: sub.mobile || '',
      email: sub.email || '',
      address: sub.address || '',
      taxNumber: sub.tax_number || '',
      commercialReg: sub.commercial_reg || '',
      nationalId: sub.national_id || '',
      bankName: sub.bank_name || '',
      bankIban: sub.bank_iban || '',
      contactPerson: sub.contact_person || '',
      rating: Number(sub.rating || 5.0),
      status: sub.status || 'active',
      notes: sub.notes || '',
      createdAt: sub.created_at,
    };
  }

  async createSubcontractor(auth: AuthContext, dto: CreateSubcontractorDto) {
    const { tenantId } = requireTenantScope(auth);
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('اسم مقاول الباطن مطلوب');
    }

    const [sub] = await this.db
      .insertInto('contracting_subcontractors')
      .values({
        tenant_id: tenantId,
        name: dto.name.trim(),
        trade_specialty: dto.tradeSpecialty?.trim() || 'مقاولات عامة',
        phone: dto.phone?.trim() || null,
        mobile: dto.mobile?.trim() || null,
        email: dto.email?.trim() || null,
        address: dto.address?.trim() || null,
        tax_number: dto.taxNumber?.trim() || null,
        commercial_reg: dto.commercialReg?.trim() || null,
        national_id: dto.nationalId?.trim() || null,
        bank_name: dto.bankName?.trim() || null,
        bank_iban: dto.bankIban?.trim() || null,
        contact_person: dto.contactPerson?.trim() || null,
        rating: dto.rating !== undefined ? Number(dto.rating) : 5.0,
        status: dto.status || 'active',
        notes: dto.notes?.trim() || null,
      })
      .returningAll()
      .execute();

    return {
      id: Number(sub.id),
      name: sub.name,
      tradeSpecialty: sub.trade_specialty,
      phone: sub.phone,
      rating: Number(sub.rating || 5.0),
      status: sub.status,
    };
  }

  async updateSubcontractor(auth: AuthContext, id: number, dto: UpdateSubcontractorDto) {
    const { tenantId } = requireTenantScope(auth);
    await this.getSubcontractorById(auth, id);

    const updatePayload: Record<string, any> = {
      updated_at: new Date(),
    };
    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.tradeSpecialty !== undefined) updatePayload.trade_specialty = dto.tradeSpecialty.trim();
    if (dto.phone !== undefined) updatePayload.phone = dto.phone.trim();
    if (dto.mobile !== undefined) updatePayload.mobile = dto.mobile.trim();
    if (dto.email !== undefined) updatePayload.email = dto.email.trim();
    if (dto.address !== undefined) updatePayload.address = dto.address.trim();
    if (dto.taxNumber !== undefined) updatePayload.tax_number = dto.taxNumber.trim();
    if (dto.commercialReg !== undefined) updatePayload.commercial_reg = dto.commercialReg.trim();
    if (dto.nationalId !== undefined) updatePayload.national_id = dto.nationalId.trim();
    if (dto.bankName !== undefined) updatePayload.bank_name = dto.bankName.trim();
    if (dto.bankIban !== undefined) updatePayload.bank_iban = dto.bankIban.trim();
    if (dto.contactPerson !== undefined) updatePayload.contact_person = dto.contactPerson.trim();
    if (dto.rating !== undefined) updatePayload.rating = Number(dto.rating);
    if (dto.status !== undefined) updatePayload.status = dto.status;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes.trim();

    await this.db
      .updateTable('contracting_subcontractors')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return this.getSubcontractorById(auth, id);
  }

  async deleteSubcontractor(auth: AuthContext, id: number) {
    const { tenantId } = requireTenantScope(auth);
    const commitments = await this.db
      .selectFrom('contracting_subcontracts')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('tenant_id', '=', tenantId)
      .where('subcontractor_id', '=', id)
      .executeTakeFirst();

    if (commitments && commitments.count > 0) {
      await this.db
        .updateTable('contracting_subcontractors')
        .set({ status: 'suspended', updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();
      return { success: true, message: 'تم إيقاف حساب المقاول لوجود عقود مرتبطة به' };
    }

    await this.db
      .deleteFrom('contracting_subcontractors')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();

    return { success: true, message: 'تم حذف المقاول بنجاح' };
  }

  async getSubcontractorLedger(
    auth: AuthContext,
    subcontractorId: number,
    query?: { projectId?: string; fromDate?: string; toDate?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    const sub = await this.getSubcontractorById(auth, subcontractorId);

    let subcontractsQuery = this.db
      .selectFrom('contracting_subcontracts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('subcontractor_id', '=', subcontractorId);
    if (query?.projectId) {
      subcontractsQuery = subcontractsQuery.where('project_id', '=', query.projectId);
    }
    const subcontracts = await subcontractsQuery.execute();
    const subcontractIds = subcontracts.map((s: any) => s.id);

    let invQuery = this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('ipc_type', '=', 'subcontractor')
      .where('subcontractor_id', '=', subcontractorId)
      .where('status', 'in', ['approved', 'paid']);
    if (query?.projectId) {
      invQuery = invQuery.where('project_id', '=', query.projectId);
    }
    const invoices = await invQuery.execute();

    let payQuery = this.db
      .selectFrom('contracting_subcontractor_payments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('subcontractor_id', '=', subcontractorId);
    if (query?.projectId) {
      payQuery = payQuery.where('project_id', '=', query.projectId);
    }
    const payments = await payQuery.execute();

    let backcharges: any[] = [];
    if (subcontractIds.length > 0) {
      let bcQuery = this.db
        .selectFrom('contracting_subcontractor_backcharges')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('subcontract_id', 'in', subcontractIds)
        .where('status', 'in', ['approved', 'deducted']);
      if (query?.projectId) {
        bcQuery = bcQuery.where('project_id', '=', query.projectId);
      }
      backcharges = await bcQuery.execute();
    }

    const rawTx: Array<{
      date: string;
      type: 'invoice' | 'payment' | 'backcharge';
      refNumber: string;
      description: string;
      projectId?: string;
      credit: number;
      debit: number;
      details?: Record<string, any>;
    }> = [];

    for (const inv of invoices) {
      const net = Number(inv.net_payable || 0);
      rawTx.push({
        date:
          inv.period_end ||
          (inv.created_at instanceof Date
            ? todayTenantDate(businessTz, inv.created_at)
            : todayTenantDate(businessTz, new Date(String(inv.created_at)))),
        type: 'invoice',
        refNumber: inv.ipc_number,
        description: `مستخلص أعمال وتشوينات رقم ${inv.ipc_number}`,
        projectId: String(inv.project_id),
        credit: net,
        debit: 0,
        details: {
          currentAmount: Number(inv.current_amount || 0),
          storedMaterials: Number(inv.stored_materials_amount || 0),
          advanceRecovery: Number(inv.advance_recovery_amount || 0),
          retentionHeld: Number(inv.retention_held_amount || 0),
          otherDeductions: Number(inv.other_deductions || 0),
          netPayable: net,
        },
      });
    }

    for (const p of payments) {
      const amt = Number(p.amount || 0);
      const methodLabel = p.payment_method === 'cash' ? 'نقدي' : p.payment_method === 'check' ? 'شيك' : 'تحويل بنكي';
      const catLabel =
        p.payment_category === 'advance'
          ? 'دفعة مقدمة'
          : p.payment_category === 'retention'
            ? 'إفراج محجوز ضمان'
            : p.payment_category === 'operational_advance'
              ? 'سلفة تشغيلية'
              : 'دفعة جارية تحت الحساب';
      rawTx.push({
        date:
          p.payment_date ||
          (p.created_at instanceof Date
            ? todayTenantDate(businessTz, p.created_at)
            : todayTenantDate(businessTz, new Date(String(p.created_at)))),
        type: 'payment',
        refNumber: p.payment_number,
        description: `سند صرف ${catLabel} (${methodLabel})${p.reference_number ? ` - م: ${p.reference_number}` : ''}${p.notes ? ` - ${p.notes}` : ''}`,
        projectId: p.project_id ? String(p.project_id) : undefined,
        credit: 0,
        debit: amt,
        details: {
          paymentMethod: p.payment_method,
          paymentCategory: p.payment_category,
          referenceNumber: p.reference_number,
        },
      });
    }

    for (const bc of backcharges) {
      const amt = Number(bc.amount || 0);
      rawTx.push({
        date:
          bc.occurrence_date ||
          (bc.created_at instanceof Date
            ? todayTenantDate(businessTz, bc.created_at)
            : todayTenantDate(businessTz, new Date(String(bc.created_at)))),
        type: 'backcharge',
        refNumber: bc.voucher_number,
        description: `خصم تشوينات/مصروفات موقع (${bc.description || 'خصم مباشر'})`,
        projectId: bc.project_id ? String(bc.project_id) : undefined,
        credit: 0,
        debit: amt,
        details: {
          category: bc.backcharge_category,
        },
      });
    }

    rawTx.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    const transactions = rawTx.map((tx, idx) => {
      runningBalance += tx.credit - tx.debit;
      return {
        id: idx + 1,
        date: tx.date,
        type: tx.type,
        refNumber: tx.refNumber,
        description: tx.description,
        projectId: tx.projectId,
        credit: tx.credit,
        debit: tx.debit,
        balanceAfter: runningBalance,
        details: tx.details,
      };
    });

    let filteredTransactions = transactions;
    if (query?.fromDate) {
      filteredTransactions = filteredTransactions.filter((t) => t.date >= query.fromDate!);
    }
    if (query?.toDate) {
      filteredTransactions = filteredTransactions.filter((t) => t.date <= query.toDate!);
    }

    const totalCommitted = subcontracts.reduce((sum: number, s: any) => sum + Number(s.total_amount || 0), 0);
    const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + Number(inv.net_payable || 0), 0);
    const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const totalBackcharges = backcharges.reduce((sum: number, bc: any) => sum + Number(bc.amount || 0), 0);
    const totalRetentionHeld = invoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.retention_held_amount || 0),
      0,
    );
    const netBalanceDue = totalInvoiced - totalPaid - totalBackcharges;

    return {
      subcontractor: sub,
      summary: {
        totalSubcontracts: subcontracts.length,
        totalCommitted,
        totalInvoiced,
        totalPaid,
        totalBackcharges,
        totalRetentionHeld,
        netBalanceDue,
      },
      transactions: filteredTransactions.reverse(),
    };
  }
}
