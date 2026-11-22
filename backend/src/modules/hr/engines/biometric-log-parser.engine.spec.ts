import * as assert from 'node:assert/strict';
import {
  parseAndAggregateBiometricLog,
  buildBiometricEmployeeResolver,
  parseZkUserDatBuffer,
  extractNumericPinCore,
  decodeZkPackedTimestamp,
  makeZkCommKeyPayload,
  buildZkUdpPacket,
} from './biometric-log-parser.engine';

// 1. Test ZKTeco attlog.dat parsing with accidental double-tap debounce & First-In / Last-Out
{
  const rawAttlog = [
    ' 4645\t2026-11-21 08:58:10\t1\t0\t1\t0',
    ' 4645\t2026-11-21 08:58:16\t1\t0\t1\t0', // Double-tap 6 seconds later -> must be debounced!
    ' 4645\t2026-11-21 17:04:22\t1\t1\t1\t0', // Check-out punch
    ' 4621\t2026-11-21 09:12:00\t1\t0\t1\t0', // Single punch only -> checkInAt set, checkOutAt null
  ].join('\r\n');

  const summary = parseAndAggregateBiometricLog(rawAttlog, { debounceMinutes: 3, minSessionMinutes: 10 });
  assert.equal(summary.detectedFormat, 'zkteco_dat');
  assert.equal(summary.totalRawPunches, 4);
  assert.equal(summary.totalDeduplicatedTaps, 1);
  assert.equal(summary.dailyRecords.length, 2);

  const rec4645 = summary.dailyRecords.find((r) => r.pin === '4645');
  assert.ok(rec4645);
  assert.equal(rec4645.workDate, '2026-11-21');
  assert.equal(rec4645.checkInTime, '08:58:10');
  assert.equal(rec4645.checkOutTime, '17:04:22');
  assert.equal(rec4645.rawPunchCount, 3);
  assert.equal(rec4645.effectivePunchCount, 2);

  const rec4621 = summary.dailyRecords.find((r) => r.pin === '4621');
  assert.ok(rec4621);
  assert.equal(rec4621.checkInTime, '09:12:00');
  assert.equal(rec4621.checkOutTime, null);
}

// 2. Test Hikvision / Generic CSV single-punch & pre-paired format
{
  const csvPaired = [
    'كود الموظف,التاريخ,وقت الحضور,وقت الانصراف',
    '101,2026-11-20,09:00,17:30',
    '102,2026-11-20,08:45,16:50',
  ].join('\n');

  const summary = parseAndAggregateBiometricLog(csvPaired);
  assert.equal(summary.detectedFormat, 'paired_table');
  assert.equal(summary.dailyRecords.length, 2);
  assert.equal(summary.dailyRecords[0].checkInTime, '09:00:00');
  assert.equal(summary.dailyRecords[0].checkOutTime, '17:30:00');
}

// 3. Test Smart Employee PIN Resolver (biometric_pin -> exact employee_no -> numeric core)
{
  const resolver = buildBiometricEmployeeResolver([
    { id: 1, employeeNo: 'EMP-0001', biometricPin: '99999', displayName: 'أحمد' },
    { id: 2, employeeNo: 'EMP-04645', biometricPin: null, displayName: 'محمود' },
    { id: 3, employeeNo: '105', biometricPin: null, displayName: 'سارة' },
  ]);

  // Exact biometric_pin match
  const m1 = resolver('99999');
  assert.ok(m1);
  assert.equal(m1.employee.id, 1);
  assert.equal(m1.matchedBy, 'biometric_pin');

  // Numeric core match: "4645" matches "EMP-04645"
  const m2 = resolver('4645');
  assert.ok(m2);
  assert.equal(m2.employee.id, 2);
  assert.equal(m2.matchedBy, 'numeric_core');

  // Exact employee_no match
  const m3 = resolver('105');
  assert.ok(m3);
  assert.equal(m3.employee.id, 3);
  assert.equal(m3.matchedBy, 'exact_employee_no');

  assert.equal(extractNumericPinCore('EMP-0045'), '45');
}

// 4. Test ZKTeco 72-byte user.dat binary parser
{
  const buf = new Uint8Array(72);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 1, true); // uid = 1
  buf[2] = 14; // privilege = 14 (Super Admin)
  const enc = new TextEncoder();
  buf.set(enc.encode('23118600'), 3); // password
  buf.set(enc.encode('AdminUser'), 11); // name
  buf.set(enc.encode('99999'), 48); // userId

  const users = parseZkUserDatBuffer(buf);
  assert.equal(users.length, 1);
  assert.equal(users[0].uid, 1);
  assert.equal(users[0].userId, '99999');
  assert.equal(users[0].password, '23118600');
  assert.equal(users[0].privilegeRole, 'super_admin');
}

// 5. Test ZKTeco Packed Timestamp Decoder & UDP Packet Builder
{
  // Formula: ((year-2000)*12*31 + (month-1)*31 + (day-1)) * 86400 + hour*3600 + min*60 + sec
  // 2026-11-21 09:30:15
  const packed = ((26 * 12 * 31) + (10 * 31) + 20) * 86400 + 9 * 3600 + 30 * 60 + 15;
  assert.equal(decodeZkPackedTimestamp(packed), '2026-11-21 09:30:15');

  const commKeyBuf = makeZkCommKeyPayload(0, 59166);
  assert.equal(commKeyBuf.length, 4);

  const connectPkt = buildZkUdpPacket(1000, 0, 65534);
  assert.equal(connectPkt.length, 8);
  assert.equal(connectPkt.readUInt16LE(0), 1000);
}

