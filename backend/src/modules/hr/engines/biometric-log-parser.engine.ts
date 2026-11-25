/**
 * Pure Biometric Log Parser, Content-Based Heuristic Column Detector,
 * Daily Punch Aggregator, User.dat Decoder & PIN Matcher Engine.
 *
 * Supports:
 * 1. ZKTeco / Realand / ZK-OEM raw attendance logs (.dat, _attlog.dat, .txt, ADMS push lines)
 * 2. Hikvision / Dahua / Anviz / Generic CSV, TSV & Excel logs in ANY column order (with or without headers)
 * 3. Content-Based Heuristic Auto-Detection + Interactive User Column Mapping Override
 * 4. ZKTeco 72-byte binary user.dat file decoding (extracts PIN, Name, Privilege, Password)
 * 5. Smart Daily Punch Pairing (First-In / Last-Out) with accidental double-tap debounce
 * 6. Flexible Employee PIN Resolution (biometric_pin -> exact employee_no -> numeric core)
 */

export type BiometricPunchDirection = 'in' | 'out' | 'break_out' | 'break_in' | 'ot_in' | 'ot_out' | 'auto';

export type BiometricVerifyMethod = 'password' | 'fingerprint' | 'card' | 'face' | 'other';

export interface DetectedBiometricColumn {
  index: number;
  headerLabel: string;
  sampleValue: string;
}

export interface BiometricColumnMapping {
  pinColIndex?: number | null;
  dateTimeColIndex?: number | null;
  dateColIndex?: number | null;
  checkInTimeColIndex?: number | null;
  checkOutTimeColIndex?: number | null;
  directionColIndex?: number | null;
  hasHeaderRow?: boolean | null;
}

export interface ParsedRawBiometricPunch {
  pin: string;
  workDate: string; // YYYY-MM-DD
  timeText: string; // HH:MM:SS
  isoTimestamp: string; // YYYY-MM-DDTHH:MM:SS
  verifyMethod: BiometricVerifyMethod;
  direction: BiometricPunchDirection;
  rawLineNumber: number;
}

export interface AggregatedBiometricDailyRecord {
  pin: string;
  workDate: string; // YYYY-MM-DD
  checkInTime: string | null; // HH:MM:SS
  checkOutTime: string | null; // HH:MM:SS
  checkInAt: string | null; // ISO or YYYY-MM-DDTHH:MM:SS
  checkOutAt: string | null; // ISO or YYYY-MM-DDTHH:MM:SS
  rawPunchCount: number;
  effectivePunchCount: number;
  deduplicatedCount: number;
  allPunchTimes: string[];
  detectedFormat: 'zkteco_dat' | 'single_punch_csv' | 'paired_table';
}

export interface BiometricParseSummary {
  detectedFormat: 'zkteco_dat' | 'single_punch_csv' | 'paired_table' | 'empty';
  totalLinesRead: number;
  totalRawPunches: number;
  totalDeduplicatedTaps: number;
  dailyRecords: AggregatedBiometricDailyRecord[];
  uniquePins: string[];
  minDate: string | null;
  maxDate: string | null;
  parseWarnings: string[];
  detectedColumns: DetectedBiometricColumn[];
  appliedColumnMapping: BiometricColumnMapping;
}

export interface DecodedZkDeviceUser {
  uid: number;
  userId: string;
  name: string;
  privilegeCode: number;
  privilegeRole: 'super_admin' | 'admin' | 'enroller' | 'usb_manager' | 'user';
  privilegeLabelAr: string;
  password: string;
  cardNumber: number;
}

export interface EmployeeBiometricCandidate {
  id: number;
  employeeNo: string;
  biometricPin?: string | null;
  displayName?: string | null;
  status?: string | null;
}

export interface ResolvedEmployeeMatch {
  employee: EmployeeBiometricCandidate;
  matchedBy: 'biometric_pin' | 'exact_employee_no' | 'numeric_core';
}

