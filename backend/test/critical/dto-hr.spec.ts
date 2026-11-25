/*
 * New file: backend/test/critical/dto-hr.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-HR-TAX-APPROVALS-30, D9): the 19 HR controller
 * routes (biometric devices + log preview/import + employee PIN assign +
 * create-employee + bulk-create, end-of-service calculate-preview +
 * create + post-accounting, employee-portal login + PIN change + leave
 * request + advance request, mobile-punch login + record + geofence +
 * employee PIN, payroll-policies update) now take DTO classes, so the
 * real global requestValidationPipe validates and whitelists them.
 * Before D9 they took inline object types, `any`, or interfaces — and
 * the pipe does nothing for an inline type, `any`, or an interface, so
 * any extra field (or a wrong-typed field) reached the service
 * untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file sends; see the per-case
 * comments for the caller file), which must pass the pipe with
 * every field intact, and (b) negative cases: an extra field the
 * caller never sends is rejected with 400 VALIDATION_ERROR, and a
 * wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D9 caller verification):
 * - UpsertBiometricDeviceDto: the add form (BiometricDevicesAndPinsTabs)
 *   is the ONLY saveBiometricDevice caller; it sends deviceName,
 *   serialNumber, deviceBrand, ipAddress, port (Number), commKey,
 *   branchName, status 'active'. deviceModel/notes are NEVER sent
 *   (only in the GET type) — optional in the DTO. port has NO
 *   Min/Max (the service clamps 1-65535); commKey has NO MinLength
 *   (masked '....' handling — D7 WhatsApp precedent). PUT /devices/:id
 *   has NO caller; the same class covers it.
 * - PreviewBiometricLogDto: ALL fields optional (the service defaults
 *   every one). The modal sends fromDate/toDate as null when the scope
 *   is not custom — null passes @IsOptional. minSessionMinutes is
 *   NEVER sent by the caller (interface-only, service defaults 10).
 *   syncScope stays a PLAIN STRING (the service defaults an unknown
 *   scope to 'since_last' — D8 CalculateFees precedent).
 * - ImportBiometricLogDto: rawText is REQUIRED (interface + caller
 *   agree; the service's EMPTY_LOG error still fires for an empty
 *   string). deviceSerial is NEVER sent (interface-only, service
 *   defaults 'file_import'). columnMapping is built ONLY from the 7
 *   BiometricColumnMapping keys (modal state + the server's
 *   appliedColumnMapping — same 7 keys); the parser reads only those 7.
 * - AssignEmployeeBiometricPinDto: biometricPin accepts missing/null/
 *   string — the service does body?.biometricPin ?? null (null clears).
 * - BulkCreateEmployeesDto.items is OPTIONAL (the service tolerates
 *   missing — body?.items || []), though the only caller always sends it.
 * - SettlementCalculateInputDto: lawType is REQUIRED enum saudi|egyptian|
 *   custom — the service throws when it is missing, and 'egyptian'
 *   stays IN the enum so the service's specific business error
 *   surfaces (not a pipe 400). terminationReason is OPTIONAL (the
 *   service defaults 'resignation'); contractType is NEVER sent by the
 *   page (optional). The EOS page ALWAYS sends lawType (UI-guarded).
 * - CreateSettlementDto.confirmTermination is NEVER read by the service
 *   (interface line only) — accepted as optional (Package C trap).
 *   clearanceChecklist + settlementDate are NEVER sent (service
 *   defaults [] / today).
 * - EmployeePortalChangePinDto: currentPin + newPin are REQUIRED though
 *   the interface marks both optional (the service throws INVALID_PIN
 *   when either is missing — D5 precedent).
 * - RequestAdvanceDto.reason is OPTIONAL though the interface says
 *   required (the service defaults 'بدون تفاصيل').
 * - RecordPunchDto.type stays a PLAIN STRING (the service branches on
 *   check_in and treats anything else as check_out — D8 fulfillmentType
 *   precedent); a non-check_in value passes the pipe, pinned below.
 *   latitude/longitude are type-only (the service owns the GPS range
 *   errors). selfieDataUrl/notes optional.
 * - UpdatePayrollPoliciesDto: ALL 31 fields OPTIONAL (the service heals
 *   country/date/reference/reviewed, then validates; {} passes when
 *   both features are off). The 3 vocabulary fields (statutoryCountry,
 *   taxableEarningsBasis, insuranceWageBasis) are PLAIN STRINGS: the
 *   service HEALS an invalid country and validates the other two only
 *   when the feature is enabled — an enum would 400 a payload the
 *   service heals/accepts. hrWeekendDays is a COMMA STRING
 *   ('friday,saturday'), NOT an array. hrSocialInsuranceEmployeePct is
 *   a legacy flat field NOT in HrStatutoryPolicy but sent by the caller
 *   and stored verbatim — it must be in the DTO. insuranceConfig nested
 *   DTO: all 4 fields optional numbers (the service enforces pcts only
 *   when insurance is enabled — the service is the backstop).
 *
 * NOT CONVERTED — THE 3 BIOMETRIC DEVICE-PUSH EXCLUSIONS (pinned):
 * the iclock cdata / hikvision / json `unknown` sites stay `unknown`
 * (Rule 7) — the handlers read the body as raw text/Buffer, not JSON.
 * The spec pins all three as `unknown` by source grep below, so a
 * future agent does not "fix" them.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop — e.g.
 * the EOS lawType/egyptian business errors, the payroll-policy
 * validator, the GPS/geofence checks, the PIN passcode rules); the
 * frontend screens (untouched); the 3 pinned webhook exclusions.
 *
 * Fail-first: this spec is new in D9 — on the unpatched tree the DTO
 * classes do not exist, so the imports fail (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the pipe accepts every real
 * caller payload and rejects every extra/wrong-typed field below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import {
  AssignEmployeeBiometricPinDto,
  BulkCreateEmployeesDto,
  CreateEmployeeFromBiometricPinDto,
  ImportBiometricLogDto,
  PreviewBiometricLogDto,
  UpsertBiometricDeviceDto,
} from '../../src/modules/hr/dto/hr-biometric-write.dto';
import { CreateSettlementDto, SettlementCalculateInputDto } from '../../src/modules/hr/services/end-of-service.service';
import { PostSettlementAccountingDto } from '../../src/modules/hr/dto/hr-eos-write.dto';
import {
  EmployeePortalChangePinDto,
  EmployeePortalLoginDto,
  RequestAdvanceDto,
  RequestLeaveDto,
} from '../../src/modules/hr/dto/employee-portal-write.dto';
import {
  MobilePunchLoginDto,
  RecordPunchDto,
  SetEmployeePinDto,
  UpdateBranchGeofenceDto,
} from '../../src/modules/hr/dto/mobile-attendance-write.dto';
import { UpdatePayrollPoliciesDto } from '../../src/modules/hr/dto/payroll-policies-write.dto';

function isValidationError(err: unknown): boolean {
  return err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === 'VALIDATION_ERROR';
}

async function pipeOk<T>(Dto: new () => T, payload: unknown): Promise<T> {
  return (await requestValidationPipe.transform(payload, { type: 'body', metatype: Dto })) as T;
}

async function pipeRejects(Dto: new () => unknown, payload: unknown, why: string): Promise<void> {
  await assert.rejects(
    () => requestValidationPipe.transform(payload, { type: 'body', metatype: Dto }),
    isValidationError,
    why,
  );
}

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

async function main(): Promise<void> {
  // 1. UpsertBiometricDeviceDto — caller: BiometricDevicesAndPinsTabs
  // add form sends { deviceName, serialNumber, deviceBrand, ipAddress,
  // port (Number), commKey, branchName, status: 'active' }.
  {
    const transformed = await pipeOk(UpsertBiometricDeviceDto, {
      deviceName: 'ZKTeco K40',
      serialNumber: 'abc123',
      deviceBrand: 'zkteco',
      ipAddress: '192.168.1.10',
      port: 4370,
      commKey: '0',
      branchName: 'Main',
      status: 'active',
    });
    assert.equal(transformed.deviceName, 'ZKTeco K40', 'device name survives the pipe');
    assert.equal(transformed.port, 4370, 'device port survives the pipe');
    const minimal = await pipeOk(UpsertBiometricDeviceDto, { deviceName: 'D1', serialNumber: 'S1' });
    assert.equal(minimal.deviceBrand, undefined, 'a minimal device passes — brand/port/model/notes optional');
    await pipeRejects(UpsertBiometricDeviceDto, { serialNumber: 'S1' }, 'a missing deviceName is rejected');
    await pipeRejects(UpsertBiometricDeviceDto, { deviceName: 'D1' }, 'a missing serialNumber is rejected');
    await pipeRejects(
      UpsertBiometricDeviceDto,
      { deviceName: 'D1', serialNumber: 'S1', deviceBrand: 'unknown-brand' },
      'an unknown deviceBrand is rejected',
    );
    await pipeRejects(
      UpsertBiometricDeviceDto,
      { deviceName: 'D1', serialNumber: 'S1', extra: 1 },
      'an extra field is rejected',
    );
    await pipeRejects(
      UpsertBiometricDeviceDto,
      { deviceName: 'D1', serialNumber: 'S1', port: 'much' },
      'a wrong-typed port is rejected',
    );
    const coercedPort = await pipeOk(UpsertBiometricDeviceDto, { deviceName: 'D1', serialNumber: 'S1', port: '4370' });
    assert.strictEqual(coercedPort.port, 4370, 'a numeric port string coerces to 4370');
  }

  // 2. PreviewBiometricLogDto — caller: BiometricIntegrationModal via
  // hr.api previewBiometricLog. Every field optional.
  {
    const transformed = await pipeOk(PreviewBiometricLogDto, {
      rawText: '1\t2026-11-25 08:00:00\t0\t0',
      debounceMinutes: 3,
      columnMapping: { pinColIndex: 0, dateTimeColIndex: 1, hasHeaderRow: false },
      syncScope: 'custom',
      fromDate: '2026-11-01',
      toDate: '2026-11-25',
    });
    assert.equal(transformed.rawText, '1\t2026-11-25 08:00:00\t0\t0', 'preview rawText survives the pipe');
    assert.equal(transformed.columnMapping?.pinColIndex, 0, 'preview columnMapping survives the pipe');
    const empty = await pipeOk(PreviewBiometricLogDto, {});
    assert.equal(empty.rawText, undefined, 'an empty preview passes — every field is optional');
    const nullDates = await pipeOk(PreviewBiometricLogDto, { rawText: 'x', fromDate: null, toDate: null });
    assert.equal(nullDates.fromDate, null, 'a null fromDate passes (the modal sends null when scope is not custom)');
    await pipeRejects(PreviewBiometricLogDto, { rawText: 'x', extra: 1 }, 'an extra field is rejected');
    await pipeRejects(
      PreviewBiometricLogDto,
      { columnMapping: { pinColIndex: 'x' } },
      'a wrong-typed columnMapping field is rejected',
    );
  }

  // 3. ImportBiometricLogDto — caller: hr.api importBiometricLog.
  // rawText is REQUIRED; the rest optional.
  {
    const transformed = await pipeOk(ImportBiometricLogDto, {
      rawText: '1\t2026-11-25 08:00:00\t0\t0',
      debounceMinutes: 3,
      onlyOpenPayrollMonth: true,
      autoCreateEmployees: false,
      stageUnmatched: true,
      syncScope: 'since_last',
    });
    assert.equal(transformed.rawText, '1\t2026-11-25 08:00:00\t0\t0', 'import rawText survives the pipe');
    await pipeRejects(ImportBiometricLogDto, {}, 'a missing rawText is rejected');
    await pipeRejects(ImportBiometricLogDto, { rawText: 'x', extra: 1 }, 'an extra field is rejected');
    const stringFalse = await pipeOk(ImportBiometricLogDto, { rawText: 'x', onlyOpenPayrollMonth: 'false' });
    assert.equal(stringFalse.onlyOpenPayrollMonth, true, 'the string "false" converts to boolean true');
  }

  // 4. AssignEmployeeBiometricPinDto — caller: hr.api
  // assignEmployeeBiometricPin sends { biometricPin } (string|null).
  {
    const transformed = await pipeOk(AssignEmployeeBiometricPinDto, { biometricPin: '1234' });
    assert.equal(transformed.biometricPin, '1234', 'assign PIN survives the pipe');
    const cleared = await pipeOk(AssignEmployeeBiometricPinDto, { biometricPin: null });
    assert.equal(cleared.biometricPin, null, 'a null PIN passes (it clears the PIN)');
    const missing = await pipeOk(AssignEmployeeBiometricPinDto, {});
    assert.equal(missing.biometricPin, undefined, 'a missing PIN passes (the service defaults null)');
    await pipeRejects(AssignEmployeeBiometricPinDto, { biometricPin: '1', extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(AssignEmployeeBiometricPinDto, { biometricPin: 42 });
    assert.strictEqual(coerced.biometricPin, '42', 'a numeric PIN coerces to the string "42"');
  }

  // 5. CreateEmployeeFromBiometricPinDto — caller: hr.api
  // createEmployeeFromBiometricPin sends { pin, displayName? }.
  {
    const transformed = await pipeOk(CreateEmployeeFromBiometricPinDto, { pin: '77', displayName: 'Ahmed' });
    assert.equal(transformed.pin, '77', 'create-employee PIN survives the pipe');
    await pipeRejects(CreateEmployeeFromBiometricPinDto, { displayName: 'Ahmed' }, 'a missing pin is rejected');
    await pipeRejects(CreateEmployeeFromBiometricPinDto, { pin: '77', extra: 1 }, 'an extra field is rejected');
  }

  // 6. BulkCreateEmployeesDto — caller: hr.api
  // bulkCreateEmployeesFromBiometricPins ALWAYS sends { items }.
  {
    const transformed = await pipeOk(BulkCreateEmployeesDto, {
      items: [{ pin: '11', displayName: 'A' }, { pin: '22' }],
    });
    assert.equal(transformed.items?.length, 2, 'bulk items survive the pipe');
    assert.equal(transformed.items?.[1].pin, '22', 'a bulk item without displayName passes');
    const empty = await pipeOk(BulkCreateEmployeesDto, {});
    assert.equal(empty.items, undefined, 'a missing items passes (the service tolerates it)');
    await pipeRejects(BulkCreateEmployeesDto, { items: [{ displayName: 'A' }] }, 'a bulk item without pin is rejected');
    await pipeRejects(BulkCreateEmployeesDto, { items: [], extra: 1 }, 'an extra field is rejected');
  }

  // 7. SettlementCalculateInputDto — caller: HrEndOfServicePage
  // calculatePreview ALWAYS sends employeeId, terminationDate,
  // terminationReason, lawType (UI-guarded) + the optional amounts.
  {
    const transformed = await pipeOk(SettlementCalculateInputDto, {
      employeeId: 5,
      terminationDate: '2026-11-25',
      terminationReason: 'resignation',
      lawType: 'saudi',
      customGratuityDaysPerYear: 21,
      pendingSalaryAmount: 1500,
      noticePeriodAmount: 0,
      customEntitlements: 0,
      assetsDeduction: 0,
      otherDeductions: 0,
    });
    assert.equal(transformed.employeeId, 5, 'preview employeeId survives the pipe');
    assert.equal(transformed.lawType, 'saudi', 'preview lawType survives the pipe');
    const noReason = await pipeOk(SettlementCalculateInputDto, {
      employeeId: 5,
      terminationDate: '2026-11-25',
      lawType: 'custom',
    });
    assert.equal(noReason.terminationReason, undefined, 'a missing terminationReason passes (service defaults it)');
    await pipeRejects(
      SettlementCalculateInputDto,
      { employeeId: 5, terminationDate: '2026-11-25', terminationReason: 'resignation' },
      'a missing lawType is rejected',
    );
    await pipeRejects(
      SettlementCalculateInputDto,
      { terminationDate: '2026-11-25', terminationReason: 'resignation', lawType: 'saudi' },
      'a missing employeeId is rejected',
    );
    await pipeRejects(
      SettlementCalculateInputDto,
      { employeeId: 5, terminationDate: '2026-11-25', terminationReason: 'resignation', lawType: 'martian' },
      'an unknown lawType is rejected',
    );
    await pipeRejects(
      SettlementCalculateInputDto,
      { employeeId: 5, terminationDate: '2026-11-25', terminationReason: 'resignation', lawType: 'saudi', extra: 1 },
      'an extra field is rejected',
    );
    const coercedId = await pipeOk(SettlementCalculateInputDto, {
      employeeId: '42',
      terminationDate: '2026-11-25',
      lawType: 'saudi',
    });
    assert.strictEqual(coercedId.employeeId, 42, 'a numeric employeeId string coerces to 42');
  }

  // 8. CreateSettlementDto — caller: HrEndOfServicePage create sends
  // the preview fields + custodyCleared + clearanceNotes +
  // confirmTermination (never read by the service — accepted anyway).
  {
    const transformed = await pipeOk(CreateSettlementDto, {
      employeeId: 5,
      terminationDate: '2026-11-25',
      terminationReason: 'resignation',
      lawType: 'egyptian',
      pendingSalaryAmount: 1500,
      custodyCleared: true,
      clearanceNotes: 'cleared',
      confirmTermination: true,
    });
    assert.equal(transformed.lawType, 'egyptian', 'create lawType survives the pipe (egyptian stays in the enum)');
    assert.equal(transformed.confirmTermination, true, 'confirmTermination survives the pipe');
    const checklist = await pipeOk(CreateSettlementDto, {
      employeeId: 5,
      terminationDate: '2026-11-25',
      lawType: 'saudi',
      clearanceChecklist: ['keys', 'laptop'],
    });
    assert.equal(checklist.clearanceChecklist?.length, 2, 'a clearanceChecklist array passes');
    await pipeRejects(
      CreateSettlementDto,
      { employeeId: 5, terminationDate: '2026-11-25' },
      'a missing lawType is rejected on create too',
    );
    await pipeRejects(
      CreateSettlementDto,
      { employeeId: 5, terminationDate: '2026-11-25', lawType: 'saudi', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 9. PostSettlementAccountingDto — caller: end-of-service.api
  // postAccounting sends { treasuryAccountId?, notes? }.
  {
    const transformed = await pipeOk(PostSettlementAccountingDto, { treasuryAccountId: 7, notes: 'posted' });
    assert.equal(transformed.treasuryAccountId, 7, 'post-accounting treasuryAccountId survives the pipe');
    const empty = await pipeOk(PostSettlementAccountingDto, {});
    assert.equal(empty.notes, undefined, 'an empty post-accounting passes — both fields optional');
    await pipeRejects(PostSettlementAccountingDto, { treasuryAccountId: 7, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(
      PostSettlementAccountingDto,
      { treasuryAccountId: 'much' },
      'a wrong-typed treasuryAccountId is rejected',
    );
  }

  // 10. EmployeePortalLoginDto — caller: employee-portal.api login
  // sends { identifier, pinCode, companyCode?, tenantId? }.
  {
    const transformed = await pipeOk(EmployeePortalLoginDto, {
      identifier: '01012345678',
      pinCode: '4321',
      companyCode: 'ACME',
    });
    assert.equal(transformed.identifier, '01012345678', 'portal identifier survives the pipe');
    await pipeRejects(EmployeePortalLoginDto, { identifier: '01012345678' }, 'a missing pinCode is rejected');
    await pipeRejects(EmployeePortalLoginDto, { pinCode: '4321' }, 'a missing identifier is rejected');
    await pipeRejects(
      EmployeePortalLoginDto,
      { identifier: '01012345678', pinCode: '4321', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 11. EmployeePortalChangePinDto — caller: employee-portal.api
  // changePin sends BOTH currentPin + newPin (both required).
  {
    const transformed = await pipeOk(EmployeePortalChangePinDto, { currentPin: '1111', newPin: '2222' });
    assert.equal(transformed.newPin, '2222', 'change-PIN newPin survives the pipe');
    await pipeRejects(EmployeePortalChangePinDto, { newPin: '2222' }, 'a missing currentPin is rejected');
    await pipeRejects(EmployeePortalChangePinDto, { currentPin: '1111' }, 'a missing newPin is rejected');
    await pipeRejects(
      EmployeePortalChangePinDto,
      { currentPin: '1111', newPin: '2222', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 12. RequestLeaveDto — caller: employee-portal.api requestLeave
  // sends { leaveTypeId, startDate, endDate, reason? }.
  {
    const transformed = await pipeOk(RequestLeaveDto, {
      leaveTypeId: 3,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      reason: 'family',
    });
    assert.equal(transformed.leaveTypeId, 3, 'leave leaveTypeId survives the pipe');
    assert.equal(transformed.reason, 'family', 'leave reason survives the pipe');
    await pipeRejects(
      RequestLeaveDto,
      { startDate: '2026-12-01', endDate: '2026-12-05' },
      'a missing leaveTypeId is rejected',
    );
    await pipeRejects(RequestLeaveDto, { leaveTypeId: 3, endDate: '2026-12-05' }, 'a missing startDate is rejected');
    await pipeRejects(
      RequestLeaveDto,
      { leaveTypeId: 3, startDate: '2026-12-01', endDate: '2026-12-05', extra: 1 },
      'an extra field is rejected',
    );
    const coercedType = await pipeOk(RequestLeaveDto, {
      leaveTypeId: '3',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
    });
    assert.strictEqual(coercedType.leaveTypeId, 3, 'a numeric leaveTypeId string coerces to 3');
  }

  // 13. RequestAdvanceDto — caller: employee-portal.api requestAdvance
  // sends { amount, reason, repaymentMonths? }.
  {
    const transformed = await pipeOk(RequestAdvanceDto, { amount: 2000, reason: 'emergency', repaymentMonths: 3 });
    assert.equal(transformed.amount, 2000, 'advance amount survives the pipe');
    const noReason = await pipeOk(RequestAdvanceDto, { amount: 2000 });
    assert.equal(noReason.reason, undefined, 'a missing reason passes (the service defaults it)');
    await pipeRejects(RequestAdvanceDto, { reason: 'emergency' }, 'a missing amount is rejected');
    await pipeRejects(RequestAdvanceDto, { amount: 2000, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(RequestAdvanceDto, { amount: 'much' }, 'a wrong-typed amount is rejected');
  }

  // 14. MobilePunchLoginDto — caller: mobile-punch.api login sends
  // { phone, pinCode, companyCode?, tenantId? }.
  {
    const transformed = await pipeOk(MobilePunchLoginDto, { phone: '01012345678', pinCode: '4321' });
    assert.equal(transformed.phone, '01012345678', 'mobile-punch phone survives the pipe');
    await pipeRejects(MobilePunchLoginDto, { phone: '01012345678' }, 'a missing pinCode is rejected');
    await pipeRejects(
      MobilePunchLoginDto,
      { phone: '01012345678', pinCode: '4321', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 15. RecordPunchDto — caller: mobile-punch.api recordPunch sends
  // { type: check_in|check_out, latitude, longitude, selfieDataUrl?,
  // notes? }. type stays a PLAIN STRING: the service branches on
  // check_in and treats anything else as check_out (D8 precedent) —
  // a non-check_in value passes the pipe, pinned here.
  {
    const transformed = await pipeOk(RecordPunchDto, {
      type: 'check_in',
      latitude: 30.05,
      longitude: 31.25,
      selfieDataUrl: 'data:image/jpeg;base64,/9j/',
      notes: 'on time',
    });
    assert.equal(transformed.type, 'check_in', 'punch type survives the pipe');
    assert.equal(transformed.latitude, 30.05, 'punch latitude survives the pipe');
    const otherType = await pipeOk(RecordPunchDto, { type: 'break', latitude: 30.05, longitude: 31.25 });
    assert.equal(otherType.type, 'break', 'a non-check_in type passes the pipe (the service treats it as check_out)');
    await pipeRejects(RecordPunchDto, { latitude: 30.05, longitude: 31.25 }, 'a missing type is rejected');
    await pipeRejects(RecordPunchDto, { type: 'check_in', longitude: 31.25 }, 'a missing latitude is rejected');
    await pipeRejects(
      RecordPunchDto,
      { type: 'check_in', latitude: 30.05, longitude: 31.25, extra: 1 },
      'an extra field is rejected',
    );
  }

  // 16. UpdateBranchGeofenceDto — caller: mobile-punch.api
  // updateBranchGeofence sends { latitude, longitude,
  // geofenceRadiusMeters? }.
  {
    const transformed = await pipeOk(UpdateBranchGeofenceDto, {
      latitude: 30.05,
      longitude: 31.25,
      geofenceRadiusMeters: 150,
    });
    assert.equal(transformed.geofenceRadiusMeters, 150, 'geofence radius survives the pipe');
    await pipeRejects(UpdateBranchGeofenceDto, { latitude: 30.05 }, 'a missing longitude is rejected');
    await pipeRejects(
      UpdateBranchGeofenceDto,
      { latitude: 30.05, longitude: 31.25, extra: 1 },
      'an extra field is rejected',
    );
  }

  // 17. SetEmployeePinDto — caller: mobile-punch.api setEmployeePin
  // sends { pinCode }.
  {
    const transformed = await pipeOk(SetEmployeePinDto, { pinCode: '9876' });
    assert.equal(transformed.pinCode, '9876', 'set-employee-PIN survives the pipe');
    await pipeRejects(SetEmployeePinDto, {}, 'a missing pinCode is rejected');
    await pipeRejects(SetEmployeePinDto, { pinCode: '9876', extra: 1 }, 'an extra field is rejected');
    const coerced = await pipeOk(SetEmployeePinDto, { pinCode: 1234 });
    assert.strictEqual(coerced.pinCode, '1234', 'a numeric pinCode coerces to the string "1234"');
  }

  // 18. UpdatePayrollPoliciesDto — caller: HrSettingsStaticSections
  // statutory save sends the FULL 31-field object (16 statutory +
  // 15 attendance/legacy fields); the attendance save spreads the
  // whole GET config + 3 fields. Every field is optional.
  {
    const transformed = await pipeOk(UpdatePayrollPoliciesDto, {
      workHoursPerDay: 8,
      latenessGracePeriodMinutes: 15,
      latenessPenaltyMultiplier: 0.25,
      absencePenaltyMultiplier: 1,
      overtimeMultiplier: 1.5,
      hrDelayPolicyEnabled: false,
      hrDelayPolicyFirstTimeDeduction: 0.25,
      hrDelayPolicySecondTimeDeduction: 0.5,
      hrDelayPolicyThirdTimeDeduction: 1,
      hrDelayPolicyFourthTimeDeduction: 1,
      hrCommissionType: 'none',
      hrCommissionValue: 0,
      hrCommissionTarget: 0,
      hrSocialInsuranceEnabled: false,
      hrSocialInsuranceEmployeePct: 0,
      hrIncomeTaxEnabled: false,
      taxPersonalExemption: 0,
      taxBrackets: [{ max: null, rate: 10 }],
      insuranceConfig: { employeePct: 11, employerPct: 18.75, minSalary: 0, maxSalary: 0 },
      statutoryCountry: 'EG',
      statutoryEffectiveFrom: '2020-01-01',
      statutoryEffectiveTo: '',
      statutoryLegalReference: 'internal',
      statutoryReviewed: true,
      insuranceWageBasis: 'earned_base',
      insuranceProratePartialEmployment: false,
      taxableEarningsBasis: 'gross_after_attendance_leave',
      taxDeductEmployeeInsurance: false,
      hrWeekendDays: 'friday,saturday',
      directAdvanceCashCap: 2000,
      directAdvanceCashCapByCurrency: { EGP: 2000 },
    });
    assert.equal(transformed.workHoursPerDay, 8, 'policies workHoursPerDay survives the pipe');
    assert.equal(
      transformed.hrWeekendDays,
      'friday,saturday',
      'hrWeekendDays survives as a comma string, not an array',
    );
    assert.equal(transformed.taxBrackets?.[0].rate, 10, 'a tax bracket survives the pipe');
    assert.equal(transformed.insuranceConfig?.employerPct, 18.75, 'insuranceConfig survives the pipe');
    const empty = await pipeOk(UpdatePayrollPoliciesDto, {});
    assert.equal(empty.statutoryCountry, undefined, 'an empty policies body passes — every field is optional');
    await pipeRejects(UpdatePayrollPoliciesDto, { workHoursPerDay: 8, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(
      UpdatePayrollPoliciesDto,
      { taxBrackets: [{ max: 1000 }] },
      'a tax bracket without rate is rejected',
    );
    const stringFalse = await pipeOk(UpdatePayrollPoliciesDto, { hrSocialInsuranceEnabled: 'false' });
    assert.equal(stringFalse.hrSocialInsuranceEnabled, true, 'the string "false" converts to boolean true');
  }

  // 19. Source pins: the controllers reference the DTO classes, and
  // the 3 biometric device-push sites still take `unknown`.
  {
    const biometric = readSrc('modules/hr/controllers/biometric-attendance.controller.ts');
    assert.ok(
      !biometric.includes('type UpsertBiometricDeviceDto'),
      'UpsertBiometricDeviceDto is a value import, not type-only',
    );
    assert.ok(
      !biometric.includes('type PreviewBiometricLogDto'),
      'PreviewBiometricLogDto is a value import, not type-only',
    );
    assert.ok(
      !biometric.includes('type ImportBiometricLogDto'),
      'ImportBiometricLogDto is a value import, not type-only',
    );
    assert.ok(biometric.includes('AssignEmployeeBiometricPinDto'), 'the PIN-assign handler takes the DTO class');
    assert.ok(biometric.includes('BulkCreateEmployeesDto'), 'the bulk-create handler takes the DTO class');
    const webhookUnknowns = (biometric.match(/@Body\(\) body: unknown/g) || []).length;
    assert.equal(webhookUnknowns, 3, 'the 3 device-push sites still take unknown (pinned exclusions)');
    const eos = readSrc('modules/hr/controllers/end-of-service.controller.ts');
    assert.ok(eos.includes('PostSettlementAccountingDto'), 'the post-accounting handler takes the DTO class');
    const portal = readSrc('modules/hr/employee-portal.controller.ts');
    assert.ok(portal.includes('EmployeePortalLoginDto'), 'the portal login handler takes the DTO class');
    assert.ok(portal.includes('RequestAdvanceDto'), 'the portal advance handler takes the DTO class');
    const mobile = readSrc('modules/hr/mobile-attendance.controller.ts');
    assert.ok(mobile.includes('RecordPunchDto'), 'the record-punch handler takes the DTO class');
    assert.ok(mobile.includes('SetEmployeePinDto'), 'the set-employee-PIN handler takes the DTO class');
    const hr = readSrc('modules/hr/hr.controller.ts');
    assert.ok(hr.includes('UpdatePayrollPoliciesDto'), 'the payroll-policies handler takes the DTO class');
    console.log('  source pins passed');
  }

  console.log('DTO HR tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
