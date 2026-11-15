import type { AppSettings, Product } from '@/types/domain';

const ARABIC_DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export interface WeightedBarcodeConfig {
  enabled: boolean;
  prefix: string;
  productCodeLength: number;
  weightDigits: number;
  weightDecimals: number;
  valueMode: 'weight' | 'price';
}

export interface WeightedBarcodeParseResult {
  rawCode: string;
  prefix: string;
  productCode: string;
  weightText: string;
  quantity: number;
  priceAmount?: number;
}

export type WeightedProductMatchKind = 'product' | 'unit' | 'styleCode' | 'sku';

export type WeightedProductMatch =
  | { status: 'empty' }
  | { status: 'not-found'; productCode: string }
  | { status: 'ambiguous'; productCode: string; matches: Array<{ product: Product; unitId?: string; unitName?: string | null; kind: WeightedProductMatchKind }> }
  | { status: 'matched'; productCode: string; match: { product: Product; unitId?: string; unitName?: string | null; kind: WeightedProductMatchKind } };

export function normalizeWeightedBarcodeDigits(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_DIGIT_MAP[ch] ?? ch);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanDigits(value: unknown, fallback = '') {
  const text = normalizeWeightedBarcodeDigits(value).replace(/\D/g, '');
  return text || fallback;
}

function uniqueCodeCandidates(value: unknown) {
  const normalized = normalizeWeightedBarcodeDigits(value);
  if (!/^\d+$/.test(normalized)) return [];
  const stripped = normalized.replace(/^0+/, '') || '0';
  return Array.from(new Set([normalized, stripped]));
}

export function getWeightedBarcodeCodeCandidates(rawProductCode: string): string[] {
  return uniqueCodeCandidates(rawProductCode);
}

function valueMatchesCode(value: unknown, candidates: string[]) {
  const normalized = normalizeWeightedBarcodeDigits(value);
  if (!/^\d+$/.test(normalized)) return false;
  const stripped = normalized.replace(/^0+/, '') || '0';
  return candidates.includes(normalized) || candidates.includes(stripped);
}

export function getWeightedBarcodeConfig(settings?: Partial<AppSettings> | null): WeightedBarcodeConfig {
  return {
    enabled: settings?.weightedBarcodeEnabled === true,
    prefix: cleanDigits(settings?.weightedBarcodePrefix, '21').slice(0, 4) || '21',
    productCodeLength: clampInt(settings?.weightedBarcodeProductCodeLength, 3, 8, 5),
    weightDigits: clampInt(settings?.weightedBarcodeWeightDigits, 3, 8, 5),
    weightDecimals: clampInt(settings?.weightedBarcodeWeightDecimals, 0, 3, 3),
    valueMode: settings?.weightedBarcodeValueMode === 'price' ? 'price' : 'weight',
  };
}

export function parseWeightedBarcode(rawCode: unknown, settings?: Partial<AppSettings> | null): WeightedBarcodeParseResult | null {
  const config = getWeightedBarcodeConfig(settings);
  if (!config.enabled) return null;

  const rawText = normalizeWeightedBarcodeDigits(rawCode);
  if (!/^\d+$/.test(rawText)) return null;
  if (!rawText.startsWith(config.prefix)) return null;

  const bodyLength = config.prefix.length + config.productCodeLength + config.weightDigits;
  const lengthWithCheckDigit = bodyLength + 1;
  if (rawText.length !== bodyLength && rawText.length !== lengthWithCheckDigit) return null;
  if (rawText.length === 13) {
    const digits = [...rawText].map(Number);
    const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
    if ((10 - (sum % 10)) % 10 !== digits[12]) return null;
  }

  const productCodeStart = config.prefix.length;
  const weightStart = productCodeStart + config.productCodeLength;
  const productCode = rawText.slice(productCodeStart, weightStart);
  const weightText = rawText.slice(weightStart, weightStart + config.weightDigits);
  const weightNumber = Number(weightText);
  if (!productCode || !Number.isFinite(weightNumber) || weightNumber <= 0) return null;

  const quantity = config.valueMode === 'price' ? 0 : weightNumber / (10 ** config.weightDecimals);
  if (config.valueMode === 'weight' && (!Number.isFinite(quantity) || quantity <= 0)) return null;

  return {
    rawCode: rawText,
    prefix: config.prefix,
    productCode,
    weightText,
    quantity,
    ...(config.valueMode === 'price' ? { priceAmount: weightNumber / 100 } : {}),
  };
}

export function matchProductByWeightedCode(products: Product[], rawProductCode: string): WeightedProductMatch {
  const candidates = uniqueCodeCandidates(rawProductCode);
  const productCode = candidates[0] || String(rawProductCode || '').trim();
  if (!candidates.length) return { status: 'empty' };

  const matches: Array<{ product: Product; unitId?: string; unitName?: string | null; kind: WeightedProductMatchKind }> = [];

  for (const product of products || []) {
    if (valueMatchesCode(product.barcode, candidates)) {
      matches.push({ product, unitName: null, kind: 'product' });
    }

    if (valueMatchesCode(product.sku, candidates)) {
      matches.push({ product, unitName: null, kind: 'sku' });
    }

    if (valueMatchesCode(product.styleCode, candidates)) {
      matches.push({ product, unitName: null, kind: 'styleCode' });
    }

    for (const unit of (product.units || [])) {
      if (valueMatchesCode(unit.barcode, candidates)) {
        matches.push({ product, unitId: unit.id || '', unitName: unit.name || null, kind: 'unit' });
      }
    }
  }

  if (!matches.length) return { status: 'not-found', productCode };

  const preferredUnits = matches.filter((entry) => entry.kind === 'unit');
  const pool = preferredUnits.length ? preferredUnits : matches;
  // Never prefer a unit match on one product over a product/barcode/sku match
  // on a different product. That would silently sell the wrong stock item.
  const uniqueProductIds = Array.from(new Set(matches.map((entry) => String(entry.product.id))));
  if (uniqueProductIds.length > 1 || preferredUnits.length > 1) {
    return { status: 'ambiguous', productCode, matches: pool };
  }

  return { status: 'matched', productCode, match: pool[0] };
}

export function formatWeightedBarcodeQuantity(quantity: number) {
  return Number(quantity || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/** Use only codes the POS will actually match; do not truncate a GTIN or use a DB id. */
export function getScaleExportItemCode(product: Product, config: WeightedBarcodeConfig, pad = true): string | null {
  for (const candidate of [product.barcode, product.styleCode, product.sku]) {
    const code = normalizeWeightedBarcodeDigits(candidate);
    if (/^\d+$/.test(code) && code.length <= config.productCodeLength) {
      return pad ? code.padStart(config.productCodeLength, '0') : code;
    }
  }
  return null;
}

/** Generate a scannable EAN-13 sample: 1 kg in weight mode, 12.50 in price mode. */
export function buildSampleScaleBarcode(code: string, config: WeightedBarcodeConfig): string | null {
  const cleanCode = normalizeWeightedBarcodeDigits(code);
  if (!/^\d+$/.test(cleanCode) || cleanCode.length !== config.productCodeLength) return null;
  const amount = config.valueMode === 'price' ? 1250 : 10 ** config.weightDecimals;
  const value = String(amount);
  if (value.length > config.weightDigits) return null;
  const payload = config.prefix + cleanCode + value.padStart(config.weightDigits, '0');
  if (payload.length !== 12) return null;
  const sum = [...payload].reduce((n, d, i) => n + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return payload + String((10 - sum % 10) % 10);
}
