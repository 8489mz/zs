/**
 * Universal Smart BOQ Excel Parser Engine
 * ----------------------------------------------------
 * High-precision, zero-failure Excel & CSV ingestion engine designed for real-world
 * contracting & engineering bills of quantities (BOQ / SOV).
 *
 * Features:
 * 1. Multi-Sheet Detection & Auto-Selection (identifies BOQ sheet vs Cover/Summary).
 * 2. Deep Matrix Header Scanning (finds headers anywhere on rows 0-30).
 * 3. Bilingual Semantic Column Matching (Arabic & English).
 * 4. Automatic Engineering Unit Normalization (m3, sqm, lm, pcs, ls -> Arabic standard).
 * 5. Trade / Category Auto-Classifier (Civil, Finishes, Plumbing, Electric, HVAC).
 * 6. Summary / Grand Total Row Filtering.
 * 7. Zero-Blocker Tender Mode (imports unpriced items gracefully as draft tender items).
 * 8. Eastern Arabic (Hindi) numeral sanitization.
 */

import * as XLSX from 'xlsx';
import { matchEngineeringConstant } from './engineeringMasterPricingCore';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export interface RawSheetInfo {
  name: string;
  rowCount: number;
  score: number;
}

export interface ColumnMapping {
  itemCodeCol: number;
  itemNameCol?: number;
  descriptionCol: number;
  categoryCol: number;
  unitCol: number;
  qtyCol: number;
  unitPriceCol: number;
  estimatedCostCol: number;
  notesCol: number;
  totalPriceCol: number;
}

export type BoqRowStatus = 'ready' | 'unpriced' | 'zero_qty' | 'invalid';

export interface ParsedBoqItemResult {
  index: number;
  rawRowIdx: number;
  itemCode: string;
  description: string;
  category: string;
  unit: string;
  contractQty: number;
  unitPrice: number;
  estimatedUnitCost: number;
  totalPrice: number;
  notes?: string;
  isValid: boolean;
  isSectionHeader?: boolean;
  isPreamble?: boolean;
  status: BoqRowStatus;
  warningMessage?: string;
  validationError?: string;
  isAutoPriced?: boolean;
  sourceFileName?: string;
  sourceSheetName?: string;
  matchedConstantCode?: string;
}

export interface WorkbookParseResult {
  sheetNames: string[];
  selectedSheet: string;
  headerRowIndex: number;
  headers: string[];
  columnMapping: ColumnMapping;
  rows: ParsedBoqItemResult[];
  validCount: number;
  unpricedCount: number;
  zeroQtyCount: number;
  sectionHeaderCount: number;
  invalidCount: number;
  totalContractValue: number;
  totalEstimatedCost: number;
}

// ----------------------------------------------------------------------
// 1. Text & Digit Normalization
// ----------------------------------------------------------------------

export function normalizeArabicDigits(str: string): string {
  return str
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function cleanString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function cleanNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    if (isNaN(val)) return 0;
    return Math.round((val + Number.EPSILON) * 10000) / 10000;
  }
  let s = String(val).trim();
  if (!s) return 0;
  s = normalizeArabicDigits(s);

  // If multiple space-separated number chunks exist (e.g., '9.300.000 9.300.000'), pick the last valid number
  const parts = s.split(/\s+/).filter((p) => /\d/.test(p));
  if (parts.length > 1) {
    s = parts[parts.length - 1];
  }

  // Remove thousand commas
  s = s.replace(/,/g, '');
  // If multiple dots exist (e.g., 9.300.000 or 15.633.960), treat as thousand separators
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) {
    s = s.replace(/\./g, '');
  }
  // Remove extraneous characters except digits, minus, and decimal point
  s = s.replace(/[^\d.-]/g, '');
  const num = parseFloat(s);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
}

// ----------------------------------------------------------------------
// 2. Unit Normalization & Translation (Bilingual)
// ----------------------------------------------------------------------