function normalizeArabicDigits(input: string): string {
  return String(input || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeBiometricDate(rawDate: string): string | null {
  const cleaned = normalizeArabicDigits(rawDate).trim();
  if (!cleaned) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const first = Number(dmyMatch[1]);
    const second = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    const d = first <= 31 && second <= 12 ? first : second;
    const m = first <= 31 && second <= 12 ? second : first;
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

export function normalizeBiometricTime(rawTime: string): string | null {
  const cleaned = normalizeArabicDigits(rawTime).trim();
  if (!cleaned) return null;

  const amPmMatch = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|ص|م)?$/i);
  if (!amPmMatch) return null;

  let hours = Number(amPmMatch[1]);
  const minutes = Number(amPmMatch[2]);
  const seconds = amPmMatch[3] !== undefined ? Number(amPmMatch[3]) : 0;
  const meridiem = (amPmMatch[4] || '').toUpperCase();

  if (meridiem === 'PM' || meridiem === 'م') {
    if (hours < 12) hours += 12;
  } else if (meridiem === 'AM' || meridiem === 'ص') {
    if (hours === 12) hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function splitDateTimeToken(token: string): { workDate: string; timeText: string } | null {
  const cleaned = normalizeArabicDigits(token).trim().replace('T', ' ');
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  const workDate = normalizeBiometricDate(parts[0]);
  const timeText = normalizeBiometricTime(parts.slice(1).join(' '));
  if (!workDate || !timeText) return null;
  return { workDate, timeText };
}

function mapZkVerifyMethod(code: string): BiometricVerifyMethod {
  const trimmed = String(code || '').trim();
  if (trimmed === '0') return 'password';
  if (trimmed === '1') return 'fingerprint';
  if (trimmed === '2') return 'card';
  if (trimmed === '15') return 'face';
  return 'other';
}

function mapPunchDirection(code: string): BiometricPunchDirection {
  const trimmed = String(code || '')
    .trim()
    .toLowerCase();
  if (
    trimmed === '0' ||
    trimmed === 'in' ||
    trimmed === 'c/in' ||
    trimmed === 'check_in' ||
    trimmed === 'checkin' ||
    trimmed === 'check-in' ||
    trimmed.includes('check-in') ||
    trimmed.includes('check_in') ||
    trimmed.includes('حضور') ||
    trimmed.includes('دخول')
  ) {
    return 'in';
  }
  if (
    trimmed === '1' ||
    trimmed === 'out' ||
    trimmed === 'c/out' ||
    trimmed === 'check_out' ||
    trimmed === 'checkout' ||
    trimmed === 'check-out' ||
    trimmed.includes('check-out') ||
    trimmed.includes('check_out') ||
    trimmed.includes('انصراف') ||
    trimmed.includes('خروج')
  ) {
    return 'out';
  }
  if (trimmed === '2') return 'break_out';
  if (trimmed === '3') return 'break_in';
  if (trimmed === '4') return 'ot_in';
  if (trimmed === '5') return 'ot_out';
  return 'auto';
}

function timeTextToSeconds(timeText: string): number {
  const [h, m, s] = timeText.split(':').map((n) => Number(n) || 0);
  return h * 3600 + m * 60 + s;
}

/**
 * Splits a raw line into cells, preserving combined "YYYY-MM-DD HH:MM:SS" tokens even in space-separated ZKTeco lines.
 */
export function tokenizeBiometricRow(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  if (line.includes(';')) {
    return line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  if (line.includes(',')) {
    // Respect CSV quotes
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    values.push(current.trim());
    return values;
  }

  // Space-separated fallback (e.g. ZKTeco attlog line where tabs were converted to spaces):
  // Merge adjacent <Date> <Time> tokens into one combined DateTime cell so column indices stay consistent
  const rawTokens = line.trim().split(/\s+/);
  const merged: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const cur = rawTokens[i];
    const next = rawTokens[i + 1];
    if (next && normalizeBiometricDate(cur) && normalizeBiometricTime(next)) {
      merged.push(`${cur} ${next}`);
      i++;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/**
 * Heuristically detects column roles from headers + first 25 data rows.
 */
export function autoDetectBiometricColumns(
  sampleRows: string[][],
  knownEmployeePins?: Set<string>,
  override?: BiometricColumnMapping,
): {
  detectedColumns: DetectedBiometricColumn[];
  mapping: BiometricColumnMapping;
} {
  if (sampleRows.length === 0) {
    return {
      detectedColumns: [],
      mapping: { hasHeaderRow: false },
    };
  }

  const firstRow = sampleRows[0];
  const firstRowJoined = firstRow.join(' ').toLowerCase();

  const headerKeywordRegex =
    /(كود|الموظف|رقم البصم|الاسم|التاريخ|وقت|الحضور|الانصراف|الحال|القسم|employeeno|employee|ac-no|acno|enno|pin|badge|person|userid|user id|date|time|clock|punch|status|state|verify|department|name)/i;

  const firstRowHasDateOrTime = firstRow.some(
    (cell) =>
      splitDateTimeToken(cell) !== null ||
      normalizeBiometricDate(cell) !== null ||
      normalizeBiometricTime(cell) !== null,
  );
  const secondRowHasDateOrTime =
    sampleRows.length > 1 &&
    sampleRows[1].some(
      (cell) =>
        splitDateTimeToken(cell) !== null ||
        normalizeBiometricDate(cell) !== null ||
        normalizeBiometricTime(cell) !== null,
    );

  const hasHeaderRow =
    override?.hasHeaderRow !== undefined && override?.hasHeaderRow !== null
      ? override.hasHeaderRow
      : headerKeywordRegex.test(firstRowJoined) || (!firstRowHasDateOrTime && secondRowHasDateOrTime);

  const dataRows = hasHeaderRow ? sampleRows.slice(1, 26) : sampleRows.slice(0, 25);
  const maxCols = Math.max(...sampleRows.slice(0, 26).map((r) => r.length), 0);

  const detectedColumns: DetectedBiometricColumn[] = [];
  for (let c = 0; c < maxCols; c++) {
    const rawHeader = hasHeaderRow ? (firstRow[c] || '').trim() : '';
    const sampleCell = dataRows.map((r) => (r[c] || '').trim()).find((val) => val.length > 0) || '';
    detectedColumns.push({
      index: c,
      headerLabel: rawHeader || `العمود ${c + 1}`,
      sampleValue: sampleCell,
    });
  }

  if (dataRows.length === 0) {
    return {
      detectedColumns,
      mapping: { hasHeaderRow },
    };
  }

  // Score each column for DateTime, DateOnly, TimeOnly
  let bestDateTimeCol: number | null = null;
  let bestDateTimeScore = 0;

  let bestDateOnlyCol: number | null = null;
  let bestDateOnlyScore = 0;

  const timeColCandidates: Array<{ col: number; score: number; header: string }> = [];

  for (let c = 0; c < maxCols; c++) {
    const hLower = (hasHeaderRow ? firstRow[c] || '' : '').toLowerCase();
    let dtHits = 0;
    let dHits = 0;
    let tHits = 0;

    for (const row of dataRows) {
      const val = (row[c] || '').trim();
      if (!val) continue;
      if (splitDateTimeToken(val)) dtHits++;
      else if (normalizeBiometricDate(val)) dHits++;
      else if (normalizeBiometricTime(val)) tHits++;
    }

    if (dtHits > bestDateTimeScore) {
      bestDateTimeScore = dtHits;
      bestDateTimeCol = c;
    }
    if (dHits > bestDateOnlyScore) {
      bestDateOnlyScore = dHits;
      bestDateOnlyCol = c;
    }
    if (tHits > 0) {
      timeColCandidates.push({ col: c, score: tHits, header: hLower });
    }
  }

  let dateTimeColIndex: number | null = null;
  let dateColIndex: number | null = null;
  let checkInTimeColIndex: number | null = null;
  let checkOutTimeColIndex: number | null = null;

  if (bestDateTimeScore >= bestDateOnlyScore && bestDateTimeScore > 0) {
    dateTimeColIndex = bestDateTimeCol;
  } else if (bestDateOnlyScore > 0) {
    dateColIndex = bestDateOnlyCol;
    if (timeColCandidates.length === 1) {
      checkInTimeColIndex = timeColCandidates[0].col;
    } else if (timeColCandidates.length >= 2) {
      const explicitIn = timeColCandidates.find((tc) =>
        /(حضور|دخول|check.?in|clock.?in|in.?time|start)/i.test(tc.header),
      );
      const explicitOut = timeColCandidates.find((tc) =>
        /(انصراف|خروج|check.?out|clock.?out|out.?time|end)/i.test(tc.header),
      );
      if (explicitIn && explicitOut && explicitIn.col !== explicitOut.col) {
        checkInTimeColIndex = explicitIn.col;
        checkOutTimeColIndex = explicitOut.col;
      } else {
        checkInTimeColIndex = timeColCandidates[0].col;
        checkOutTimeColIndex = timeColCandidates[1].col;
      }
    }
  }

  // Apply date/time overrides first so PIN detection doesn't collide with them
  if (override?.dateTimeColIndex !== undefined && override.dateTimeColIndex !== null) {
    dateTimeColIndex = override.dateTimeColIndex >= 0 ? override.dateTimeColIndex : null;
  }
  if (override?.dateColIndex !== undefined && override.dateColIndex !== null) {
    dateColIndex = override.dateColIndex >= 0 ? override.dateColIndex : null;
  }
  if (override?.checkInTimeColIndex !== undefined && override.checkInTimeColIndex !== null) {
    checkInTimeColIndex = override.checkInTimeColIndex >= 0 ? override.checkInTimeColIndex : null;
  }
  if (override?.checkOutTimeColIndex !== undefined && override.checkOutTimeColIndex !== null) {
    checkOutTimeColIndex = override.checkOutTimeColIndex >= 0 ? override.checkOutTimeColIndex : null;
  }

  const usedTemporalCols = new Set(
    [dateTimeColIndex, dateColIndex, checkInTimeColIndex, checkOutTimeColIndex].filter(
      (idx): idx is number => idx !== null && idx !== undefined,
    ),
  );

  // Detect Employee PIN column
  let pinColIndex: number | null = null;
  if (override?.pinColIndex !== undefined && override.pinColIndex !== null && override.pinColIndex >= 0) {
    pinColIndex = override.pinColIndex;
  } else {
    let bestPinScore = -1;
    for (let c = 0; c < maxCols; c++) {
      if (usedTemporalCols.has(c)) continue;
      const hLower = (hasHeaderRow ? firstRow[c] || '' : '').toLowerCase().trim();

      // Exclude columns that are clearly non-employee metadata, verify/status flags, or work codes
      if (
        /(اسم الموظف|الاسم|القسم|الفرع|طريقة التحقق|التحقق|الحال|الرمز|نوع الحرك|employee.?name|full.?name|dept|department|verify|work.?code|machine|device|status|state|direction)/i.test(
          hLower,
        )
      ) {
        continue;
      }

      let score = 0;
      const hasExplicitPinHeader =
        /(كود الموظف|رقم البصم|رقم الموظف|الكود|ac-no|acno|enno|empno|employeeno|employee.?id|person.?id|user.?id|badge|pin|^id$|^code$|^no\.?$)/i.test(
          hLower,
        );
      if (hasExplicitPinHeader) {
        score += 500;
      }

      const distinctVals = new Set<string>();
      const distinctDbMatchedPins = new Set<string>();
      let validCodeCount = 0;

      for (const row of dataRows) {
        const rawVal = normalizeArabicDigits(row[c] || '').trim();
        if (!rawVal) continue;
        distinctVals.add(rawVal);

        if (knownEmployeePins && knownEmployeePins.size > 0) {
          const core = extractNumericPinCore(rawVal);
          if (knownEmployeePins.has(rawVal.toLowerCase()) || (core && knownEmployeePins.has(core))) {
            distinctDbMatchedPins.add(core || rawVal.toLowerCase());
          }
        }

        // Valid identifier: 1..20 chars, contains at least one digit, not a multi-word sentence
        if (/^[A-Za-z0-9_-]{1,20}$/.test(rawVal) && /\d/.test(rawVal)) {
          validCodeCount++;
        }
      }

      // Guard against constant flag/workcode columns (e.g. "1" repeated on every single row)
      const isConstantFlagColumn =
        distinctVals.size === 1 && dataRows.length >= 3 && /^[0-5]$/.test(Array.from(distinctVals)[0] || '');

      if (isConstantFlagColumn && !hasExplicitPinHeader) {
        score -= 200;
      } else if (distinctVals.size > 1 || dataRows.length <= 2) {
        score += distinctDbMatchedPins.size * 60;
      }

      score += validCodeCount * 2;
      if (distinctVals.size > 1) score += 25;
      if (c === 0) score += 10; // Tie-breaker favors first column (standard ZKTeco attlog.dat)

      if (score > bestPinScore && validCodeCount > 0) {
        bestPinScore = score;
        pinColIndex = c;
      }
    }
  }

  // Detect Direction (In/Out) column for single-punch logs
  let directionColIndex: number | null = null;
  if (override?.directionColIndex !== undefined && override.directionColIndex !== null) {
    directionColIndex = override.directionColIndex >= 0 ? override.directionColIndex : null;
  } else if (checkOutTimeColIndex === null) {
    let bestDirScore = 0;
    for (let c = 0; c < maxCols; c++) {
      if (usedTemporalCols.has(c) || c === pinColIndex) continue;
      const hLower = (hasHeaderRow ? firstRow[c] || '' : '').toLowerCase().trim();
      let score = 0;
      if (/(الحال|نوع الحرك|state|status|direction|check.?type|in\/out|punch.?state)/i.test(hLower)) {
        score += 60;
      }
      let dirTokenHits = 0;
      for (const row of dataRows) {
        const val = (row[c] || '').trim().toLowerCase();
        if (
          [
            'in',
            'out',
            'c/in',
            'c/out',
            'check_in',
            'check_out',
            'checkin',
            'checkout',
            'حضور',
            'انصراف',
            'دخول',
            'خروج',
          ].includes(val)
        ) {
          dirTokenHits += 4;
        } else if (['0', '1', '2', '3', '4', '5'].includes(val) && c >= 2) {
          // In ZKTeco attlog.dat: col0=PIN, col1=DateTime, col2=Verify(1), col3=Status(0/1)
          dirTokenHits += c === 3 ? 2 : 1;
        }
      }
      score += dirTokenHits;
      if (score > bestDirScore) {
        bestDirScore = score;
        directionColIndex = c;
      }
    }
  }

  return {
    detectedColumns,
    mapping: {
      pinColIndex,
      dateTimeColIndex,
      dateColIndex,
      checkInTimeColIndex,
      checkOutTimeColIndex,
      directionColIndex,
      hasHeaderRow,
    },
  };
}

/**
 * Parses and aggregates any biometric log text:
 * - ZKTeco attlog.dat / .dat / .txt
 * - Hikvision / Dahua / Anviz CSV & Excel logs in any column order
 * - Pre-paired attendance tables in any column order
 */
export function parseAndAggregateBiometricLog(
  rawText: string,
  options?: {
    debounceMinutes?: number;
    minSessionMinutes?: number;
    columnMapping?: BiometricColumnMapping;
    knownEmployeePins?: Set<string>;
  },
): BiometricParseSummary {
  const debounceSeconds = Math.max(0, (options?.debounceMinutes ?? 3) * 60);
  const minSessionSeconds = Math.max(60, (options?.minSessionMinutes ?? 10) * 60);

  const cleanContent = String(rawText || '').replace(/^\ufeff/, '');
  const rawLines = cleanContent.split(/\r?\n/);

  const nonEmptyLines = rawLines
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line.length > 0);

  if (nonEmptyLines.length === 0) {
    return {
      detectedFormat: 'empty',
      totalLinesRead: 0,
      totalRawPunches: 0,
      totalDeduplicatedTaps: 0,
      dailyRecords: [],
      uniquePins: [],
      minDate: null,
      maxDate: null,
      parseWarnings: [],
      detectedColumns: [],
      appliedColumnMapping: { hasHeaderRow: false },
    };
  }

  const tokenizedRows = nonEmptyLines.map((entry) => ({
    cells: tokenizeBiometricRow(entry.line),
    lineNumber: entry.lineNumber,
    rawLine: entry.line,
  }));

  const { detectedColumns, mapping } = autoDetectBiometricColumns(
    tokenizedRows.slice(0, 30).map((r) => r.cells),
    options?.knownEmployeePins,
    options?.columnMapping,
  );

  const rawPunches: ParsedRawBiometricPunch[] = [];
  const prePairedRecords: AggregatedBiometricDailyRecord[] = [];
  const parseWarnings: string[] = [];

  let detectedFormat: BiometricParseSummary['detectedFormat'] = 'empty';
  const startRowIdx = mapping.hasHeaderRow ? 1 : 0;
  const totalLinesRead = tokenizedRows.length;

  const isStandardZkHeaderless =
    !mapping.hasHeaderRow &&
    mapping.pinColIndex === 0 &&
    mapping.dateTimeColIndex === 1 &&
    nonEmptyLines[0].line.includes('\t');

  for (let i = startRowIdx; i < tokenizedRows.length; i++) {
    const { cells, lineNumber, rawLine } = tokenizedRows[i];
    const pinIdx = mapping.pinColIndex ?? 0;
    const pin = normalizeArabicDigits(cells[pinIdx] || '').trim();
    if (!pin) continue;

    // Mode A: Combined DateTime column (single punch per row)
    if (mapping.dateTimeColIndex !== null && mapping.dateTimeColIndex !== undefined) {
      const dtCell = cells[mapping.dateTimeColIndex] || '';
      const combinedDt = splitDateTimeToken(dtCell);
      if (combinedDt) {
        if (detectedFormat === 'empty') {
          detectedFormat = isStandardZkHeaderless ? 'zkteco_dat' : 'single_punch_csv';
        }
        const dirVal =
          mapping.directionColIndex !== null && mapping.directionColIndex !== undefined
            ? cells[mapping.directionColIndex] || ''
            : '';
        rawPunches.push({
          pin,
          workDate: combinedDt.workDate,
          timeText: combinedDt.timeText,
          isoTimestamp: `${combinedDt.workDate}T${combinedDt.timeText}`,
          verifyMethod: 'fingerprint',
          direction: mapPunchDirection(dirVal),
          rawLineNumber: lineNumber,
        });
        continue;
      }
    }

    // Mode B: Separate Date column + Time column(s)
    if (mapping.dateColIndex !== null && mapping.dateColIndex !== undefined) {
      const workDate = normalizeBiometricDate(cells[mapping.dateColIndex] || '');
      if (workDate) {
        const timeIn =
          mapping.checkInTimeColIndex !== null && mapping.checkInTimeColIndex !== undefined
            ? normalizeBiometricTime(cells[mapping.checkInTimeColIndex] || '')
            : null;
        const timeOut =
          mapping.checkOutTimeColIndex !== null && mapping.checkOutTimeColIndex !== undefined
            ? normalizeBiometricTime(cells[mapping.checkOutTimeColIndex] || '')
            : null;

        // If both check-in and check-out columns are mapped (or checkOutTimeColIndex is set), treat as pre-paired row
        if (
          mapping.checkOutTimeColIndex !== null &&
          mapping.checkOutTimeColIndex !== undefined &&
          (timeIn || timeOut)
        ) {
          if (detectedFormat === 'empty') detectedFormat = 'paired_table';
          prePairedRecords.push({
            pin,
            workDate,
            checkInTime: timeIn,
            checkOutTime: timeOut,
            checkInAt: timeIn ? `${workDate}T${timeIn}` : null,
            checkOutAt: timeOut ? `${workDate}T${timeOut}` : null,
            rawPunchCount: (timeIn ? 1 : 0) + (timeOut ? 1 : 0),
            effectivePunchCount: (timeIn ? 1 : 0) + (timeOut ? 1 : 0),
            deduplicatedCount: 0,
            allPunchTimes: [timeIn, timeOut].filter((t): t is string => Boolean(t)),
            detectedFormat: 'paired_table',
          });
          continue;
        }

        // Single time column (single punch per row with separate Date and Time columns)
        if (timeIn) {
          if (detectedFormat === 'empty') detectedFormat = 'single_punch_csv';
          const dirVal =
            mapping.directionColIndex !== null && mapping.directionColIndex !== undefined
              ? cells[mapping.directionColIndex] || ''
              : '';
          rawPunches.push({
            pin,
            workDate,
            timeText: timeIn,
            isoTimestamp: `${workDate}T${timeIn}`,
            verifyMethod: 'fingerprint',
            direction: mapPunchDirection(dirVal),
            rawLineNumber: lineNumber,
          });
          continue;
        }
      }
    }

    if (parseWarnings.length < 20) {
      parseWarnings.push(`تعذر تحليل السطر رقم ${lineNumber}: ${rawLine.slice(0, 60)}`);
    }
  }

  // Group raw punches by (pin, workDate)
  const grouped = new Map<string, ParsedRawBiometricPunch[]>();
  for (const punch of rawPunches) {
    const key = `${punch.pin}__${punch.workDate}`;
    const list = grouped.get(key);
    if (list) {
      list.push(punch);
    } else {
      grouped.set(key, [punch]);
    }
  }

  let totalDeduplicatedTaps = 0;
  const aggregatedFromPunches: AggregatedBiometricDailyRecord[] = [];

  for (const [, groupPunches] of grouped) {
    groupPunches.sort((a, b) => a.timeText.localeCompare(b.timeText));
    const pin = groupPunches[0].pin;
    const workDate = groupPunches[0].workDate;

    const effectivePunches: ParsedRawBiometricPunch[] = [];
    for (const p of groupPunches) {
      if (effectivePunches.length === 0) {
        effectivePunches.push(p);
        continue;
      }
      const prev = effectivePunches[effectivePunches.length - 1];
      const deltaSec = Math.abs(timeTextToSeconds(p.timeText) - timeTextToSeconds(prev.timeText));
      if (deltaSec <= debounceSeconds) {
        totalDeduplicatedTaps++;
        continue;
      }
      effectivePunches.push(p);
    }

    let checkInTime: string | null = null;
    let checkOutTime: string | null = null;

    if (effectivePunches.length === 1) {
      const only = effectivePunches[0];
      checkInTime = only.timeText;
      checkOutTime = null;
    } else if (effectivePunches.length >= 2) {
      const first = effectivePunches[0];
      const last = effectivePunches[effectivePunches.length - 1];
      const sessionSpanSec = timeTextToSeconds(last.timeText) - timeTextToSeconds(first.timeText);

      checkInTime = first.timeText;
      if (sessionSpanSec >= minSessionSeconds || last.direction === 'out' || last.direction === 'ot_out') {
        checkOutTime = last.timeText;
      } else {
        checkOutTime = null;
        totalDeduplicatedTaps++;
      }
    }

    aggregatedFromPunches.push({
      pin,
      workDate,
      checkInTime,
      checkOutTime,
      checkInAt: checkInTime ? `${workDate}T${checkInTime}` : null,
      checkOutAt: checkOutTime ? `${workDate}T${checkOutTime}` : null,
      rawPunchCount: groupPunches.length,
      effectivePunchCount: effectivePunches.length,
      deduplicatedCount: groupPunches.length - effectivePunches.length,
      allPunchTimes: effectivePunches.map((p) => p.timeText),
      detectedFormat: detectedFormat === 'zkteco_dat' ? 'zkteco_dat' : 'single_punch_csv',
    });
  }

  const dailyRecords = [...prePairedRecords, ...aggregatedFromPunches].sort((a, b) => {
    const dateCmp = b.workDate.localeCompare(a.workDate);
    if (dateCmp !== 0) return dateCmp;
    return a.pin.localeCompare(b.pin, undefined, { numeric: true });
  });

  const uniquePins = Array.from(new Set(dailyRecords.map((r) => r.pin))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const rec of dailyRecords) {
    if (!minDate || rec.workDate < minDate) minDate = rec.workDate;
    if (!maxDate || rec.workDate > maxDate) maxDate = rec.workDate;
  }

  return {
    detectedFormat: dailyRecords.length > 0 ? (detectedFormat === 'empty' ? 'paired_table' : detectedFormat) : 'empty',
    totalLinesRead,
    totalRawPunches: rawPunches.length + prePairedRecords.length * 2,
    totalDeduplicatedTaps,
    dailyRecords,
    uniquePins,
    minDate,
    maxDate,
    parseWarnings,
    detectedColumns,
    appliedColumnMapping: mapping,
  };
}

/**
 * Extracts the numeric core of an employee code or PIN (e.g. "EMP-0045" -> "45", "001" -> "1").
 */
export function extractNumericPinCore(code: string): string | null {
  const normalized = normalizeArabicDigits(String(code || '')).trim();
  if (!normalized) return null;
  const digitsOnly = normalized.replace(/\D+/g, '');
  if (!digitsOnly) return null;
  const strippedLeadingZeros = digitsOnly.replace(/^0+/, '');
  return strippedLeadingZeros || '0';
}

/**
 * Builds an O(1) employee matcher that resolves a biometric device PIN to an HR employee.
 */
export function buildBiometricEmployeeResolver(
  employees: EmployeeBiometricCandidate[],
): (devicePin: string) => ResolvedEmployeeMatch | null {
  const byBiometricPin = new Map<string, EmployeeBiometricCandidate>();
  const byExactEmployeeNo = new Map<string, EmployeeBiometricCandidate>();
  const byNumericCore = new Map<string, EmployeeBiometricCandidate | 'AMBIGUOUS'>();

  for (const emp of employees) {
    const bioPin = normalizeArabicDigits(String(emp.biometricPin || ''))
      .trim()
      .toLowerCase();
    if (bioPin) {
      byBiometricPin.set(bioPin, emp);
    }

    const empNo = normalizeArabicDigits(String(emp.employeeNo || ''))
      .trim()
      .toLowerCase();
    if (empNo) {
      byExactEmployeeNo.set(empNo, emp);
    }

    const coreFromBio = bioPin ? extractNumericPinCore(bioPin) : null;
    const coreFromNo = empNo ? extractNumericPinCore(empNo) : null;
    const cores = new Set([coreFromBio, coreFromNo].filter((c): c is string => Boolean(c)));

    for (const core of cores) {
      const existing = byNumericCore.get(core);
      if (!existing) {
        byNumericCore.set(core, emp);
      } else if (existing !== 'AMBIGUOUS' && existing.id !== emp.id) {
        byNumericCore.set(core, 'AMBIGUOUS');
      }
    }
  }

  return (devicePin: string): ResolvedEmployeeMatch | null => {
    const cleanPin = normalizeArabicDigits(String(devicePin || ''))
      .trim()
      .toLowerCase();
    if (!cleanPin) return null;

    const exactBio = byBiometricPin.get(cleanPin);
    if (exactBio) {
      return { employee: exactBio, matchedBy: 'biometric_pin' };
    }

    const exactNo = byExactEmployeeNo.get(cleanPin);
    if (exactNo) {
      return { employee: exactNo, matchedBy: 'exact_employee_no' };
    }

    const core = extractNumericPinCore(cleanPin);
    if (core) {
      const coreMatch = byNumericCore.get(core);
      if (coreMatch && coreMatch !== 'AMBIGUOUS') {
        return { employee: coreMatch, matchedBy: 'numeric_core' };
      }
    }

    return null;
  };
}

/**
 * Decodes ZKTeco binary `user.dat` (72-byte records for TFT terminals like IN01-A, K40, F18).
 */
export function parseZkUserDatBuffer(buffer: Uint8Array): DecodedZkDeviceUser[] {
  const RECORD_SIZE = 72;
  if (!buffer || buffer.length < RECORD_SIZE || buffer.length % RECORD_SIZE !== 0) {
    return [];
  }

  const users: DecodedZkDeviceUser[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const decodeNullTerminated = (slice: Uint8Array): string => {
    let end = slice.indexOf(0);
    if (end === -1) end = slice.length;
    return decoder.decode(slice.subarray(0, end)).trim();
  };

  const mapPrivilege = (priv: number): { role: DecodedZkDeviceUser['privilegeRole']; labelAr: string } => {
    if (priv === 14) return { role: 'super_admin', labelAr: 'سوبر أدمن كامل (Super Admin)' };
    if (priv === 6 || priv === 4) return { role: 'admin', labelAr: 'مشرف (Supervisor / Admin)' };
    if (priv === 2) return { role: 'enroller', labelAr: 'مسجل بصمات (Enroller)' };
    if (priv === 8) return { role: 'usb_manager', labelAr: 'مدير فلاشة فقط (USB Manager)' };
    return { role: 'user', labelAr: 'موظف عادي (Normal User)' };
  };

  const count = buffer.length / RECORD_SIZE;
  for (let i = 0; i < count; i++) {
    const offset = i * RECORD_SIZE;
    const uid = view.getUint16(offset, true);
    const privilegeCode = buffer[offset + 2];
    const password = decodeNullTerminated(buffer.subarray(offset + 3, offset + 11));
    const name = decodeNullTerminated(buffer.subarray(offset + 11, offset + 35));
    const cardNumber = view.getUint32(offset + 35, true);
    const userId = decodeNullTerminated(buffer.subarray(offset + 48, offset + 72));

    if (!userId && uid === 0) continue;

    const privInfo = mapPrivilege(privilegeCode);
    users.push({
      uid,
      userId: userId || String(uid),
      name: name || `مستخدم #${userId || uid}`,
      privilegeCode,
      privilegeRole: privInfo.role,
      privilegeLabelAr: privInfo.labelAr,
      password,
      cardNumber,
    });
  }

  return users;
}

/**
 * Decodes a 32-bit ZKTeco packed timestamp integer into "YYYY-MM-DD HH:MM:SS".
 */
export function decodeZkPackedTimestamp(rawUint32: number): string {
  let t = rawUint32 >>> 0;
  const second = t % 60;
  t = Math.floor(t / 60);
  const minute = t % 60;
  t = Math.floor(t / 60);
  const hour = t % 24;
  t = Math.floor(t / 24);
  const day = (t % 31) + 1;
  t = Math.floor(t / 31);
  const month = (t % 12) + 1;
  t = Math.floor(t / 12);
  const year = t + 2000;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

/**
 * Generates the 4-byte ZKTeco CMD_AUTH commkey payload (ported from commpro.c MakeKey).
 */
export function makeZkCommKeyPayload(commKey: number, sessionId: number, ticks = 50): Buffer {
  const key = Number(commKey) || 0;
  const sid = Number(sessionId) || 0;
  let k = 0;
  for (let i = 0; i < 32; i++) {
    if ((key & (1 << i)) !== 0) {
      k = ((k << 1) | 1) >>> 0;
    } else {
      k = (k << 1) >>> 0;
    }
  }
  k = (k + sid) >>> 0;

  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(k, 0);
  buf[0] ^= 'Z'.charCodeAt(0);
  buf[1] ^= 'K'.charCodeAt(0);
  buf[2] ^= 'S'.charCodeAt(0);
  buf[3] ^= 'O'.charCodeAt(0);

  const h0 = buf.readUInt16LE(0);
  const h1 = buf.readUInt16LE(2);
  buf.writeUInt16LE(h1, 0);
  buf.writeUInt16LE(h0, 2);

  const b = ticks & 0xff;
  buf[0] ^= b;
  buf[1] ^= b;
  buf[2] = b;
  buf[3] ^= b;
  return buf;
}

/**
 * Computes ZKTeco 16-bit one's complement packet checksum.
 */
export function buildZkUdpPacket(
  cmd: number,
  sessionId: number,
  replyId: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  const pkt = Buffer.alloc(8 + payload.length);
  pkt.writeUInt16LE(cmd, 0);
  pkt.writeUInt16LE(0, 2);
  pkt.writeUInt16LE(sessionId & 0xffff, 4);
  pkt.writeUInt16LE(replyId & 0xffff, 6);
  if (payload.length > 0) {
    payload.copy(pkt, 8);
  }

  let chk = 0;
  for (let i = 0; i < pkt.length; i += 2) {
    if (i + 1 < pkt.length) {
      chk += pkt.readUInt16LE(i);
    } else {
      chk += pkt[i];
    }
    while (chk > 0xffff) {
      chk = (chk & 0xffff) + (chk >>> 16);
    }
  }
  chk = ~chk & 0xffff;
  pkt.writeUInt16LE(chk, 2);
  return pkt;
}
