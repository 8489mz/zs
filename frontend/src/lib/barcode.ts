import { escapeHtml, printHtmlDocument, resolvePrintSettings } from '@/lib/browser';
import type { AppSettings, Product, ProductUnit, Sale } from '@/types/domain';
import { formatCurrency } from '@/lib/format';
import { printPostedSaleReceipt } from '@/lib/pos-printing';

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
] as const;

const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_CODE_B = 100;
const CODE128_CODE_C = 99;
const CODE128_STOP = 106;

export function normalizeCode128Value(value: unknown) {
  return String(value == null ? '' : value).trim();
}

const ARABIC_KEYBOARD_TO_ENGLISH_MAP: Record<string, string> = {
  // Arabic Letters
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': '\'',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'لا': 'b', 'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
  // Capital / Shift letters on Arabic keyboard
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'لإ': 'T', 'إ': 'Y', '‘': 'U', '÷': 'I', '×': 'O', '؛': 'P',
  'ِ': 'A', 'ٍ': 'S', 'لأ': 'G', 'أ': 'H', 'ـ': 'J', '،': 'K',
  '~': 'Z', 'ْ': 'X', 'لآ': 'B', 'آ': 'N', '؟': '?',
  // Arabic & Persian digits
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function remapArabicKeyboardToEnglish(input: string): string {
  if (!input) return '';
  let result = '';
  for (let i = 0; i < input.length; i++) {
    if (i + 1 < input.length) {
      const pair = input.substring(i, i + 2);
      if (ARABIC_KEYBOARD_TO_ENGLISH_MAP[pair]) {
        result += ARABIC_KEYBOARD_TO_ENGLISH_MAP[pair];
        i++;
        continue;
      }
    }
    const char = input[i];
    result += ARABIC_KEYBOARD_TO_ENGLISH_MAP[char] !== undefined ? ARABIC_KEYBOARD_TO_ENGLISH_MAP[char] : char;
  }
  return result;
}

/**
 * Ordered barcode lookup candidates covering Windows Arabic OS keyboard layouts
 * (e.g. Arabic 101/102/AZERTY mapping '/' or '-' to 'ظ' in '321321ظ007').
 */
export function getBarcodeLookupCandidates(rawCode: string): string[] {
  const trimmed = String(rawCode || '').trim();
  if (!trimmed) return [];

  const candidates: string[] = [trimmed];
  if (!/\s/.test(trimmed)) {
    const remapped = remapArabicKeyboardToEnglish(trimmed).trim();
    if (remapped && !candidates.includes(remapped)) {
      candidates.push(remapped);
    }
    if (remapped.includes('/') || trimmed.includes('ظ')) {
      const hyphenVariant = remapped.replace(/\//g, '-');
      if (hyphenVariant && !candidates.includes(hyphenVariant)) {
        candidates.push(hyphenVariant);
      }
    }
  }
  return candidates;
}

export function isCode128BValueSupported(value: unknown) {
  const normalized = normalizeCode128Value(value);
  if (!normalized) return false;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

export function encodeCode128Auto(str: string): number[] {
  if (!str) return [];

  // 1. Purely numeric string
  if (/^\d+$/.test(str)) {
    if (str.length === 1) {
      return [CODE128_START_B, str.charCodeAt(0) - 32];
    }
    if (str.length % 2 === 0) {
      // Even digits: 100% Subset C (2 digits per symbol)
      const codes = [CODE128_START_C];
      for (let i = 0; i < str.length; i += 2) {
        codes.push(parseInt(str.slice(i, i + 2), 10));
      }
      return codes;
    } else {
      // Odd digits (>= 3): start B with first digit, then Subset C for remaining pairs
      const codes = [CODE128_START_B, str.charCodeAt(0) - 32, CODE128_CODE_C];
      for (let i = 1; i < str.length; i += 2) {
        codes.push(parseInt(str.slice(i, i + 2), 10));
      }
      return codes;
    }
  }

  // 2. Alphanumeric string with smart Subset C switching for runs of 4+ digits
  const codes: number[] = [CODE128_START_B];
  let inSetC = false;
  let i = 0;

  while (i < str.length) {
    if (!inSetC) {
      const match = str.slice(i).match(/^(\d{4,})/);
      if (match) {
        const digitRun = match[1];
        const count = digitRun.length % 2 === 0 ? digitRun.length : digitRun.length - 1;
        codes.push(CODE128_CODE_C);
        inSetC = true;
        for (let k = 0; k < count; k += 2) {
          codes.push(parseInt(str.slice(i + k, i + k + 2), 10));
        }
        i += count;
        continue;
      }
      codes.push(str.charCodeAt(i) - 32);
      i += 1;
    } else {
      if (i + 1 < str.length && /^\d{2}/.test(str.slice(i, i + 2))) {
        codes.push(parseInt(str.slice(i, i + 2), 10));
        i += 2;
      } else {
        codes.push(CODE128_CODE_B);
        inSetC = false;
      }
    }
  }

  return codes;
}

export function buildCode128Svg(value: unknown) {
  const normalized = normalizeCode128Value(value);
  if (!isCode128BValueSupported(normalized)) return '';

  const codes = encodeCode128Auto(normalized);
  if (!codes.length) return '';

  let checksum = codes[0];
  for (let index = 1; index < codes.length; index += 1) {
    checksum += codes[index] * index;
  }
  codes.push(checksum % 103, CODE128_STOP);

  const moduleWidth = 40;
  const quietZone = 280; // 7X inside SVG + white label edge margin preserves >= 9.5X quiet zone while stretching bars wide edge-to-edge
  let x = quietZone;
  const rects: Array<{ x: number; width: number }> = [];

  codes.forEach((code) => {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) return;
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]) * moduleWidth;
      if (index % 2 === 0) {
        // Trim 0.25X total bar width (5 units each edge on 40-unit grid -> 30 black : 50 white) to eliminate heavy "bold" ink bleed while keeping timing T exact
        rects.push({ x: x + 5, width: width - 10 });
      }
      x += width;
    }
  });

  const totalWidth = x + quietZone;
  const height = 400;
  const rectSvg = [
    `<rect x="0" y="0" width="${totalWidth}" height="${height}" fill="#fff" />`,
    ...rects.map((r) => `<rect x="${r.x}" y="0" width="${r.width}" height="${height}" fill="#000" />`),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" style="display:block;width:100%;height:100%;" aria-label="Barcode ${escapeHtml(normalized)}">${rectSvg}</svg>`;
}

