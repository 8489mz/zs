/**
 * PurchasesWriteRepricingService — slice S1 of the purchases-write split.
 * Pure move of 4 repricing methods from PurchasesWriteService: roundCurrency,
 * buildRecommendedSellPrice, buildPurchaseRepricingCandidate, buildPurchaseRepricingInsights.
 * No behavior change: bodies are byte-identical. No deps: pure computation.
 * The facade keeps thin private delegates for the two methods other slices call.
 */

import { Injectable } from '@nestjs/common';
import type {
  PurchaseRepricingCandidate,
  PurchaseRepricingInsights,
  PurchaseRepricingProduct,
} from './purchases-write.types';

@Injectable()
export class PurchasesWriteRepricingService {
  private roundCurrency(value: number, digits: 2 | 3 = 2): number {
    return Number(Number(value || 0).toFixed(digits));
  }

  private buildRecommendedSellPrice(
    currentSellPrice: number,
    previousCost: number,
    newCost: number,
    digits: 2 | 3 = 2,
  ): number {
    const safeCurrentSell = Number(currentSellPrice || 0);
    const safePreviousCost = Number(previousCost || 0);
    const safeNewCost = Number(newCost || 0);
    if (safeCurrentSell <= 0) return 0;
    if (safePreviousCost > 0 && safeNewCost > 0) {
      return this.roundCurrency((safeCurrentSell / safePreviousCost) * safeNewCost, digits);
    }
    if (safeNewCost > 0) {
      const absoluteMarkup = Math.max(0, safeCurrentSell - Math.max(0, safePreviousCost));
      return this.roundCurrency(safeNewCost + absoluteMarkup, digits);
    }
    return this.roundCurrency(safeCurrentSell, digits);
  }

  buildPurchaseRepricingCandidate(product: PurchaseRepricingProduct, newCost: number): PurchaseRepricingCandidate {
    return {
      productId: Number(product.id),
      name: String(product.name || ''),
      itemKind: product.item_kind === 'fashion' ? 'fashion' : 'standard',
      styleCode: String(product.style_code || ''),
      previousCost: Number(product.cost_price || 0),
      newCost,
      retailPrice: Number(product.retail_price || 0),
      wholesalePrice: Number(product.wholesale_price || 0),
    };
  }

  buildPurchaseRepricingInsights(
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits: 2 | 3 = 2,
  ): PurchaseRepricingInsights | null {
    const rows = candidates
      .filter((candidate) => Math.abs(Number(candidate.newCost || 0) - Number(candidate.previousCost || 0)) > 0.0001)
      .map((candidate) => {
        const previousCost = Number(candidate.previousCost || 0);
        const newCost = Number(candidate.newCost || 0);
        const retailPrice = Number(candidate.retailPrice || 0);
        const wholesalePrice = Number(candidate.wholesalePrice || 0);
        const recommendedRetailPrice = this.buildRecommendedSellPrice(retailPrice, previousCost, newCost, moneyDigits);
        const recommendedWholesalePrice = this.buildRecommendedSellPrice(
          wholesalePrice,
          previousCost,
          newCost,
          moneyDigits,
        );
        const costChangePercent =
          previousCost > 0
            ? this.roundCurrency(((newCost - previousCost) / previousCost) * 100)
            : newCost > 0
              ? 100
              : 0;
        return {
          productId: Number(candidate.productId),
          name: candidate.name,
          itemKind: candidate.itemKind,
          styleCode: candidate.styleCode,
          previousCost: this.roundCurrency(previousCost, moneyDigits),
          newCost: this.roundCurrency(newCost, moneyDigits),
          costChangePercent,
          retailPrice: this.roundCurrency(retailPrice, moneyDigits),
          wholesalePrice: this.roundCurrency(wholesalePrice, moneyDigits),
          recommendedRetailPrice,
          recommendedWholesalePrice,
          recommendedRetailDelta: this.roundCurrency(recommendedRetailPrice - retailPrice, moneyDigits),
          recommendedWholesaleDelta: this.roundCurrency(recommendedWholesalePrice - wholesalePrice, moneyDigits),
        };
      });

    if (!rows.length) return null;

    return {
      purchaseId,
      supplierId: Number(supplier.id),
      supplierName: supplier.name,
      affectedCount: rows.length,
      increasedCount: rows.filter((row) => row.newCost > row.previousCost).length,
      decreasedCount: rows.filter((row) => row.newCost < row.previousCost).length,
      unchangedCount: Math.max(0, candidates.length - rows.length),
      productIds: rows.map((row) => row.productId),
      rows,
    };
  }
}