export function normalizeUnit(rawUnit: string): string {
  if (!rawUnit) return '';
  const raw = rawUnit.trim();
  const u = raw.toLowerCase();
  const stripped = u.replace(/[\.\s_\/-]/g, '');

  // Lump sum
  if (
    /^(ls|lumpsum|sum|job|مقطوعية|جملة|مقطوع|بالمقطوع)$/i.test(stripped) ||
    /^(l\.s|l\.s\.|l\/s|lump\s*sum|مقطوعية|جملة|مقطوع|بالمقطوع)$/i.test(u)
  ) {
    return 'ls';
  }

  // Cubic meter
  if (
    /^(m3|cum|cumtr|م3|مترمكعب|مم)$/i.test(stripped) ||
    /^(m3|m³|cum|cu\.m|m\^3|م3|م³|متر مكعب|م\.م|متر3)$/i.test(u)
  ) {
    return 'm3';
  }

  // Square meter
  if (
    /^(m2|sqm|sqmtr|م2|مترمربع|مترمسطح|ممتر)$/i.test(stripped) ||
    /^(m2|m²|sqm|sq\.m|m\^2|م2|م²|متر مربع|متر مسطح|م\.متر|متر2)$/i.test(u)
  ) {
    return 'm2';
  }

  // Linear meter
  if (
    /^(lm|m|rm|ml|linearmeter|مط|مترطولي|متر)$/i.test(stripped) ||
    /^(lm|m|r\.m|rm|ml|linear meter|م\.ط|متر طولي|م\/ط|متر)$/i.test(u)
  ) {
    return 'm';
  }

  // Item / Piece / Number
  if (
    /^(pcs|pc|ea|each|nos|no|nr|item|عدد|حبه|حبة|قطعة|راس|رأس|بند)$/i.test(stripped) ||
    /^(pcs|pc|ea|each|nos|no|no\.|nr|item|عدد|حبه|حبة|قطعة|راس|رأس|بند)$/i.test(u)
  ) {
    return 'item';
  }

  // Weight
  if (/^(kg|kilo|كجم|كيلو|كيلوجرام)$/i.test(stripped) || /^(kg|kilo|كجم|كيلو|كيلوجرام)$/i.test(u)) return 'kg';
  if (/^(ton|tonne|طن)$/i.test(stripped) || /^(ton|tonne|طن)$/i.test(u)) return 'ton';

  // Sets / Points
  if (/^(set|طقم|مجموعة)$/i.test(stripped) || /^(set|طقم|مجموعة)$/i.test(u)) return 'set';
  if (/^(point|pt|نقطة|مخرج)$/i.test(stripped) || /^(point|pt|نقطة|مخرج)$/i.test(u)) return 'point';

  // Time / Trips
  if (/^(day|يوم|يومية)$/i.test(stripped) || /^(day|يوم|يومية)$/i.test(u)) return 'day';
  if (/^(month|شهر)$/i.test(stripped) || /^(month|شهر)$/i.test(u)) return 'month';
  if (/^(trip|نقلة|مشوار)$/i.test(stripped) || /^(trip|نقلة|مشوار)$/i.test(u)) return 'trip';

  return raw;
}

// ----------------------------------------------------------------------
// 3. Trade / Category Auto-Classifier (Bilingual)
// ----------------------------------------------------------------------

export function classifyTradeFromDescription(desc: string): string {
  if (!desc) return 'general';
  const text = desc.toLowerCase();

  // 1. Low Current & Smart Security (CCTV, Fire Alarm, Data, Sound, Intercom)
  if (
    /تيار خفيف|انذار حريق|إنذار حريق|إنذار|انذار|كواسر|كاسر زجاج|كاميرات|مراقبة|شبكة معلومات|مخرج داتا|انتركم|إنتركم|صوتيات|اذاعة داخلية|إخلاء صوتي|low current|light current|fire alarm|cctv|ip camera|smoke detector|heat detector|manual call|call point|call station|sounder|strobe|control module|monitor module|isolator module|voice evacuation|loudspeaker|intercom|patch cord|cat\.?6|cat\.?6a|rj45|data outlet|it rack/i.test(
      text
    )
  ) {
    return 'low_current';
  }

  // 2. Fire Fighting & Suppression (Sprinklers, Extinguishers, Hydrants, Foam, Clean Agent)
  if (
    /إطفاء|اطفاء|رشاشات|حريق|مكافحة|طفاية|طفايات|صندوق حريق|هوز ريل|fm200|novec|co2|firefighting|fire fighting|fire protection|fire suppression|sprinkler|fire hose|fire search|fhc|hydrant|siamese|seamless|schedule 40|astm a53|astm a\s*53|hdpe fire|nrs|os&y|osy|tie-in|tie in/i.test(
      text
    )
  ) {
    return 'fire_fighting';
  }

  // 3. HVAC & Ventilation (High priority to capture A/C units, chillers, fans, ducts, copper refrigeration pipes before general plumbing)
  if (
    /تكييف|تهوية|دكت|صاج|تشيلر|شيلر|فان كويل|مكيف|مروحة|مراوح|مواسير نحاس|نحاس تكييف|خط سحب|خط طرد|نحاس وتبريد|hvac|chiller|duct|air conditioning|air conditioner|a\/c|split\s*unit|high\s*wall|ventilation|exhaust\s*fan|centrifugal|fcu|ahu|vrf|vrv|\bcfm\b|smacna|refrigerant|refrigeration|copper\s*pipes?|copper\s*cabling|copper\s*tubing|suction\s*line/i.test(
      text
    )
  ) {
    return 'hvac';
  }

  // 4. Electrical & Power Infrastructure
  if (
    /كهرباء|كهربائى|كهربائي|إنارة|انارة|كابلات|كابل|جهد متوسط|جهد منخفض|أكشاك|كشك محول|محول|موزع|لوحة توزيع|لوحة التوزيع|قاطع|قواطع|باسبار|بطاريات|شاحن|تأريض|نظام أرض|إلكترود|بيلر|بيلرات|عدايات|xlpe|\bsta\b|switchgear|transformer|electrical|cable|wires?|panel|switches|lighting|breaker|conduit|earthing|pillar|ك\s*ف\s*أ|ك\.ف\.أ|\bkva\b|\bmva\b|امبير|أمبير/i.test(
      text
    )
  ) {
    return 'electrical_power';
  }

  // 5. Civil & Concrete
  if (
    /خرسانة|مسلحة|عادية|حفر|ردم|إحلال|احلال|أساسات|اساسات|قواعد|أعمدة|اعمدة|سقف|كمرات|ميد|بيتون|حدادة|نجارة مسلحة|سملات|لبشة|بياض عزل خرسانة|concrete|rebar|excavation|backfill|footing|foundation|column|slab|beam|earthwork|formwork/i.test(
      text
    )
  ) {
    return 'civil_concrete';
  }

  // 6. Finishing & Architecture
  if (
    /بياض|محارة|دهان|دهانات|سيراميك|بورسلين|رخام|جرانيت|طوب|مباني|جبس|جبسوم بورد|أبواب|ابواب|شبابيك|ألومنيوم|الومنيوم|عزل|أرضيات|ارضيات|واجهات|نجارة معمارية|ديكور|plaster|paint|painting|ceramic|porcelain|marble|granite|brick|block|masonry|gypsum|door|window|aluminum|insulation|finishing|flooring|cladding|waterproof|membrane|bitumen|polystyrene|extruded|screed/i.test(
      text
    )
  ) {
    return 'architecture_finishes';
  }

  // 7. Plumbing & Sanitary
  if (
    /صحي|سباكة|مواسير|تغذية|صرف|حمام|مرحاض|خلاط|طلمبة|مضخة|بيارات|غرف تفتيش|بالوعة|سيفون|شبكة مياه|شاور|حوض|مغسلة|بانيو|سخان|خزان|جروهي|ديورافيت|ايديال|gebrit|duravit|grohe|ideal standard|shower|basin|lavatory|wc|water closet|bathtub|urinal|tray|plumbing|sanitary|drainage|water supply|pipe|piping|valve|pump|sewerage|manhole|ppr|upvc/i.test(
      text
    )
  ) {
    return 'plumbing_sanitary';
  }

  return 'general';
}

