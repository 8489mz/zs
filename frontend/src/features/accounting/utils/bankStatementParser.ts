/**
 * Bank Statement Import & Smart Column Detection Engine
 * Supports Excel (.xlsx, .xls), CSV (.csv), and Tab/Whitespace-separated Text (PDF/Web copy-paste).
 * Features:
 *  - Automatic bank metadata header skipping (skips bank logo/account info at rows 1-5).
 *  - Multilingual Arabic & English column auto-detection.
 *  - Separate Debit/Credit or single Amount (+/- or DR/CR) column handling.
 *  - Clean standard template generation.
 */

import * as XLSX from 'xlsx';
import { todayLocalDateKey } from '@/lib/format';

export interface BankColumnMapping {
  dateCol: number;
  descCol: number;
  refCol: number;
  amountType: 'single' | 'dual'; // 'single' = one column (+/-), 'dual' = separate debit/credit
  amountCol: number; // used if amountType === 'single'
  debitCol: number;  // used if amountType === 'dual'
  creditCol: number; // used if amountType === 'dual'
  balanceCol: number;
}

export interface BankStatementParsedLine {
  lineDate: string; // YYYY-MM-DD
  description: string;
  reference: string;
  amount: number; // positive = credit/deposit into bank, negative = debit/withdrawal
  balance?: number;
}

export interface BankStatementFileParseResult {
  fileName: string;
  sheets: string[];
  activeSheet: string;
  headerRowIndex: number;
  headers: string[];
  rawRows: any[][];
  mapping: BankColumnMapping;
  parsedLines: BankStatementParsedLine[];
  totalDeposits: number;
  totalWithdrawals: number;
  netChange: number;
  detectedStartBal?: number;
  detectedEndBal?: number;
}

// Keywords for smart detection
const DATE_KEYWORDS = ['date', 'posting date', 'value date', 'trans date', 'txn date', 'booking date', 'تاريخ', 'تاريخ الحركة', 'تاريخ القيد', 'تاريخ العملية', 'التاريخ'];
const DESC_KEYWORDS = ['description', 'narrative', 'details', 'particulars', 'transaction details', 'statement', 'memo', 'remarks', 'البيان', 'تفاصيل', 'تفاصيل الحركة', 'شرح', 'الوصف', 'الحركة'];
const REF_KEYWORDS = ['reference', 'ref', 'ref no', 'cheque', 'chq', 'chq no', 'transaction id', 'txn ref', 'document', 'رقم المرجع', 'المرجع', 'رقم الشيك', 'شيك', 'رقم السند', 'رقم الإيصال'];
const DEBIT_KEYWORDS = ['debit', 'withdrawal', 'withdrawals', 'dr', 'paid out', 'payments', 'out', 'مدين', 'سحب', 'خصم', 'مدفوعات', 'المسحوبات', 'خارج'];
const CREDIT_KEYWORDS = ['credit', 'deposit', 'deposits', 'cr', 'paid in', 'receipts', 'in', 'دائن', 'إيداع', 'وارد', 'مقبوضات', 'الإيداعات', 'داخل'];
const AMOUNT_KEYWORDS = ['amount', 'txn amount', 'net amount', 'total', 'المبلغ', 'القيمة', 'صافي المبلغ'];
const BALANCE_KEYWORDS = ['balance', 'running balance', 'ledger balance', 'الرصيد', 'الرصيد بعد الحركة', 'رصيد'];

