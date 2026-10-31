import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AppError } from '../../common/errors/app-error';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { assertPortalTenantAllowed } from '../../core/auth/utils/portal-tenant-status';
import { LoginAttemptLimiter } from '../../common/utils/login-attempt-limiter';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';
import { getTenantTimezone, todayTenantDate, formatTimeInTimezone } from '../../common/utils/tenant-timezone.util';
import {
  PORTAL_TOKEN_TTL_MS,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../core/auth/utils/portal-token';

const MOBILE_TOKEN_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'يرجى تسجيل الدخول أولاً', code: 'UNAUTHORIZED' },
  invalid: { message: 'رمز الجلسة غير صالح', code: 'INVALID_TOKEN' },
  signature: { message: 'رمز الجلسة مزور أو غير صالح', code: 'INVALID_SIGNATURE' },
  expired: { message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول ثانية', code: 'TOKEN_EXPIRED' },
};

export interface MobileAttendanceUser {
  employeeId: number;
  employeeNo: string;
  name: string;
  phone: string;
  branchId: number | null;
  branchName: string;
  tenantId: string;
  accountId: string;
  branchLat: number | null;
  branchLng: number | null;
  geofenceRadiusMeters: number;
}

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

@Injectable()
export class MobileAttendanceService {
  private readonly loginLimiter = new LoginAttemptLimiter();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Fast employee mobile login using phone and 4-digit PIN
   */
  async employeeLogin(payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{
    token: string;
    employee: MobileAttendanceUser;
    todayStatus: {
      hasCheckedIn: boolean;
      hasCheckedOut: boolean;
      checkInTime?: string;
      checkOutTime?: string;
      distanceMeters?: number;
    };
  }> {
    const rawPhone = String(payload?.phone || '').trim();
    const pinCode = String(payload?.pinCode || '').trim();
    const companyScope = payload?.companyCode || payload?.tenantId;

    if (!rawPhone || !pinCode) {
      throw new AppError('رقم الهاتف ورمز الدخول السريع (PIN) مطلوبان', 'INVALID_CREDENTIALS', 400);
    }

    const rateLimitKey = `mobile-punch:${rawPhone.toLowerCase()}:${(companyScope || '').toLowerCase()}`;
    this.loginLimiter.assertNotLocked(rateLimitKey);

    try {
      return await this.employeeLoginInternal(rawPhone, pinCode, companyScope, rateLimitKey);
    } catch (error) {
      if (error instanceof AppError && error.code === 'UNAUTHORIZED_EMPLOYEE') {
        this.loginLimiter.recordFailure(rateLimitKey);
      }
      throw error;
    }
  }

  private async employeeLoginInternal(
    rawPhone: string,
    pinCode: string,
    companyScope: string | undefined,
    rateLimitKey: string,
  ) {
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const cleanNoCountry = cleanDigits.startsWith('20')
      ? cleanDigits.slice(2)
      : cleanDigits.startsWith('0')
      ? cleanDigits.slice(1)
      : cleanDigits;
    if (cleanNoCountry.length < 8) {
      throw new AppError('بيانات الدخول غير صحيحة', 'UNAUTHORIZED_EMPLOYEE', 401);
    }

    // Search active employees with matching contact phone
    let employeesQuery = this.anyDb
      .selectFrom('hr_employees as e')
      .leftJoin('branches as b', (join: any) => join.onRef('b.id', '=', 'e.branch_id').onRef('b.tenant_id', '=', 'e.tenant_id'))
      .select([
        'e.id as employee_id',
        'e.employee_no',
        'e.display_name',
        'e.first_name',
        'e.last_name',
        'e.pin_hash',
        'e.pin_salt',
        'e.mobile_punch_enabled',
        'e.tenant_id',
        'e.account_id',
        'e.branch_id',
        'b.name as branch_name',
        'b.latitude as branch_lat',
        'b.longitude as branch_lng',
        'b.geofence_radius_meters',
      ])
      .where('e.status', '=', 'active');

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

    if (resolvedTenantId) {
      employeesQuery = employeesQuery.where('e.tenant_id', '=', resolvedTenantId);
    }

    // Login discovery reads only contacts matching the submitted phone. A company
    // hint adds the tenant boundary before any employee or contact row is loaded.
    let contactsQuery = this.anyDb
      .selectFrom('hr_employee_contacts')
      .select(['employee_id', 'value'])
      .where('contact_type', '=', 'phone')
      .where(sql<boolean>`RIGHT(REGEXP_REPLACE(value, '[^0-9]', '', 'g'), ${cleanNoCountry.length}) = ${cleanNoCountry}`);
    if (resolvedTenantId) contactsQuery = contactsQuery.where('tenant_id', '=', resolvedTenantId);
    const contacts = await contactsQuery.execute();
    const candidateEmployeeIds = [...new Set(contacts.map((contact: any) => Number(contact.employee_id)).filter((id: number) => id > 0))];
    if (!candidateEmployeeIds.length) throw new AppError('بيانات الدخول غير صحيحة أو رمز الـ PIN غير مطابق', 'UNAUTHORIZED_EMPLOYEE', 401);
    employeesQuery = employeesQuery.where('e.id', 'in', candidateEmployeeIds);
    const employees = await employeesQuery.execute();

    const empPhonesMap = new Map<number, string[]>();
    for (const c of contacts) {
      const eid = Number(c.employee_id);
      const list = empPhonesMap.get(eid) || [];
      list.push(String(c.value));
      empPhonesMap.set(eid, list);
    }

    // الهاتف يُرشَّح أولاً (مقارنة نصية رخيصة) ثم يُتحقق من الـPIN بالتجزئة على
    // المرشحين الباقين فقط — bcrypt مكلف، وتشغيله على كل موظفي كل المستأجرين
    // يحوّل شاشة الدخول إلى عبء ثقيل.
    const phoneMatches = employees.filter((emp: any) => {
      const phones = empPhonesMap.get(Number(emp.employee_id)) || [];
      return phones.some((p) => {
        const pDigits = p.replace(/\D/g, '');
        const pNoCountry = pDigits.startsWith('20')
          ? pDigits.slice(2)
          : pDigits.startsWith('0')
          ? pDigits.slice(1)
          : pDigits;
        return pDigits === cleanDigits || pNoCountry === cleanNoCountry;
      });
    });

    const pinChecks = await Promise.all(
      phoneMatches.map(async (emp: any) => {
        if (!emp.pin_hash) return false;
        const res = await verifyPassword(pinCode, String(emp.pin_hash), String(emp.pin_salt || ''));
        return res.valid;
      }),
    );
    const matchedList = phoneMatches.filter((_: any, idx: number) => pinChecks[idx]);

    if (!matchedList || matchedList.length === 0) {
      throw new AppError('بيانات الدخول غير صحيحة أو رمز الـ PIN غير مطابق', 'UNAUTHORIZED_EMPLOYEE', 401);
    }

    if (matchedList.length > 1) {
      throw new AppError(
        'رقم الهاتف مسجل لدى أكثر من منشأة. يرجى استخدام رابط محلك المحدد لتسجيل البصمة لمنع تداخل الحسابات.',
        'AMBIGUOUS_EMPLOYEE_TENANT',
        409,
      );
    }

    const matched = matchedList[0];

    if (matched.mobile_punch_enabled === false) {
      throw new AppError('تسجيل البصمة عبر الموبايل غير مفعل لهذا الموظف', 'MOBILE_PUNCH_DISABLED', 403);
    }

    const employeeUser: MobileAttendanceUser = {
      employeeId: Number(matched.employee_id),
      employeeNo: matched.employee_no || `EMP-${matched.employee_id}`,
      name: matched.display_name || `${matched.first_name} ${matched.last_name}`.trim(),
      phone: rawPhone,
      branchId: matched.branch_id ? Number(matched.branch_id) : null,
      branchName: matched.branch_name || 'الفرع الرئيسي',
      tenantId: matched.tenant_id,
      accountId: matched.account_id,
      branchLat: matched.branch_lat ? Number(matched.branch_lat) : null,
      branchLng: matched.branch_lng ? Number(matched.branch_lng) : null,
      geofenceRadiusMeters: Number(matched.geofence_radius_meters || 100),
    };

    // Check today's punch status
    const today = new Date().toISOString().slice(0, 10);
    const record = await this.anyDb
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', employeeUser.employeeId)
      .where('work_date', '=', today)
      .where('tenant_id', '=', employeeUser.tenantId)
      .executeTakeFirst();

    const todayStatus = {
      hasCheckedIn: Boolean(record?.check_in_at),
      hasCheckedOut: Boolean(record?.check_out_at),
      checkInTime: record?.check_in_at ? new Date(record.check_in_at).toLocaleTimeString('ar-EG') : undefined,
      checkOutTime: record?.check_out_at ? new Date(record.check_out_at).toLocaleTimeString('ar-EG') : undefined,
      distanceMeters: record?.distance_meters ? Number(record.distance_meters) : undefined,
    };

    // INV-PORTAL-TENANT-STATUS-ENFORCED: no fresh login for a
    // suspended / expired / trial-expired tenant, even with a valid PIN.
    await assertPortalTenantAllowed(this.db as any, this.authCache, String(employeeUser.tenantId));

    const token = this.generateToken(employeeUser);
    this.loginLimiter.recordSuccess(rateLimitKey);

    return {
      token,
      employee: employeeUser,
      todayStatus,
    };
  }

  /**
   * Generates a tamper-proof HMAC auth token for the mobile session
   */
  private generateToken(user: MobileAttendanceUser): string {
    return signPortalToken(
      {
        employeeId: user.employeeId,
        employeeNo: user.employeeNo,
        name: user.name,
        phone: user.phone,
        tenantId: user.tenantId,
        accountId: user.accountId,
        branchId: user.branchId,
        branchName: user.branchName,
        branchLat: user.branchLat,
        branchLng: user.branchLng,
        geofenceRadiusMeters: user.geofenceRadiusMeters,
      },
      PORTAL_TOKEN_TTL_MS,
    );
  }

  /**
   * Validates mobile employee token from Authorization header.
   *
   * الرمز بلا حالة وعمره 30 يوماً، فلا يكفي التحقق من التوقيع: يُعاد التأكد على كل
   * طلب أن الموظف ما زال نشطاً داخل نفس المستأجر، وأن الفرع المذكور في الرمز يخص
   * هذا المستأجر فعلاً (وإلا صار الـgeofence قابلاً للاختيار من داخل الرمز).
   */
  async verifyToken(authHeader?: string): Promise<MobileAttendanceUser> {
    const payload = verifyPortalToken<Record<string, any>>(authHeader, MOBILE_TOKEN_ERRORS);

    const employeeId = Number(payload.employeeId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    const accountId = String(payload.accountId || '').trim();

    if (!employeeId || !tenantId || !accountId) {
      throw new AppError('رمز الجلسة غير صالح', 'INVALID_TOKEN', 401);
    }

    const employee = await this.anyDb
      .selectFrom('hr_employees')
      .select(['id', 'status', 'tenant_id', 'account_id', 'branch_id'])
      .where('id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!employee || employee.status !== 'active') {
      throw new AppError('تم إيقاف حساب الموظف. يرجى مراجعة إدارة الموارد البشرية', 'EMPLOYEE_INACTIVE', 401);
    }

    // INV-PORTAL-TENANT-STATUS-ENFORCED: the token is stateless, so
    // every request re-checks the tenant status, not just the row.
    await assertPortalTenantAllowed(this.db as any, this.authCache, tenantId);

    return {
      employeeId,
      employeeNo: String(payload.employeeNo || ''),
      name: String(payload.name || ''),
      phone: String(payload.phone || ''),
      // الفرع يُؤخذ من صف الموظف في القاعدة، لا من الرمز
      branchId: employee.branch_id != null ? Number(employee.branch_id) : null,
      branchName: String(payload.branchName || ''),
      tenantId: String(employee.tenant_id),
      accountId: String(employee.account_id || accountId),
      branchLat: payload.branchLat != null ? Number(payload.branchLat) : null,
      branchLng: payload.branchLng != null ? Number(payload.branchLng) : null,
      geofenceRadiusMeters: Number(payload.geofenceRadiusMeters || 100),
    };
  }

  /**
   * Returns current employee's attendance status for today
   */
  async getTodayStatus(user: MobileAttendanceUser) {
    const tenantTimezone = await getTenantTimezone(this.db, user.tenantId);
    const today = todayTenantDate(tenantTimezone);
    const record = await this.anyDb
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', user.employeeId)
      .where('work_date', '=', today)
      .where('tenant_id', '=', user.tenantId)
      .executeTakeFirst();

    // Get live branch coordinates in case manager updated them
    let branchLat = user.branchLat;
    let branchLng = user.branchLng;
    let geofenceRadius = user.geofenceRadiusMeters;

    if (user.branchId) {
      const br = await this.anyDb
        .selectFrom('branches')
        .select(['latitude', 'longitude', 'geofence_radius_meters'])
        .where('id', '=', user.branchId)
        .where('tenant_id', '=', user.tenantId)
        .executeTakeFirst();
      if (br) {
        branchLat = br.latitude ? Number(br.latitude) : branchLat;
        branchLng = br.longitude ? Number(br.longitude) : branchLng;
        geofenceRadius = br.geofence_radius_meters ? Number(br.geofence_radius_meters) : geofenceRadius;
      }
    }

    return {
      workDate: today,
      hasCheckedIn: Boolean(record?.check_in_at),
      hasCheckedOut: Boolean(record?.check_out_at),
      checkInTime: record?.check_in_at ? formatTimeInTimezone(record.check_in_at, tenantTimezone) : null,
      checkOutTime: record?.check_out_at ? formatTimeInTimezone(record.check_out_at, tenantTimezone) : null,
      checkInSelfie: record?.check_in_selfie_url || null,
      checkOutSelfie: record?.check_out_selfie_url || null,
      distanceMeters: record?.distance_meters ? Number(record.distance_meters) : null,
      branch: {
        id: user.branchId,
        name: user.branchName,
        lat: branchLat,
        lng: branchLng,
        geofenceRadius,
      },
    };
  }

  /**
   * Records Check-In or Check-Out with GPS geofence validation and Selfie capture
   */
  async recordPunch(
    user: MobileAttendanceUser,
    payload: {
      type: 'check_in' | 'check_out';
      latitude: number;
      longitude: number;
      selfieDataUrl?: string;
      notes?: string;
    },
  ) {
    const punchType = payload.type;
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new AppError('إحداثيات الـ GPS غير صالحة، يرجى تفعيل الموقع الجغرافي بالهاتف', 'GPS_REQUIRED', 400);
    }

    // Refresh branch coordinates
    let targetLat = user.branchLat;
    let targetLng = user.branchLng;
    let radius = user.geofenceRadiusMeters || 100;

    if (user.branchId) {
      const br = await this.anyDb
        .selectFrom('branches')
        .select(['latitude', 'longitude', 'geofence_radius_meters'])
        .where('id', '=', user.branchId)
        .where('tenant_id', '=', user.tenantId)
        .executeTakeFirst();
      if (br && br.latitude != null && br.longitude != null) {
        targetLat = Number(br.latitude);
        targetLng = Number(br.longitude);
        radius = Number(br.geofence_radius_meters || 100);
      }
    }

    let distanceMeters = 0;
    if (targetLat != null && targetLng != null && targetLat !== 0 && targetLng !== 0) {
      distanceMeters = calculateDistanceMeters(lat, lng, targetLat, targetLng);
      if (distanceMeters > radius) {
        throw new AppError(
          `أنت خارج نطاق الفرع! المسافة الحالية (${distanceMeters} متر)، والحد الأقصى المسموح للبصمة هو (${radius} متر).`,
          'OUTSIDE_GEOFENCE',
          403,
        );
      }
    }

    const tenantTimezone = await getTenantTimezone(this.db, user.tenantId);
    const today = todayTenantDate(tenantTimezone);
    const now = new Date();

    return this.db.transaction().execute(async trx => {
      // Locking the employee row ensures double mobile punches cannot both
      // observe an empty attendance row before either inserts or checks out.
      // Do not tenant-serialize all mobile punches at peak check-in time.
      const employees = await sql<{ id: number; status: string }>`
        SELECT id, status FROM hr_employees
        WHERE id = ${user.employeeId} AND tenant_id = ${user.tenantId}
        FOR UPDATE
      `.execute(trx);
      if (!employees.rows.length || employees.rows[0].status !== 'active') {
        throw new AppError('ملف الموظف غير نشط أو غير تابع للمنشأة', 'HR_MOBILE_EMPLOYEE_INACTIVE', 403);
      }
      const closedPayroll = await sql<{ id: number }>`
        SELECT r.id FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${user.tenantId} AND i.employee_id = ${user.employeeId}
          AND i.status = 'approved' AND r.status IN ('approved', 'paid')
          AND ${today}::date BETWEEN r.start_date AND r.end_date
        LIMIT 1
      `.execute(trx);
      if (closedPayroll.rows.length) {
        throw new AppError('لا يمكن تعديل بصمة يوم أُغلقت رواتبه؛ اطلب تسوية إدارية',
          'HR_MOBILE_ATTENDANCE_APPROVED_PAYROLL', 409);
      }
      const db: any = trx;
    const existing = await db
      .selectFrom('hr_attendance_records')
      .selectAll()
      .where('employee_id', '=', user.employeeId)
      .where('work_date', '=', today)
      .where('tenant_id', '=', user.tenantId)
      .executeTakeFirst();

    if (punchType === 'check_in') {
      if (existing?.check_in_at) {
        throw new AppError(
          `تم تسجيل الحضور اليوم بالفعل في تمام الساعة: ${formatTimeInTimezone(existing.check_in_at, tenantTimezone)}`,
          'ALREADY_CHECKED_IN',
          400,
        );
      }

      if (existing) {
        await db
          .updateTable('hr_attendance_records')
          .set({
            status: 'present',
            check_in_at: now,
            check_in_gps_lat: lat,
            check_in_gps_lng: lng,
            check_in_selfie_url: payload.selfieDataUrl || null,
            branch_id: user.branchId,
            distance_meters: distanceMeters,
            source: 'mobile_gps',
            is_geofence_verified: true,
            notes: payload.notes || 'بصمة حضور ذكية عبر الموبايل',
            updated_at: now,
          })
          .where('id', '=', existing.id)
          .where('tenant_id', '=', user.tenantId)
          .execute();
      } else {
        await db
          .insertInto('hr_attendance_records')
          .values({
            employee_id: user.employeeId,
            work_date: today,
            status: 'present',
            check_in_at: now,
            check_in_gps_lat: lat,
            check_in_gps_lng: lng,
            check_in_selfie_url: payload.selfieDataUrl || null,
            branch_id: user.branchId,
            distance_meters: distanceMeters,
            source: 'mobile_gps',
            is_geofence_verified: true,
            notes: payload.notes || 'بصمة حضور ذكية عبر الموبايل',
            tenant_id: user.tenantId,
            account_id: user.accountId,
            created_at: now,
            updated_at: now,
          })
          .execute();
      }

      return {
        ok: true,
        type: 'check_in',
        time: formatTimeInTimezone(now, tenantTimezone),
        distanceMeters,
        message: 'تم تسجيل حضورك بنجاح داخل نطاق الفرع ✓',
      };
    } else {
      // check_out
      if (!existing?.check_in_at) {
        throw new AppError('يجب تسجيل الحضور أولاً قبل تسجيل الانصراف', 'CHECK_IN_FIRST', 400);
      }
      if (existing?.check_out_at) {
        throw new AppError(
          `تم تسجيل الانصراف مسبقاً في تمام الساعة: ${formatTimeInTimezone(existing.check_out_at, tenantTimezone)}`,
          'ALREADY_CHECKED_OUT',
          400,
        );
      }

      await db
        .updateTable('hr_attendance_records')
        .set({
          check_out_at: now,
          check_out_gps_lat: lat,
          check_out_gps_lng: lng,
          check_out_selfie_url: payload.selfieDataUrl || null,
          distance_meters: distanceMeters,
          updated_at: now,
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', user.tenantId)
        .execute();

      return {
        ok: true,
        type: 'check_out',
        time: formatTimeInTimezone(now, tenantTimezone),
        distanceMeters,
        message: 'تم تسجيل انصرافك بنجاح. يوم سعيد! ✓',
      };
    }
    });
  }

  /**
   * Updates branch geofence coordinates from admin or manager
   */
  async updateBranchGeofence(
    branchId: number,
    tenantId: string,
    payload: { latitude: number; longitude: number; geofenceRadiusMeters?: number },
  ) {
    await this.anyDb
      .updateTable('branches')
      .set({
        latitude: payload.latitude,
        longitude: payload.longitude,
        geofence_radius_meters: payload.geofenceRadiusMeters || 100,
        updated_at: new Date(),
      })
      .where('id', '=', branchId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, message: 'تم تحديث النطاق الجغرافي للفرع بنجاح' };
  }

  /**
   * Sets or updates employee mobile punch PIN code
   */
  async setEmployeePin(employeeId: number, tenantId: string, pinCode: string) {
    const cleanPin = String(pinCode || '').trim();
    assertSecurePasscode(cleanPin);

    const pinRecord = await createPasswordRecord(cleanPin);

    await this.anyDb
      .updateTable('hr_employees')
      .set({
        pin_hash: pinRecord.hash,
        pin_salt: pinRecord.salt,
        mobile_punch_enabled: true,
        updated_at: new Date(),
      })
      .where('id', '=', employeeId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, message: 'تم تعيين رمز الدخول السريع للموظف بنجاح' };
  }
}
