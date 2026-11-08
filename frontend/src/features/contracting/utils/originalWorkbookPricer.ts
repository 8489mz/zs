import * as XLSX from 'xlsx';
import { ColumnMapping } from './boqExcelParser';
import { triggerDownload } from '@/lib/browser';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export interface OriginalWorkbookEntry {
  fileName: string;
  buffer: ArrayBuffer;
  sheetName: string;
  columnMapping: ColumnMapping;
  headerRowIndex: number;
}

// In-Memory Registry for uploaded client workbooks
const originalWorkbookRegistry = new Map<string, OriginalWorkbookEntry>();

// IndexedDB Persistence for Surviving Page Reloads
const DB_NAME = 'ZS_ORIGINAL_BOQ_WORKBOOKS';
const DB_STORE = 'workbooks';

function openIndexedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'fileName' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function persistWorkbookToDb(entry: OriginalWorkbookEntry) {
  try {
    const db = await openIndexedDb();
    if (!db) return;
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put({
      fileName: entry.fileName,
      buffer: entry.buffer,
      sheetName: entry.sheetName,
      columnMapping: entry.columnMapping,
      headerRowIndex: entry.headerRowIndex,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Failed to persist workbook in IndexedDB:', err);
  }
}

async function getWorkbookFromDb(fileName: string): Promise<OriginalWorkbookEntry | undefined> {
  try {
    const db = await openIndexedDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req = store.get(fileName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function getAllWorkbooksFromDb(): Promise<OriginalWorkbookEntry[]> {
  try {
    const db = await openIndexedDb();
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export function registerOriginalWorkbook(entry: OriginalWorkbookEntry) {
  if (!entry.fileName || !entry.buffer) return;
  originalWorkbookRegistry.set(entry.fileName, entry);
  persistWorkbookToDb(entry);
}

export async function findRegisteredWorkbook(
  hintFileName?: string,
  hintSheetName?: string
): Promise<OriginalWorkbookEntry | undefined> {
  // 1. Ensure registry is hydrated from IndexedDB if in-memory registry is empty
  if (originalWorkbookRegistry.size === 0) {
    const allDb = await getAllWorkbooksFromDb();
    for (const item of allDb) {
      if (item.fileName && item.buffer) {
        originalWorkbookRegistry.set(item.fileName, item);
      }
    }
  }

  // 2. Direct in-memory lookup
  if (hintFileName && originalWorkbookRegistry.has(hintFileName)) {
    return originalWorkbookRegistry.get(hintFileName);
  }

  // 3. Direct IndexedDB lookup
  if (hintFileName) {
    const fromDb = await getWorkbookFromDb(hintFileName);
    if (fromDb && fromDb.buffer) {
      originalWorkbookRegistry.set(fromDb.fileName, fromDb);
      return fromDb;
    }
  }

  // 4. Fuzzy match by file name (ignoring extension / path / trailing labels)
  if (hintFileName) {
    const lowerHint = hintFileName.toLowerCase().replace(/(\.xlsx|\.xls)$/i, '').replace(/_مسعر$/i, '').trim();
    for (const [name, entry] of originalWorkbookRegistry.entries()) {
      const lowerName = name.toLowerCase().replace(/(\.xlsx|\.xls)$/i, '').trim();
      if (lowerName === lowerHint || lowerName.includes(lowerHint) || lowerHint.includes(lowerName)) {
        return entry;
      }
    }
  }

  // 5. Match by sheet name
  if (hintSheetName) {
    for (const entry of originalWorkbookRegistry.values()) {
      if (entry.sheetName === hintSheetName) return entry;
    }
  }

  // 6. If only 1 workbook has been registered in the system, return it!
  const allEntries = Array.from(originalWorkbookRegistry.values());
  if (allEntries.length === 1) {
    return allEntries[0];
  }

  // 7. Fallback to first available entry if any exist
  if (allEntries.length > 0) {
    return allEntries[0];
  }

  return undefined;
}

export function getRegisteredOriginalWorkbook(fileName: string): OriginalWorkbookEntry | undefined {
  return originalWorkbookRegistry.get(fileName);
}

export interface PricedExportItem {
  rawRowIdx?: number;
  itemCode?: string;
  description: string;
  unit: string;
  contractQty: number;
  unitPrice: number;
  totalPrice?: number;
  notes?: string;
  category?: string;
  sourceFileName?: string;
  sourceSheetName?: string;
}

export interface ExportPricedOptions {
  projectName?: string;
  clientName?: string;
  scopeLabel?: string;
  includeCompanyHeader?: boolean;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyTaxNumber?: string;
  commercialRegister?: string;
  socialInsurancePercent?: number;
  socialInsuranceAmount?: number;
  officeMarginPercent?: number;
  officeMarginAmount?: number;
  vatPercent?: number;
  vatAmount?: number;
  finalTotalAmount?: number;
  currency?: string;
}

const TRADE_ARABIC_NAMES: Record<string, string> = {
  hvac: 'أعمال التكييف والتهوية الميكانيكية',
  fire_fighting: 'أعمال شبكات إنذار ومكافحة الحريق',
  electrical_power: 'أعمال القوى والشبكات الكهربائية',
  low_current: 'أعمال التيار الخفيف والأنظمة الذكية',
  plumbing_sanitary: 'أعمال التغذية والصرف الصحي والسباكة',
  civil_concrete: 'أعمال الهيكل الخرساني والإنشاءات المدنية',
  architecture_finishes: 'أعمال التشطيبات والمعماري',
  masonry: 'أعمال المباني والقواطيع',
  concrete: 'أعمال الخرسانات المسلحة والعادية',
  plastering: 'أعمال البياض والمحارة',
  flooring: 'أعمال الأرضيات والسيراميك والرخام',
  finishes: 'أعمال الدهانات والتشطيبات النهائية',
  general: 'أعمال عامة واشتراطات تمهيدية',
};

/**
 * Helper to find item row in client sheet if rawRowIdx was lost
 */
function findRowInSheet(
  worksheet: XLSX.WorkSheet,
  itemCode?: string,
  description?: string
): number | undefined {
  const ref = worksheet['!ref'];
  if (!ref) return undefined;
  const range = XLSX.utils.decode_range(ref);
  const cleanCode = (itemCode || '').trim().toLowerCase();
  const cleanDesc = (description || '').trim().toLowerCase();

  // First pass: match by description (most reliable in engineering BOQs)
  if (cleanDesc && cleanDesc.length >= 6) {
    const descChunk = cleanDesc.slice(0, 32);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 10); c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined) continue;
        const str = String(cell.v).trim().toLowerCase();
        if (str.length >= 6 && (str.includes(descChunk) || descChunk.includes(str))) {
          return r;
        }
      }
    }
  }

  // Second pass: match by itemCode (only if not a simple generic number)
  if (cleanCode && cleanCode.length >= 3 && !/^\d+$/.test(cleanCode)) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 4); c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined) continue;
        const str = String(cell.v).trim().toLowerCase();
        if (str === cleanCode) {
          return r;
        }
      }
    }
  }

  return undefined;
}