// ----------------------------------------------------------------------
// 3.1 Sheet-Level Trade Scope Detector
// ----------------------------------------------------------------------

export function detectSheetTradeScope(sheetName = '', titleText = ''): string | null {
  const combined = `${sheetName} ${titleText}`.toLowerCase();
  if (/\b(lc\b|lc\s*boq|light\s*current|low\s*current|تيار\s*خفيف|انذار|إنذار)/i.test(combined)) {
    return 'low_current';
  }
  if (/\b(elec\b|elec\s*boq|electrical|كهربا|كهرباء|power|قوى)/i.test(combined)) {
    return 'electrical_power';
  }
  if (/\b(hvac|تكييف|تهوية|duct|صاج|تبريد)/i.test(combined)) {
    return 'hvac';
  }
  if (/\b(plumb|plumbing|sanitary|صحي|سباكة|تغذية|صرف)/i.test(combined)) {
    return 'plumbing_sanitary';
  }
  if (/\b(fire|fighting|ff\b|مكافحة|اطفاء|إطفاء)/i.test(combined)) {
    return 'fire_fighting';
  }
  if (/\b(civil|concrete|خرسان|مدني|أساسات|قواعد)/i.test(combined)) {
    return 'civil_concrete';
  }
  if (/\b(arch|finishes|تشطيب|معمار|دهانات|أرضيات)/i.test(combined)) {
    return 'architecture_finishes';
  }
  return null;
}

// ----------------------------------------------------------------------
// 4. Grand Total & Summary Row Detection
// ----------------------------------------------------------------------

export function isSummaryOrTotalRow(text: string): boolean {
  if (!text) return false;
  // Normalize Arabic alef & clean
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/[\s_:.-]/g, '');

  // If text is short (< 35 chars) and contains summary keywords, it is a summary row
  if (clean.length <= 35) {
    if (
      clean.includes('اجمالي') ||
      clean.includes('مجموع') ||
      clean.includes('جملة') ||
      clean.includes('صافي') ||
      clean.includes('total') ||
      clean.includes('subtotal') ||
      clean.includes('summary')
    ) {
      return true;
    }
  }

  return false;
}

// ----------------------------------------------------------------------
// 4.1 Section & Division Header Detection
// ----------------------------------------------------------------------

export function isSectionHeaderRow(
  desc: string,
  contractQty: number,
  unitPrice: number,
  rawUnit: string
): boolean {
  if (contractQty > 0 || unitPrice > 0) return false;
  const clean = desc.trim();
  if (!clean) return false;

  // 1. Check CSI Division / Section patterns (e.g., "DIVISION 07...", "Section 075213...")
  if (/^(division|section|part|chapter|bill\s+no|sub-section|subsection|الباب|الفصل|قسم)\b/i.test(clean)) {
    return true;
  }

  // 2. Check if text is all-uppercase heading with no unit and short-to-medium length
  if (!rawUnit && clean === clean.toUpperCase() && clean.length > 5 && clean.length < 90) {
    if (
      /^(GENERAL|THERMAL|MOISTURE|MASONRY|CONCRETE|FINISHES|ELECTRICAL|MECHANICAL|PLUMBING|HVAC|EARTHWORKS|SITEWORKS|SUBSTRUCTURE|SUPERSTRUCTURE)/i.test(
        clean
      )
    ) {
      return true;
    }
  }

  return false;
}

