/**
 * Pure calculation engine for FMCG & Wholesale Promotions (Mix & Match, Tiered Quantities, Invoice Thresholds)
 * Deterministic, zero side-effects, testable in isolation.
 */

import { type MoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';

export type FmcgPromoType = 'mix_and_match' | 'tiered_qty' | 'invoice_threshold';
export type FmcgApplyType = 'free_bonus' | 'discount_percent' | 'discount_amount';

export interface FmcgPromoBuyCondition {
  productId: number;
  productName?: string;
  minQty: number;
  uom?: string;
}

export interface FmcgPromoReward {
  bonusProductId?: number;
  bonusProductName?: string;
  bonusQty?: number;
  bonusUom?: string;
  bonusReason?: string;
  discountPercent?: number;
  discountAmount?: number;
  targetProductId?: number;
}

export interface FmcgPromotion {
  id: number;
  name: string;
  code: string;
  promoType: FmcgPromoType | string;
  applyType: FmcgApplyType | string;
  buyConditions: FmcgPromoBuyCondition[] | FmcgPromoBuyCondition | { minInvoiceTotal: number } | any;
  reward: FmcgPromoReward;
  customerTypes?: string[] | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
  maxApplicationsPerOrder?: number;
  priority?: number;
  notes?: string | null;
}

export interface CartItemInput {
  productId: number;
  productName?: string;
  qty: number;
  unitPrice: number;
  uom?: string;
  multiplier?: number;
  isBonus?: boolean;
}

export interface AppliedPromotionReward {
  promoId: number;
  promoName: string;
  promoCode: string;
  promoType: string;
  applyType: string;
  applicationsCount: number;
  discountAmount: number;
  bonusItems: {
    productId: number;
    productName: string;
    bonusQty: number;
    uom: string;
    bonusReason: string;
  }[];
  description: string;
}

export interface PromotionNudge {
  promoId: number;
  promoName: string;
  hintText: string;
  missingItems?: {
    productId: number;
    productName?: string;
    neededQty: number;
  }[];
  missingAmount?: number;
}

export interface CartPromotionEvaluationResult {
  appliedPromotions: AppliedPromotionReward[];
  bonusItemsToAdd: {
    productId: number;
    productName: string;
    qty: number;
    unitPrice: 0;
    uom: string;
    isBonus: true;
    bonusReason: string;
  }[];
  totalPromotionalDiscount: number;
  upsellNudges: PromotionNudge[];
}

/**
 * Evaluates active promotions against current shopping cart
 */
export function evaluateFmcgCartPromotions(params: {
  cartItems: CartItemInput[];
  invoiceSubtotal?: number;
  customerType?: string | null;
  activePromotions: FmcgPromotion[];
  referenceDate?: string | Date;
  // Book digits of the tenant's base currency (2 or 3). Defaults to 2
  // for pure-engine callers that do not resolve a tenant; the live
  // caller (VanPromotionsService.evaluateCart) passes the tenant's
  // book digits so a 3-decimal tenant keeps its third decimal.
  moneyDigits?: MoneyDigits;
}): CartPromotionEvaluationResult {
  const { cartItems, activePromotions } = params;
  const moneyDigits: MoneyDigits = params.moneyDigits ?? 2;

  // Filter out any existing system-added promo bonuses from condition checking
  const nonBonusItems = cartItems.filter((i) => !i.isBonus && i.qty > 0);

  // Group quantities by product ID (in base units)
  const qtyByProduct = new Map<number, { totalQty: number; name: string; unitPrice: number }>();
  for (const item of nonBonusItems) {
    const pid = Number(item.productId);
    const existing = qtyByProduct.get(pid) || { totalQty: 0, name: item.productName || `صنف #${pid}`, unitPrice: item.unitPrice };
    const effectiveQty = item.qty * (item.multiplier && item.multiplier > 0 ? item.multiplier : 1);
    existing.totalQty += effectiveQty;
    qtyByProduct.set(pid, existing);
  }

  // Calculate clean subtotal
  const computedSubtotal = params.invoiceSubtotal !== undefined && params.invoiceSubtotal !== null
    ? Number(params.invoiceSubtotal)
    : nonBonusItems.reduce((acc, it) => acc + (it.qty * it.unitPrice), 0);

  const refDateStr = params.referenceDate
    ? (typeof params.referenceDate === 'string' ? params.referenceDate.slice(0, 10) : params.referenceDate.toISOString().slice(0, 10))
    : new Date().toISOString().slice(0, 10);

  const appliedPromotions: AppliedPromotionReward[] = [];
  const bonusItemsToAdd: CartPromotionEvaluationResult['bonusItemsToAdd'] = [];
  const upsellNudges: PromotionNudge[] = [];
  let totalPromotionalDiscount = 0;

  // Sort promotions by priority descending
  const sortedPromos = [...activePromotions]
    .filter((p) => p.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const promo of sortedPromos) {
    // 1. Check Date Range
    if (promo.startDate && promo.startDate > refDateStr) continue;
    if (promo.endDate && promo.endDate < refDateStr) continue;

    // 2. Check Customer Type
    if (promo.customerTypes && Array.isArray(promo.customerTypes) && promo.customerTypes.length > 0 && !promo.customerTypes.includes('all')) {
      const cType = params.customerType || 'regular';
      if (!promo.customerTypes.includes(cType)) continue;
    }

    const maxApps = Math.max(1, promo.maxApplicationsPerOrder || 1);

    // 3. Evaluate by Promo Type
    if (promo.promoType === 'mix_and_match') {
      const conditions: FmcgPromoBuyCondition[] = Array.isArray(promo.buyConditions)
        ? promo.buyConditions
        : [promo.buyConditions];

      if (conditions.length === 0) continue;

      let maxPossibleApplications = maxApps;
      const missingConditions: { productId: number; productName?: string; neededQty: number }[] = [];
      let hasAtLeastOneItem = false;

      for (const cond of conditions) {
        const itemInCart = qtyByProduct.get(Number(cond.productId));
        const currentQty = itemInCart ? itemInCart.totalQty : 0;
        const requiredMin = Number(cond.minQty || 1);

        if (currentQty > 0) hasAtLeastOneItem = true;

        if (currentQty < requiredMin) {
          maxPossibleApplications = 0;
          missingConditions.push({
            productId: cond.productId,
            productName: cond.productName || itemInCart?.name || `صنف #${cond.productId}`,
            neededQty: requiredMin - currentQty,
          });
        } else {
          const appsForThisCond = Math.floor(currentQty / requiredMin);
          maxPossibleApplications = Math.min(maxPossibleApplications, appsForThisCond);
        }
      }

      if (maxPossibleApplications > 0) {
        // Promotion matches!
        const apps = Math.min(maxApps, maxPossibleApplications);
        const reward = promo.reward;
        let discount = 0;
        const bonuses: AppliedPromotionReward['bonusItems'] = [];

        if (promo.applyType === 'free_bonus' && reward.bonusProductId) {
          const bQty = Number(reward.bonusQty || 1) * apps;
          const bItem = {
            productId: Number(reward.bonusProductId),
            productName: reward.bonusProductName || `بونص ترويجي (${promo.name})`,
            bonusQty: bQty,
            uom: reward.bonusUom || 'قطعة',
            bonusReason: reward.bonusReason || `عرض خلطات: ${promo.name}`,
          };
          bonuses.push(bItem);
          bonusItemsToAdd.push({
            productId: bItem.productId,
            productName: bItem.productName,
            qty: bItem.bonusQty,
            unitPrice: 0,
            uom: bItem.uom,
            isBonus: true,
            bonusReason: bItem.bonusReason,
          });
        } else if (promo.applyType === 'discount_percent' && reward.discountPercent) {
          discount = roundMoney((computedSubtotal * Number(reward.discountPercent)) / 100, moneyDigits);
        } else if (promo.applyType === 'discount_amount' && reward.discountAmount) {
          discount = roundMoney(Number(reward.discountAmount) * apps, moneyDigits);
        }

        totalPromotionalDiscount += discount;
        appliedPromotions.push({
          promoId: promo.id,
          promoName: promo.name,
          promoCode: promo.code,
          promoType: promo.promoType,
          applyType: promo.applyType,
          applicationsCount: apps,
          discountAmount: discount,
          bonusItems: bonuses,
          description: `تم تطبيق ${promo.name} (${apps > 1 ? `${apps} باقات` : 'باقة واحدة'})`,
        });
      } else if (hasAtLeastOneItem && missingConditions.length > 0) {
        // Nudge upsell
        const missingDesc = missingConditions
          .map((m) => `${m.neededQty} ${m.productName}`)
          .join(' و ');
        upsellNudges.push({
          promoId: promo.id,
          promoName: promo.name,
          hintText: `أضف ${missingDesc} لتفعيل ${promo.name}`,
          missingItems: missingConditions,
        });
      }
    } else if (promo.promoType === 'tiered_qty') {
      const cond: FmcgPromoBuyCondition = Array.isArray(promo.buyConditions)
        ? promo.buyConditions[0]
        : promo.buyConditions;

      if (!cond || !cond.productId) continue;

      const pid = Number(cond.productId);
      const itemInCart = qtyByProduct.get(pid);
      const currentQty = itemInCart ? itemInCart.totalQty : 0;
      const minQty = Number(cond.minQty || 1);

      if (currentQty >= minQty) {
        const apps = Math.min(maxApps, Math.floor(currentQty / minQty));
        const reward = promo.reward;
        let discount = 0;
        const bonuses: AppliedPromotionReward['bonusItems'] = [];

        if (promo.applyType === 'free_bonus' && reward.bonusProductId) {
          const bQty = Number(reward.bonusQty || 1) * apps;
          const bItem = {
            productId: Number(reward.bonusProductId),
            productName: reward.bonusProductName || `بونص شريحة كمية (${promo.name})`,
            bonusQty: bQty,
            uom: reward.bonusUom || 'قطعة',
            bonusReason: reward.bonusReason || `عرض كميات: ${promo.name}`,
          };
          bonuses.push(bItem);
          bonusItemsToAdd.push({
            productId: bItem.productId,
            productName: bItem.productName,
            qty: bItem.bonusQty,
            unitPrice: 0,
            uom: bItem.uom,
            isBonus: true,
            bonusReason: bItem.bonusReason,
          });
        } else if (promo.applyType === 'discount_percent' && reward.discountPercent) {
          const itemTotal = (itemInCart?.unitPrice || 0) * currentQty;
          discount = roundMoney((itemTotal * Number(reward.discountPercent)) / 100, moneyDigits);
        } else if (promo.applyType === 'discount_amount' && reward.discountAmount) {
          discount = roundMoney(Number(reward.discountAmount) * apps, moneyDigits);
        }

        totalPromotionalDiscount += discount;
        appliedPromotions.push({
          promoId: promo.id,
          promoName: promo.name,
          promoCode: promo.code,
          promoType: promo.promoType,
          applyType: promo.applyType,
          applicationsCount: apps,
          discountAmount: discount,
          bonusItems: bonuses,
          description: `تم تطبيق ${promo.name} على كمية (${currentQty})`,
        });
      } else if (currentQty > 0 && currentQty >= minQty * 0.4) {
        const needed = minQty - currentQty;
        upsellNudges.push({
          promoId: promo.id,
          promoName: promo.name,
          hintText: `أضف ${needed} قطعة إضافية من ${itemInCart?.name || cond.productName || 'الصنف'} للاستفادة من ${promo.name}`,
          missingItems: [{
            productId: pid,
            productName: itemInCart?.name || cond.productName,
            neededQty: needed,
          }],
        });
      }
    } else if (promo.promoType === 'invoice_threshold') {
      const minTotal = Number(promo.buyConditions?.minInvoiceTotal || promo.buyConditions?.minTotal || 0);
      if (minTotal <= 0) continue;

      if (computedSubtotal >= minTotal) {
        const reward = promo.reward;
        let discount = 0;
        const bonuses: AppliedPromotionReward['bonusItems'] = [];

        if (promo.applyType === 'discount_percent' && reward.discountPercent) {
          discount = roundMoney((computedSubtotal * Number(reward.discountPercent)) / 100, moneyDigits);
        } else if (promo.applyType === 'discount_amount' && reward.discountAmount) {
          discount = roundMoney(Number(reward.discountAmount), moneyDigits);
        } else if (promo.applyType === 'free_bonus' && reward.bonusProductId) {
          const bQty = Number(reward.bonusQty || 1);
          const bItem = {
            productId: Number(reward.bonusProductId),
            productName: reward.bonusProductName || `هدية سقف الفاتورة (${promo.name})`,
            bonusQty: bQty,
            uom: reward.bonusUom || 'قطعة',
            bonusReason: reward.bonusReason || `بونص فاتورة: ${promo.name}`,
          };
          bonuses.push(bItem);
          bonusItemsToAdd.push({
            productId: bItem.productId,
            productName: bItem.productName,
            qty: bItem.bonusQty,
            unitPrice: 0,
            uom: bItem.uom,
            isBonus: true,
            bonusReason: bItem.bonusReason,
          });
        }

        totalPromotionalDiscount += discount;
        appliedPromotions.push({
          promoId: promo.id,
          promoName: promo.name,
          promoCode: promo.code,
          promoType: promo.promoType,
          applyType: promo.applyType,
          applicationsCount: 1,
          discountAmount: discount,
          bonusItems: bonuses,
          description: `تم تطبيق ${promo.name} لتجاوز الفاتورة ${minTotal}`,
        });
      } else if (computedSubtotal >= minTotal * 0.7) {
        const diff = roundMoney(minTotal - computedSubtotal, moneyDigits);
        upsellNudges.push({
          promoId: promo.id,
          promoName: promo.name,
          hintText: `أضف مشتريات بقيمة ${diff} ج.م للاستفادة من ${promo.name}`,
          missingAmount: diff,
        });
      }
    }
  }

  return {
    appliedPromotions,
    bonusItemsToAdd,
    totalPromotionalDiscount: roundMoney(totalPromotionalDiscount, moneyDigits),
    upsellNudges,
  };
}
