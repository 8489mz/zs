import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/domain';
import { resolveSalesOrderBarcodeScan } from './sales-order-barcode-scan';

const settings = {
  weightedBarcodeEnabled: true,
  weightedBarcodePrefix: '21',
  weightedBarcodeProductCodeLength: 5,
  weightedBarcodeWeightDigits: 5,
  weightedBarcodeWeightDecimals: 3,
  weightedBarcodeValueMode: 'weight' as const,
};

const sampleProducts = [
  {
    id: '9',
    name: 'لحم مفروم',
    barcode: '9',
    sku: 'MEAT-9',
    retailPrice: 300,
    wholesalePrice: 280,
    costPrice: 240,
    stock: 20,
    units: [{ id: 'u1', name: 'kg', multiplier: 1, barcode: '9' }],
  } as unknown as Product,
];

const productOptions = sampleProducts.map((p) => ({
  id: String(p.id),
  rawId: Number(p.id),
  name: p.name,
  barcode: p.barcode || '',
  sku: p.sku || '',
  price: Number(p.retailPrice || 0),
  costPrice: Number(p.costPrice || 0),
  unit: 'kg',
  stock: Number(p.stock || 0),
  raw: p,
}));

describe('resolveSalesOrderBarcodeScan', () => {
  it('resolves weighted barcodes with unpadded numeric product codes outside POS', () => {
    // 21 + 00009 + 01250 + checkDigit (9): payload 210000901250 -> odd=2+0+0+9+1+5=17, even=3*(1+0+0+0+2+0)=9 -> 26 -> check=4
    const result = resolveSalesOrderBarcodeScan({
      scannedCode: '2100009012504',
      catalogProducts: sampleProducts,
      productOptions,
      settings,
    });
    expect(result).toMatchObject({
      status: 'found',
      quantity: 1.25,
      unitName: 'kg',
      total: 375,
      option: { rawId: 9 },
    });
  });

  it('keeps standard barcode and sku scanning working when not a weighted label', () => {
    const result = resolveSalesOrderBarcodeScan({
      scannedCode: 'MEAT-9',
      catalogProducts: sampleProducts,
      productOptions,
      settings,
    });
    expect(result).toMatchObject({
      status: 'found',
      quantity: 1,
      option: { rawId: 9 },
    });
  });
});
