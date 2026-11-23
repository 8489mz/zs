import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { MAX_IMPORT_ROWS_PER_REQUEST, cleanString, normalizeArabicDigits, digitsOnly, parseDateOnly, toNumericOrNull, normalizePhoneText } from './settings-import-shared';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { DbExecutor, TenantScope } from './settings-import-shared';

export class SettingsImportEmployees {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => TenantScope;
      buildRowLookup: (row: Record<string, unknown>) => Record<string, string>;
      pickCell: (lookup: Record<string, string>, aliases: string[]) => string;
      normalizeCompensationType: (value: unknown) => 'monthly' | 'hourly';
      normalizeTimeOnly: (value: unknown) => string | null;
      normalizeEmployeeStatus: (value: unknown) => 'active' | 'inactive' | 'deactivated' | 'terminated';
      normalizeOvertimePolicy: (value: unknown) => 'review_only' | 'disabled' | 'auto_approved';
      ensureHrMasterName: (db: DbExecutor, table: 'hr_departments' | 'hr_job_titles' | 'hr_positions', name: string, actor: AuthContext) => Promise<number | null>;
      findEmployeeByContact: (db: DbExecutor, contactType: 'phone' | 'email', value: string, actor: AuthContext) => Promise<number[]>;
      upsertEmployeeContact: (db: DbExecutor, employeeId: number, contactType: 'phone' | 'email', value: string, actor: AuthContext) => Promise<void>;
      nextAvailableEmployeeNo: (db: DbExecutor, actor: AuthContext) => Promise<string>;
    },
  ) {}

  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private buildRowLookup(row: Record<string, unknown>): Record<string, string> {
    return this.bound.buildRowLookup(row);
  }
  private pickCell(lookup: Record<string, string>, aliases: string[]): string {
    return this.bound.pickCell(lookup, aliases);
  }
  private normalizeCompensationType(value: unknown): 'monthly' | 'hourly' {
    return this.bound.normalizeCompensationType(value);
  }
  private normalizeTimeOnly(value: unknown): string | null {
    return this.bound.normalizeTimeOnly(value);
  }
  private normalizeEmployeeStatus(value: unknown): 'active' | 'inactive' | 'deactivated' | 'terminated' {
    return this.bound.normalizeEmployeeStatus(value);
  }
  private normalizeOvertimePolicy(value: unknown): 'review_only' | 'disabled' | 'auto_approved' {
    return this.bound.normalizeOvertimePolicy(value);
  }
  private async ensureHrMasterName(db: DbExecutor, table: 'hr_departments' | 'hr_job_titles' | 'hr_positions', name: string, actor: AuthContext): Promise<number | null> {
    return this.bound.ensureHrMasterName(db, table, name, actor);
  }
  private async findEmployeeByContact(db: DbExecutor, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<number[]> {
    return this.bound.findEmployeeByContact(db, contactType, value, actor);
  }
  private async upsertEmployeeContact(db: DbExecutor, employeeId: number, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<void> {
    return this.bound.upsertEmployeeContact(db, employeeId, contactType, value, actor);
  }
  private async nextAvailableEmployeeNo(db: DbExecutor, actor: AuthContext): Promise<string> {
    return this.bound.nextAvailableEmployeeNo(db, actor);
  }

  async importEmployees(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);

    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      const warnings: string[] = [];

      for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2;
        const raw = rows[index];
        const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const lookup = this.buildRowLookup(row);

        const fullName = this.pickCell(lookup, ['اسم الموظف', 'اسم العامل', 'الموظف', 'الاسم', 'employee name', 'employee_name', 'employeename', 'full name', 'fullname', 'full_name', 'name', 'displayname', 'display_name']);
        const explicitFirstName = this.pickCell(lookup, ['الاسم الأول', 'first name', 'firstname', 'first_name']);
        const explicitLastName = this.pickCell(lookup, ['الاسم الأخير', 'last name', 'lastname', 'last_name']);
        const nameParts = cleanString(fullName).split(/\s+/).filter(Boolean);
        const firstName = cleanString(explicitFirstName || nameParts[0] || '');
        const lastName = cleanString(explicitLastName || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''));
        const displayName = cleanString(`${firstName} ${lastName}`);

        if (!firstName) { warnings.push(`الصف ${rowNumber}: اسم الموظف مطلوب.`); continue; }

        const employeeNoRaw = normalizeArabicDigits(this.pickCell(lookup, ['كود الموظف', 'رقم الموظف', 'employee no', 'employee_no', 'employee code', 'code']));
        const employeeNoDigits = digitsOnly(employeeNoRaw);
        if (employeeNoRaw && !employeeNoDigits) { warnings.push(`الصف ${rowNumber}: كود الموظف يجب أن يحتوي أرقامًا فقط.`); continue; }
        const employeeNo = employeeNoDigits ? employeeNoDigits.padStart(3, '0') : '';

        const nationalIdText = digitsOnly(this.pickCell(lookup, ['الرقم القومي', 'رقم قومي', 'رقم الهوية', 'national id', 'national_id', 'nationalid', 'id number']));
        if (nationalIdText && nationalIdText.length !== 14) { warnings.push(`الصف ${rowNumber}: الرقم القومي يجب أن يكون 14 رقمًا.`); continue; }

        const hireDateRaw = this.pickCell(lookup, ['تاريخ التعيين', 'hire date', 'hiredate', 'hire_date']);
        const hireDate = hireDateRaw ? parseDateOnly(hireDateRaw) : null;
        if (hireDateRaw && !hireDate) { warnings.push(`الصف ${rowNumber}: تاريخ التعيين غير صحيح.`); continue; }

        const compensationType = this.normalizeCompensationType(this.pickCell(lookup, ['نوع الأجر', 'compensation type', 'compensation_type']));
        const hourlyRateText = this.pickCell(lookup, ['أجر الساعة', 'hourly rate', 'hourly_rate']);
        const expectedDailyHoursText = this.pickCell(lookup, ['ساعات العمل اليومية', 'ساعات العمل اليومية المتوقعة', 'expected daily hours', 'expected_daily_hours']);
        const graceMinutesText = this.pickCell(lookup, ['فترة السماح', 'فترة السماح بالدقائق', 'grace minutes', 'grace_minutes']);
        const hourlyRate = toNumericOrNull(hourlyRateText);
        const expectedDailyHours = toNumericOrNull(expectedDailyHoursText);
        const graceMinutes = toNumericOrNull(graceMinutesText);
        if (hourlyRateText && hourlyRate == null) { warnings.push(`الصف ${rowNumber}: أجر الساعة غير صالح.`); continue; }
        if (expectedDailyHoursText && expectedDailyHours == null) { warnings.push(`الصف ${rowNumber}: ساعات العمل اليومية غير صالحة.`); continue; }
        if (graceMinutesText && graceMinutes == null) { warnings.push(`الصف ${rowNumber}: فترة السماح غير صالحة.`); continue; }

        const scheduledCheckInRaw = this.pickCell(lookup, ['موعد الحضور', 'scheduled check in', 'scheduled_check_in_time', 'check in']);
        const scheduledCheckOutRaw = this.pickCell(lookup, ['موعد الانصراف', 'scheduled check out', 'scheduled_check_out_time', 'check out']);
        const scheduledCheckInTime = this.normalizeTimeOnly(scheduledCheckInRaw);
        const scheduledCheckOutTime = this.normalizeTimeOnly(scheduledCheckOutRaw);
        if (scheduledCheckInRaw && !scheduledCheckInTime) { warnings.push(`الصف ${rowNumber}: موعد الحضور غير صحيح.`); continue; }
        if (scheduledCheckOutRaw && !scheduledCheckOutTime) { warnings.push(`الصف ${rowNumber}: موعد الانصراف غير صحيح.`); continue; }

        const status = this.normalizeEmployeeStatus(this.pickCell(lookup, ['الحالة', 'status']));
        const overtimePolicy = this.normalizeOvertimePolicy(this.pickCell(lookup, ['سياسة الإضافي', 'overtime policy', 'overtime_policy']));
        const phone = normalizePhoneText(this.pickCell(lookup, ['رقم الهاتف', 'الموبايل', 'mobile', 'phoneNumber', 'phone number', 'phonenumber', 'phone']));
        const email = cleanString(this.pickCell(lookup, ['البريد الإلكتروني', 'email'])).toLowerCase();
        const notes = cleanString(this.pickCell(lookup, ['ملاحظات', 'notes']));

        const departmentId = await this.ensureHrMasterName(trx, 'hr_departments', this.pickCell(lookup, ['القسم', 'الإدارة', 'department']), actor);
        const jobTitleId = await this.ensureHrMasterName(trx, 'hr_job_titles', this.pickCell(lookup, ['الوظيفة', 'المسمى الوظيفي', 'job title', 'job_title', 'jobtitle']), actor);
        const positionId = await this.ensureHrMasterName(trx, 'hr_positions', this.pickCell(lookup, ['المنصب', 'position']), actor);

        const matchedIds = new Set<number>();
        if (employeeNo) {
          const byCode = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND employee_no = ${employeeNo} LIMIT 2`.execute(trx);
          for (const rowMatch of byCode.rows) matchedIds.add(Number(rowMatch.id));
        } else {
          if (nationalIdText) {
            const byNational = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND national_id = ${nationalIdText} LIMIT 2`.execute(trx);
            for (const rowMatch of byNational.rows) matchedIds.add(Number(rowMatch.id));
          }
          if (phone) for (const id of await this.findEmployeeByContact(trx, 'phone', phone, actor)) matchedIds.add(id);
          if (email) for (const id of await this.findEmployeeByContact(trx, 'email', email, actor)) matchedIds.add(id);
          if (!matchedIds.size && displayName) {
            const byName = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND LOWER(display_name) = LOWER(${displayName}) LIMIT 2`.execute(trx);
            for (const rowMatch of byName.rows) matchedIds.add(Number(rowMatch.id));
          }
        }

        if (matchedIds.size > 1) { warnings.push(`الصف ${rowNumber}: تعذر تحديد موظف واحد بسبب تكرار محتمل. استخدم كود موظف واضح.`); continue; }

        const existingId = matchedIds.size === 1 ? Array.from(matchedIds)[0] : null;
        if (existingId) {
          await sql`
            UPDATE hr_employees
            SET employee_no = COALESCE(NULLIF(${employeeNo}, ''), employee_no),
                first_name = ${firstName}, last_name = ${lastName}, display_name = ${displayName}, national_id = ${nationalIdText || null}, status = ${status},
                department_id = ${departmentId}, job_title_id = ${jobTitleId}, position_id = ${positionId}, hire_date = ${hireDate}, compensation_type = ${compensationType},
                hourly_rate = ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null}, expected_daily_hours = ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null},
                scheduled_check_in_time = ${scheduledCheckInTime || null}, scheduled_check_out_time = ${scheduledCheckOutTime || null}, grace_minutes = ${Math.max(0, Math.floor(Number(graceMinutes || 0)))},
                overtime_policy = ${overtimePolicy}, notes = ${notes}, updated_by = ${actor.userId}, updated_at = NOW()
            WHERE tenant_id = ${scope.tenantId} AND id = ${existingId}
          `.execute(trx);
          if (phone) await this.upsertEmployeeContact(trx, existingId, 'phone', phone, actor);
          if (email) await this.upsertEmployeeContact(trx, existingId, 'email', email, actor);
          updated += 1;
          continue;
        }

        const generatedEmployeeNo = employeeNo || await this.nextAvailableEmployeeNo(trx, actor);
        const insertedEmployee = await sql<{ id: number }>`
          INSERT INTO hr_employees (employee_no, national_id, first_name, last_name, display_name, status, department_id, job_title_id, position_id, hire_date, notes, compensation_type, hourly_rate, expected_daily_hours, scheduled_check_in_time, scheduled_check_out_time, grace_minutes, overtime_policy, created_by, updated_by, tenant_id, account_id)
          VALUES (${generatedEmployeeNo}, ${nationalIdText || null}, ${firstName}, ${lastName}, ${displayName}, ${status}, ${departmentId}, ${jobTitleId}, ${positionId}, ${hireDate}, ${notes}, ${compensationType}, ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null}, ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null}, ${scheduledCheckInTime || null}, ${scheduledCheckOutTime || null}, ${Math.max(0, Math.floor(Number(graceMinutes || 0)))}, ${overtimePolicy}, ${actor.userId}, ${actor.userId}, ${scope.tenantId}, ${scope.accountId})
          RETURNING id
        `.execute(trx);
        const employeeId = Number(insertedEmployee.rows[0]?.id || 0);
        if (employeeId <= 0) { warnings.push(`الصف ${rowNumber}: تعذر حفظ الموظف.`); continue; }
        if (phone) await this.upsertEmployeeContact(trx, employeeId, 'phone', phone, actor);
        if (email) await this.upsertEmployeeContact(trx, employeeId, 'email', email, actor);
        inserted += 1;
      }

      return { inserted, updated, warnings };
    });

    await this.audit.log('استيراد موظفين', `تم استيراد/تحديث ${result.inserted + result.updated} موظف على يد ${actor.username}`, actor);
    return { ok: true, inserted: result.inserted, updated: result.updated, warnings: result.warnings };
  }
}