function randomNumericSegment(length: number, avoidLeadingZero = false): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    const minDigit = index === 0 && avoidLeadingZero ? 2 : 0;
    const digit = minDigit + Math.floor(Math.random() * (10 - minDigit));
    out += String(digit);
  }
  return out;
}

export function createGeneratedBarcode(existingValues: string[], prefix = 'ZS') {
  const existing = new Set(existingValues.map((value) => normalizeCode128Value(value).toLowerCase()).filter(Boolean));
  const cleanPrefix = normalizeCode128Value(prefix);
  const useDefaultPureNumeric = !cleanPrefix || cleanPrefix.toUpperCase() === 'ZS';
  const isNumericPrefix = /^\d+$/.test(cleanPrefix);

  for (let attempt = 0; attempt < 500; attempt += 1) {
    let candidate = '';
    if (useDefaultPureNumeric) {
      // 8 pure digits -> 100% Code 128 Subset C (99 total modules, ~2x fewer bars for fast scanning on weak scanners)
      candidate = randomNumericSegment(8, true);
    } else if (isNumericPrefix) {
      const needed = Math.max(4, 8 - cleanPrefix.length);
      const evenPad = (cleanPrefix.length + needed) % 2 === 0 ? needed : needed + 1;
      candidate = `${cleanPrefix}${randomNumericSegment(evenPad, false)}`;
    } else {
      candidate = `${cleanPrefix}${randomNumericSegment(6, false)}`;
    }
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }

  const tailDigits = String(Date.now()).slice(-8);
  return useDefaultPureNumeric ? `2${tailDigits.slice(1)}` : `${cleanPrefix}${tailDigits}`;
}

export function createSequentialVariantBarcode(
  prefix: string,
  startSequence: number,
  usedBarcodes: Set<string>,
): string {
  const cleanPrefix = normalizeCode128Value(prefix);
  if (!cleanPrefix) return '';
  const isNumericPrefix = /^\d+$/.test(cleanPrefix);
  let sequence = Math.max(1, Math.round(startSequence));

  const formatCandidate = (seq: number) => {
    if (isNumericPrefix) {
      // Even-length pure numeric strings encode cleanly in Code 128 Subset C (2 digits per symbol) with no hyphen overhead
      const basePad = cleanPrefix.length % 2 === 0 ? 2 : 3;
      const minWidth = seq >= Math.pow(10, basePad) ? basePad + 2 : basePad;
      return `${cleanPrefix}${String(seq).padStart(minWidth, '0')}`;
    }
    return `${cleanPrefix}${String(seq).padStart(2, '0')}`;
  };

  let candidate = formatCandidate(sequence);
  while (usedBarcodes.has(candidate.toLowerCase())) {
    sequence += 1;
    candidate = formatCandidate(sequence);
  }
  usedBarcodes.add(candidate.toLowerCase());
  return candidate;
}

