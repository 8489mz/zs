/*
 * Rep employee link (van-sales split-10 out of VanSalesService).
 * Pure move: the 3 HR-link methods (linkRepToEmployee,
 * listCandidateEmployees, autoCreateEmployeeForRep), unchanged,
 * behind the VanSalesService delegating facade. The facade owns the
 * injected db handle; this service receives it via
 * VanRepEmployeeLinkDeps, so the moved bodies are byte-identical to
 * the originals. The methods use only this.anyDb (Kysely) plus sql /
 * AppError / AuthContext — no other facade helper is bound.
 */
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

export type VanRepEmployeeLinkDeps = {
  db: Kysely<Database>;
};

export class VanRepEmployeeLinkService {
  private readonly db: Kysely<Database>;

  constructor(deps: VanRepEmployeeLinkDeps) {
    this.db = deps.db;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Link delivery representative to an HR employee.
   */
  async linkRepToEmployee(
    tenantId: string,
    repId: number,
    employeeId: number | null,
  ) {
    await this.anyDb
      .updateTable('delivery_representatives')
      .set({ employee_id: employeeId, updated_at: sql`NOW()` })
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .execute();
    return { ok: true, repId, employeeId };
  }

  /**
   * List active candidate HR employees for linking to delivery representatives.
   */
  async listCandidateEmployees(tenantId: string) {
    const rows = await this.anyDb
      .selectFrom('hr_employees')
      .select([
        'id',
        'employee_no as employeeNo',
        'display_name as displayName',
        'national_id as nationalId',
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'terminated')
      .orderBy('display_name', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      employeeNo: r.employeeNo || r.employeeno || null,
      displayName: r.displayName || r.displayname || '',
      nationalId: r.nationalId || r.nationalid || null,
      status: r.status,
    }));
  }

  /**
   * Automatically create an HR employee record for a delivery representative and link them.
   */
  async autoCreateEmployeeForRep(
    tenantId: string,
    accountId: string,
    repId: number,
    authContext: AuthContext,
  ) {
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep) throw new AppError('مندوب التوزيع غير موجود', 'REP_NOT_FOUND', 404);

    if (rep.employee_id) {
      const existingEmp = await this.anyDb
        .selectFrom('hr_employees')
        .select(['id', 'display_name', 'employee_no'])
        .where('id', '=', rep.employee_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (existingEmp) {
        return {
          ok: true,
          employeeId: Number(existingEmp.id),
          displayName: existingEmp.display_name,
          employeeNo: existingEmp.employee_no,
          message: 'المندوب مربوط بالفعل بملف موظف موجود',
        };
      }
    }

    const nameParts = String(rep.name || 'مندوب توزيع').trim().split(/\s+/);
    const firstName = nameParts[0] || 'مندوب';
    const lastName = nameParts.slice(1).join(' ') || '.';
    const displayName = String(rep.name || 'مندوب توزيع').trim();
    const employeeNo = `EMP-${String(rep.id).padStart(4, '0')}`;
    const actorUserId = authContext.userId ? Number(authContext.userId) : null;

    const inserted = await this.anyDb
      .insertInto('hr_employees')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        employee_no: employeeNo,
        first_name: firstName,
        last_name: lastName,
        display_name: displayName,
        national_id: rep.national_id || null,
        status: 'active',
        compensation_type: 'salary',
        pay_frequency: 'monthly',
        overtime_policy: 'default',
        attendance_policy: 'default',
        has_social_insurance: false,
        has_income_tax: false,
        grace_minutes: 15,
        notes: `تم إنشاؤه تلقائياً من منظومة مناديب وسيارات الفان (معرف مندوب #${rep.id})`,
        created_by: actorUserId,
        updated_by: actorUserId,
        mobile_punch_enabled: false,
        used_annual_leaves: 0,
        created_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .returning(['id', 'employee_no as employeeNo', 'display_name as displayName'])
      .executeTakeFirst();

    if (!inserted) throw new AppError('فشل إنشاء ملف موظف HR', 'CREATE_EMPLOYEE_FAILED', 500);

    await this.anyDb
      .updateTable('delivery_representatives')
      .set({ employee_id: Number(inserted.id), updated_at: sql`NOW()` })
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      employeeId: Number(inserted.id),
      displayName: inserted.displayName,
      employeeNo: inserted.employeeNo,
    };
  }
}
