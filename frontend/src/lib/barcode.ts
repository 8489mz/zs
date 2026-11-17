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
const BARCODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode128Value(value: unknown) {
  return String(value == null ? '' : value).trim();
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
    if (str.length % 2 === 0) {
      // Even digits: 100% Subset C (2 digits per symbol)
      const codes = [CODE128_START_C];
      for (let i = 0; i < str.length; i += 2) {
        codes.push(parseInt(str.slice(i, i + 2), 10));
      }
      return codes;
    } else {
      // Odd digits: start B with first digit, then Subset C for remaining pairs
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

  const moduleWidth = 2;
  const quietZone = 16;
  const height = 72;
  let x = quietZone;
  const rects: string[] = [];

  codes.forEach((code) => {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) return;
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]) * moduleWidth;
      if (index % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000" />`);
      }
      x += width;
    }
  });

  const totalWidth = x + quietZone;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block;width:100%;height:100%;" aria-label="Barcode ${escapeHtml(normalized)}">${rects.join('')}</svg>`;
}

export function createGeneratedBarcode(existingValues: string[], prefix = 'ZS') {
  const existing = new Set(existingValues.map((value) => normalizeCode128Value(value)).filter(Boolean));
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const randomSegment = Array.from({ length: 10 }, () => BARCODE_CHARS[Math.floor(Math.random() * BARCODE_CHARS.length)]).join('');
    const candidate = `${prefix}-${randomSegment}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${prefix}-${Date.now()}`;
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

  const barcodePrinterName = String(
    options.deviceName ||
    options.settings?.posElectronBarcodePrinter ||
    resolvePrintSettings().electronBarcodePrinter ||
    ''
  ).trim();

  printHtmlDocument('Barcode Sheet', `
    <div class="barcode-sheet">${cards}</div>
  `, {
    subtitle: 'ملصقات باركود جاهزة للطباعة',
    pageSize: 'A4',
    orientation: 'landscape',
    deviceName: barcodePrinterName || undefined,
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