// ----------------------------------------------------------------------
// 5. Column Alias Dictionaries
// ----------------------------------------------------------------------

export const COLUMN_ALIASES = {
  description: [
    'بيان',
    'أعمال',
    'اعمال',
    'مواصفات',
    'المواصفات',
    'وصف',
    'الوصف',
    'تفاصيل',
    'التفاصيل',
    'بند',
    'البند',
    'اسم البند',
    'مسمى',
    'بيان الاعمال والمواصفات',
    'بيان الأعمال والمواصفات',
    'بيان الاعمال',
    'بيان الأعمال',
    'شرح',
    'description',
    'desc',
    'item description',
    'work description',
    'particulars',
    'scope',
    'details',
    'item name',
    'spec',
    'specifications',
    'activity',
  ],
  quantity: [
    'كمية',
    'الكمية',
    'كميات',
    'الكميات',
    'الكمية التعاقدية',
    'الكمية التقديرية',
    'عدد',
    'العدد',
    'qty',
    'quantity',
    'quantities',
    'contract qty',
    'tender qty',
    'boq qty',
    'est qty',
    'estimated qty',
    'qnty',
    'count',
    'volume',
  ],
  unitPrice: [
    'فئة',
    'الفئة',
    'سعر',
    'السعر',
    'سعر الفئة',
    'سعر الوحدة',
    'فئة السعر',
    'سعر الفئة التعاقدي',
    'فئة التعاقد',
    'السعر الإفرادي',
    'السعر الفردي',
    'سعر البند',
    'rate',
    'unit rate',
    'unit price',
    'price',
    'u.price',
    'u_price',
    'rate/unit',
    'price/unit',
    'unit cost',
    'rate (egp)',
    'rate (sar)',
    'rate (usd)',
    'rate/m2',
    'rate/m3',
    'unit rate (egp)',
    'unit rate (sar)',
  ],
  unit: [
    'وحدة',
    'الوحدة',
    'وحدة القياس',
    'تمييز',
    'التمييز',
    'unit',
    'uom',
    'meas',
    'measurement',
    'unit of measure',
    'u/m',
  ],
  itemCode: [
    'كود',
    'كود البند',
    'رقم',
    'رقم البند',
    'مسلسل',
    'م',
    'ت',
    'رمز',
    'item',
    'item no',
    'item #',
    'code',
    'item code',
    'no',
    'no.',
    'ref',
    'ref no',
    'sn',
    's/n',
    'pos',
    '#',
    'id',
  ],
  estimatedCost: [
    'تكلفة',
    'التكلفة',
    'تكلفة تقديرية',
    'التكلفة التقديرية',
    'سعر التكلفة',
    'التكلفة التقديرية للوحدة',
    'cost',
    'unit cost',
    'estimated cost',
    'est cost',
    'target cost',
    'budget cost',
  ],
  totalPrice: [
    'إجمالي',
    'الاجمالي',
    'مجموع',
    'المجموع',
    'جملة',
    'الجملة',
    'القيمة',
    'إجمالي القيمة',
    'اجمالي القيمة',
    'المبلغ',
    'total',
    'amount',
    'total amount',
    'total price',
    'total rate',
    'value',
  ],
  category: [
    'تصنيف',
    'التصنيف',
    'قسم',
    'القسم',
    'نوع',
    'نوع البند',
    'التخصص',
    'category',
    'trade',
    'section',
    'division',
    'discipline',
  ],
  notes: [
    'ملاحظات',
    'ملاحظة',
    'notes',
    'note',
    'remarks',
    'remark',
    'comments',
  ],
};

export function testCellMatches(cellStr: string, aliases: string[]): boolean {
  if (!cellStr) return false;
  const clean = cellStr.trim().toLowerCase().replace(/[\s_()/-]/g, '');
  return aliases.some((alias) => {
    const cleanAlias = alias.toLowerCase().replace(/[\s_()/-]/g, '');
    if (cleanAlias.length <= 2) {
      return clean === cleanAlias;
    }
    return clean === cleanAlias || clean.includes(cleanAlias);
  });
}

// ----------------------------------------------------------------------
// 6. Header Row Scanner (Finds Headers Anywhere in Top 30 Rows)
// ----------------------------------------------------------------------

