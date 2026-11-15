import type { AppSettings, Product } from '@/types/domain';
import { matchProductByWeightedCode, parseWeightedBarcode } from '@/shared/lib/weighted-barcode';

export interface SalesOrderProductOption {
  id: string;
  rawId: number;
  name: string;
  barcode: string;
  sku: string;
  price: number;
  costPrice: number;
  unit: string;
  stock: number;
  raw: Product;
}

export type SalesOrderBarcodeScanResolution =
  | {
      status: 'found';
      option: SalesOrderProductOption;
      quantity: number;
      unitName: string;
      total: number;
    }
  | { status: 'error'; message: string };

export function resolveSalesOrderBarcodeScan(params: {
  scannedCode: string;
  catalogProducts: Product[];
  productOptions: SalesOrderProductOption[];
  settings?: Partial<AppSettings> | null;
}): SalesOrderBarcodeScanResolution | null {
  const code = String(params.scannedCode || '').trim();
  if (!code) return null;

  const weighted = parseWeightedBarcode(code, params.settings);
  if (weighted) {
    const weightedMatch = matchProductByWeightedCode(params.catalogProducts || [], weighted.productCode);
    if (weightedMatch.status === 'ambiguous') {
      return { status: 'error', message: `كود الميزان ${weighted.productCode} مرتبط بأكثر من صنف.` };
    }
    if (weightedMatch.status === 'matched') {
      const matchedProduct = weightedMatch.match.product;
      const option =
        params.productOptions.find((entry) => entry.rawId === Number(matchedProduct.id)) || {
          id: String(matchedProduct.id),
          rawId: Number(matchedProduct.id),
          name: matchedProduct.name || '',
          barcode: matchedProduct.barcode || '',
          sku: matchedProduct.sku || '',
          price: Number(matchedProduct.retailPrice ?? matchedProduct.wholesalePrice ?? 0),
          costPrice: Number(matchedProduct.costPrice ?? 0),
          unit: matchedProduct.units?.[0]?.name || 'قطعة',
          stock: Number(matchedProduct.stock ?? 0),
          raw: matchedProduct,
        };
      const unitName = weightedMatch.match.kind === 'unit' && weightedMatch.match.unitName ? weightedMatch.match.unitName : option.unit;
      let quantity = weighted.quantity;
      if (weighted.priceAmount !== undefined) {
        if (!Number.isFinite(option.price) || option.price <= 0) {
          return { status: 'error', message: 'تعذر احتساب وزن الصنف لعدم وجود سعر بيع.' };
        }
        quantity = Number((weighted.priceAmount / option.price).toFixed(3));
      }
      return {
        status: 'found',
        option,
        quantity,
        unitName,
        total: Number((quantity * option.price).toFixed(2)),
      };
    }
    return { status: 'error', message: `باركود ميزان: لم يتم العثور على كود الصنف ${weighted.productCode}.` };
  }

  const lower = code.toLowerCase();
  const found = params.productOptions.find(
    (entry) =>
      (entry.barcode && entry.barcode.trim().toLowerCase() === lower) ||
      (entry.sku && entry.sku.trim().toLowerCase() === lower) ||
      (entry.raw?.styleCode && entry.raw.styleCode.trim().toLowerCase() === lower) ||
      entry.raw?.units?.some((u) => u.barcode && u.barcode.trim().toLowerCase() === lower),
  );
  if (found) {
    return { status: 'found', option: found, quantity: 1, unitName: found.unit, total: found.price };
  }
  return { status: 'error', message: 'لم يتم العثور على صنف بهذا الباركود' };
}