function normalizeString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function parseFormattedNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  let str = String(val).trim();
  // Handle brackets (100.00) -> -100.00
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.substring(1, str.length - 1);
  }
  // Remove commas, currency symbols, and spaces
  str = str.replace(/[,\s$EGPegpUSDusdSARsar€]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseDateCell(val: any): string {
  if (!val) return todayLocalDateKey();
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) return todayLocalDateKey(val);
  }
  const str = String(val).trim();
  // Check Excel serial number (e.g. 45210)
  if (/^\d{5}$/.test(str)) {
    try {
      const date = new Date(Math.round((Number(str) - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    } catch {}
  }

  // Common date formats: DD/MM/YYYY or YYYY-MM-DD
  const parts1 = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // YYYY-MM-DD
  if (parts1) {
    const y = parts1[1];
    const m = parts1[2].padStart(2, '0');
    const d = parts1[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const parts2 = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // DD/MM/YYYY or MM/DD/YYYY
  if (parts2) {
    const d = parts2[1].padStart(2, '0');
    const m = parts2[2].padStart(2, '0');
    let y = parts2[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return todayLocalDateKey(parsed);
  }

  return todayLocalDateKey();
}

/**
 * Scan first rows to find the actual header row of the bank statement
 */
function findHeaderRow(rows: any[][]): { headerRowIndex: number; headers: string[] } {
  let bestRowIndex = 0;
  let maxScore = -1;
  const searchLimit = Math.min(15, rows.length);

  for (let r = 0; r < searchLimit; r++) {
    const row = rows[r] || [];
    let score = 0;
    for (const cell of row) {
      const text = normalizeString(cell);
      if (!text) continue;
      if (DATE_KEYWORDS.some((k) => text.includes(k))) score += 3;
      if (DESC_KEYWORDS.some((k) => text.includes(k))) score += 3;
      if (DEBIT_KEYWORDS.some((k) => text.includes(k))) score += 2;
      if (CREDIT_KEYWORDS.some((k) => text.includes(k))) score += 2;
      if (AMOUNT_KEYWORDS.some((k) => text.includes(k))) score += 2;
      if (BALANCE_KEYWORDS.some((k) => text.includes(k))) score += 2;
      if (REF_KEYWORDS.some((k) => text.includes(k))) score += 1;
    }
    if (score > maxScore) {
      maxScore = score;
      bestRowIndex = r;
    }
  }

  const rawHeaders = rows[bestRowIndex] || [];
  const headers = rawHeaders.map((h, i) => (h ? String(h).trim() : `العمود ${i + 1}`));
  return { headerRowIndex: bestRowIndex, headers };
}

/**
 * Auto-detect column roles based on header names
 */
export function detectColumnMapping(headers: string[]): BankColumnMapping {
  let dateCol = -1;
  let descCol = -1;
  let refCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let amountCol = -1;
  let balanceCol = -1;

  headers.forEach((h, idx) => {
    const text = normalizeString(h);
    if (!text) return;

    if (dateCol === -1 && DATE_KEYWORDS.some((k) => text.includes(k))) dateCol = idx;
    else if (descCol === -1 && DESC_KEYWORDS.some((k) => text.includes(k))) descCol = idx;
    else if (refCol === -1 && REF_KEYWORDS.some((k) => text.includes(k))) refCol = idx;
    else if (debitCol === -1 && DEBIT_KEYWORDS.some((k) => text.includes(k))) debitCol = idx;
    else if (creditCol === -1 && CREDIT_KEYWORDS.some((k) => text.includes(k))) creditCol = idx;
    else if (balanceCol === -1 && BALANCE_KEYWORDS.some((k) => text.includes(k))) balanceCol = idx;
    else if (amountCol === -1 && AMOUNT_KEYWORDS.some((k) => text.includes(k))) amountCol = idx;
  });

  // Fallbacks if not detected
  if (dateCol === -1) dateCol = 0;
  if (descCol === -1) descCol = headers.length > 1 ? 1 : 0;
  if (amountCol === -1 && (debitCol === -1 || creditCol === -1)) {
    // If no debit/credit found, fallback amount to last column or 2nd column
    amountCol = headers.length > 2 ? 2 : 1;
  }

  const hasDual = debitCol !== -1 && creditCol !== -1;
  return {
    dateCol,
    descCol,
    refCol,
    amountType: hasDual ? 'dual' : 'single',
    amountCol,
    debitCol,
    creditCol,
    balanceCol,
  };
}

/**
 * Apply column mapping onto raw rows to extract standardized statement lines
 */
export function extractLinesFromRows(
  rows: any[][],
  startRowIndex: number,
  mapping: BankColumnMapping
): { lines: BankStatementParsedLine[]; totalDeposits: number; totalWithdrawals: number; netChange: number } {
  const lines: BankStatementParsedLine[] = [];
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  for (let r = startRowIndex; r < rows.length; r++) {
    const row = rows[r] || [];
    // Skip empty rows
    const hasAnyVal = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (!hasAnyVal) continue;

    const rawDate = mapping.dateCol >= 0 ? row[mapping.dateCol] : null;
    const rawDesc = mapping.descCol >= 0 ? row[mapping.descCol] : '';
    const rawRef = mapping.refCol >= 0 ? row[mapping.refCol] : '';
    const rawBal = mapping.balanceCol >= 0 ? parseFormattedNumber(row[mapping.balanceCol]) : undefined;

    let amount = 0;
    if (mapping.amountType === 'dual') {
      const debit = mapping.debitCol >= 0 ? parseFormattedNumber(row[mapping.debitCol]) : 0;
      const credit = mapping.creditCol >= 0 ? parseFormattedNumber(row[mapping.creditCol]) : 0;
      // In bank statements: Credit is Deposit (+), Debit is Withdrawal (-)
      amount = credit - debit;
    } else {
      amount = mapping.amountCol >= 0 ? parseFormattedNumber(row[mapping.amountCol]) : 0;
    }

    const description = rawDesc ? String(rawDesc).trim() : 'حركة بنكية';
    const reference = rawRef ? String(rawRef).trim() : '';

    // Ignore rows where both amount and description are blank
    if (amount === 0 && (!description || description === 'حركة بنكية')) continue;

    const lineDate = parseDateCell(rawDate);

    if (amount > 0) totalDeposits += amount;
    else if (amount < 0) totalWithdrawals += Math.abs(amount);

    lines.push({
      lineDate,
      description,
      reference,
      amount,
      balance: rawBal,
    });
  }

  const netChange = totalDeposits - totalWithdrawals;
  return { lines, totalDeposits, totalWithdrawals, netChange };
}

/**
 * Main parser for Bank Statement Excel & CSV files
 */
export async function parseBankStatementFile(file: File): Promise<BankStatementFileParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('الملف فارغ ولا يحتوي على أي أوراق عمل.');
  }

  const activeSheetName = sheetNames[0];
  const worksheet = workbook.Sheets[activeSheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('ورقة العمل فارغة ولا تحتوي على أي بيانات.');
  }

  const { headerRowIndex, headers } = findHeaderRow(rawRows);
  const mapping = detectColumnMapping(headers);
  const { lines, totalDeposits, totalWithdrawals, netChange } = extractLinesFromRows(rawRows, headerRowIndex + 1, mapping);

  // Attempt to detect start & end balance from first/last balance columns
  let detectedStartBal: number | undefined = undefined;
  let detectedEndBal: number | undefined = undefined;
  if (lines.length > 0 && lines[0].balance !== undefined) {
    // If bank lists transactions chronologically, line[0] balance minus first amount was start
    detectedStartBal = lines[0].balance - lines[0].amount;
    detectedEndBal = lines[lines.length - 1].balance;
  }

  return {
    fileName: file.name,
    sheets: sheetNames,
    activeSheet: activeSheetName,
    headerRowIndex,
    headers,
    rawRows,
    mapping,
    parsedLines: lines,
    totalDeposits,
    totalWithdrawals,
    netChange,
    detectedStartBal,
    detectedEndBal,
  };
}

/**
 * Smart Text Parser: Extracts bank statement lines from raw text (copied from PDF or web)
 */
export function parseBankStatementText(rawText: string): BankStatementParsedLine[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.split(/\r?\n/);
  const parsedLines: BankStatementParsedLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Try splitting by tabs first, then semicolon, comma, or multiple spaces
    let tokens: string[] = [];
    if (line.includes('\t')) {
      tokens = line.split('\t').map((t) => t.trim()).filter(Boolean);
    } else if (line.includes(';') && line.split(';').length >= 3) {
      tokens = line.split(';').map((t) => t.trim()).filter(Boolean);
    } else if (line.includes(',') && line.split(',').length >= 3) {
      tokens = line.split(',').map((t) => t.trim()).filter(Boolean);
    } else {
      tokens = line.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
    }

    if (tokens.length >= 2) {
      // Find date token
      let dateVal = '';
      let dateIdx = -1;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(t) || /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(t)) {
          dateVal = parseDateCell(t);
          dateIdx = i;
          break;
        }
      }

      // Find amount token
      let amountVal = 0;
      let amountIdx = -1;
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (i === dateIdx) continue;
        const t = tokens[i];
        const cleaned = t.replace(/[,\s$EGPegpUSDusdSARsar€]/g, '');
        if (/^-?\d+(\.\d+)?$/.test(cleaned) || /^\(\d+(\.\d+)?\)$/.test(cleaned)) {
          amountVal = parseFormattedNumber(t);
          amountIdx = i;
          break;
        }
      }

      // If we found date and amount, the rest is description/reference
      if (dateVal && amountIdx !== -1) {
        const descTokens: string[] = [];
        let refVal = '';
        tokens.forEach((t, idx) => {
          if (idx !== dateIdx && idx !== amountIdx) {
            if (/^[A-Z0-9-]{5,20}$/i.test(t) && !refVal) {
              refVal = t;
            } else {
              descTokens.push(t);
            }
          }
        });

        parsedLines.push({
          lineDate: dateVal,
          description: descTokens.join(' ') || 'حركة بنكية',
          reference: refVal,
          amount: amountVal,
        });
      }
    }
  }

  return parsedLines;
}

