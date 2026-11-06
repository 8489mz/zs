import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { assertPortalTenantAllowed } from '../../core/auth/utils/portal-tenant-status';
import { calculateLoanInstallmentSchedule, addLoanInstallmentMonths, requireLoanMoney } from './payroll-loan-allocation.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { LoginAttemptLimiter } from '../../common/utils/login-attempt-limiter';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import {
  PORTAL_TOKEN_TTL_MS,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../core/auth/utils/portal-token';

const PORTAL_TOKEN_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'يرجى تسجيل الدخول إلى بوابة الموظف', code: 'UNAUTHORIZED' },
  invalid: { message: 'رمز الجلسة غير صالح', code: 'INVALID_TOKEN' },
  signature: { message: 'رمز الجلسة غير صالح أو تم التلاعب به', code: 'INVALID_SIGNATURE' },
  expired: { message: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول', code: 'TOKEN_EXPIRED' },
};

export interface PortalEmployeeUser {
  employeeId: number;
  employeeNo: string;
  name: string;
  phone: string;
  branchId: number | null;
  branchName: string;
  departmentName: string;
  positionName: string;
  hireDate: string | null;
  status: string;
  tenantId: string;
  accountId: string;
}

@Injectable()
export class EmployeePortalService {
  private readonly loginLimiter = new LoginAttemptLimiter();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Generates a tamper-proof session token for the employee portal
   */
  generateToken(user: PortalEmployeeUser): string {
    return signPortalToken(
      {
        employeeId: user.employeeId,
        employeeNo: user.employeeNo,
        name: user.name,
        tenantId: user.tenantId,
        accountId: user.accountId,
        branchId: user.branchId,
        role: 'employee',
      },
      PORTAL_TOKEN_TTL_MS,
    );
  }

