import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingService } from '../../accounting/accounting.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { KYSELY_DB } from '../../../database/database.constants';
import { formatDailyDocumentNumber, getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import {
  calculateGratuity,
  calculateLeaveEncashment,
  calculateSettlementAbsorption,
} from '../engines/eos-calculation.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { requireStoredHrMoney } from '../engines/hr-payroll-run.engine';

export interface SettlementCalculateInput {
  employeeId: number;
  terminationDate: string;
  terminationReason: string;
  contractType?: string;
  lawType?: 'saudi' | 'egyptian' | 'custom';
  customGratuityDaysPerYear?: number;
  pendingSalaryAmount?: number;
  customEntitlements?: number;
  noticePeriodAmount?: number;
  assetsDeduction?: number;
  otherDeductions?: number;
}

export interface CreateSettlementDto extends SettlementCalculateInput {
  settlementDate?: string;
  custodyCleared?: boolean;
  clearanceChecklist?: any[];
  clearanceNotes?: string;
  notes?: string;
  confirmTermination?: boolean;
}

async function eosBookDigits(db: Kysely<Database>, tenantId: string): Promise<MoneyDigits> {
  const setting = await sql<{ value: string }>`
    SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
  `.execute(db);
  const currency = String(setting.rows[0]?.value ?? '').replace(/^"|"$/g, '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException('حدد عملة منشأتك قبل احتساب المخالصة');
  }
  return currencyMoneyDigits(currency);
}

@Injectable()
export class EndOfServiceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingService: AccountingService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  /**
   * The monthly allowance of the compensation package effective on the
   * given date, mirroring payroll's effective-dated package semantics
   * (see calculateEffectiveCompensationPay): no package covering the
   * date means zero allowances; more than one covering it is ambiguous
   * and fails closed instead of summing (double-pay) or picking one
   * silently. The amount is the package's FULL monthly bucket, never
   * prorated: EOS needs the monthly wage, not one day of it.
   */
  private async effectiveAllowanceAmount(
    employeeId: number,
    tenantId: string,
    terminationDate: string,
  ): Promise<number> {
    const packages = await this.db
      .selectFrom('hr_compensation_packages')
      .select(['id', 'allowance_amount'])
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where((eb) =>
        eb.or([
          eb('effective_from', 'is', null),
          eb('effective_from', '<=', terminationDate),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>=', terminationDate),
        ]),
      )
      .execute();
    if (packages.length > 1) {
      throw new BadRequestException('يوجد أكثر من حزمة بدلات سارية في تاريخ إنهاء الخدمة؛ أغلق الحزم المتداخلة قبل احتساب المخالصة');
    }
    const amount = packages.length ? Number(packages[0].allowance_amount || 0) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('قيمة البدلات في حزمة التعويض غير صحيحة');
    }
    return amount;
  }

  /**
   * Preview & calculate end-of-service breakdown according to labor laws
   */
  async calculateSettlementPreview(input: SettlementCalculateInput, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const bookDigits = await eosBookDigits(this.db, tenantId);

    const employee = await this.db
      .selectFrom('hr_employees')
      .selectAll()
      .where('id', '=', input.employeeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!employee) {
      throw new NotFoundException('الموظف غير موجود أو لا ينتمي لهذه المنشأة');
    }

    if (!employee.hire_date) throw new BadRequestException('يجب تسجيل تاريخ تعيين الموظف قبل احتساب المخالصة');
    const endDate = String(input.terminationDate || '');
    const validEndDate = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      && Number.isFinite(Date.parse(endDate + 'T00:00:00Z'))
      && new Date(endDate + 'T00:00:00Z').toISOString().slice(0, 10) === endDate;
    if (!validEndDate) throw new BadRequestException('تاريخ إنهاء الخدمة يجب أن يكون تاريخاً صحيحاً YYYY-MM-DD');
    const hireDate = new Date(employee.hire_date);
    if (!Number.isFinite(hireDate.getTime())) throw new BadRequestException('تاريخ تعيين الموظف غير صحيح');
    const terminationDate = new Date(endDate + 'T00:00:00Z');

    if (terminationDate < hireDate) {
      throw new BadRequestException('تاريخ إنهاء الخدمة لا يمكن أن يكون قبل تاريخ التعيين');
    }

    // Calculate duration
    const diffTime = Math.max(0, terminationDate.getTime() - hireDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const serviceYearsDecimal = Number((diffDays / 365.25).toFixed(8));
    const serviceYears = Math.floor(diffDays / 365.25);
    const serviceMonths = Math.floor((diffDays % 365.25) / 30.4375);
    const serviceDays = Math.floor((diffDays % 365.25) % 30.4375);

    // Latest contract salary
    const latestContract = await (this.db as any)
      .selectFrom('hr_employment_contracts')
      .selectAll()
      .where('employee_id', '=', input.employeeId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['active', 'ended'])
      .where('start_date', '<=', input.terminationDate as any)
      // A historic contract that expired before termination is NOT a valid
      // salary basis for an EOS gratuity or unused leave payout.
      .where((eb: any) => eb.or([
        eb('end_date', 'is', null),
        eb('end_date', '>=', input.terminationDate as any),
      ]))
      .orderBy('start_date', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    let basicSalary = 0;
    let totalSalary = 0;
    let allowanceAmount = 0;

    if (latestContract) {
      basicSalary = Number(latestContract.base_salary || 0);
      // INV-EOS-TOTAL-WAGE-FROM-COMPENSATION: hr_employment_contracts has
      // NO allowance columns (housing_allowance / transport_allowance /
      // other_allowances / gross_salary do not exist in the schema), so
      // reading them always yielded 0 and every settlement was computed
      // on base salary alone. The total wage is now derived from the
      // existing allowance store, hr_compensation_packages, mirroring
      // payroll: the package effective on the termination date. The
      // package store has ONE allowance bucket with no housing/transport
      // split, so the WHOLE bucket counts toward the statutory total
      // wage (flagged assumption: if non-statutory allowances are ever
      // recorded in the same bucket, gratuity is overstated — the
      // preview discloses allowanceAmount so the user can see it).
      // Deductions never count toward the wage.
      allowanceAmount = await this.effectiveAllowanceAmount(
        input.employeeId,
        tenantId,
        input.terminationDate,
      );
      totalSalary = basicSalary + allowanceAmount;
    } else {
      throw new BadRequestException('لا يوجد عقد راتب صالح يغطي تاريخ إنهاء الخدمة؛ راجع العقد قبل تسعير المخالصة');
    }

    if (!Number.isFinite(totalSalary) || totalSalary <= 0 || !Number.isFinite(basicSalary) || basicSalary < 0) {
      throw new BadRequestException('يجب مراجعة عقد الموظف وتحديد أجر موجب قبل احتساب المخالصة');
    }
    const dailyWage = totalSalary / 30;

    // Determine gratuity via pure engine
    if (!input.lawType) throw new BadRequestException('يجب تحديد قانون العمل؛ لا يجوز افتراض قانون دولة');
    const lawType = input.lawType;
    if (lawType === 'egyptian') {
      throw new BadRequestException('مكافأة نهاية الخدمة المصرية ليست نسبة موحدة من سنوات الخدمة. لا تستخدم الحسبة الآلية؛ راجع القانون والعقد ثم استخدم سياسة مخصصة معتمدة.');
    }
    const reason = input.terminationReason || 'resignation';
    const gratuity = calculateGratuity({
      serviceYearsDecimal,
      totalSalary,
      dailyWage,
      lawType,
      reason,
      customGratuityDaysPerYear: input.customGratuityDaysPerYear,
      minorUnits: bookDigits,
    });

    // Leave Encashment: reconcile live used annual leaves from approved requests if not yet synced
    const empAny = employee as any;
    const annualBalance = Number(empAny.annual_leave_balance ?? 0);
    let usedLeaves = Number(empAny.used_annual_leaves || 0);

    if (usedLeaves === 0) {
      const leaveRequestsRes = await sql<{ used_days: string }>`
        SELECT COALESCE(SUM(days_count), 0) AS used_days
        FROM hr_leave_requests lr
        LEFT JOIN hr_leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id
        WHERE lr.employee_id = ${input.employeeId} AND lr.tenant_id = ${tenantId}
          AND lr.status = 'approved'
          AND (
            LOWER(COALESCE(lt.code, '')) IN ('annual', 'vacation')
            OR LOWER(COALESCE(lr.leave_type, '')) IN ('annual', 'vacation')
            OR COALESCE(lt.name, '') LIKE '%سنوية%'
          )
      `.execute(this.db);
      usedLeaves = Number(leaveRequestsRes.rows[0]?.used_days || 0);
    }

    const remainingLeaveDays = Math.max(0, annualBalance - usedLeaves);
    const leaveEncashmentAmount = calculateLeaveEncashment(remainingLeaveDays, dailyWage, bookDigits);

    // Never guess unpaid wages from the termination calendar day: the employee
    // may already have been paid through the normal payroll. HR must reconcile
    // salary runs and explicitly confirm the remaining payable amount.
    if (input.pendingSalaryAmount == null || !Number.isFinite(Number(input.pendingSalaryAmount))
      || Number(input.pendingSalaryAmount) < 0) {
      throw new BadRequestException('حدد قيمة المرتب المتبقي بعد مراجعة ما تم صرفه في كشوف المرتبات');
    }
    let pendingSalaryAmount: number;
    try {
      pendingSalaryAmount = requireStoredHrMoney(Number(input.pendingSalaryAmount), bookDigits);
    } catch {
      throw new BadRequestException('قيمة المرتب المتبقي يجب أن تكون بدقة دفاتر المنشأة دون كسر أدق');
    }

    // Unpaid loans
    const loansRes = await sql<Record<string, unknown>>`
      SELECT COALESCE(SUM(remaining_amount), 0) as total_unpaid 
      FROM hr_employee_loans 
      WHERE employee_id = ${input.employeeId} 
        AND tenant_id = ${tenantId} 
        AND status IN ('disbursed', 'paid', 'partially_repaid')
    `.execute(this.db);
    const unpaidLoansDeduction = Number(loansRes.rows[0]?.total_unpaid || 0);

    // Active unreturned assets / custody
    const assetsRes = await (this.db as any)
      .selectFrom('hr_employee_assets')
      .selectAll()
      .where('employee_id', '=', input.employeeId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'not in', ['returned', 'cancelled'])
      .execute();

    const validateEosAmount = (value: unknown): number => {
      try {
        return requireStoredHrMoney(Number(value || 0), bookDigits);
      } catch {
        throw new BadRequestException('مبالغ المخالصة يجب أن تكون بدقة دفاتر المنشأة دون كسر أدق');
      }
    };
    const noticePeriodAmount = validateEosAmount(input.noticePeriodAmount);
    const customEntitlements = validateEosAmount(input.customEntitlements);
    const assetsDeduction = validateEosAmount(input.assetsDeduction);
    const otherDeductions = validateEosAmount(input.otherDeductions);

    // Entitlement absorption via pure engine
    let absorption: ReturnType<typeof calculateSettlementAbsorption>;
    try {
      absorption = calculateSettlementAbsorption({
        gratuityAmount: gratuity.gratuityAmount,
        leaveEncashmentAmount,
        pendingSalaryAmount,
        noticePeriodAmount,
        otherEntitlementsAmount: customEntitlements,
        unpaidLoansDeduction,
        assetsDeduction,
        otherDeductions,
        minorUnits: bookDigits,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'مبالغ المخالصة غير صحيحة');
    }

    const totalEntitlements = absorption.totalEntitlements;
    const totalDeductions = absorption.totalDeductions;
    const netSettlementAmount = absorption.netPayable;

    return {
      employee: {
        id: employee.id,
        employeeNo: employee.employee_no,
        name: employee.display_name || `${employee.first_name} ${employee.last_name}`.trim(),
        hireDate: employee.hire_date,
        departmentId: employee.department_id,
        currentStatus: employee.status,
      },
      servicePeriod: {
        years: serviceYears,
        months: serviceMonths,
        days: serviceDays,
        totalYearsDecimal: serviceYearsDecimal,
        totalDays: diffDays,
      },
      salaries: {
        basicSalary,
        allowanceAmount,
        totalSalary,
        dailyWage: roundMoney(dailyWage, bookDigits),
      },
      gratuity: {
        lawType,
        reason,
        baseGratuity: roundMoney(gratuity.baseGratuity, bookDigits),
        gratuityPercentage: gratuity.gratuityPercentage,
        gratuityAmount: gratuity.gratuityAmount,
      },
      leaveEncashment: {
        remainingLeaveDays,
        leaveEncashmentAmount,
      },
      pendingSalaryAmount,
      noticePeriodAmount,
      customEntitlements,
      unpaidLoansOutstanding: unpaidLoansDeduction,
      unpaidLoansDeduction: absorption.appliedLoans,
      unabsorbedLoans: absorption.unabsorbedLoans,
      assetsDeduction: absorption.appliedAssets,
      unabsorbedAssets: absorption.unabsorbedAssets,
      otherDeductions: absorption.appliedOther,
      unabsorbedOther: absorption.unabsorbedOther,
      totalEntitlements: roundMoney(totalEntitlements, bookDigits),
      totalDeductions: roundMoney(totalDeductions, bookDigits),
      netSettlementAmount,
      unreturnedAssets: assetsRes.map((a: any) => ({
        id: a.id,
        assetType: a.asset_type,
        assetName: a.asset_name,
        assetCode: a.asset_code,
        serialNo: a.serial_no,
        assignedAt: a.assigned_at,
      })),
    };
  }

  /**
   * Create & save official End of Service Settlement
   */
  async createSettlement(dto: CreateSettlementDto, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    // Calculate full breakdown
    const calc = await this.calculateSettlementPreview(dto, auth);

    return await this.db.transaction().execute(async (trx) => {
      const employee = await trx.selectFrom('hr_employees')
        .select(['id', 'status'])
        .where('id', '=', dto.employeeId).where('tenant_id', '=', tenantId)
        .forUpdate().executeTakeFirst();
      if (!employee || employee.status === 'terminated') throw new BadRequestException('الموظف انتهت خدمته بالفعل');
      const duplicate = await sql<{ id: number }>`
        SELECT id FROM hr_end_of_service_settlements
        WHERE employee_id = ${dto.employeeId} AND tenant_id = ${tenantId} LIMIT 1
      `.execute(trx);
      if (duplicate.rows.length) throw new BadRequestException('يوجد مخالصة سابقة للموظف');
      // Temporary settlement number for collision-proof generation
      const tempNo = `EOS-TMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      // Insert record
      const [inserted] = await (trx as any)
        .insertInto('hr_end_of_service_settlements')
        .values({
          tenant_id: tenantId,
          settlement_no: tempNo,
          employee_id: dto.employeeId,
          settlement_date: dto.settlementDate || new Date().toISOString().slice(0, 10),
          hire_date: calc.employee.hireDate,
          termination_date: dto.terminationDate,
          contract_type: dto.contractType || 'unspecified',
          termination_reason: dto.terminationReason,
          law_type: calc.gratuity.lawType,
          service_years: calc.servicePeriod.totalYearsDecimal,
          service_months: calc.servicePeriod.months,
          service_days: calc.servicePeriod.days,
          last_basic_salary: calc.salaries.basicSalary,
          last_total_salary: calc.salaries.totalSalary,
          gratuity_percentage: calc.gratuity.gratuityPercentage,
          gratuity_amount: calc.gratuity.gratuityAmount,
          remaining_leave_days: calc.leaveEncashment.remainingLeaveDays,
          leave_encashment_amount: calc.leaveEncashment.leaveEncashmentAmount,
          pending_salary_amount: calc.pendingSalaryAmount,
          notice_period_amount: calc.noticePeriodAmount,
          other_entitlements_amount: calc.customEntitlements,
          unpaid_loans_deduction: calc.unpaidLoansDeduction,
          assets_deduction: calc.assetsDeduction,
          other_deductions: calc.otherDeductions,
          net_settlement_amount: calc.netSettlementAmount,
          custody_cleared: dto.custodyCleared ?? false,
          clearance_checklist: JSON.stringify(dto.clearanceChecklist || []),
          clearance_notes: dto.clearanceNotes || null,
          status: 'draft',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      // Canonical collision-proof document numbering based on unique returned ID
      const settlementNo = formatDailyDocumentNumber('EOS', Number(inserted.id));
      await (trx as any)
        .updateTable('hr_end_of_service_settlements')
        .set({ settlement_no: settlementNo })
        .where('id', '=', inserted.id)
        .where('tenant_id', '=', tenantId)
        .execute();
      inserted.settlement_no = settlementNo;

      // A draft is not an approved financial settlement; termination happens
      // only when its accounting posting succeeds within the posting transaction.

      return {
        ok: true,
        settlement: inserted,
      };
    });
  }

  /**
   * List all settlements
   */
  async listSettlements(auth: AuthContext, query?: { status?: string; employeeId?: number }) {
    const { tenantId } = requireTenantScope(auth);

    let q = (this.db as any)
      .selectFrom('hr_end_of_service_settlements as s')
      .leftJoin('hr_employees as e', (join: any) => join.onRef('e.id', '=', 's.employee_id').onRef('e.tenant_id', '=', 's.tenant_id'))
      .leftJoin('hr_departments as d', (join: any) => join.onRef('d.id', '=', 'e.department_id').onRef('d.tenant_id', '=', 's.tenant_id'))
      .leftJoin('journal_entries as j', (join: any) => join.onRef('j.id', '=', 's.journal_entry_id').onRef('j.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id',
        's.settlement_no as settlementNo',
        's.employee_id as employeeId',
        's.settlement_date as settlementDate',
        's.hire_date as hireDate',
        's.termination_date as terminationDate',
        's.contract_type as contractType',
        's.termination_reason as terminationReason',
        's.law_type as lawType',
        's.service_years as serviceYears',
        's.gratuity_amount as gratuityAmount',
        's.leave_encashment_amount as leaveEncashmentAmount',
        's.pending_salary_amount as pendingSalaryAmount',
        's.net_settlement_amount as netSettlementAmount',
        's.custody_cleared as custodyCleared',
        's.status',
        's.journal_entry_id as journalEntryId',
        'j.entry_no as journalEntryNo',
        's.created_at as createdAt',
        'e.employee_no as employeeNo',
        'e.display_name as employeeName',
        'e.first_name as firstName',
        'e.last_name as lastName',
        'd.name as departmentName',
      ])
      .where('s.tenant_id', '=', tenantId);

    if (query?.status) {
      q = q.where('s.status', '=', query.status);
    }
    if (query?.employeeId) {
      q = q.where('s.employee_id', '=', query.employeeId);
    }

    const rows = await q.orderBy('s.id', 'desc').execute();

    return {
      settlements: rows.map((r: any) => ({
        ...r,
        employeeName: r.employeeName || `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        netSettlementAmount: Number(r.netSettlementAmount || 0),
        gratuityAmount: Number(r.gratuityAmount || 0),
      })),
    };
  }

  /**
   * Get single settlement detail
   */
  async getSettlement(id: number, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    const row = await (this.db as any)
      .selectFrom('hr_end_of_service_settlements as s')
      .leftJoin('hr_employees as e', (join: any) => join.onRef('e.id', '=', 's.employee_id').onRef('e.tenant_id', '=', 's.tenant_id'))
      .leftJoin('hr_departments as d', (join: any) => join.onRef('d.id', '=', 'e.department_id').onRef('d.tenant_id', '=', 's.tenant_id'))
      .leftJoin('journal_entries as j', (join: any) => join.onRef('j.id', '=', 's.journal_entry_id').onRef('j.tenant_id', '=', 's.tenant_id'))
      .selectAll('s')
      .select([
        'e.employee_no as employeeNo',
        'e.display_name as employeeName',
        'e.first_name as firstName',
        'e.last_name as lastName',
        'e.national_id as nationalId',
        'd.name as departmentName',
        'j.entry_no as journalEntryNo',
      ])
      .where('s.id', '=', id)
      .where('s.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException('مخالصة نهاية الخدمة غير موجودة');
    }

    return {
      settlement: {
        ...row,
        employeeName: row.employeeName || `${row.firstName || ''} ${row.lastName || ''}`.trim(),
        netSettlementAmount: Number(row.net_settlement_amount || 0),
        gratuityAmount: Number(row.gratuity_amount || 0),
        leaveEncashmentAmount: Number(row.leave_encashment_amount || 0),
        pendingSalaryAmount: Number(row.pending_salary_amount || 0),
        noticePeriodAmount: Number(row.notice_period_amount || 0),
        otherEntitlementsAmount: Number(row.other_entitlements_amount || 0),
        unpaidLoansDeduction: Number(row.unpaid_loans_deduction || 0),
        assetsDeduction: Number(row.assets_deduction || 0),
        otherDeductions: Number(row.other_deductions || 0),
        clearanceChecklist: typeof row.clearance_checklist === 'string'
          ? JSON.parse(row.clearance_checklist)
          : (row.clearance_checklist || []),
      },
    };
  }

  /**
   * Post 1-Click Accounting Journal Entry for the settlement
   */
  async postAccountingEntry(id: number, payload: { treasuryAccountId?: number; notes?: string }, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx) => {
      const bookDigits = await eosBookDigits(trx as Kysely<Database>, tenantId);
      const halfMinor = 1 / (2 * 10 ** bookDigits);
      // Use the same lock order as payroll approval, loan disbursement and
      // manual repayments. An EOS journal may settle the very same loan.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const settlement = await (trx as any)
        .selectFrom('hr_end_of_service_settlements')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!settlement) {
        throw new NotFoundException('المخالصة غير موجودة');
      }

      if (settlement.journal_entry_id || settlement.status === 'posted') {
        throw new BadRequestException('تم ترحيل قيد هذه المخالصة مسبقاً برقم قيد مرتبط');
      }

      // EOS gratuity and annual-leave encashment were calculated from specific
      // employment and leave records. Never post a stale draft after those
      // underlying values change without recalculating the full settlement.
      const changedFinancialBasis = await sql<{ contract_changed: boolean; leave_changed: boolean; future_contract: boolean }>`
        SELECT
          EXISTS (
            SELECT 1 FROM hr_employment_contracts c
            WHERE c.tenant_id = ${tenantId} AND c.employee_id = ${settlement.employee_id}
              AND (c.created_at > ${settlement.created_at}::timestamp
                OR c.updated_at > ${settlement.created_at}::timestamp)
          ) AS contract_changed,
          EXISTS (
            SELECT 1 FROM hr_leave_requests lr
            WHERE lr.tenant_id = ${tenantId} AND lr.employee_id = ${settlement.employee_id}
              AND (lr.created_at > ${settlement.created_at}::timestamp
                OR lr.updated_at > ${settlement.created_at}::timestamp)
          ) AS leave_changed,
          EXISTS (
            SELECT 1 FROM hr_employment_contracts c
            WHERE c.tenant_id = ${tenantId} AND c.employee_id = ${settlement.employee_id}
              AND c.status = 'active' AND c.start_date > ${settlement.termination_date}::date
          ) AS future_contract
      `.execute(trx);
      if (changedFinancialBasis.rows[0]?.contract_changed || changedFinancialBasis.rows[0]?.leave_changed) {
        throw new BadRequestException('تغيرت عقود أو إجازات الموظف بعد إعداد المخالصة؛ احذف المسودة وأعد الحساب والمراجعة قبل الترحيل');
      }
      if (changedFinancialBasis.rows[0]?.future_contract) {
        throw new BadRequestException('يوجد عقد نشط يبدأ بعد تاريخ إنهاء الخدمة؛ عالج العقود المستقبلية قبل ترحيل المخالصة');
      }

      // Payroll accrual can have occurred after the EOS draft was computed.
      // If payroll already covers the termination date, a nonzero manually
      // entered unpaid salary cannot also be posted as an EOS entitlement:
      // require HR/accounting to reconcile the payroll and regenerate a draft.
      if (Number(settlement.pending_salary_amount || 0) > 0) {
        const overlappingPayroll = await sql<{ id: number }>`
          SELECT r.id FROM hr_payroll_runs r
          JOIN hr_payroll_run_items i
            ON i.run_id = r.id AND i.tenant_id = r.tenant_id
          WHERE r.tenant_id = ${tenantId}
            AND i.employee_id = ${settlement.employee_id}
            AND r.status IN ('approved', 'paid') AND i.status = 'approved'
            AND ${settlement.termination_date}::date BETWEEN r.start_date AND r.end_date
          LIMIT 1
        `.execute(trx);
        if (overlappingPayroll.rows.length) {
          throw new BadRequestException(
            'الراتب المتأخر في المخالصة يتداخل مع مسير مرتبات معتمد؛ راجع المبالغ وأعد إنشاء المخالصة لمنع ازدواج الصرف',
          );
        }
      }

      // Custody clearance gate: If employee has unreturned assets, custody must be cleared or deducted
      const unreturnedAssets = await (trx as any)
        .selectFrom('hr_employee_assets')
        .selectAll()
        .where('employee_id', '=', settlement.employee_id)
        .where('tenant_id', '=', tenantId)
        .where('status', 'not in', ['returned', 'cancelled'])
        .execute();

      if (unreturnedAssets.length > 0 && !settlement.custody_cleared && !(Number(settlement.assets_deduction || 0) > 0)) {
        throw new BadRequestException('لا يمكن ترحيل مخالصة موظف لديه عهد غير مستردة دون إخلاء طرف للعهدة أو استقطاع قيمتها');
      }

      // EOS drafts are snapshots: loan repayments may have occurred since creation.
      // Lock the current loan balances *before* posting the general-ledger credit.
      // Otherwise the journal could credit a loan that can no longer be recovered.
      const loansDeduction = Number(settlement.unpaid_loans_deduction || 0);
      const activeLoans = loansDeduction > 0 ? await sql<Record<string, unknown>>`
        SELECT * FROM hr_employee_loans
        WHERE employee_id = ${settlement.employee_id}
          AND tenant_id = ${tenantId}
          AND status IN ('disbursed', 'paid', 'partially_repaid')
          AND remaining_amount > 0
        ORDER BY id ASC
        FOR UPDATE
      `.execute(trx) : { rows: [] as Record<string, unknown>[] };
      const availableLoanBalance = roundMoney(activeLoans.rows.reduce(
        (sum, loan) => sum + Number(loan.remaining_amount || 0), 0,
      ), bookDigits);
      if (loansDeduction < 0 || loansDeduction > availableLoanBalance + halfMinor) {
        throw new BadRequestException('رصيد السلف تغير منذ إنشاء المخالصة؛ احذف المسودة وأعد احتسابها قبل الترحيل');
      }

      // Post 1-Click Accounting Journal Entry via AccountingPostingService
      const postingRes = await this.accountingPosting.postEndOfServiceSettlement(
        trx,
        id,
        payload.treasuryAccountId || null,
        auth,
      );

      const entryId = postingRes.journalEntryId;
      if (!entryId) throw new BadRequestException('تعذر ترحيل قيد مخالصة الموظف المحاسبي.');

      // Allocate only the exact balances locked and reconciled above.
      if (loansDeduction > 0) {
        let remainingLoanDeduction = loansDeduction;

        for (const loan of activeLoans.rows) {
          if (remainingLoanDeduction <= 0) break;
          const loanId = Number(loan.id);
          const remainingBalance = Number(loan.remaining_amount || 0);
          const toDeduct = Math.min(remainingBalance, remainingLoanDeduction);
          const newPaid = roundMoney(Number(loan.paid_amount || 0) + toDeduct, bookDigits);
          const newRemaining = roundMoney(remainingBalance - toDeduct, bookDigits);
          const newStatus = newRemaining <= 0 ? 'repaid' : 'partially_repaid';

          await sql`
            UPDATE hr_employee_loans
            SET paid_amount = ${newPaid},
                remaining_amount = ${newRemaining},
                status = ${newStatus},
                updated_by = ${auth.userId ? Number(auth.userId) : null},
                updated_at = NOW()
            WHERE id = ${loanId} AND tenant_id = ${tenantId}
          `.execute(trx);

          // Deduct from loan installments
          let remainingInstallmentDeduction = toDeduct;
          const installments = await sql<Record<string, unknown>>`
            SELECT id, amount, paid_amount
            FROM hr_employee_loan_installments
            WHERE loan_id = ${loanId} AND tenant_id = ${tenantId} AND status <> 'paid'
            ORDER BY installment_no ASC
          `.execute(trx);

          for (const inst of installments.rows) {
            if (remainingInstallmentDeduction <= 0) break;
            const instId = Number(inst.id);
            const instAmount = Number(inst.amount || 0);
            const alreadyPaid = Number(inst.paid_amount || 0);
            const due = Math.max(0, instAmount - alreadyPaid);
            if (due <= 0) continue;
            const applied = Math.min(due, remainingInstallmentDeduction);
            const updatedPaid = roundMoney(alreadyPaid + applied, bookDigits);
            const instStatus = updatedPaid + halfMinor >= instAmount ? 'paid' : 'partial';

            await sql`
              UPDATE hr_employee_loan_installments
              SET paid_amount = ${updatedPaid},
                  status = ${instStatus},
                  paid_at = CASE WHEN ${instStatus} = 'paid' THEN NOW() ELSE paid_at END,
                  updated_at = NOW()
              WHERE id = ${instId} AND tenant_id = ${tenantId}
            `.execute(trx);

            remainingInstallmentDeduction = roundMoney(remainingInstallmentDeduction - applied, bookDigits);
          }
          // Loan principal, detailed installments and EOS GL have to reconcile
          // in the same transaction. Historic missing installments must not
          // silently disappear from the employee repayment subledger.
          if (remainingInstallmentDeduction > halfMinor) {
            throw new BadRequestException(
              'أقساط السلفة لا تغطي كامل الخصم من المخالصة؛ أصلح جدول الأقساط قبل الترحيل',
            );
          }

          // Record in hr_employee_ledger
          await sql`
            INSERT INTO hr_employee_ledger (
              employee_id, entry_type, amount, balance_after, note, repayment_method,
              reference_type, reference_id, created_by, tenant_id
            ) VALUES (
              ${settlement.employee_id}, 'loan_repayment', ${-toDeduct}, ${newRemaining},
              ${'تسوية سلف بمخالصة نهاية الخدمة #' + settlement.settlement_no},
              'salary_deduction', 'hr_end_of_service_settlement', ${id},
              ${auth.userId ? Number(auth.userId) : null}, ${tenantId}
            )
          `.execute(trx);

          remainingLoanDeduction = roundMoney(remainingLoanDeduction - toDeduct, bookDigits);
        }
        if (remainingLoanDeduction > halfMinor) {
          throw new BadRequestException('تعذر توزيع إجمالي خصومات السلف بالكامل؛ تم إلغاء ترحيل المخالصة');
        }
      }

      // A settlement becomes final only together with its journal and HR state.
      await sql`
        UPDATE hr_employees
        SET status = 'terminated',
            end_of_service_date = ${settlement.termination_date},
            end_of_service_reason = ${settlement.termination_reason},
            updated_at = NOW()
        WHERE id = ${settlement.employee_id} AND tenant_id = ${tenantId}
      `.execute(trx);
      await sql`
        UPDATE hr_employment_contracts
        SET status = 'ended',
            end_date = ${settlement.termination_date},
            updated_at = NOW()
        WHERE employee_id = ${settlement.employee_id} AND tenant_id = ${tenantId}
          AND status = 'active' AND start_date <= ${settlement.termination_date}::date
      `.execute(trx);
      // Update settlement record
      await (trx as any)
        .updateTable('hr_end_of_service_settlements')
        .set({
          journal_entry_id: entryId,
          status: 'posted',
          treasury_or_bank_account_id: payload.treasuryAccountId || null,
          updated_by: auth.userId ? Number(auth.userId) : null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        ok: true,
        journalEntryId: entryId,
      };
    });
  }

  /**
   * Delete draft settlement
   */
  async deleteSettlement(id: number, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx) => {
      const row = await (trx as any)
        .selectFrom('hr_end_of_service_settlements')
        .select(['id', 'status', 'journal_entry_id'])
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!row) {
        throw new NotFoundException('المخالصة غير موجودة');
      }

      if (row.journal_entry_id || row.status === 'posted') {
        throw new BadRequestException('لا يمكن حذف مخالصة تم ترحيل قيدها المحاسبي');
      }

      await (trx as any)
        .deleteFrom('hr_end_of_service_settlements')
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return { ok: true };
    });
  }
}