/**
 * Export Priced Workbook:
 * Mode A: In-Place Raw Workbook Injection (The Gold Standard)
 *    Preserves 100% of original formatting, fonts, preambles, and colors from the client's file.
 * Mode B: Branded Enterprise Spreadsheet (Corporate Proposal)
 *    A structured, styled, and colored corporate Excel sheet containing the client's items in their
 *    exact sequence with corporate headers, zebra styling, accounting formatting, and full merges.
 */
export async function exportPricedBoqWorkbook(
  exportFileName: string,
  items: PricedExportItem[],
  optionsOrProjectName: string | ExportPricedOptions = 'المشروع'
): Promise<boolean> {
  if (!items || items.length === 0) return false;

  // INV-FE3-FRONTEND-BOOK-DIGITS: every price/total written into the
  // exported workbook is money; it rounds at the tenant's book digits,
  // not hardcoded 2dp. (The `currency` option is a display symbol, e.g.
  // 'ج.م', and cannot yield digits — the tenant currency is resolved
  // here. Cell number formats `#,##0.00` are display-only and unchanged.)
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());

  const options: ExportPricedOptions =
    typeof optionsOrProjectName === 'string'
      ? { projectName: optionsOrProjectName, includeCompanyHeader: false }
      : { includeCompanyHeader: false, ...optionsOrProjectName };

  const {
    projectName = 'مشروع مقاولات',
    clientName = 'العميل الموقر',
    scopeLabel = 'كافة البنود والمستندات',
    includeCompanyHeader = false,
    companyName = 'شركة المقاولات العامة والإنشاءات المتكاملة',
    companyPhone = '',
    companyAddress = '',
    companyTaxNumber = '',
    commercialRegister = '',
    socialInsurancePercent = 0,
    socialInsuranceAmount = 0,
    officeMarginPercent = 0,
    officeMarginAmount = 0,
    vatPercent = 0,
    vatAmount = 0,
    currency = 'ج.م',
  } = options;

  // Determine hint file name
  const firstItemFile = items.find((it) => it.sourceFileName)?.sourceFileName;
  const firstItemSheet = items.find((it) => it.sourceSheetName)?.sourceSheetName;
  const targetHint = exportFileName.replace(/_مسعر(\.xlsx|\.xls)?$/i, '');

  // Look up original client workbook
  const entry = await findRegisteredWorkbook(firstItemFile || targetHint, firstItemSheet);

  // =========================================================================
  // MODE A: In-Place Raw Workbook Injection (Client Native Workbook)
  // =========================================================================
  if (!includeCompanyHeader && entry && entry.buffer) {
    try {
      const workbook = XLSX.read(entry.buffer, {
        type: 'array',
        cellStyles: true,
        cellFormula: true,
        cellNF: true,
      });

      const targetSheetName = entry.sheetName && workbook.Sheets[entry.sheetName]
        ? entry.sheetName
        : workbook.SheetNames[0];

      const worksheet = workbook.Sheets[targetSheetName];

      if (worksheet) {
        const mapping = entry.columnMapping;
        let unitPriceCol = mapping.unitPriceCol;
        let totalPriceCol = mapping.totalPriceCol;

        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z100');
        const headerRow = entry.headerRowIndex >= 0 ? entry.headerRowIndex : 0;

        // If unit price col was not in original header, create one at the end
        if (unitPriceCol < 0) {
          unitPriceCol = range.e.c + 1;
          range.e.c += 1;
          worksheet['!ref'] = XLSX.utils.encode_range(range);
          worksheet[XLSX.utils.encode_cell({ r: headerRow, c: unitPriceCol })] = {
            t: 's',
            v: 'سعر الفئة',
          };
        }

        // If total price col was not in original header, create one at the end
        if (totalPriceCol < 0) {
          totalPriceCol = range.e.c + 1;
          range.e.c += 1;
          worksheet['!ref'] = XLSX.utils.encode_range(range);
          worksheet[XLSX.utils.encode_cell({ r: headerRow, c: totalPriceCol })] = {
            t: 's',
            v: 'إجمالي القيمة',
          };
        }

        let grandPricedSum = 0;

        // Fill priced cells in their exact original row positions!
        items.forEach((item) => {
          const itemSheetName = item.sourceSheetName || targetSheetName;
          const targetWs = workbook.Sheets[itemSheetName] || worksheet;

          let targetRow = item.rawRowIdx;
          if (targetRow === undefined || targetRow < 0) {
            targetRow = findRowInSheet(targetWs, item.itemCode, item.description);
          }

          if (targetRow !== undefined && targetRow >= 0) {
            const price = roundMoneyValue(Number(item.unitPrice || 0), bookDigits);
            const qty = Number(item.contractQty || 0);
            const total =
              item.totalPrice !== undefined
                ? roundMoneyValue(Number(item.totalPrice), bookDigits)
                : roundMoneyValue(price * qty, bookDigits);

            grandPricedSum += total;

            const priceCellRef = XLSX.utils.encode_cell({ r: targetRow, c: unitPriceCol });
            const existingPriceCell = targetWs[priceCellRef] || {};
            targetWs[priceCellRef] = {
              ...existingPriceCell,
              t: 'n',
              v: price,
              z: '#,##0.00',
            };

            if (totalPriceCol >= 0) {
              const totalCellRef = XLSX.utils.encode_cell({ r: targetRow, c: totalPriceCol });
              const existingTotalCell = targetWs[totalCellRef] || {};
              targetWs[totalCellRef] = {
                ...existingTotalCell,
                t: 'n',
                v: total,
                z: '#,##0.00',
              };
            }
          }
        });

        // If sheet has a "Grand Total" row, inject the grand sum
        if (totalPriceCol >= 0 && grandPricedSum > 0) {
          const sRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z100');
          for (let r = headerRow + 1; r <= sRange.e.r; r++) {
            for (let c = 0; c <= Math.min(sRange.e.c, 4); c++) {
              const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
              if (!cell || cell.v === undefined) continue;
              const val = String(cell.v).trim().toLowerCase();
              if (/grand\s*total|المجموع\s*الكلي|إجمالي\s*عام|اجمالي\s*العطاء/i.test(val)) {
                const totalCellRef = XLSX.utils.encode_cell({ r, c: totalPriceCol });
                const existingCell = worksheet[totalCellRef] || {};
                worksheet[totalCellRef] = {
                  ...existingCell,
                  t: 'n',
                  v: roundMoneyValue(grandPricedSum, bookDigits),
                  z: '#,##0.00',
                };
                break;
              }
            }
          }
        }

        const outputBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([outputBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const safeBaseName = (entry.fileName || exportFileName).replace(/(\.xlsx|\.xls)$/i, '');
        const finalDownloadName = `${safeBaseName}_مسعر.xlsx`;
        triggerDownload(blob, finalDownloadName);
        return true;
      }
    } catch (err) {
      console.warn('Failed in-place raw injection, falling back to structured export:', err);
    }
  }

  // =========================================================================
  // MODE B: Branded Enterprise Styled Excel Sheet (Corporate Quotation)
  // =========================================================================
  const aoaData: Array<Array<string | number | null | undefined>> = [];
  const merges: XLSX.Range[] = [];

  // 1. Corporate Header
  if (includeCompanyHeader) {
    const titleRowIdx = aoaData.length;
    aoaData.push([`${companyName} — إدارة المشروعات والمكتب الفني`]);
    merges.push({ s: { r: titleRowIdx, c: 0 }, e: { r: titleRowIdx, c: 7 } });

    const metaParts = [
      companyPhone ? `هاتف: ${companyPhone}` : '',
      companyAddress ? `العنوان: ${companyAddress}` : '',
      commercialRegister ? `س.ت: ${commercialRegister}` : '',
      companyTaxNumber ? `الرقم الضريبي: ${companyTaxNumber}` : '',
    ].filter(Boolean);
    const subTitleRowIdx = aoaData.length;
    aoaData.push([metaParts.length > 0 ? metaParts.join('  |  ') : 'عرض سعر رسمي للمقايسة والأعمال التنفيذية']);
    merges.push({ s: { r: subTitleRowIdx, c: 0 }, e: { r: subTitleRowIdx, c: 7 } });

    const projectMetaRowIdx = aoaData.length;
    aoaData.push([
      `المشروع: ${projectName}  |  الجهة المالكة: ${clientName}  |  النطاق: ${scopeLabel}  |  تاريخ الصدور: ${new Date().toLocaleDateString('ar-EG')}`,
    ]);
    merges.push({ s: { r: projectMetaRowIdx, c: 0 }, e: { r: projectMetaRowIdx, c: 7 } });

    aoaData.push([]); // Spacer
  }

  // 2. Table Column Headers
  const tableHeaders = [
    'م',
    'كود البند',
    'بيان الأعمال والمواصفات الفنية',
    'الوحدة',
    'الكمية التعاقدية',
    `سعر الفئة (${currency})`,
    `إجمالي القيمة (${currency})`,
    'ملاحظات واشتراطات فنية',
  ];
  aoaData.push(tableHeaders);

  // 3. Rows with Category Groupings
  let currentCategory = '';
  let itemCounter = 1;
  let baseContractSum = 0;

  items.forEach((item) => {
    const itemCat = item.category || 'general';
    if (itemCat !== currentCategory && TRADE_ARABIC_NAMES[itemCat]) {
      currentCategory = itemCat;
      const catRowIdx = aoaData.length;
      const catTitle = `【 ${TRADE_ARABIC_NAMES[itemCat]} 】`;
      aoaData.push([catTitle, '', '', '', '', '', '', '']);
      merges.push({ s: { r: catRowIdx, c: 0 }, e: { r: catRowIdx, c: 7 } });
    }

    const qty = Number(item.contractQty || 0);
    const unitPrice = roundMoneyValue(Number(item.unitPrice || 0), bookDigits);
    const totalPrice =
      item.totalPrice !== undefined
        ? roundMoneyValue(Number(item.totalPrice), bookDigits)
        : roundMoneyValue(qty * unitPrice, bookDigits);
    baseContractSum += totalPrice;

    aoaData.push([
      itemCounter++,
      item.itemCode || `BOQ-${itemCounter - 1}`,
      item.description,
      item.unit,
      qty,
      unitPrice,
      totalPrice,
      item.notes || '',
    ]);
  });

  // 4. Financial Breakdown Rows
  aoaData.push([]); // Spacer
  const subtotalRowIdx = aoaData.length;
  aoaData.push(['إجمالي قيمة الأعمال التنفيذية الأساسية', '', '', '', '', '', roundMoneyValue(baseContractSum, bookDigits), currency]);
  merges.push({ s: { r: subtotalRowIdx, c: 0 }, e: { r: subtotalRowIdx, c: 5 } });

  if (socialInsuranceAmount > 0) {
    const insRowIdx = aoaData.length;
    aoaData.push([
      `تأمينات اجتماعية على العملية (${socialInsurancePercent}%)`,
      '',
      '',
      '',
      '',
      '',
      roundMoneyValue(socialInsuranceAmount, bookDigits),
      currency,
    ]);
    merges.push({ s: { r: insRowIdx, c: 0 }, e: { r: insRowIdx, c: 5 } });
  }

  if (officeMarginAmount > 0) {
    const offRowIdx = aoaData.length;
    aoaData.push([
      `مصاريف إشراف ومكتب المقاولات (${officeMarginPercent}%)`,
      '',
      '',
      '',
      '',
      '',
      roundMoneyValue(officeMarginAmount, bookDigits),
      currency,
    ]);
    merges.push({ s: { r: offRowIdx, c: 0 }, e: { r: offRowIdx, c: 5 } });
  }

  if (vatAmount > 0) {
    const vatRowIdx = aoaData.length;
    aoaData.push([
      `ضريبة القيمة المضافة (${vatPercent}%)`,
      '',
      '',
      '',
      '',
      '',
      roundMoneyValue(vatAmount, bookDigits),
      currency,
    ]);
    merges.push({ s: { r: vatRowIdx, c: 0 }, e: { r: vatRowIdx, c: 5 } });
  }

  const finalSum =
    options.finalTotalAmount !== undefined
      ? roundMoneyValue(options.finalTotalAmount, bookDigits)
      : roundMoneyValue(baseContractSum + socialInsuranceAmount + officeMarginAmount + vatAmount, bookDigits);

  const grandTotalRowIdx = aoaData.length;
  aoaData.push(['إجمالي قيمة العرض المالي النهائي المعروض للتعاقد', '', '', '', '', '', finalSum, currency]);
  merges.push({ s: { r: grandTotalRowIdx, c: 0 }, e: { r: grandTotalRowIdx, c: 5 } });

  // 5. Contractual Notes & Terms
  aoaData.push([]); // Spacer
  const noteHeaderRowIdx = aoaData.length;
  aoaData.push(['الشروط والمحددات التعاقدية العامة:']);
  merges.push({ s: { r: noteHeaderRowIdx, c: 0 }, e: { r: noteHeaderRowIdx, c: 7 } });

  const notesList = [
    '1. الأسعار الموضحة أعلاه شاملة كافة مصاريف التوريد والمصنعيات والمعدات والإشراف الهندسي طبقاً لأصول الصناعة والمواصفات الفنية.',
    '2. الدفعة المقدمة المقترحة 10% تُخصم بنسب متساوية من المستخلصات الجارية.',
    '3. نسبة ضمان الأعمال (التأمين المحتجز) 5% تُصرف بعد مرور عام من تاريخ الاستلام الابتدائي للمشروع.',
    '4. مدة سريان هذا العرض 30 يوماً من تاريخ صدوره.',
  ];

  notesList.forEach((n) => {
    const nr = aoaData.length;
    aoaData.push([n]);
    merges.push({ s: { r: nr, c: 0 }, e: { r: nr, c: 7 } });
  });

  // 6. Signatures Block
  aoaData.push([]); // Spacer
  const sigTitleRowIdx = aoaData.length;
  aoaData.push(['', 'إعداد المكتب الفني', '', 'اعتماد المدير التنفيذي', '', '', 'موافقة واعتماد المالك الموقر', '']);
  merges.push({ s: { r: sigTitleRowIdx, c: 1 }, e: { r: sigTitleRowIdx, c: 2 } });
  merges.push({ s: { r: sigTitleRowIdx, c: 3 }, e: { r: sigTitleRowIdx, c: 4 } });
  merges.push({ s: { r: sigTitleRowIdx, c: 6 }, e: { r: sigTitleRowIdx, c: 7 } });

  const sigLineRowIdx = aoaData.length;
  aoaData.push(['', '................................', '', '................................', '', '', '................................', '']);
  merges.push({ s: { r: sigLineRowIdx, c: 1 }, e: { r: sigLineRowIdx, c: 2 } });
  merges.push({ s: { r: sigLineRowIdx, c: 3 }, e: { r: sigLineRowIdx, c: 4 } });
  merges.push({ s: { r: sigLineRowIdx, c: 6 }, e: { r: sigLineRowIdx, c: 7 } });

  // 7. Sheet Assembly
  const worksheet = XLSX.utils.aoa_to_sheet(aoaData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'عرض_سعر_مسعر');

  worksheet['!merges'] = merges;

  // Set Optimal Column Widths
  worksheet['!cols'] = [
    { wch: 7 },  // م
    { wch: 16 }, // كود البند
    { wch: 62 }, // بيان الأعمال والمواصفات الفنية
    { wch: 10 }, // الوحدة
    { wch: 14 }, // الكمية
    { wch: 16 }, // سعر الفئة
    { wch: 18 }, // إجمالي القيمة
    { wch: 28 }, // ملاحظات
  ];

  // Format All Numbers to Financial Standard (#,##0.00)
  const ref = worksheet['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellRef];
        if (cell && cell.t === 'n') {
          // If integer quantity, format with integer formatting; if price or total, use currency
          if (c === 4 && Number.isInteger(cell.v)) {
            cell.z = '#,##0';
          } else {
            cell.z = '#,##0.00';
          }
        }
      }
    }
  }

  // Set Sheet Direction to RTL
  worksheet['!views'] = [{ rightToLeft: true, RTL: true } as any];
  workbook.Workbook = {
    Views: [{ RTL: true } as any],
    Sheets: [{ name: 'عرض_سعر_مسعر', RTL: true } as any],
  } as any;

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const safeName = exportFileName.endsWith('.xlsx') ? exportFileName : `${exportFileName}.xlsx`;
  triggerDownload(blob, safeName);
  return true;
}
