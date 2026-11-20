/**
 * calculateItemPrice — pure move from VanPreSalesTab.tsx (pristine L402-455).
 * Money engine: cash/credit tiers, offers, cash discount. Byte-identical except
 * the declaration line, which gains `export` (top-level export).
 */
import type { PreSalesCatalogItem } from '../../api/van-sales.api';
import { roundMoney } from '../../utils/van-money.utils';

  // Compute pricing for an item based on terms and quantity
  // Official baseline is Credit Price; when selling Cash, difference is "خصم تعجيل دفع (سداد نقدي)"
  export const calculateItemPrice = (
    item: PreSalesCatalogItem,
    terms: 'cash' | 'credit',
    totalBaseQty: number,
    multiplier: number,
  ) => {
    const isCredit = terms === 'credit';
    const creditBasePrice =
      item.creditPrice != null && Number(item.creditPrice) > 0
        ? Number(item.creditPrice) * multiplier
        : Number(item.retailPrice || 0) * multiplier;

    const cashBasePrice = Number(item.retailPrice || 0) * multiplier;
    // Official baseline list price:
    const listPrice = Math.max(creditBasePrice, cashBasePrice);

    // Cash discount per unit is the difference between list/credit price and cash price
    const cashDiscountPerUnit = isCredit ? 0 : Math.max(0, roundMoney(listPrice - cashBasePrice));

    let effectivePrice = isCredit ? listPrice : cashBasePrice;
    let tierType: 'cash' | 'credit' | 'offer' = isCredit ? 'credit' : 'cash';
    let savings = cashDiscountPerUnit;

    // Check offers (offers lower effective price further)
    const matchingOffer = (item.offers || [])
      .filter((off) => totalBaseQty >= Math.max(1, Number(off.minQty || 1)))
      .sort((a, b) => Number(b.minQty || 0) - Number(a.minQty || 0))[0];

    if (matchingOffer) {
      const offerVal = Number(matchingOffer.value || 0);
      if (matchingOffer.offerType === 'percent' && offerVal > 0) {
        effectivePrice = Math.max(0, roundMoney(effectivePrice * (1 - offerVal / 100)));
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      } else if (matchingOffer.offerType === 'fixed' && offerVal > 0) {
        effectivePrice = Math.max(0, roundMoney(effectivePrice - offerVal * multiplier));
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      } else if (matchingOffer.offerType === 'price' && offerVal > 0) {
        effectivePrice = roundMoney(offerVal * multiplier);
        tierType = 'offer';
        savings = Math.max(0, roundMoney(listPrice - effectivePrice));
      }
    }

    const consumerPrice =
      item.consumerPrice != null && Number(item.consumerPrice) > 0
        ? roundMoney(Number(item.consumerPrice) * multiplier)
        : null;

    return { listPrice, cashDiscountPerUnit, effectivePrice, tierType, savings, consumerPrice };
  };