export function detectHeaderRow(matrix: any[][]): { headerRowIdx: number; mapping: ColumnMapping } {
  let bestRowIdx = 0;
  let bestScore = -1;
  let bestMapping: ColumnMapping = {
    itemCodeCol: -1,
    descriptionCol: -1,
    categoryCol: -1,
    unitCol: -1,
    qtyCol: -1,
    unitPriceCol: -1,
    estimatedCostCol: -1,
    notesCol: -1,
    totalPriceCol: -1,
  };

  const maxScan = Math.min(matrix.length, 30);

  for (let r = 0; r < maxScan; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    // Filter out completely empty or 1-cell rows
    const nonEmptyCells = row.filter((c) => cleanString(c).length > 0);
    if (nonEmptyCells.length < 2) continue;

    let rowScore = 0;
    const currentMapping: ColumnMapping = {
      itemCodeCol: -1,
      descriptionCol: -1,
      categoryCol: -1,
      unitCol: -1,
      qtyCol: -1,
      unitPriceCol: -1,
      estimatedCostCol: -1,
      notesCol: -1,
      totalPriceCol: -1,
    };

    for (let c = 0; c < row.length; c++) {
      const cell = cleanString(row[c]);
      if (!cell) continue;

      // Item Name vs Description
      const isExplicitDesc = /^(description|desc|item description|work description|بيان الأعمال|بيان الاعمال|المواصفات|شرح)$/i.test(cell);
      const isItemName = /^(item name|اسم البند|اسم الصنف|item title)$/i.test(cell);

      if (isExplicitDesc) {
        if (currentMapping.descriptionCol !== -1 && currentMapping.itemNameCol === undefined) {
          currentMapping.itemNameCol = currentMapping.descriptionCol;
        }
        currentMapping.descriptionCol = c;
        rowScore += 7;
      } else if (isItemName) {
        if (currentMapping.descriptionCol === -1) {
          currentMapping.descriptionCol = c;
          currentMapping.itemNameCol = c;
        } else {
          currentMapping.itemNameCol = c;
        }
        rowScore += 6;
      } else if (currentMapping.descriptionCol === -1 && testCellMatches(cell, COLUMN_ALIASES.description)) {
        currentMapping.descriptionCol = c;
        rowScore += 6;
      }
      // Quantity
      else if (currentMapping.qtyCol === -1 && testCellMatches(cell, COLUMN_ALIASES.quantity)) {
        currentMapping.qtyCol = c;
        rowScore += 5;
      }
      // Unit Price (Make sure it's not Total)
      else if (
        currentMapping.unitPriceCol === -1 &&
        testCellMatches(cell, COLUMN_ALIASES.unitPrice) &&
        !testCellMatches(cell, COLUMN_ALIASES.totalPrice)
      ) {
        currentMapping.unitPriceCol = c;
        rowScore += 5;
      }
      // Unit
      else if (currentMapping.unitCol === -1 && testCellMatches(cell, COLUMN_ALIASES.unit)) {
        currentMapping.unitCol = c;
        rowScore += 4;
      }
      // Item Code / Number
      else if (currentMapping.itemCodeCol === -1 && testCellMatches(cell, COLUMN_ALIASES.itemCode)) {
        currentMapping.itemCodeCol = c;
        rowScore += 3;
      }
      // Total Price
      else if (currentMapping.totalPriceCol === -1 && testCellMatches(cell, COLUMN_ALIASES.totalPrice)) {
        currentMapping.totalPriceCol = c;
        rowScore += 3;
      }
      // Estimated Cost
      else if (currentMapping.estimatedCostCol === -1 && testCellMatches(cell, COLUMN_ALIASES.estimatedCost)) {
        currentMapping.estimatedCostCol = c;
        rowScore += 2;
      }
      // Category
      else if (currentMapping.categoryCol === -1 && testCellMatches(cell, COLUMN_ALIASES.category)) {
        currentMapping.categoryCol = c;
        rowScore += 2;
      }
      // Notes
      else if (currentMapping.notesCol === -1 && testCellMatches(cell, COLUMN_ALIASES.notes)) {
        currentMapping.notesCol = c;
        rowScore += 1;
      }
    }

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestRowIdx = r;
      bestMapping = currentMapping;
    }
  }

  // Fallback & Refinement:
  const sampleDataRows = matrix.slice(bestRowIdx + 1, Math.min(matrix.length, bestRowIdx + 20));

  // If description column wasn't detected by header name,
  // find the text column with the longest average string length in data rows
  if (bestMapping.descriptionCol === -1 && sampleDataRows.length > 0) {
    const colLengths: Record<number, { sum: number; count: number }> = {};

    sampleDataRows.forEach((r) => {
      if (Array.isArray(r)) {
        r.forEach((cell, cIdx) => {
          const str = cleanString(cell);
          if (str.length > 0 && isNaN(Number(str))) {
            if (!colLengths[cIdx]) colLengths[cIdx] = { sum: 0, count: 0 };
            colLengths[cIdx].sum += str.length;
            colLengths[cIdx].count += 1;
          }
        });
      }
    });

    let maxAvg = 0;
    let longestCol = -1;
    for (const [cStr, stats] of Object.entries(colLengths)) {
      const avg = stats.sum / stats.count;
      if (avg > maxAvg && avg > 10) {
        maxAvg = avg;
        longestCol = Number(cStr);
      }
    }

    if (longestCol !== -1) {
      bestMapping.descriptionCol = longestCol;
    }
  }

  // Refine unitPriceCol if candidate column is completely empty in data rows
  if (sampleDataRows.length > 0) {
    const headerRow = matrix[bestRowIdx] || [];

    let currentPriceNumCount = 0;
    if (bestMapping.unitPriceCol !== -1) {
      sampleDataRows.forEach((r) => {
        if (Array.isArray(r) && cleanNumber(r[bestMapping.unitPriceCol]) > 0) {
          currentPriceNumCount++;
        }
      });
    }

    // If current unitPriceCol is empty or has 0 numbers, search for alternative price column with numbers
    if (currentPriceNumCount === 0) {
      for (let c = 0; c < headerRow.length; c++) {
        if (
          c === bestMapping.descriptionCol ||
          c === bestMapping.qtyCol ||
          c === bestMapping.unitCol ||
          c === bestMapping.totalPriceCol
        ) {
          continue;
        }
        const cell = cleanString(headerRow[c]);
        const isPriceAlias = testCellMatches(cell, COLUMN_ALIASES.unitPrice);
        if (isPriceAlias) {
          let numCount = 0;
          sampleDataRows.forEach((r) => {
            if (Array.isArray(r) && cleanNumber(r[c]) > 0) numCount++;
          });
          if (numCount > 0) {
            bestMapping.unitPriceCol = c;
            break;
          }
        }
      }
    }
  }

  return { headerRowIdx: bestRowIdx, mapping: bestMapping };
}