  /**
   * Verifies employee portal token from Authorization header.
   *
   * التوقيع وحده لا يكفي: الرمز بلا حالة وعمره 30 يوماً، فلا بد من التأكد على كل طلب
   * أن الموظف ما زال موجوداً ونشطاً **داخل نفس المستأجر المذكور في الرمز**. بدون هذا
   * الفحص يظل موظف مفصول (أو مستأجر موقوف) قادراً على قراءة الرواتب والسلف لمدة شهر.
   */
  async verifyToken(authHeader?: string): Promise<PortalEmployeeUser & { mustChangePin: boolean }> {
    const payload = verifyPortalToken<Record<string, any>>(authHeader, PORTAL_TOKEN_ERRORS);

    const employeeId = Number(payload.employeeId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    const accountId = String(payload.accountId || '').trim();

    if (!employeeId || !tenantId || !accountId) {
      throw new AppError('رمز الجلسة غير صالح', 'INVALID_TOKEN', 401);
    }

    const employee = await this.anyDb
      .selectFrom('hr_employees')
      .select(['id', 'status', 'tenant_id', 'account_id', 'pin_hash', 'pin_salt'])
      .where('id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!employee || employee.status !== 'active') {
      throw new AppError('تم إيقاف حساب الموظف. يرجى مراجعة إدارة الموارد البشرية', 'EMPLOYEE_INACTIVE', 401);
    }

    // INV-PORTAL-TENANT-STATUS-ENFORCED: the token is stateless, so
    // every request re-checks the tenant status, not just the row.
    await assertPortalTenantAllowed(this.db as any, this.authCache, tenantId);

    // INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE: the flag is re-derived from the
    // live stored hash on every request, never trusted from the token. A
    // changed PIN unflags the session immediately, even on an old token.
    const mustChangePin = employee.pin_hash
      ? (await verifyPassword('1234', String(employee.pin_hash), String(employee.pin_salt || ''))).valid
      : false;

    return {
      employeeId,
      employeeNo: String(payload.employeeNo || ''),
      name: String(payload.name || ''),
      phone: String(payload.phone || ''),
      branchId: payload.branchId != null ? Number(payload.branchId) : null,
      branchName: String(payload.branchName || ''),
      departmentName: String(payload.departmentName || ''),
      positionName: String(payload.positionName || ''),
      hireDate: payload.hireDate ? String(payload.hireDate) : null,
      status: String(employee.status),
      tenantId: String(employee.tenant_id),
      accountId: String(employee.account_id || accountId),
      mustChangePin,
    };
  }

  /**
   * Employee Login using phone / employeeNo / nationalId + 4-digit PIN
   */
  async login(payload: { identifier: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{
    token: string;
    employee: PortalEmployeeUser;
    mustChangePin: boolean;
  }> {
    const rawIdentifier = String(payload?.identifier || '').trim();
    const rawPin = String(payload?.pinCode || '').trim();

    if (!rawIdentifier || !rawPin) {
      throw new AppError('يرجى إدخال رقم الهاتف المحمول ورمز الدخول السري (PIN)', 'INVALID_CREDENTIALS', 400);
    }

    const rateLimitKey = `employee-portal:${rawIdentifier.toLowerCase()}:${(payload?.companyCode || payload?.tenantId || '').toLowerCase()}`;
    this.loginLimiter.assertNotLocked(rateLimitKey);

    try {
      return await this.loginInternal(payload, rawIdentifier, rawPin);
    } catch (error) {
      if (error instanceof AppError && ['EMPLOYEE_NOT_FOUND', 'INVALID_PIN', 'NO_ACTIVE_EMPLOYEES'].includes(error.code)) {
        this.loginLimiter.recordFailure(rateLimitKey);
      }
      throw error;
    }
  }

  private async loginInternal(
    payload: { identifier: string; pinCode: string; companyCode?: string; tenantId?: string },
    rawIdentifier: string,
    rawPin: string,
  ): Promise<{ token: string; employee: PortalEmployeeUser; mustChangePin: boolean }> {
    const cleanDigits = rawIdentifier.replace(/\D/g, '');
    const cleanNoCountry = cleanDigits.startsWith('20')
      ? cleanDigits.slice(2)
      : cleanDigits.startsWith('0')
      ? cleanDigits.slice(1)
      : cleanDigits;

    const companyScope = payload?.companyCode || payload?.tenantId;
    let resolvedTenantId = companyScope ? String(companyScope).trim() : undefined;
    if (resolvedTenantId) {
      try {
        const tenantRow = await this.anyDb
          .selectFrom('tenants')
          .select(['id', 'slug'])
          .where((eb: any) => eb.or([eb('id', '=', resolvedTenantId), eb('slug', '=', resolvedTenantId)]))
          .executeTakeFirst();
        if (tenantRow?.id) {
          resolvedTenantId = tenantRow.id;
        }
      } catch {
        // fallback
      }
    }

    let contacts: Array<{ employee_id: number; value: string; contact_type: string }> = [];
    if (cleanNoCountry.length >= 8) {
      let contactQuery = this.anyDb.selectFrom('hr_employee_contacts')
        .select(['employee_id', 'value', 'contact_type'])
        .where('contact_type', '=', 'phone')
        .where(sql<boolean>`RIGHT(REGEXP_REPLACE(value, '[^0-9]', '', 'g'), ${cleanNoCountry.length}) = ${cleanNoCountry}`);
      if (resolvedTenantId) contactQuery = contactQuery.where('tenant_id', '=', resolvedTenantId);
      contacts = await contactQuery.execute();
    }
    const contactEmployeeIds = [...new Set(contacts.map((contact) => Number(contact.employee_id)).filter((id) => id > 0))];

    // Search only employees identified by the supplied number or phone contact.
    let employeesQuery = this.anyDb
      .selectFrom('hr_employees as e')
      .leftJoin('branches as b', (join: any) => join.onRef('b.id', '=', 'e.branch_id').onRef('b.tenant_id', '=', 'e.tenant_id'))
      .leftJoin('hr_departments as d', (join: any) => join.onRef('d.id', '=', 'e.department_id').onRef('d.tenant_id', '=', 'e.tenant_id'))
      .leftJoin('hr_positions as pos', (join: any) => join.onRef('pos.id', '=', 'e.position_id').onRef('pos.tenant_id', '=', 'e.tenant_id'))
      .select([
        'e.id as employee_id',
        'e.employee_no',
        'e.display_name',
        'e.first_name',
        'e.last_name',
        'e.pin_hash',
        'e.pin_salt',
        'e.hire_date',
        'e.status',
        'e.tenant_id',
        'e.account_id',
        'e.branch_id',
        'b.name as branch_name',
        'd.name as department_name',
        'pos.name as position_name',
      ])
      .where('e.status', '=', 'active');

    employeesQuery = contactEmployeeIds.length
      ? employeesQuery.where((eb: any) => eb.or([eb('e.employee_no', 'ilike', rawIdentifier), eb('e.id', 'in', contactEmployeeIds)]))
      : employeesQuery.where('e.employee_no', 'ilike', rawIdentifier);

    if (resolvedTenantId) {
      employeesQuery = employeesQuery.where('e.tenant_id', '=', resolvedTenantId);
    }

    const employees = await employeesQuery.execute();

    if (!employees || employees.length === 0) {
      throw new AppError('لم يتم العثور على أي موظف نشط في النظام', 'NO_ACTIVE_EMPLOYEES', 404);
    }

    // Match employee
    const matchedEmployees = employees.filter((e: any) => {
      // Check employee_no
      if (e.employee_no && e.employee_no.trim().toLowerCase() === rawIdentifier.toLowerCase()) {
        return true;
      }

      // Check phone contacts
      const empContacts = contacts.filter((c: any) => String(c.employee_id) === String(e.employee_id));
      return empContacts.some((c: any) => {
        const p = String(c.value || '').trim();
        const pDigits = p.replace(/\D/g, '');
        const pNoCountry = pDigits.startsWith('20')
          ? pDigits.slice(2)
          : pDigits.startsWith('0')
          ? pDigits.slice(1)
          : pDigits;
        return cleanDigits.length >= 8 && (pDigits === cleanDigits || pNoCountry === cleanNoCountry);
      });
    });

    if (!matchedEmployees || matchedEmployees.length === 0) {
      throw new AppError('بيانات الدخول غير صحيحة، يرجى التأكد من رقم الهاتف المحمول ورمز الدخول السري', 'EMPLOYEE_NOT_FOUND', 401);
    }

    let matched: any = null;

    if (matchedEmployees.length === 1) {
      matched = matchedEmployees[0];
      if (!matched.pin_hash) {
        throw new AppError('لم يتم تعيين رمز الدخول السري (PIN) لهذا الموظف بعد. يرجى مراجعة إدارة الموارد البشرية لتعيينه', 'INVALID_PIN', 401);
      }
      const check = await verifyPassword(rawPin, String(matched.pin_hash), String(matched.pin_salt || ''));
      if (!check.valid) {
        throw new AppError('رمز الدخول السري (PIN) غير صحيح', 'INVALID_PIN', 401);
      }
    } else {
      // Multiple matches across tenants (e.g. employee code 001 exists in both Ragab and Mahmoud).
      // المقارنة صارت تجزئة، فلا يمكن ترشيحها بـ`filter` متزامن — تُفحص كل
      // المرشحين بالتوازي كما في مسار دخول المستخدمين (`session.service`).
      const pinChecks = await Promise.all(
        matchedEmployees.map(async (emp: any) => {
          if (!emp.pin_hash) return false;
          const res = await verifyPassword(rawPin, String(emp.pin_hash), String(emp.pin_salt || ''));
          return res.valid;
        }),
      );
      const validPinMatches = matchedEmployees.filter((_: any, idx: number) => pinChecks[idx]);

      if (validPinMatches.length === 1) {
        matched = validPinMatches[0];
      } else if (validPinMatches.length > 1) {
        const candidateTenantIds = Array.from(
          new Set(validPinMatches.map((e: any) => String(e.tenant_id).trim())),
        ).filter(Boolean);

        let tenantRows: any[] = [];
        try {
          tenantRows = await this.anyDb
            .selectFrom('tenants')
            .select(['id', 'slug', 'business_name'])
            .where('id', 'in', candidateTenantIds)
            .execute();
        } catch {
          tenantRows = [];
        }

        const tenantMap = new Map((tenantRows || []).map((t: any) => [t.id, t]));
        const tenantOptions = candidateTenantIds.map((tId) => {
          const t = tenantMap.get(tId);
          return {
            id: tId,
            name: t?.business_name || t?.slug || tId,
            slug: t?.slug || tId,
          };
        });

        throw new AppError(
          'بيانات الدخول مسجلة لدى أكثر من منشأة. يرجى اختيار المنشأة لمتابعة العمل.',
          'MULTIPLE_TENANTS',
          401,
          { tenants: tenantOptions },
        );
      } else {
        throw new AppError('رمز الدخول السري (PIN) غير صحيح', 'INVALID_PIN', 401);
      }
    }

    const employeeUser: PortalEmployeeUser = {
      employeeId: Number(matched.employee_id),
      employeeNo: matched.employee_no || `EMP-${matched.employee_id}`,
      name: matched.display_name || `${matched.first_name} ${matched.last_name}`.trim(),
      phone: rawIdentifier,
      branchId: matched.branch_id ? Number(matched.branch_id) : null,
      branchName: matched.branch_name || 'الفرع الرئيسي',
      departmentName: matched.department_name || 'الإدارة العامة',
      positionName: matched.position_name || 'موظف',
      hireDate: matched.hire_date ? String(matched.hire_date).slice(0, 10) : null,
      status: matched.status,
      tenantId: matched.tenant_id,
      accountId: matched.account_id,
    };

    // INV-PORTAL-TENANT-STATUS-ENFORCED: no fresh login for a
    // suspended / expired / trial-expired tenant, even with a valid PIN.
    await assertPortalTenantAllowed(this.db as any, this.authCache, String(matched.tenant_id));

    // INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE: a PIN that is still the public
    // default must be changed at first login. Detection is a real password
    // check against the stored hash — never a comparison with a stored
    // value — and the default itself is never returned or displayed.
    const mustChangePin = matched.pin_hash
      ? (await verifyPassword('1234', String(matched.pin_hash), String(matched.pin_salt || ''))).valid
      : false;

    const rateLimitKey = `employee-portal:${rawIdentifier.toLowerCase()}:${(payload?.companyCode || payload?.tenantId || '').toLowerCase()}`;
    this.loginLimiter.recordSuccess(rateLimitKey);

    const token = this.generateToken(employeeUser);
    return { token, employee: employeeUser, mustChangePin };
  }

  /**
   * INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE: no portal data is served while the
   * employee still uses the default PIN. The change-PIN endpoint is the only
   * escape hatch and does not call this guard.
   */
  assertPinChanged(user: { mustChangePin?: boolean }): void {
    if (user?.mustChangePin) {
      throw new AppError('يجب تغيير رمز الدخول الافتراضي قبل المتابعة', 'PIN_CHANGE_REQUIRED', 403);
    }
  }

  /**
   * Employee self-service PIN change. The current PIN must verify first;
   * the new credential must be at least 4 characters, never a trivial value
   * (0000 / 1234), and different from the current one. Returns a fresh
   * token: once the PIN is no longer the default the session is unflagged
   * and the dashboard opens.
   */
  async changePin(
    user: PortalEmployeeUser & { mustChangePin: boolean },
    body: { currentPin?: string; newPin?: string },
  ): Promise<{ token: string; employee: PortalEmployeeUser; mustChangePin: false }> {
    const currentPin = String(body?.currentPin || '').trim();
    const newPin = String(body?.newPin || '').trim();
    if (!currentPin || !newPin) {
      throw new AppError('يرجى إدخال الرمز الحالي والرمز الجديد', 'INVALID_PIN', 400);
    }

    const employee = await this.anyDb
      .selectFrom('hr_employees')
      .select(['id', 'status', 'tenant_id', 'account_id', 'pin_hash', 'pin_salt'])
      .where('id', '=', user.employeeId)
      .where('tenant_id', '=', user.tenantId)
      .executeTakeFirst();

    if (!employee || employee.status !== 'active') {
      throw new AppError('تم إيقاف حساب الموظف. يرجى مراجعة إدارة الموارد البشرية', 'EMPLOYEE_INACTIVE', 401);
    }
    if (
      !employee.pin_hash ||
      !(await verifyPassword(currentPin, String(employee.pin_hash), String(employee.pin_salt || ''))).valid
    ) {
      throw new AppError('رمز الدخول الحالي غير صحيح', 'INVALID_PIN', 401);
    }
    if (
      newPin.length < 4 ||
      newPin.length > 64 ||
      newPin === '0000' ||
      newPin === '1234' ||
      (await verifyPassword(newPin, String(employee.pin_hash), String(employee.pin_salt || ''))).valid
    ) {
      throw new AppError(
        'الرمز الجديد ضعيف: يجب أن يكون 4 أحرف على الأقل، وأن يختلف عن الرمز الحالي',
        'WEAK_PIN',
        400,
      );
    }

    const record = await createPasswordRecord(newPin);
    await this.anyDb
      .updateTable('hr_employees')
      .set({ pin_hash: record.hash, pin_salt: record.salt })
      .where('id', '=', user.employeeId)
      .where('tenant_id', '=', user.tenantId)
      .execute();

    const { mustChangePin: _ignored, ...employeeUser } = user;
    return { token: this.generateToken(employeeUser), employee: employeeUser, mustChangePin: false };
  }

  /**
   * رصيد الإجازات المتاح للموظف.
   *
   * كان هذا يُقرأ من جدول `hr_leave_balances` — وهو جدول **غير موجود في أي هجرة**،
   * فكانت لوحة البوابة و شاشة الإجازات تنهار بالكامل وقت التشغيل، والخطأ مخفي خلف
   * `this.db as any`. المصدر الحقيقي هو `hr_employees.annual_leave_balance`
   * (هجرة `2030000000006-hr-leave-balances`) مع `used_annual_leaves` المحدث ذرياً عند الاعتماد والإلغاء.
   */
  private async computeLeaveBalances(employeeId: number, tenantId: string): Promise<Array<{
    leave_type_id: number | null;
    leave_type_name: string;
    total_days: number;
    used_days: number;
    remaining_days: number;
  }>> {
    const employee = await this.anyDb
      .selectFrom('hr_employees')
      .select(['annual_leave_balance', 'used_annual_leaves'])
      .where('id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const annualType = await this.anyDb
      .selectFrom('hr_leave_types')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where(sql`LOWER(COALESCE(code, ''))`, '=', 'annual')
      .executeTakeFirst();

    // HR approval/cancellation atomically updates this counter. Summing every
    // approved request instead would count sick/unpaid leave as annual leave and
    // disagree with the balance enforcement used by the HR approval endpoint.
    const totalDays = Math.max(0, Number(employee?.annual_leave_balance ?? 0));
    const usedDays = Math.max(0, Number(employee?.used_annual_leaves || 0));

    return [{
      leave_type_id: annualType?.id != null ? Number(annualType.id) : null,
      leave_type_name: annualType?.name || 'إجازة سنوية',
      total_days: totalDays,
      used_days: usedDays,
      remaining_days: Math.max(0, totalDays - usedDays),
    }];
  }

  /**
   * Get employee dashboard overview
   */
  async getDashboard(employeeId: number, tenantId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7); // YYYY-MM

    // 1. Employee Profile
    const employee = await this.anyDb
      .selectFrom('hr_employees as e')
      .leftJoin('branches as b', 'b.id', 'e.branch_id')
      .leftJoin('hr_departments as d', 'd.id', 'e.department_id')
      .leftJoin('hr_positions as pos', 'pos.id', 'e.position_id')
      .select([
        'e.id',
        'e.employee_no',
        'e.display_name',
        'e.first_name',
        'e.last_name',
        'e.hire_date',
        'e.status',
        'b.name as branch_name',
        'd.name as department_name',
        'pos.name as position_name',
      ])
      .where('e.id', '=', employeeId)
      .where('e.tenant_id', '=', tenantId)
      .executeTakeFirst();

    // 2. Active contract
    const contract = await this.anyDb
      .selectFrom('hr_employment_contracts')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    // 3. Today's attendance
    const todayAttendance = await this.anyDb
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where('work_date', '=', today)
      .executeTakeFirst();

    // 4. Month attendance counts
    const monthRecords = await this.anyDb
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where(sql`work_date::text`, 'like', `${currentMonth}%`)
      .execute();

    const daysPresent = monthRecords.filter((r: any) => r.status === 'present' || r.check_in_at).length;
    let totalWorkHours = 0;
    let totalLateMinutes = 0;
    for (const r of monthRecords) {
      totalWorkHours += Number(r.work_hours || 0);
      totalLateMinutes += Number(r.late_minutes || 0);
    }

    // 5. Leave balances
    const leaveBalances = await this.computeLeaveBalances(employeeId, tenantId);

    // 6. Latest payslip
    const latestPayslip = await this.anyDb
      .selectFrom('hr_payroll_run_items as item')
      .innerJoin('hr_payroll_runs as run', (join: any) => join.onRef('run.id', '=', 'item.run_id').onRef('run.tenant_id', '=', 'item.tenant_id'))
      .select([
        'item.id',
        'item.run_id',
        'run.period_month',
        'item.base_salary',
        'item.allowance_amount',
        'item.deduction_amount',
        'item.loan_deduction_amount',
        'item.gross_pay',
        'item.net_pay',
        'item.status',
        'run.created_at',
      ])
      .where('item.employee_id', '=', employeeId)
      .where('item.tenant_id', '=', tenantId)
      .where('item.status', '=', 'approved')
      .where('run.status', 'in', ['approved', 'paid'])
      .orderBy('run.period_month', 'desc')
      .executeTakeFirst();

    // 7. Active loans remaining
    const loans = await this.anyDb
      .selectFrom('hr_employee_loans')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['approved', 'paid', 'partially_repaid'])
      .execute();

    let totalLoansRemaining = 0;
    for (const l of loans) {
      totalLoansRemaining += Number(l.remaining_amount || 0);
    }

    return {
      profile: {
        id: employee?.id,
        employeeNo: employee?.employee_no,
        name: employee?.display_name || `${employee?.first_name} ${employee?.last_name}`.trim(),
        branchName: employee?.branch_name || 'الفرع الرئيسي',
        departmentName: employee?.department_name || 'الإدارة العامة',
        positionName: employee?.position_name || 'موظف',
        hireDate: employee?.hire_date ? String(employee.hire_date).slice(0, 10) : null,
        status: employee?.status,
        baseSalary: contract?.base_salary ? Number(contract.base_salary) : 0,
        housingAllowance: contract?.housing_allowance ? Number(contract.housing_allowance) : 0,
        transportAllowance: contract?.transport_allowance ? Number(contract.transport_allowance) : 0,
      },
      todayAttendance: {
        hasCheckedIn: Boolean(todayAttendance?.check_in_at),
        hasCheckedOut: Boolean(todayAttendance?.check_out_at),
        checkInTime: todayAttendance?.check_in_at ? new Date(todayAttendance.check_in_at).toLocaleTimeString('ar-EG') : null,
        checkOutTime: todayAttendance?.check_out_at ? new Date(todayAttendance.check_out_at).toLocaleTimeString('ar-EG') : null,
        workHours: Number(todayAttendance?.work_hours || 0),
        status: todayAttendance?.status || 'لم يبصم بعد',
      },
      monthSummary: {
        month: currentMonth,
        daysPresent,
        totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        totalLateMinutes,
      },
      leaveBalances: leaveBalances.map((b: any) => ({
        leaveTypeId: b.leave_type_id,
        name: b.leave_type_name || 'إجازة سنوية',
        totalDays: Number(b.total_days ?? 0),
        usedDays: Number(b.used_days || 0),
        remainingDays: Number(b.remaining_days ?? 0),
      })),
      latestPayslip: latestPayslip ? {
        period: latestPayslip.period_month,
        baseSalary: Number(latestPayslip.base_salary || 0),
        allowanceAmount: Number(latestPayslip.allowance_amount || 0),
        deductionAmount: Number(latestPayslip.deduction_amount || 0),
        loanDeduction: Number(latestPayslip.loan_deduction_amount || 0),
        netPay: Number(latestPayslip.net_pay || 0),
        status: latestPayslip.status,
      } : null,
      totalLoansRemaining,
    };
  }

  /**
   * Get attendance log for month
   */
  async getAttendance(employeeId: number, tenantId: string, month?: string) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const records = await this.anyDb
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .where(sql`work_date::text`, 'like', `${targetMonth}%`)
      .orderBy('work_date', 'desc')
      .execute();

    return records.map((r: any) => ({
      id: r.id,
      date: String(r.work_date).slice(0, 10),
      checkInTime: r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString('ar-EG') : '-',
      checkOutTime: r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString('ar-EG') : '-',
      workHours: Number(r.work_hours || 0),
      overtimeHours: Number(r.overtime_hours || 0),
      lateMinutes: Number(r.late_minutes || 0),
      status: r.status,
      source: r.source || 'device',
      notes: r.notes || '',
    }));
  }

  /**
   * Get employee payslips
   */
  async getPayslips(employeeId: number, tenantId: string) {
    const items = await this.anyDb
      .selectFrom('hr_payroll_run_items as item')
      .innerJoin('hr_payroll_runs as run', (join: any) => join.onRef('run.id', '=', 'item.run_id').onRef('run.tenant_id', '=', 'item.tenant_id'))
      .select([
        'item.id',
        'item.run_id',
        'run.period_month',
        'item.base_salary',
        'item.allowance_amount',
        'item.deduction_amount',
        'item.loan_deduction_amount',
        'item.gross_pay',
        'item.net_pay',
        'item.status',
        'item.notes',
        'run.created_at',
      ])
      .where('item.employee_id', '=', employeeId)
      .where('item.tenant_id', '=', tenantId)
      .where('item.status', '=', 'approved')
      .where('run.status', 'in', ['approved', 'paid'])
      .orderBy('run.period_month', 'desc')
      .execute();

    // Adjustments
    const itemIds = items.map((i: any) => i.id);
    let adjustments: any[] = [];
    if (itemIds.length > 0) {
      adjustments = await this.anyDb
        .selectFrom('hr_payroll_item_adjustments')
        .selectAll()
        .where('payroll_item_id', 'in', itemIds)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    return items.map((i: any) => {
      const itemAdjustments = adjustments.filter((a: any) => String(a.payroll_item_id) === String(i.id));
      return {
        id: i.id,
        period: i.period_month,
        baseSalary: Number(i.base_salary || 0),
        allowances: Number(i.allowance_amount || 0),
        deductions: Number(i.deduction_amount || 0),
        loanDeductions: Number(i.loan_deduction_amount || 0),
        grossPay: Number(i.gross_pay || 0),
        netPay: Number(i.net_pay || 0),
        status: i.status,
        notes: i.notes || '',
        createdAt: i.created_at,
        adjustments: itemAdjustments.map((a: any) => ({
          type: a.adjustment_type,
          label: a.label,
          amount: Number(a.amount || 0),
        })),
      };
    });
  }

  /**
   * Get employee leave balance and requests
   */
  async getLeaves(employeeId: number, tenantId: string) {
    const types = await this.anyDb
      .selectFrom('hr_leave_types')
      .selectAll()
      .where('is_active', '=', true)
      .where('tenant_id', '=', tenantId)
      .execute();

    const balances = await this.computeLeaveBalances(employeeId, tenantId);

    const requests = await this.anyDb
      .selectFrom('hr_leave_requests as req')
      .leftJoin('hr_leave_types as t', (join: any) => join.onRef('t.id', '=', 'req.leave_type_id').onRef('t.tenant_id', '=', 'req.tenant_id'))
      .select([
        'req.id',
        'req.leave_type_id',
        't.name as leave_type_name',
        'req.start_date',
        'req.end_date',
        'req.days_count',
        'req.status',
        'req.reason',
        'req.decision_notes',
        'req.created_at',
      ])
      .where('req.employee_id', '=', employeeId)
      .where('req.tenant_id', '=', tenantId)
      .orderBy('req.created_at', 'desc')
      .execute();

    return {
      leaveTypes: types.map((t: any) => ({ id: t.id, name: t.name, isPaid: t.is_paid })),
      balances: balances.map((b: any) => ({
        leaveTypeId: b.leave_type_id,
        name: b.leave_type_name,
        totalDays: Number(b.total_days ?? 0),
        usedDays: Number(b.used_days || 0),
        remainingDays: Number(b.remaining_days ?? 0),
      })),
      requests: requests.map((r: any) => ({
        id: r.id,
        leaveTypeId: r.leave_type_id,
        leaveTypeName: r.leave_type_name || 'إجازة سنوية',
        startDate: String(r.start_date).slice(0, 10),
        endDate: String(r.end_date).slice(0, 10),
        daysCount: Number(r.days_count || 1),
        status: r.status,
        reason: r.reason || '',
        decisionNotes: r.decision_notes || '',
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Submit a new leave request
   */
  async requestLeave(
    employeeId: number,
    tenantId: string,
    accountId: string,
    body: { leaveTypeId: number; startDate: string; endDate: string; reason?: string },
  ) {
    const start = String(body.startDate || '');
    const end = String(body.endDate || '');
    const validDate = (value: string): boolean => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const timestamp = Date.parse(value + 'T00:00:00Z');
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
    };
    if (!validDate(start) || !validDate(end) || end < start) {
      throw new AppError('تاريخ بداية ونهاية الإجازة غير صحيحين', 'INVALID_LEAVE_DATES', 400);
    }
    const leaveTypeId = Number(body.leaveTypeId || 0);
    if (!Number.isSafeInteger(leaveTypeId) || leaveTypeId <= 0) {
      throw new AppError('اختر نوع الإجازة', 'INVALID_LEAVE_TYPE', 400);
    }
    const daysCount = Math.floor((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
    // Shared employee lock serializes portal and HR-created requests for the
    // same employee, eliminating concurrent overlapping annual leave requests.
    const inserted = await this.db.transaction().execute(async (trx) => {
      const employee = await sql<{ id: number; hire_date: string | null; end_date: string | null }>`
        SELECT id, to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
               to_char(end_of_service_date, 'YYYY-MM-DD') AS end_date
        FROM hr_employees
        WHERE id = ${employeeId} AND tenant_id = ${tenantId} AND status = 'active'
        FOR UPDATE
      `.execute(trx);
      const employeeService = employee.rows[0];
      if (!employeeService) throw new AppError('الموظف غير نشط', 'EMPLOYEE_INACTIVE', 403);
      if ((employeeService.hire_date && start < employeeService.hire_date)
        || (employeeService.end_date && end > employeeService.end_date)) {
        throw new AppError('تاريخ الإجازة يجب أن يقع داخل مدة خدمة الموظف', 'LEAVE_OUTSIDE_EMPLOYMENT', 400);
      }
      const leaveType = await sql<{ id: number }>`
        SELECT id FROM hr_leave_types
        WHERE id = ${leaveTypeId} AND tenant_id = ${tenantId} AND is_active = TRUE
      `.execute(trx);
      if (!leaveType.rows.length) throw new AppError('نوع الإجازة غير متاح', 'INVALID_LEAVE_TYPE', 400);
      const overlap = await sql<{ id: number }>`
        SELECT id FROM hr_leave_requests
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND status IN ('pending', 'approved')
          AND start_date <= ${end}::date AND end_date >= ${start}::date
        LIMIT 1
      `.execute(trx);
      if (overlap.rows.length) {
        throw new AppError('يوجد طلب إجازة آخر يتداخل مع الفترة المحددة', 'LEAVE_PERIOD_OVERLAP', 409);
      }
      const saved = await trx.insertInto('hr_leave_requests').values({
        employee_id: employeeId,
        tenant_id: tenantId,
        account_id: accountId,
        leave_type_id: leaveTypeId,
        start_date: start,
        end_date: end,
        days_count: daysCount,
        status: 'pending',
        reason: body.reason || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).returningAll().executeTakeFirstOrThrow();
      return saved;
    });
    return {
      success: true,
      message: 'تم إرسال طلب الإجازة للمراجعة',
      request: inserted,
    };
  }

  /**
   * Get employee loans, advances and custody assets
   */
  async getLoansAndCustody(employeeId: number, tenantId: string) {
    const loans = await this.anyDb
      .selectFrom('hr_employee_loans')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    const assets = await this.anyDb
      .selectFrom('hr_employee_assets')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .orderBy('assigned_at', 'desc')
      .execute();

    return {
      loans: loans.map((l: any) => ({
        id: l.id,
        loanNo: l.loan_no || `ADV-${l.id}`,
        loanType: l.loan_type === 'loan' ? 'قرض' : 'سلفة نقدية',
        principalAmount: Number(l.principal_amount || 0),
        paidAmount: Number(l.paid_amount || 0),
        remainingAmount: Number(l.remaining_amount || 0),
        installmentCount: Number(l.installment_count || 1),
        installmentAmount: Number(l.installment_amount || 0),
        status: l.status,
        issueDate: String(l.issue_date || '').slice(0, 10),
        notes: l.notes || '',
      })),
      assets: assets.map((a: any) => ({
        id: a.id,
        assetType: a.asset_type,
        assetName: a.asset_name,
        assetCode: a.asset_code || '-',
        serialNo: a.serial_no || '-',
        assignedAt: String(a.assigned_at || '').slice(0, 10),
        status: a.status === 'assigned' ? 'بعهدة الموظف' : a.status === 'returned' ? 'تم الاسترجاع' : a.status,
        notes: a.notes || '',
      })),
    };
  }

  /**
   * Submit an advance request
   */
  async requestAdvance(
    employeeId: number,
    tenantId: string,
    accountId: string,
    body: { amount: number; reason: string; repaymentMonths?: number },
  ) {
    let amount: number;
    let schedule: ReturnType<typeof calculateLoanInstallmentSchedule>;
    try {
      const currencySetting = await sql<{ value: string }>`
        SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
      `.execute(this.db);
      const currency = String(currencySetting.rows[0]?.value || '').replace(/^"|"$/g, '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('حدد عملة منشأتك قبل طلب السلفة', 'HR_TENANT_CURRENCY_REQUIRED', 400);
      const bookDigits = currencyMoneyDigits(currency);
      amount = requireLoanMoney(Number(body.amount), bookDigits);
      const count = body.repaymentMonths == null ? 1 : Number(body.repaymentMonths);
      schedule = calculateLoanInstallmentSchedule(amount, count, bookDigits);
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : 'مبلغ السلفة أو عدد الأقساط غير صحيح',
        'HR_PORTAL_ADVANCE_INVALID', 400);
    }
    const today = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const due = addLoanInstallmentMonths(today, 1);
    const loan = await this.db.transaction().execute(async trx => {
      // A portal draft must generate an installment plan just like an HR-created
      // loan. Without these rows its salary deductions can never be allocated.
      const emp = await sql<{ id: number; status: string }>`
        SELECT id, status FROM hr_employees
        WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE
      `.execute(trx);
      if (!emp.rows.length || emp.rows[0].status !== 'active') {
        throw new AppError('لا يمكن طلب سلفة لموظف غير نشط', 'HR_PORTAL_ADVANCE_EMPLOYEE_INACTIVE', 403);
      }
      const inserted = await sql<{ id: number }>`
        INSERT INTO hr_employee_loans
          (tenant_id, account_id, employee_id, loan_no, loan_type,
           principal_amount, paid_amount, remaining_amount, installment_count,
           installment_amount, repayment_mode, monthly_installment_amount,
           status, issue_date, first_due_date, salary_due_date, notes)
        VALUES
          (${tenantId}, ${accountId}, ${employeeId},
           ${`ADV-REQ-TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`}, 'advance',
           ${amount}, 0, ${amount}, ${schedule.installmentCount},
           ${schedule.installmentAmount}, 'monthly_salary_installment', ${schedule.installmentAmount},
           'draft', ${today}::date, ${due}::date, ${due}::date,
           ${'طلب سلفة من الموظف: ' + String(body.reason || 'بدون تفاصيل').slice(0, 600)})
        RETURNING id
      `.execute(trx);
      const loanId = Number(inserted.rows[0]?.id || 0);
      if (!Number.isSafeInteger(loanId) || loanId <= 0) throw new Error('Failed to create portal advance');
      const no = formatDailyDocumentNumber('LOAN', loanId);
      await sql`
        UPDATE hr_employee_loans SET loan_no = ${no}
        WHERE id = ${loanId} AND tenant_id = ${tenantId}
      `.execute(trx);
      for (let i = 0; i < schedule.installmentValues.length; i += 1) {
        const dueDate = addLoanInstallmentMonths(due, i);
        await sql`
          INSERT INTO hr_employee_loan_installments
            (tenant_id, account_id, loan_id, installment_no, due_date, amount)
          VALUES (${tenantId}, ${accountId}, ${loanId}, ${i + 1},
                  ${dueDate}::date, ${schedule.installmentValues[i]})
        `.execute(trx);
      }
      return { id: loanId, loan_no: no, principal_amount: amount,
        installment_count: schedule.installmentCount, installment_amount: schedule.installmentAmount,
        repayment_mode: 'monthly_salary_installment', status: 'draft' };
    });
    return {
      success: true,
      message: 'تم تسجيل طلب السلفة وجدول أقساطه وهو قيد مراجعة الحسابات والإدارة',
      advance: loan,
    };
  }
}
