import type { Product } from '@/types/domain';
import {
  getWeightedBarcodeCodeCandidates,
  matchProductByWeightedCode,
  type WeightedBarcodeParseResult,
} from '@/features/pos/lib/weighted-barcode';

export interface ResolveRemoteWeightedBarcodeParams {
  rawQuery: string;
  weightedBarcode: WeightedBarcodeParseResult;
  branchId?: string;
  locationId?: string;
  activeTenantId?: string;
  lookupProducts: (query: { barcode: string; branchId?: string; locationId?: string; limit: number }) => Promise<Product[]>;
  lookupOfflineProduct: (code: string, expectedTenantId?: string) => Promise<Product | null>;
  submitWeightedProducts: (rawCode: string, products: Product[]) => boolean;
  setSearch: (value: string) => void;
  setSubmitMessage: (message: string) => void;
}

/**
 * Resolves a parsed weighted barcode remotely (by exact and zero-stripped barcode/PLU)
 * and falls back to offline IndexedDB storage, without overwriting real stock or price
 * validation errors once a product match has been found.
 */
export async function resolveRemoteWeightedBarcode(params: ResolveRemoteWeightedBarcodeParams): Promise<void> {
  const candidates = getWeightedBarcodeCodeCandidates(params.weightedBarcode.productCode);

  const tryProductPool = (pool: Product[]): 'added' | 'handled' | 'not-found' => {
    if (!pool.length) return 'not-found';
    const match = matchProductByWeightedCode(pool, params.weightedBarcode.productCode);
    if (match.status === 'ambiguous') {
      params.setSubmitMessage(`كود الميزان ${params.weightedBarcode.productCode} مرتبط بأكثر من صنف أو وحدة. راجع كود الصنف أولًا.`);
      return 'handled';
    }
    if (match.status === 'matched') {
      const submitted = params.submitWeightedProducts(params.rawQuery, pool);
      if (submitted) {
        params.setSearch('');
        return 'added';
      }
      // Product matched, so handleQuickAddCodeSubmit already posted the stock/price rejection reason.
      return 'handled';
    }
    return 'not-found';
  };

  for (const candidate of candidates) {
    let remoteProducts: Product[] = [];
    try {
      remoteProducts = await params.lookupProducts({
        barcode: candidate,
        branchId: params.branchId,
        locationId: params.locationId,
        limit: 5,
      });
    } catch {
      remoteProducts = [];
    }

    const outcome = tryProductPool(remoteProducts);
    if (outcome !== 'not-found') return;
  }

  for (const candidate of candidates) {
    try {
      const offlineItem = await params.lookupOfflineProduct(candidate, params.activeTenantId || undefined);
      if (offlineItem) {
        const outcome = tryProductPool([offlineItem]);
        if (outcome !== 'not-found') return;
      }
    } catch {
      // Ignore storage fallback read error
    }
  }

  params.setSubmitMessage(`باركود ميزان: لم يتم العثور على كود الصنف ${params.weightedBarcode.productCode}.`);
}