/**
 * Downloads a standardized Excel template for bank statements
 */
export function downloadBankStatementTemplate(): void {
  const headers = [
    'تاريخ الحركة (Date)',
    'البيان وتفاصيل العملية (Description)',
    'رقم المرجع أو الشيك (Reference)',
    'المبلغ (Amount) (+ للإيداع / - للسحب)',
    'ملاحظات اختيارية (Notes)',
  ];

  const sampleRows = [
    ['2026-09-01', 'تحويل بنكي وارد من عميل شركة الأمل', 'REF-98710', 50000, 'إيداع على الحساب'],
    ['2026-09-02', 'سداد فاتورة مشتريات شركة التوريدات', 'CHQ-00451', -18500, 'سداد مستحقات مورد'],
    ['2026-09-05', 'عمولات ومصاريف تحويل بنكية', 'FEE-201', -150, 'مصروفات بنكية دورية'],
    ['2026-09-08', 'إيداع نقدي بالفرع', 'DEP-8841', 25000, 'إيداع خزانة'],
    ['2026-09-12', 'سداد رواتب شهرية عبر البنك', 'PAY-9002', -34000, 'تحويل رواتب الموظفين'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

  // Set column widths
  ws['!cols'] = [
    { wch: 22 }, // Date
    { wch: 40 }, // Description
    { wch: 25 }, // Reference
    { wch: 28 }, // Amount
    { wch: 25 }, // Notes
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب البنكي');

  XLSX.writeFile(wb, 'قالب_كشف_الحساب_البنكي_القياسي.xlsx');
}