// ----------------------------------------------------------------------
// 7. Extract BOQ Rows from Matrix using Mapping
// ----------------------------------------------------------------------

export function extractBoqRows(
  matrix: any[][],
  headerRowIdx: number,
  mapping: ColumnMapping,
  sheetTradeHint?: string,
  sourceFileName?: string,
  sourceSheetName?: string
): ParsedBoqItemResult[] {
  const results: ParsedBoqItemResult[] = [];
  const startRow = headerRowIdx + 1;
  let currentParentContext = '';

  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    // Check if entire row is empty
    const hasData = row.some((c) => cleanString(c).length > 0);
    if (!hasData) continue;

    // 1. Description
    const nameRaw = mapping.itemNameCol !== undefined && mapping.itemNameCol >= 0 ? cleanString(row[mapping.itemNameCol]) : '';
    let descRaw = mapping.descriptionCol >= 0 ? cleanString(row[mapping.descriptionCol]) : '';

    if (nameRaw && descRaw && mapping.itemNameCol !== mapping.descriptionCol) {
      if (!descRaw.toLowerCase().includes(nameRaw.toLowerCase())) {
        descRaw = `${nameRaw} — ${descRaw}`;
      }
    } else if (nameRaw && !descRaw) {
      descRaw = nameRaw;
    }

    // If description matches total/summary row, skip it completely
    if (isSummaryOrTotalRow(descRaw)) {
      continue;
    }

    // 2. Item Code
    let codeRaw = mapping.itemCodeCol >= 0 ? cleanString(row[mapping.itemCodeCol]) : '';
    if (isSummaryOrTotalRow(codeRaw)) {
      continue;
    }
    if (!codeRaw) {
      codeRaw = `BOQ-${String(results.length + 1).padStart(3, '0')}`;
    }

    // 3. Raw Quantity and Unit with Smart Swapping (Handles L.S in Qty column and 1 in Unit column)
    const rawQtyCell = mapping.qtyCol >= 0 ? cleanString(row[mapping.qtyCol]) : '';
    const rawUnitCell = mapping.unitCol >= 0 ? cleanString(row[mapping.unitCol]) : '';

    const isQtyUnitLike = /^(l\.s|ls|l\/s|lump\s*sum|job|مقطوعية|جملة|m|m2|m3|م\.ط|م2|م3|no|nos|pcs|عدد|طقم|set)$/i.test(rawQtyCell);
    const isUnitNumLike = rawUnitCell !== '' && !isNaN(Number(normalizeArabicDigits(rawUnitCell).replace(/,/g, '')));

    let contractQty = 0;
    let rawUnit = '';
    if (isQtyUnitLike && isUnitNumLike) {
      contractQty = cleanNumber(rawUnitCell);
      rawUnit = rawQtyCell;
    } else {
      contractQty = cleanNumber(rawQtyCell);
      rawUnit = rawUnitCell;
    }

    const unitPrice = mapping.unitPriceCol >= 0 ? cleanNumber(row[mapping.unitPriceCol]) : 0;
    const estimatedUnitCost = mapping.estimatedCostCol >= 0 ? cleanNumber(row[mapping.estimatedCostCol]) : 0;

    let totalPrice = contractQty * unitPrice;
    if (totalPrice === 0 && mapping.totalPriceCol >= 0) {
      totalPrice = cleanNumber(row[mapping.totalPriceCol]);
    }

    // 4. Unit Normalization
    let unit = normalizeUnit(rawUnit);
    if (!unit && contractQty > 0) {
      unit = 'm3'; // Default fallback for quantifiable items with missing unit
    }

    // 5. Section Header & Preamble Detection
    const isSectionHeader = isSectionHeaderRow(descRaw, contractQty, unitPrice, rawUnit);
    const isPreamble =
      !isSectionHeader &&
      contractQty <= 0 &&
      unitPrice <= 0 &&
      (!rawUnit || rawUnit.trim() === '');

    const isNoteRow = /^(note|notes|ملاحظة|ملاحظات|تنبيه|conditions)/i.test(codeRaw.trim()) || /^(note:|ملاحظة:)/i.test(descRaw.trim());

    if (isSectionHeader || (isPreamble && !isNoteRow)) {
      if (descRaw.length > 5 && !isNoteRow) {
        currentParentContext = descRaw;
      }
    } else if (!isPreamble) {
      // Sub-item: Check if it should inherit or merge parent context for completeness
      const isSubItemCode = /^[a-z0-9]$/i.test(codeRaw.trim()) || /^[0-9]+\.[0-9]+(\.[0-9]+)*$/i.test(codeRaw.trim()) || /^BOQ-[0-9]+$/i.test(codeRaw.trim());
      const isShortDesc = descRaw.length < 50;
      
      if (currentParentContext && (isSubItemCode && isShortDesc) && !descRaw.toLowerCase().includes(currentParentContext.toLowerCase().slice(0, 15))) {
        descRaw = `${currentParentContext} — ${descRaw}`;
      }
    }

    // 6. Category / Trade Classification (Uses Sheet-Level Hint or Keyword Classifier)
    let category = mapping.categoryCol >= 0 ? cleanString(row[mapping.categoryCol]) : '';
    if (!category || category === 'general') {
      if (sheetTradeHint) {
        category = sheetTradeHint;
      } else {
        category = classifyTradeFromDescription(descRaw);
      }
    } else if (sheetTradeHint) {
      category = sheetTradeHint;
    }
    if (category === 'general') {
      const matched = matchEngineeringConstant(descRaw, codeRaw);
      if (matched?.trade) {
        category = matched.trade;
      }
    }

    // 7. Notes
    const notes = mapping.notesCol >= 0 ? cleanString(row[mapping.notesCol]) : undefined;

    let isValid = true;
    let status: BoqRowStatus = 'ready';
    let warningMessage: string | undefined;
    let validationError: string | undefined;
    let finalUnitPrice = unitPrice;
    let finalEstimatedCost = estimatedUnitCost;
    let finalTotalPrice = totalPrice;
    let isAutoPriced = false;
    let matchedConstantCode: string | undefined;

    if (!descRaw || descRaw.length < 2) {
      isValid = false;
      status = 'invalid';
      validationError = 'بيان ومواصفات البند مطلوبة';
    } else if (isSectionHeader) {
      isValid = false;
      status = 'unpriced';
      warningMessage = 'عنوان رئيسي / فصل استشاري (Division / Section Header)';
    } else if (isPreamble) {
      isValid = true;
      status = 'unpriced';
      warningMessage = 'ديباجات وشروط عامة للمقايسة (بدون حصر أو كميات)';
    } else {
      // Check for master library match for proactive auto-pricing
      const matched = matchEngineeringConstant(descRaw, codeRaw);
      if (matched) {
        matchedConstantCode = matched.itemCode;
        if (finalUnitPrice <= 0 && matched.suggestedUnitPrice > 0) {
          finalUnitPrice = matched.suggestedUnitPrice;
          finalEstimatedCost = matched.directCost;
          finalTotalPrice = contractQty * finalUnitPrice;
          isAutoPriced = true;
        }
      }

      // If estimated unit cost was not in the Excel file, compute baseline direct cost from constant or standard markup
      if (finalEstimatedCost <= 0 && finalUnitPrice > 0) {
        const matched = matchEngineeringConstant(descRaw, codeRaw);
        if (matched?.directCost && matched.directCost > 0) {
          finalEstimatedCost = matched.directCost;
        } else {
          // INV-FE3-FRONTEND-BOOK-DIGITS: the baseline direct cost is a
          // unit price (money); it rounds at the tenant's book digits.
          finalEstimatedCost = roundMoneyValue(finalUnitPrice / 1.30, currencyMoneyDigits(getGlobalSystemCurrency()));
        }
      }

      if (contractQty <= 0 && finalUnitPrice <= 0) {
        isValid = true;
        status = 'unpriced';
        warningMessage = 'غير مسعر وكمية صفرية (بند مبدئي للمناقصة)';
      } else if (finalUnitPrice <= 0) {
        isValid = true;
        status = 'unpriced';
        warningMessage = 'غير مسعر (بند مناقصة للتسعير لاحقاً)';
      } else if (contractQty <= 0) {
        isValid = true;
        status = 'zero_qty';
        warningMessage = isAutoPriced
          ? 'تم التسعير آلياً، والكمية التعاقدية المبدئية: 0'
          : 'كمية تعاقدية مبدئية: 0';
      } else {
        isValid = true;
        status = 'ready';
      }
    }

    results.push({
      index: results.length + 1,
      rawRowIdx: r,
      itemCode: codeRaw,
      description: descRaw,
      category,
      unit,
      contractQty,
      unitPrice: finalUnitPrice,
      estimatedUnitCost: finalEstimatedCost,
      totalPrice: finalTotalPrice,
      notes: notes || undefined,
      isValid,
      isSectionHeader,
      isPreamble,
      status,
      warningMessage,
      validationError,
      isAutoPriced,
      matchedConstantCode,
      sourceFileName,
      sourceSheetName,
    });
  }

  return results;
}