export function collectExistingBarcodes(products: Product[]) {
  return products.flatMap((product) => [
    normalizeCode128Value(product.barcode),
    ...(product.units || []).map((unit) => normalizeCode128Value(unit.barcode))
  ]).filter(Boolean);
}

export function productUnitsWithFallback(product?: Product | null) {
  const units = Array.isArray(product?.units) && product?.units.length
    ? product.units
    : [{ id: 'u-1', name: 'قطعة', multiplier: 1, barcode: product?.barcode || '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true } satisfies ProductUnit];
  return units;
}

export function printBarcodeSheet(options: {
  product: Product;
  unit?: ProductUnit | null;
  copies?: number;
  settings?: Partial<AppSettings> | null;
  deviceName?: string;
}) {
  const product = options.product;
  const units = productUnitsWithFallback(product);
  const unit = options.unit || units.find((entry) => entry.isBaseUnit) || units[0];
  const barcode = normalizeCode128Value(unit?.barcode || product.barcode);
  if (!barcode) throw new Error('الصنف أو الوحدة لا تحتوي على باركود');
  if (!isCode128BValueSupported(barcode)) {
    throw new Error('الباركود الحالي يحتوي على رموز غير مدعومة في Code 128. استخدم إنجليزي أو أرقام أو رموز قياسية فقط.');
  }
  const barcodeSvg = buildCode128Svg(barcode);
  if (!barcodeSvg) throw new Error('تعذر بناء الباركود الحالي للطباعة');
  const count = Math.max(1, Number(options.copies || 1));
  const priceFactor = Math.max(1, Number(unit?.multiplier || 1));
  const cards = Array.from({ length: count }).map(() => `
    <div class="barcode-card">
      <div class="barcode-title"><strong>${escapeHtml(product.name || '-')}</strong></div>
      <div class="muted">الوحدة: ${escapeHtml(unit?.name || 'قطعة')}</div>
      <div class="barcode-svg-wrap">${barcodeSvg}</div>
      <div class="barcode-text">${escapeHtml(barcode)}</div>
      <div class="barcode-type">CODE 128</div>
      <div class="barcode-price">${formatCurrency(Number(product.retailPrice || 0) * priceFactor)}</div>
    </div>
  `).join('');

  const resolvedPrint = resolvePrintSettings();
  const barcodePrinterName = String(
    options.deviceName ||
    resolvedPrint.electronBarcodePrinter ||
    options.settings?.posElectronBarcodePrinter ||
    ''
  ).trim();
  const barcodeBridgePrinter = String(
    resolvedPrint.windowsBarcodePrinter ||
    options.settings?.posWindowsBarcodePrinterName ||
    ''
  ).trim();

  printHtmlDocument('Barcode Sheet', `
    <div class="barcode-sheet">${cards}</div>
  `, {
    subtitle: 'ملصقات باركود جاهزة للطباعة',
    pageSize: 'A4',
    orientation: 'landscape',
    deviceName: barcodePrinterName || undefined,
    windowsPrinterName: barcodeBridgePrinter || undefined,
    disableWindowsBridge: !barcodeBridgePrinter,
    extraStyles: `
      .barcode-sheet{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .barcode-card{border:1px dashed #999;border-radius: 8px;padding:12px;text-align:center;break-inside:avoid;background:#fff}
      .barcode-title{font-size:15px;line-height:1.4;margin-bottom:4px}
      .barcode-svg-wrap{margin:10px 0 4px;height:80px}
      .barcode-svg-wrap svg{display:block;width:100%;height:100%}
      .barcode-text{font-size:13px;letter-spacing:1.1px;font-weight:700;direction:ltr;text-align:center}
      .barcode-type{margin-top:4px;font-size:11px;letter-spacing:.8px;color:#475569;direction:ltr}
      .barcode-price{margin-top:8px;font-size:14px;font-weight:700}
      .muted{color:#64748b;font-size:13px}
      @media print{.barcode-card{border-color:#777}}
    `
  });
}

export function getMissingBarcodeRows(products: Product[]) {
  return products.flatMap((product) => {
    const units = productUnitsWithFallback(product);
    const missingUnits = units.filter((unit) => !normalizeCode128Value(unit.barcode));
    if (!normalizeCode128Value(product.barcode) || missingUnits.length) {
      return [{
        productId: String(product.id),
        productName: product.name,
        productBarcode: normalizeCode128Value(product.barcode),
        missingUnits: missingUnits.map((unit) => unit.name || 'قطعة')
      }];
    }
    return [];
  });
}

export function printSaleReceipt(sale: Sale) {
  return printPostedSaleReceipt(sale, { pageSize: 'receipt' });
}
