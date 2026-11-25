import { Inject, Injectable } from '@nestjs/common';
import {
  BiometricColumnMappingDto,
  ImportBiometricLogDto,
  PreviewBiometricLogDto,
  UpsertBiometricDeviceDto,
  type BiometricSyncScope,
} from '../dto/hr-biometric-write.dto';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { firstDayOfTenantMonth } from '../../../common/utils/client-date-bounds.util';
import { HrService } from '../hr.service';
import {
  buildBiometricEmployeeResolver,
  extractNumericPinCore,
  parseAndAggregateBiometricLog,
  parseZkUserDatBuffer,
  type AggregatedBiometricDailyRecord,
  type DecodedZkDeviceUser,
  type EmployeeBiometricCandidate,
} from '../engines/biometric-log-parser.engine';
import { fetchZktecoUdpData, probeZktecoLanDevice } from './zkteco-lan.client';
import {
  fetchDahuaLanAttendance,
  fetchHikvisionLanAttendance,
  maskDeviceCommKey,
  parseHttpDeviceCredentials,
  probeDahuaLanDevice,
  probeHikvisionLanDevice,
} from './http-biometric-lan.client';
import { BiometricStagingService } from './biometric-staging.service';

@Injectable()
export class BiometricAttendanceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly hrService: HrService,
    private readonly audit: AuditService,
    private readonly stagingService: BiometricStagingService,
  ) {}

  private async ensureBiometricSchema(): Promise<void> {
    await this.stagingService.ensureBiometricDevicesSchema();
  }

  async listDevices(auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();
    const devices = await this.db
      .selectFrom('hr_biometric_devices')
      .selectAll()
      .where('tenant_id', '=', auth.tenantId!)
      .orderBy('id', 'desc')
      .execute();

    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'employee_no', 'biometric_pin', 'display_name', 'status'])
      .where('tenant_id', '=', auth.tenantId!)
      .where('status', '=', 'active')
      .orderBy('id', 'asc')
      .execute();

    return {
      devices: devices.map((d) => ({
        id: Number(d.id),
        deviceName: d.device_name,
        serialNumber: d.serial_number,
        deviceBrand: d.device_brand,
        deviceModel: d.device_model,
        ipAddress: d.ip_address,
        port: Number(d.port || (d.device_brand === 'hikvision' || d.device_brand === 'dahua' ? 80 : 4370)),
        commKey: maskDeviceCommKey(d.device_brand, d.comm_key),
        branchName: d.branch_name,
        status: d.status,
        lastSyncAt: d.last_sync_at ? new Date(d.last_sync_at).toISOString() : null,
        totalPunchesReceived: Number(d.total_punches_received || 0),
        notes: d.notes,
      })),
      employeePins: employees.map((e) => ({
        id: Number(e.id),
        employeeNo: e.employee_no,
        biometricPin: e.biometric_pin || null,
        displayName: e.display_name,
      })),
      admsPushPath: '/api/hr/biometric/iclock/cdata',
      hikvisionPushPath: '/api/hr/biometric-push/hikvision',
      genericPushPath: '/api/hr/biometric-push/json',
    };
  }

  async upsertDevice(id: number | null, payload: UpsertBiometricDeviceDto, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();
    const deviceName = String(payload.deviceName || '').trim();
    const serialNumber = String(payload.serialNumber || '')
      .trim()
      .toUpperCase();

    if (!deviceName) {
      throw new AppError('اسم جهاز البصمة مطلوب', 'HR_BIOMETRIC_NAME_REQUIRED', 400);
    }
    if (!serialNumber) {
      throw new AppError('الرقم التسلسلي لجهاز البصمة (Serial Number) مطلوب', 'HR_BIOMETRIC_SN_REQUIRED', 400);
    }

    const existingSn = await this.db
      .selectFrom('hr_biometric_devices')
      .select(['id', 'tenant_id'])
      .where(sql`UPPER(serial_number)`, '=', serialNumber)
      .executeTakeFirst();

    if (existingSn && (!id || Number(existingSn.id) !== Number(id))) {
      throw new AppError('الرقم التسلسلي لجهاز البصمة مسجل بالفعل', 'HR_BIOMETRIC_SN_DUPLICATE', 409);
    }

    const brand = payload.deviceBrand || 'zkteco';
    const defaultPort = brand === 'hikvision' || brand === 'dahua' ? 80 : 4370;
    const port = Math.max(1, Math.min(65535, Number(payload.port || defaultPort) || defaultPort));
    const status = payload.status === 'inactive' ? 'inactive' : 'active';
    const incomingCommKey = payload.commKey ? String(payload.commKey).trim() : '';

    if (id) {
      const target = await this.db
        .selectFrom('hr_biometric_devices')
        .select(['id', 'comm_key'])
        .where('id', '=', id)
        .where('tenant_id', '=', auth.tenantId!)
        .executeTakeFirst();
      if (!target) {
        throw new AppError('جهاز البصمة غير موجود', 'HR_BIOMETRIC_NOT_FOUND', 404);
      }
      const nextCommKey =
        !incomingCommKey || incomingCommKey.includes('••••') ? target.comm_key || '0' : incomingCommKey;

      await this.db
        .updateTable('hr_biometric_devices')
        .set({
          device_name: deviceName,
          serial_number: serialNumber,
          device_brand: brand,
          device_model: payload.deviceModel ? String(payload.deviceModel).trim() : null,
          ip_address: payload.ipAddress ? String(payload.ipAddress).trim() : null,
          port,
          comm_key: nextCommKey,
          branch_name: payload.branchName ? String(payload.branchName).trim() : null,
          status,
          notes: payload.notes ? String(payload.notes).trim() : null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', auth.tenantId!)
        .execute();

      await this.audit.log('Update biometric device', `Updated biometric device ${deviceName} (${serialNumber})`, auth);
    } else {
      await this.db
        .insertInto('hr_biometric_devices')
        .values({
          tenant_id: auth.tenantId!,
          account_id: auth.accountId || 'default',
          device_name: deviceName,
          serial_number: serialNumber,
          device_brand: brand,
          device_model: payload.deviceModel ? String(payload.deviceModel).trim() : null,
          ip_address: payload.ipAddress ? String(payload.ipAddress).trim() : null,
          port,
          comm_key: payload.commKey ? String(payload.commKey).trim() : '0',
          branch_name: payload.branchName ? String(payload.branchName).trim() : null,
          status,
          notes: payload.notes ? String(payload.notes).trim() : null,
          created_by: auth.userId || null,
          updated_at: new Date(),
        })
        .execute();

      await this.audit.log(
        'Create biometric device',
        `Registered biometric device ${deviceName} (${serialNumber})`,
        auth,
      );
    }

    return this.listDevices(auth);
  }

  async deleteDevice(id: number, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();
    await this.db
      .deleteFrom('hr_biometric_devices')
      .where('id', '=', id)
      .where('tenant_id', '=', auth.tenantId!)
      .execute();

    await this.audit.log('Delete biometric device', `Deleted biometric device #${id}`, auth);
    return this.listDevices(auth);
  }

  async assignEmployeeBiometricPin(employeeId: number, biometricPin: string | null, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();
    const cleanPin = biometricPin ? String(biometricPin).trim() : null;

    if (cleanPin) {
      const duplicate = await this.db
        .selectFrom('hr_employees')
        .select(['id', 'display_name'])
        .where('tenant_id', '=', auth.tenantId!)
        .where('biometric_pin', '=', cleanPin)
        .where('id', '!=', employeeId)
        .executeTakeFirst();
      if (duplicate) {
        throw new AppError(
          `رقم البصمة (${cleanPin}) مربوط بالفعل بالموظف ${duplicate.display_name}`,
          'HR_BIOMETRIC_PIN_DUPLICATE',
          409,
        );
      }
    }

    await this.db
      .updateTable('hr_employees')
      .set({
        biometric_pin: cleanPin,
        updated_by: auth.userId || null,
        updated_at: new Date(),
      })
      .where('id', '=', employeeId)
      .where('tenant_id', '=', auth.tenantId!)
      .execute();

    await this.audit.log(
      'Assign employee biometric PIN',
      `Set biometric_pin=${cleanPin || 'NULL'} for employee #${employeeId}`,
      auth,
    );

    let postedPendingDays = 0;
    if (cleanPin) {
      const empRow = await this.db
        .selectFrom('hr_employees')
        .select(['employee_no'])
        .where('id', '=', employeeId)
        .where('tenant_id', '=', auth.tenantId!)
        .executeTakeFirst();
      if (empRow?.employee_no) {
        const postRes = await this.stagingService.postPendingPunchesForEmployee(
          cleanPin,
          employeeId,
          empRow.employee_no,
          auth,
        );
        postedPendingDays = postRes.postedDays;
      }
    }

    const listRes = await this.listDevices(auth);
    return { ...listRes, postedPendingDays };
  }

  async testLanDeviceConnection(id: number, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();
    const device = await this.db
      .selectFrom('hr_biometric_devices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', auth.tenantId!)
      .executeTakeFirst();

    if (!device) {
      throw new AppError('جهاز البصمة غير موجود', 'HR_BIOMETRIC_NOT_FOUND', 404);
    }
    if (!device.ip_address) {
      throw new AppError('لم يتم تحديد عنوان IP المحلي لجهاز البصمة', 'HR_BIOMETRIC_IP_REQUIRED', 400);
    }

    const ip = device.ip_address.trim();
    const brand = String(device.device_brand || 'zkteco').toLowerCase();
    if (brand === 'hikvision') {
      const creds = parseHttpDeviceCredentials(device.comm_key);
      return probeHikvisionLanDevice(ip, Number(device.port || 80), creds.username, creds.password);
    }
    if (brand === 'dahua') {
      const creds = parseHttpDeviceCredentials(device.comm_key);
      return probeDahuaLanDevice(ip, Number(device.port || 80), creds.username, creds.password);
    }
    return probeZktecoLanDevice(ip, Number(device.port || 4370));
  }

  async pullAttendanceFromLanDevice(id: number, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();

    const device = await this.db
      .selectFrom('hr_biometric_devices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', auth.tenantId!)
      .executeTakeFirst();

    if (!device) {
      throw new AppError('جهاز البصمة غير موجود', 'HR_BIOMETRIC_NOT_FOUND', 404);
    }
    if (!device.ip_address) {
      throw new AppError('لم يتم تحديد عنوان IP المحلي لجهاز البصمة', 'HR_BIOMETRIC_IP_REQUIRED', 400);
    }

    const ip = device.ip_address.trim();
    const brand = String(device.device_brand || 'zkteco').toLowerCase();
    const port = Number(device.port || (brand === 'hikvision' || brand === 'dahua' ? 80 : 4370));

    let rawAttlogLines: string[] = [];
    let deviceUsers: DecodedZkDeviceUser[] = [];
    if (brand === 'hikvision' || brand === 'dahua') {
      const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
      const todayKey = todayTenantDate(tenantTimezone);
      const openMonthStart = firstDayOfTenantMonth(todayKey);
      const creds = parseHttpDeviceCredentials(device.comm_key);
      const pulled =
        brand === 'hikvision'
          ? await fetchHikvisionLanAttendance(ip, port, creds.username, creds.password, openMonthStart, todayKey)
          : await fetchDahuaLanAttendance(
              ip,
              port,
              creds.username,
              creds.password,
              openMonthStart,
              todayKey,
              tenantTimezone,
            );
      rawAttlogLines = pulled.rawAttlogLines;
    } else {
      const commKey = Number(device.comm_key || 0) || 0;
      const pulled = await fetchZktecoUdpData(ip, port, commKey);
      rawAttlogLines = pulled.rawAttlogLines;
      deviceUsers = pulled.deviceUsers;
    }

    await this.db
      .updateTable('hr_biometric_devices')
      .set({
        last_sync_at: new Date(),
        total_punches_received: Number(device.total_punches_received || 0) + rawAttlogLines.length,
        updated_at: new Date(),
      })
      .where('id', '=', device.id)
      .execute();

    if (rawAttlogLines.length === 0) {
      return {
        pulledPunchesCount: 0,
        deviceUsersCount: deviceUsers.length,
        deviceUsers,
        imported: 0,
        skipped: 0,
        message: `تم الاتصال بالجهاز بنجاح (${deviceUsers.length} مستخدم على الجهاز) — لا توجد حركات حضور مسجلة حالياً في ذاكرة الماكينة`,
      };
    }

    const importResult = await this.importBiometricLog(
      {
        rawText: rawAttlogLines.join('\n'),
        debounceMinutes: 3,
        onlyOpenPayrollMonth: true,
        stageUnmatched: true,
        deviceSerial: device.serial_number,
      },
      auth,
    );

    await this.audit.log(
      'Pull LAN biometric attendance',
      `Pulled ${rawAttlogLines.length} punches from ${device.device_name} (${ip}:${port}), imported ${importResult.imported}, staged ${importResult.stagedPendingCount || 0}`,
      auth,
    );

    const stagedSuffix =
      importResult.stagedPendingCount && importResult.stagedPendingCount > 0
        ? `، وحفظ ${importResult.stagedPendingCount} يوم غير مربوط في «البصمات المعلقة»`
        : '';

    return {
      pulledPunchesCount: rawAttlogLines.length,
      deviceUsersCount: deviceUsers.length,
      deviceUsers,
      ...importResult,
      message: `تم سحب ${rawAttlogLines.length} حركة من الجهاز واعتماد ${importResult.imported} يوم عمل بنجاح${stagedSuffix}`,
    };
  }

  private async resolveEffectiveDateWindow(
    tenantId: string,
    openMonthStart: string,
    todayKey: string,
    requestedScope?: BiometricSyncScope,
    fromDate?: string | null,
    toDate?: string | null,
  ): Promise<{
    appliedSyncScope: BiometricSyncScope;
    lastImportedDate: string | null;
    effectiveFrom: string;
    effectiveTo: string;
  }> {
    const watermarkRes = await sql<{ last_date: string | null }>`
      SELECT MAX(to_char(work_date, 'YYYY-MM-DD')) AS last_date
      FROM hr_attendance_records
      WHERE tenant_id = ${tenantId}
        AND source = 'import'
        AND work_date BETWEEN ${openMonthStart}::date AND ${todayKey}::date
    `.execute(this.db);
    const lastImportedDate = watermarkRes.rows[0]?.last_date || null;

    const scope: BiometricSyncScope =
      requestedScope === 'open_month' || requestedScope === 'custom' ? requestedScope : 'since_last';

    if (scope === 'open_month') {
      return { appliedSyncScope: scope, lastImportedDate, effectiveFrom: openMonthStart, effectiveTo: todayKey };
    }

    if (scope === 'custom') {
      const cleanFrom = String(fromDate || '').trim();
      const cleanTo = String(toDate || '').trim();
      const isoRx = /^\d{4}-\d{2}-\d{2}$/;
      const effectiveFrom =
        isoRx.test(cleanFrom) && cleanFrom >= openMonthStart && cleanFrom <= todayKey ? cleanFrom : openMonthStart;
      const effectiveTo = isoRx.test(cleanTo) && cleanTo >= effectiveFrom && cleanTo <= todayKey ? cleanTo : todayKey;
      return { appliedSyncScope: scope, lastImportedDate, effectiveFrom, effectiveTo };
    }

    // 'since_last' (Incremental Watermark): starts at lastImportedDate (inclusive to catch check-out)
    // or falls back seamlessly to openMonthStart on the first import of the month.
    const effectiveFrom =
      lastImportedDate && lastImportedDate >= openMonthStart && lastImportedDate <= todayKey
        ? lastImportedDate
        : openMonthStart;
    return { appliedSyncScope: 'since_last', lastImportedDate, effectiveFrom, effectiveTo: todayKey };
  }

  async previewBiometricLog(payload: PreviewBiometricLogDto, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();

    if (payload.base64UserDat) {
      const buf = Buffer.from(payload.base64UserDat, 'base64');
      const decodedUsers: DecodedZkDeviceUser[] = parseZkUserDatBuffer(new Uint8Array(buf));
      return {
        mode: 'user_dat' as const,
        decodedUsers,
      };
    }

    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'employee_no', 'biometric_pin', 'display_name', 'status'])
      .where('tenant_id', '=', auth.tenantId!)
      .where('status', '=', 'active')
      .execute();

    const knownPins = new Set<string>();
    const candidates: EmployeeBiometricCandidate[] = employees.map((e) => {
      if (e.employee_no) {
        knownPins.add(e.employee_no.trim().toLowerCase());
        const core = extractNumericPinCore(e.employee_no);
        if (core) knownPins.add(core);
      }
      if (e.biometric_pin) {
        knownPins.add(e.biometric_pin.trim().toLowerCase());
        const core = extractNumericPinCore(e.biometric_pin);
        if (core) knownPins.add(core);
      }
      return {
        id: Number(e.id),
        employeeNo: e.employee_no,
        biometricPin: e.biometric_pin,
        displayName: e.display_name,
        status: e.status,
      };
    });

    const summary = parseAndAggregateBiometricLog(payload.rawText || '', {
      debounceMinutes: payload.debounceMinutes ?? 3,
      minSessionMinutes: payload.minSessionMinutes ?? 10,
      columnMapping: payload.columnMapping,
      knownEmployeePins: knownPins,
    });

    const resolveEmployee = buildBiometricEmployeeResolver(candidates);
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const todayKey = todayTenantDate(tenantTimezone);
    const openMonthStart = firstDayOfTenantMonth(todayKey);
    const dateWindow = await this.resolveEffectiveDateWindow(
      auth.tenantId!,
      openMonthStart,
      todayKey,
      payload.syncScope,
      payload.fromDate,
      payload.toDate,
    );

    const readyRecords: Array<
      AggregatedBiometricDailyRecord & {
        employeeId: number;
        employeeNo: string;
        employeeName: string;
        matchedBy: string;
      }
    > = [];
    let historicalOutOfMonthCount = 0;
    let skippedBeforeWindowCount = 0;
    let unmatchedInMonthCount = 0;
    const unmatchedPinCounts = new Map<string, number>();

    for (const rec of summary.dailyRecords) {
      if (rec.workDate < openMonthStart || rec.workDate > todayKey) {
        historicalOutOfMonthCount++;
        continue;
      }
      if (rec.workDate < dateWindow.effectiveFrom || rec.workDate > dateWindow.effectiveTo) {
        skippedBeforeWindowCount++;
        continue;
      }

      const match = resolveEmployee(rec.pin);
      if (!match) {
        unmatchedInMonthCount++;
        unmatchedPinCounts.set(rec.pin, (unmatchedPinCounts.get(rec.pin) || 0) + 1);
        continue;
      }

      readyRecords.push({
        ...rec,
        employeeId: match.employee.id,
        employeeNo: match.employee.employeeNo,
        employeeName: match.employee.displayName || match.employee.employeeNo,
        matchedBy: match.matchedBy,
      });
    }

    return {
      mode: 'attendance_log' as const,
      detectedFormat: summary.detectedFormat,
      detectedColumns: summary.detectedColumns,
      appliedColumnMapping: summary.appliedColumnMapping,
      totalLinesRead: summary.totalLinesRead,
      totalRawPunches: summary.totalRawPunches,
      totalDeduplicatedTaps: summary.totalDeduplicatedTaps,
      totalDailyAggregated: summary.dailyRecords.length,
      openPayrollMonth: { from: openMonthStart, to: todayKey },
      lastImportedDate: dateWindow.lastImportedDate,
      appliedSyncScope: dateWindow.appliedSyncScope,
      appliedDateRange: { from: dateWindow.effectiveFrom, to: dateWindow.effectiveTo },
      readyToImportCount: readyRecords.length,
      unmatchedInMonthCount,
      historicalOutOfMonthCount,
      skippedBeforeWindowCount,
      minDate: summary.minDate,
      maxDate: summary.maxDate,
      unmatchedPins: Array.from(unmatchedPinCounts.entries()).map(([pin, daysCount]) => ({
        pin,
        daysCount,
      })),
      previewRecords: readyRecords.slice(0, 150),
      parseWarnings: summary.parseWarnings,
    };
  }

  async importBiometricLog(payload: ImportBiometricLogDto, auth: AuthContext) {
    requireTenantScope(auth);
    await this.ensureBiometricSchema();

    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'employee_no', 'biometric_pin', 'display_name', 'status'])
      .where('tenant_id', '=', auth.tenantId!)
      .where('status', '=', 'active')
      .execute();

    const knownPins = new Set<string>();
    for (const e of employees) {
      if (e.employee_no) {
        knownPins.add(e.employee_no.trim().toLowerCase());
        const core = extractNumericPinCore(e.employee_no);
        if (core) knownPins.add(core);
      }
      if (e.biometric_pin) {
        knownPins.add(e.biometric_pin.trim().toLowerCase());
        const core = extractNumericPinCore(e.biometric_pin);
        if (core) knownPins.add(core);
      }
    }

    const summary = parseAndAggregateBiometricLog(payload.rawText || '', {
      debounceMinutes: payload.debounceMinutes ?? 3,
      minSessionMinutes: payload.minSessionMinutes ?? 10,
      columnMapping: payload.columnMapping,
      knownEmployeePins: knownPins,
    });

    if (summary.dailyRecords.length === 0) {
      throw new AppError('الملف لا يحتوي على حركات بصمة صالحة للاستيراد', 'HR_BIOMETRIC_EMPTY_LOG', 400);
    }

    const resolveEmployee = buildBiometricEmployeeResolver(
      employees.map((e) => ({
        id: Number(e.id),
        employeeNo: e.employee_no,
        biometricPin: e.biometric_pin,
        displayName: e.display_name,
        status: e.status,
      })),
    );

    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const todayKey = todayTenantDate(tenantTimezone);
    const openMonthStart = firstDayOfTenantMonth(todayKey);
    const filterToOpenMonth = payload.onlyOpenPayrollMonth !== false;
    const dateWindow = await this.resolveEffectiveDateWindow(
      auth.tenantId!,
      openMonthStart,
      todayKey,
      payload.syncScope,
      payload.fromDate,
      payload.toDate,
    );

    const recordsToImport: Array<{
      employeeNo: string;
      workDate: string;
      checkInAt?: string;
      checkOutAt?: string;
    }> = [];

    let historicalSkipped = 0;
    let skippedBeforeWindow = 0;
    let unmatchedSkipped = 0;
    let autoCreatedEmployees = 0;
    const unmatchedPins = new Set<string>();
    const unmatchedInMonthRecords: Array<{
      pin: string;
      workDate: string;
      checkInAt: string | null;
      checkOutAt: string | null;
      rawPunchCount: number;
    }> = [];

    const autoCreatedPinToEmpNo = new Map<string, string>();

    for (const rec of summary.dailyRecords) {
      if (filterToOpenMonth && (rec.workDate < openMonthStart || rec.workDate > todayKey)) {
        historicalSkipped++;
        continue;
      }
      if (filterToOpenMonth && (rec.workDate < dateWindow.effectiveFrom || rec.workDate > dateWindow.effectiveTo)) {
        skippedBeforeWindow++;
        continue;
      }

      const match = resolveEmployee(rec.pin);
      if (!match) {
        if (payload.autoCreateEmployees) {
          let empNo = autoCreatedPinToEmpNo.get(rec.pin);
          if (!empNo) {
            const created = await this.stagingService.createEmployeeFromBiometricPin({ pin: rec.pin }, auth);
            empNo = created.employeeNo;
            autoCreatedPinToEmpNo.set(rec.pin, empNo);
            if (!created.alreadyExisted) autoCreatedEmployees++;
          }
          recordsToImport.push({
            employeeNo: empNo,
            workDate: rec.workDate,
            checkInAt: rec.checkInAt || undefined,
            checkOutAt: rec.checkOutAt || undefined,
          });
          continue;
        }

        unmatchedSkipped++;
        unmatchedPins.add(rec.pin);
        unmatchedInMonthRecords.push({
          pin: rec.pin,
          workDate: rec.workDate,
          checkInAt: rec.checkInAt,
          checkOutAt: rec.checkOutAt,
          rawPunchCount: rec.rawPunchCount,
        });
        continue;
      }

      recordsToImport.push({
        employeeNo: match.employee.employeeNo,
        workDate: rec.workDate,
        checkInAt: rec.checkInAt || undefined,
        checkOutAt: rec.checkOutAt || undefined,
      });
    }

    let stagedPendingCount = 0;
    if (unmatchedInMonthRecords.length > 0 && payload.stageUnmatched !== false) {
      stagedPendingCount = await this.stagingService.stageUnmatchedDailyRecords(
        auth.tenantId!,
        auth.accountId || 'default',
        payload.deviceSerial || 'file_import',
        unmatchedInMonthRecords,
      );
    }

    if (recordsToImport.length === 0) {
      return {
        imported: 0,
        skipped: summary.dailyRecords.length,
        historicalSkipped,
        unmatchedSkipped,
        stagedPendingCount,
        autoCreatedEmployees,
        unmatchedPins: Array.from(unmatchedPins),
        totalRawPunches: summary.totalRawPunches,
        deduplicatedTaps: summary.totalDeduplicatedTaps,
        errors: [
          stagedPendingCount > 0
            ? `تم حفظ ${stagedPendingCount} يوم عمل في صندوق «البصمات المعلقة» لـ ${unmatchedPins.size} رقم بصمة غير مربوط بموظف؛ يمكنك ربطهم أو إنشاء ملفاتهم بضغطة زر.`
            : skippedBeforeWindow > 0
              ? `لا توجد حركات جديدة ضمن النطاق المحدد (${dateWindow.effectiveFrom} إلى ${dateWindow.effectiveTo})؛ يمكنك اختيار «الشهر المفتوح بالكامل» لاستعراض باقي الشهر.`
              : `كافة الحركات في الملف (${historicalSkipped}) تقع خارج الشهر المفتوح حالياً (${openMonthStart} إلى ${todayKey})`,
        ],
      };
    }

    const importResult = await this.hrService.bulkImportAttendanceRecords({ records: recordsToImport }, auth);

    return {
      ...importResult,
      historicalSkipped,
      unmatchedSkipped,
      stagedPendingCount,
      autoCreatedEmployees,
      unmatchedPins: Array.from(unmatchedPins),
      totalRawPunches: summary.totalRawPunches,
      deduplicatedTaps: summary.totalDeduplicatedTaps,
    };
  }

  async handleAdmsHandshake(serialNumber: string): Promise<string> {
    await this.ensureBiometricSchema();
    const cleanSn = String(serialNumber || '')
      .trim()
      .toUpperCase();
    if (!cleanSn) return 'ERROR: SN REQUIRED';

    const device = await this.db
      .selectFrom('hr_biometric_devices')
      .select(['id', 'tenant_id', 'status'])
      .where(sql`UPPER(serial_number)`, '=', cleanSn)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!device) {
      return 'UNKNOWN DEVICE';
    }

    await this.db
      .updateTable('hr_biometric_devices')
      .set({ last_sync_at: new Date(), updated_at: new Date() })
      .where('id', '=', device.id)
      .execute();

    return [
      `GET OPTION FROM: ${cleanSn}`,
      'ATTLOGStamp=None',
      'OPERLOGStamp=9999',
      'ATTPHOTOStamp=None',
      'ErrorDelay=30',
      'Delay=10',
      'TransTimes=00:00;14:05',
      'TransInterval=1',
      'TransFlag=TransData AttLog',
      'Realtime=1',
      'Encrypt=0',
    ].join('\n');
  }

  async handleAdmsPush(serialNumber: string, table: string, rawBody: string): Promise<string> {
    await this.ensureBiometricSchema();
    const cleanSn = String(serialNumber || '')
      .trim()
      .toUpperCase();
    if (!cleanSn) return 'ERROR: SN REQUIRED';

    const device = await this.db
      .selectFrom('hr_biometric_devices')
      .selectAll()
      .where(sql`UPPER(serial_number)`, '=', cleanSn)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!device) {
      return 'ERROR: UNREGISTERED DEVICE';
    }

    const upperTable = String(table || 'ATTLOG')
      .trim()
      .toUpperCase();
    if (upperTable !== 'ATTLOG') {
      await this.db
        .updateTable('hr_biometric_devices')
        .set({ last_sync_at: new Date(), updated_at: new Date() })
        .where('id', '=', device.id)
        .execute();
      return 'OK';
    }

    const summary = parseAndAggregateBiometricLog(rawBody || '', {
      debounceMinutes: 3,
      minSessionMinutes: 10,
    });

    if (summary.dailyRecords.length === 0) {
      return 'OK: 0';
    }

    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'employee_no', 'biometric_pin', 'display_name', 'status'])
      .where('tenant_id', '=', device.tenant_id)
      .where('status', '=', 'active')
      .execute();

    const resolveEmployee = buildBiometricEmployeeResolver(
      employees.map((e) => ({
        id: Number(e.id),
        employeeNo: e.employee_no,
        biometricPin: e.biometric_pin,
        displayName: e.display_name,
        status: e.status,
      })),
    );

    const tenantTimezone = await getTenantTimezone(this.db, device.tenant_id);
    const todayKey = todayTenantDate(tenantTimezone);
    const openMonthStart = firstDayOfTenantMonth(todayKey);

    const recordsToUpsert: Array<{
      employeeNo: string;
      workDate: string;
      checkInAt?: string;
      checkOutAt?: string;
    }> = [];

    const unmatchedAdmsRecords: Array<{
      pin: string;
      workDate: string;
      checkInAt: string | null;
      checkOutAt: string | null;
      rawPunchCount: number;
    }> = [];

    for (const rec of summary.dailyRecords) {
      if (rec.workDate < openMonthStart || rec.workDate > todayKey) continue;
      const match = resolveEmployee(rec.pin);
      if (!match) {
        unmatchedAdmsRecords.push({
          pin: rec.pin,
          workDate: rec.workDate,
          checkInAt: rec.checkInAt,
          checkOutAt: rec.checkOutAt,
          rawPunchCount: rec.rawPunchCount,
        });
        continue;
      }

      const existing = await this.db
        .selectFrom('hr_attendance_records')
        .select(['id', 'check_in_at', 'check_out_at'])
        .where('tenant_id', '=', device.tenant_id)
        .where('employee_id', '=', match.employee.id)
        .where('work_date', '=', rec.workDate)
        .executeTakeFirst();

      if (existing?.check_in_at && rec.checkInAt && !rec.checkOutAt) {
        const existingInMs = new Date(existing.check_in_at).getTime();
        const incomingMs = new Date(rec.checkInAt).getTime();
        const diffMinutes = Math.abs(incomingMs - existingInMs) / 60000;

        if (diffMinutes <= 3) {
          continue;
        }
        if (incomingMs > existingInMs) {
          recordsToUpsert.push({
            employeeNo: match.employee.employeeNo,
            workDate: rec.workDate,
            checkInAt: new Date(existing.check_in_at).toISOString(),
            checkOutAt: rec.checkInAt,
          });
          continue;
        }
      }

      recordsToUpsert.push({
        employeeNo: match.employee.employeeNo,
        workDate: rec.workDate,
        checkInAt: rec.checkInAt || undefined,
        checkOutAt: rec.checkOutAt || undefined,
      });
    }

    if (recordsToUpsert.length > 0) {
      const syntheticAuth: AuthContext = {
        sessionId: 'biometric-adms',
        userId: Number(device.created_by || 0),
        username: `biometric:${cleanSn}`,
        role: 'admin',
        permissions: ['hr', 'hrAttendance'],
        tenantId: device.tenant_id,
        accountId: device.account_id || 'default',
      };

      await this.hrService.bulkImportAttendanceRecords({ records: recordsToUpsert }, syntheticAuth);
    }

    if (unmatchedAdmsRecords.length > 0) {
      await this.stagingService.stageUnmatchedDailyRecords(
        device.tenant_id,
        device.account_id || 'default',
        cleanSn,
        unmatchedAdmsRecords,
      );
    }

    await this.db
      .updateTable('hr_biometric_devices')
      .set({
        last_sync_at: new Date(),
        total_punches_received: Number(device.total_punches_received || 0) + summary.totalRawPunches,
        updated_at: new Date(),
      })
      .where('id', '=', device.id)
      .execute();

    return `OK: ${summary.totalRawPunches}`;
  }
}