// ----------------------------------------------------------------------
// 8. Main Workbook Parser Entrypoint
// ----------------------------------------------------------------------

export async function parseBoqWorkbook(
  file: File,
  targetSheetName?: string
): Promise<WorkbookParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const fileName = file.name;

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('ملف الـ Excel لا يحتوي على أي صفحات عمل (Sheets).');
  }

  // 1. Sheet Detection & Ranking
  const sheetInfos: RawSheetInfo[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    let score = 0;
    const lowerName = name.toLowerCase();

    // Name relevance
    if (/boq|مقايسة|كميات|bill|items|جدول|مشروع|works|اعمال/i.test(lowerName)) {
      score += 15;
    }
    if (/غلاف|cover|تعليمات|instructions|summary|ملخص/i.test(lowerName)) {
      score -= 10;
    }

    // Row density
    if (matrix.length > 5) score += 5;
    if (matrix.length > 20) score += 10;

    return {
      name,
      rowCount: matrix.length,
      score,
    };
  });

  // Sort sheets by score descending
  sheetInfos.sort((a, b) => b.score - a.score);

  // Pick target sheet
  const selectedSheet = targetSheetName && workbook.Sheets[targetSheetName]
    ? targetSheetName
    : sheetInfos[0].name;

  const worksheet = workbook.Sheets[selectedSheet];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

  if (!matrix || matrix.length === 0) {
    throw new Error(`الصفحة "${selectedSheet}" فارغة تماماً.`);
  }

  // 2. Header Row & Column Mapping Auto-Detection
  const { headerRowIdx, mapping } = detectHeaderRow(matrix);

  const rawHeaders = Array.isArray(matrix[headerRowIdx])
    ? matrix[headerRowIdx].map((h) => cleanString(h))
    : [];

  // 3. Extract Rows with Sheet-Level & File-Level Trade Hint
  const titleText = matrix.slice(0, Math.max(headerRowIdx, 3)).flat().map((c) => cleanString(c)).join(' ');
  const sheetTradeHint = detectSheetTradeScope(selectedSheet, `${titleText} ${fileName}`) || undefined;
  const rows = extractBoqRows(matrix, headerRowIdx, mapping, sheetTradeHint, fileName, selectedSheet);

  const validRows = rows.filter((r) => r.isValid);
  const unpricedCount = rows.filter((r) => r.status === 'unpriced' && !r.isSectionHeader).length;
  const zeroQtyCount = rows.filter((r) => r.status === 'zero_qty').length;
  const sectionHeaderCount = rows.filter((r) => r.isSectionHeader).length;
  const invalidCount = rows.filter((r) => !r.isValid && !r.isSectionHeader).length;

  const totalContractValue = validRows.reduce((sum, r) => sum + r.contractQty * r.unitPrice, 0);
  const totalEstimatedCost = validRows.reduce((sum, r) => sum + r.contractQty * r.estimatedUnitCost, 0);

  return {
    sheetNames: workbook.SheetNames,
    selectedSheet,
    headerRowIndex: headerRowIdx,
    headers: rawHeaders,
    columnMapping: mapping,
    rows,
    validCount: validRows.length,
    unpricedCount,
    zeroQtyCount,
    sectionHeaderCount,
    invalidCount,
    totalContractValue,
    totalEstimatedCost,
  };
}