// 6. Test Content-Based Auto-Detection on Reversed / Arbitrary Column Orders (Headerless & Multi-Column Excel/CSV)
{
  // Case A: Headerless file where DateTime is in Column 0, Machine ID is in Column 1, and Employee PIN is in Column 2
  const reversedHeaderless = [
    '2026-11-21 08:45:00\tMACHINE_A\t4645',
    '2026-11-21 17:15:00\tMACHINE_A\t4645',
  ].join('\n');

  const summaryA = parseAndAggregateBiometricLog(reversedHeaderless, {
    knownEmployeePins: new Set(['4645']),
  });
  assert.equal(summaryA.appliedColumnMapping.dateTimeColIndex, 0);
  assert.equal(summaryA.appliedColumnMapping.pinColIndex, 2);
  assert.equal(summaryA.dailyRecords.length, 1);
  assert.equal(summaryA.dailyRecords[0].pin, '4645');
  assert.equal(summaryA.dailyRecords[0].checkInTime, '08:45:00');
  assert.equal(summaryA.dailyRecords[0].checkOutTime, '17:15:00');

  // Case B: 6-Column Foreign Device Excel/CSV (Department, Employee Name, AC-No., Date, Clock In, Clock Out)
  const foreignExcelTsv = [
    'Department\tEmployee Name\tAC-No.\tDate\tClock In\tClock Out',
    'Sales\tMahmoud Ali\t105\t21/11/2026\t09:05\t17:20',
    'Sales\tAhmed Hassan\t108\t21/11/2026\t08:50\t17:00',
  ].join('\n');

  const summaryB = parseAndAggregateBiometricLog(foreignExcelTsv);
  assert.equal(summaryB.appliedColumnMapping.hasHeaderRow, true);
  assert.equal(summaryB.appliedColumnMapping.pinColIndex, 2);
  assert.equal(summaryB.appliedColumnMapping.dateColIndex, 3);
  assert.equal(summaryB.appliedColumnMapping.checkInTimeColIndex, 4);
  assert.equal(summaryB.appliedColumnMapping.checkOutTimeColIndex, 5);
  assert.equal(summaryB.dailyRecords.length, 2);
  assert.equal(summaryB.dailyRecords[0].pin, '105');
  assert.equal(summaryB.dailyRecords[0].workDate, '2026-11-21');
  assert.equal(summaryB.dailyRecords[0].checkInTime, '09:05:00');
  assert.equal(summaryB.dailyRecords[0].checkOutTime, '17:20:00');

  // Case C: Explicit User Column Mapping Override from UI
  const customOverrideSummary = parseAndAggregateBiometricLog(
    [
      '999\t4645\t2026-11-21 09:00:00',
      '999\t4645\t2026-11-21 17:00:00',
    ].join('\n'),
    {
      columnMapping: {
        hasHeaderRow: false,
        pinColIndex: 1,
        dateTimeColIndex: 2,
      },
    },
  );
  assert.equal(customOverrideSummary.dailyRecords.length, 1);
  assert.equal(customOverrideSummary.dailyRecords[0].pin, '4645');
  assert.equal(customOverrideSummary.dailyRecords[0].checkInTime, '09:00:00');
  assert.equal(customOverrideSummary.dailyRecords[0].checkOutTime, '17:00:00');

  // Case D: Converted attendance_logs.csv format (Arabic+English headers & combined Date Time)
  const convertedCsv = [
    'كود الموظف (User ID),التاريخ والوقت (Date Time),طريقة التحقق,الحالة,الرمز',
    '4645,2020-07-26 10:26:49,بصمة إصبع (Fingerprint),تسجيل حضور (Check-In),1',
    '4645,2020-07-26 10:26:55,بصمة إصبع (Fingerprint),تسجيل حضور (Check-In),1',
    '4645,2020-07-26 17:40:10,بصمة إصبع (Fingerprint),تسجيل انصراف (Check-Out),1',
  ].join('\n');

  const summaryD = parseAndAggregateBiometricLog(convertedCsv, {
    // Regression test: tenant has employee 001 (core "1"), while column 4 ("الرمز") is constant "1" on all rows!
    // Must ALWAYS pick column 0 ("كود الموظف (User ID)"), never column 4 ("الرمز").
    knownEmployeePins: new Set(['001', '1']),
  });
  assert.equal(summaryD.appliedColumnMapping.hasHeaderRow, true);
  assert.equal(summaryD.appliedColumnMapping.pinColIndex, 0);
  assert.equal(summaryD.appliedColumnMapping.dateTimeColIndex, 1);
  assert.equal(summaryD.dailyRecords.length, 1);
  assert.equal(summaryD.dailyRecords[0].pin, '4645');
  assert.equal(summaryD.dailyRecords[0].workDate, '2020-07-26');
  assert.equal(summaryD.dailyRecords[0].checkInTime, '10:26:49');
  assert.equal(summaryD.dailyRecords[0].checkOutTime, '17:40:10');
  assert.equal(summaryD.totalDeduplicatedTaps, 1);
}

console.log('biometric-log-parser.engine.spec: all cases passed');
