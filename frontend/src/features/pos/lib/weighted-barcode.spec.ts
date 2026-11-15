import { describe, expect, it } from 'vitest';
import {
  getScaleExportItemCode,
  buildSampleScaleBarcode,
  getWeightedBarcodeConfig,
  matchProductByWeightedCode,
  parseWeightedBarcode,
  isAutoSubmittableWeightedBarcode,
} from './weighted-barcode';
import type { Product } from '@/types/domain';

const settings = { weightedBarcodeEnabled: true, weightedBarcodePrefix: '21', weightedBarcodeProductCodeLength: 5, weightedBarcodeWeightDigits: 5, weightedBarcodeWeightDecimals: 3 };
const config = getWeightedBarcodeConfig(settings);
const makeProduct = (id: string, barcode: string, styleCode?: string, sku?: string) => ({ id, barcode, styleCode, sku, units: [], name: id } as unknown as Product);
describe('scale barcode safety', () => {
  it('generates valid EAN-13 checksum compatible with the POS parser', () => {
    const code = getScaleExportItemCode(makeProduct('1', '101'), config);
    expect(code).toBe('00101');
    const sample = buildSampleScaleBarcode(code!, config)!;
    expect(sample).toMatch(/^\d{13}$/);
    expect(parseWeightedBarcode(sample, settings)).toMatchObject({ productCode: '00101', quantity: 1 });
    const bad = sample.slice(0, -1) + ((Number(sample.slice(-1)) + 1) % 10);
    expect(parseWeightedBarcode(bad, settings)).toBeNull();
  });
  it('never converts alphanumeric barcodes, truncates GTINs or invents an id-code', () => {
    expect(getScaleExportItemCode(makeProduct('101', 'A101'), config)).toBeNull();
    expect(getScaleExportItemCode(makeProduct('101', '6221234567890'), config)).toBeNull();
    expect(getScaleExportItemCode(makeProduct('101', '6221234567890', '101'), config)).toBe('00101');
    expect(matchProductByWeightedCode([makeProduct('101', 'A101')], '00101').status).toBe('not-found');
  });
  it('recognizes identical barcode and styleCode on one item but refuses other items sharing that code', () => {
    expect(matchProductByWeightedCode([makeProduct('a', '101', '101')], '00101').status).toBe('matched');
    expect(matchProductByWeightedCode([makeProduct('a', '101'), makeProduct('b', '00101')], '00101').status).toBe('ambiguous');
  });
  it('rejects an ambiguous product barcode even when another product unit is preferred', () => {
    const plain = makeProduct('a', '101');
    const packed = { ...makeProduct('b', '200'), units: [{ id: 'u', name: 'kg', barcode: '00101' }] } as unknown as Product;
    expect(matchProductByWeightedCode([plain, packed], '00101').status).toBe('ambiguous');
  });
  it('refuses invalid EAN lengths', () => {
    expect(buildSampleScaleBarcode('00101', { ...config, weightDigits: 6 })).toBeNull();
  });
  it('generates price-coded EAN-13 stickers using 12.50 correctly', () => {
    const priceConfig = { ...config, valueMode: 'price' as const };
    const sample = buildSampleScaleBarcode('00101', priceConfig);
    expect(parseWeightedBarcode(sample, { ...settings, weightedBarcodeValueMode: 'price' })).toMatchObject({ priceAmount: 12.5 });
  });
  it('normalizes Arabic-Indic digits and matches unpadded numeric sku codes safely', () => {
    const sample = buildSampleScaleBarcode('00101', config)!;
    const toArabicDigits = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    expect(parseWeightedBarcode(toArabicDigits(sample), settings)).toMatchObject({ productCode: '00101', quantity: 1 });
    expect(matchProductByWeightedCode([makeProduct('p-sku', '', undefined, '101')], '00101')).toMatchObject({
      status: 'matched',
      match: { kind: 'sku' },
    });
    expect(getScaleExportItemCode(makeProduct('p-sku', '', undefined, '101'), config)).toBe('00101');
  });
  it('flags weighted barcodes (with optional qty prefix) for scanner auto-submit only when enabled', () => {
    const sample = buildSampleScaleBarcode('00101', config)!;
    expect(isAutoSubmittableWeightedBarcode(sample, settings)).toBe(true);
    expect(isAutoSubmittableWeightedBarcode(`2*${sample}`, settings)).toBe(true);
    expect(isAutoSubmittableWeightedBarcode(sample, { ...settings, weightedBarcodeEnabled: false })).toBe(false);
    expect(isAutoSubmittableWeightedBarcode('6221234567890', settings)).toBe(false);
  });
});