export function reExtractBoqWithCustomMapping(
  fileBuffer: ArrayBuffer,
  sheetName: string,
  headerRowIdx: number,
  customMapping: ColumnMapping,
  fileName?: string
): { rows: ParsedBoqItemResult[]; validCount: number; unpricedCount: number; zeroQtyCount: number; sectionHeaderCount: number; invalidCount: number; totalContractValue: number; totalEstimatedCost: number } {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`صفحة العمل ${sheetName} غير موجودة`);

  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
  const titleText = matrix.slice(0, Math.max(headerRowIdx, 3)).flat().map((c) => cleanString(c)).join(' ');
  const sheetTradeHint = detectSheetTradeScope(sheetName, `${titleText} ${fileName || ''}`) || undefined;
  const rows = extractBoqRows(matrix, headerRowIdx, customMapping, sheetTradeHint, fileName, sheetName);

  const validRows = rows.filter((r) => r.isValid);
  const unpricedCount = rows.filter((r) => r.status === 'unpriced' && !r.isSectionHeader).length;
  const zeroQtyCount = rows.filter((r) => r.status === 'zero_qty').length;
  const sectionHeaderCount = rows.filter((r) => r.isSectionHeader).length;
  const invalidCount = rows.filter((r) => !r.isValid && !r.isSectionHeader).length;

  const totalContractValue = validRows.reduce((sum, r) => sum + r.contractQty * r.unitPrice, 0);
  const totalEstimatedCost = validRows.reduce((sum, r) => sum + r.contractQty * r.estimatedUnitCost, 0);

  return {
    rows,
    validCount: validRows.length,
    unpricedCount,
    zeroQtyCount,
    sectionHeaderCount,
    invalidCount,
    totalContractValue,
    totalEstimatedCost,
  };
}
