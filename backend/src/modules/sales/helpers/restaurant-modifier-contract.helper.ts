/* INV-REST-MODIFIER-CONTRACT-2 (R4-C): server-side modifier price truth
 * and group-rule enforcement for restaurant sales.
 *
 * POLICY (never-ask decision, recorded 2026-11-09): re-price, don't
 * reject, when a configured modifier price exists — mirroring the
 * existing cost re-derivation (resolveSaleModifierCosts) and surviving
 * a merchant repricing an option between cart-add and submit. Reject
 * (422) only when NO server price truth exists for a modifier.
 *
 * FROZEN OVERRIDE (SF-3 D-SF-03): an online order converts at the
 * modifier prices the server fixed at placement — the agreed amount.
 * When approvedPrices carries a modifier's key (option:<id> or
 * product:<id>), that price wins over current truth and no
 * missing-truth error is raised for it; the merchant's later reprice
 * (or deletion) of the option applies to new orders only. Walk-in and
 * direct sales pass no approved prices and keep the re-price policy.
 *
 * Price truth, in lookup order:
 * - A mod with optionId is a configured group option: its price is the
 *   pos_modifier_options.price, whatever the client sent. A negative
 *   configured price is data corruption and fails closed (500).
 * - A combo-component mod (isComboComponent, no optionId) is a real
 *   catalog product sold at retail: its price is products.retail_price.
 * - A flat legacy addon (no optionId, productId is an addons row, not a
 *   products row) is priced from addons.price.
 * - A bare product mod (no optionId, productId is a real product) is a
 *   bundled ingredient portion: it keeps its client price when that
 *   price is finite and >= 0. It is NOT re-priced to the product's
 *   retail price — retail is the standalone price, not a configured
 *   modifier price, and the pinned restaurant case (meal 60 with a
 *   cheese portion bundled at 0) posts the meal at 60 exactly. A
 *   negative client price on such a mod is a discount bypass with no
 *   configured price to fall back to, so it is rejected (422).
 * - Anything else (no optionId, productId in neither table, or a
 *   name-only mod such as the old hardcoded combo deltas) has no
 *   server price truth and is rejected with
 *   RESTAURANT_MODIFIER_PRICE_UNVERIFIED (422).
 *
 * Group rules (I48): a mod's group is resolved from its DB option's
 * group_id, never from the client-sent groupId. Counts are per linked
 * group of the line product: mandatory needs >= max(1, min), and
 * min <= count <= max always (single-select groups: effective max 1).
 * Violations throw RESTAURANT_MODIFIER_RULE_VIOLATED (422) naming the
 * group. Cross-group options (an option whose group is not linked to
 * the line product) do not count toward any linked group; they are NOT
 * rejected here — the existing component-mismatch check in
 * resolveSaleModifierCosts still guards them, and rejecting here would
 * mask its RESTAURANT_MODIFIER_COMPONENT_MISMATCH pin.
 */
import { AppError } from '../../../common/errors/app-error';

export interface ModifierOptionPriceTruth {
  price: number;
  groupId: number;
}

export interface ModifierPriceTruth {
  /** pos_modifier_options rows, keyed by option id. */
  options: Map<number, ModifierOptionPriceTruth>;
  /** products rows, keyed by product id: retail price. */
  products: Map<number, number>;
  /** addons rows, keyed by addon id: price. */
  addons: Map<number, number>;
}

export interface ModifierGroupRule {
  id: number;
  name: string;
  selectionType: string;
  isMandatory: boolean;
  minSelections: number;
  maxSelections: number;
  isActive: boolean;
}

export type ModifierLike = Record<string, any>;
export type SaleItemLike = { modifiers?: ModifierLike[] } & Record<string, any>;

export function modifierOptionId(mod: ModifierLike): number {
  return Number(mod.optionId || mod.option_id || 0);
}

export function modifierProductId(mod: ModifierLike): number {
  return Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
}

export function isComboComponentMod(mod: ModifierLike): boolean {
  return Boolean(mod.isComboComponent || mod.comboComponent);
}

/** Single-select groups take at most one option, whatever maxSelections says. */
export function effectiveMaxSelections(group: ModifierGroupRule): number {
  if (String(group.selectionType || '') === 'single') return 1;
  const max = Number(group.maxSelections);
  return Number.isFinite(max) && max > 0 ? Math.floor(max) : Number.MAX_SAFE_INTEGER;
}

function corruptPrice(): AppError {
  return new AppError(
    'Configured modifier price is negative or invalid',
    'RESTAURANT_MODIFIER_PRICE_CORRUPT',
    500,
  );
}

function unverifiedPrice(modName: string): AppError {
  return new AppError(
    `Restaurant modifier "${modName || 'unnamed'}" has no server price to verify against`,
    'RESTAURANT_MODIFIER_PRICE_UNVERIFIED',
    422,
  );
}

/** Resolve one modifier's server price. Throws when no truth exists. */
export function resolveModifierPrice(mod: ModifierLike, truth: ModifierPriceTruth, approvedPrices?: Record<string, number>): number {
  const optionId = modifierOptionId(mod);
  // SF-3 D-SF-03: a frozen modifier converts at its order-time price.
  if (optionId > 0 && approvedPrices?.[`option:${optionId}`] !== undefined) {
    const frozen = Number(approvedPrices[`option:${optionId}`]);
    if (Number.isFinite(frozen) && frozen >= 0) return frozen;
  }
  if (optionId > 0) {
    const option = truth.options.get(optionId);
    if (!option) {
      throw new AppError(
        'Restaurant modifier option missing',
        'RESTAURANT_MODIFIER_OPTION_INVALID',
        422,
      );
    }
    const price = Number(option.price);
    if (!Number.isFinite(price) || price < 0) throw corruptPrice();
    return price;
  }
  const productId = modifierProductId(mod);
  if (productId > 0 && approvedPrices?.[`product:${productId}`] !== undefined) {
    const frozen = Number(approvedPrices[`product:${productId}`]);
    if (Number.isFinite(frozen) && frozen >= 0) return frozen;
  }
  if (isComboComponentMod(mod)) {
    if (productId <= 0 || !truth.products.has(productId)) throw unverifiedPrice(String(mod.name || ''));
    const retail = Number(truth.products.get(productId));
    if (!Number.isFinite(retail) || retail < 0) throw corruptPrice();
    return retail;
  }
  if (productId > 0 && truth.products.has(productId)) {
    // Bundled ingredient portion: keep the client price when it is a
    // sane (finite, non-negative) amount; see the header note.
    const clientPrice = Number(mod.price || 0);
    if (!Number.isFinite(clientPrice) || clientPrice < 0) throw unverifiedPrice(String(mod.name || ''));
    return clientPrice;
  }
  if (productId > 0 && truth.addons.has(productId)) {
    const addonPrice = Number(truth.addons.get(productId));
    if (!Number.isFinite(addonPrice) || addonPrice < 0) throw corruptPrice();
    return addonPrice;
  }
  throw unverifiedPrice(String(mod.name || ''));
}

/** Rewrite every modifier's price to its server truth; returns new items. */
export function rewriteModifierPrices<T extends SaleItemLike>(
  items: T[],
  truth: ModifierPriceTruth,
  approvedPrices?: Record<string, number>,
): T[] {
  return items.map((item) => {
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    if (modifiers.length === 0) return item;
    return {
      ...item,
      modifiers: modifiers.map((mod) => ({ ...mod, price: resolveModifierPrice(mod, truth, approvedPrices) })),
    };
  });
}

/**
 * Enforce mandatory/min/max on the linked groups of each line product.
 * linkedGroups maps a line productId to that product's linked groups.
 * A mod counts toward a group only when its DB option belongs to it.
 */
export function validateModifierGroupRules(
  items: SaleItemLike[],
  linkedGroups: Map<number, ModifierGroupRule[]>,
  truth: ModifierPriceTruth,
): void {
  for (const item of items) {
    const groups = linkedGroups.get(Number((item as any).productId || 0)) || [];
    if (groups.length === 0) continue;
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    for (const group of groups) {
      if (group.isActive === false) continue;
      let count = 0;
      for (const mod of modifiers) {
        const optionId = modifierOptionId(mod);
        if (optionId > 0 && truth.options.get(optionId)?.groupId === Number(group.id)) count += 1;
      }
      const min = Math.max(0, Math.floor(Number(group.minSelections || 0)));
      const max = effectiveMaxSelections(group);
      if (group.isMandatory && count < Math.max(1, min)) {
        throw new AppError(
          `Modifier group "${group.name}" requires a selection`,
          'RESTAURANT_MODIFIER_RULE_VIOLATED',
          422,
        );
      }
      // An optional group may be skipped entirely (zero selections is
      // fine); the minimum only binds once the cashier picks at least
      // one option from it.
      if (count > 0 && count < min) {
        throw new AppError(
          `Modifier group "${group.name}" requires at least ${min} selections`,
          'RESTAURANT_MODIFIER_RULE_VIOLATED',
          422,
        );
      }
      if (count > max) {
        throw new AppError(
          `Modifier group "${group.name}" allows at most ${max} selections`,
          'RESTAURANT_MODIFIER_RULE_VIOLATED',
          422,
        );
      }
    }
  }
}

/**
 * Combined contract: re-price first (so a spoofed price never reaches
 * the prepared-items loop), then enforce the group rules on the
 * re-priced lines. Returns the re-priced items.
 */
export function enforceRestaurantModifierContract<T extends SaleItemLike>(
  items: T[],
  truth: ModifierPriceTruth,
  linkedGroups: Map<number, ModifierGroupRule[]>,
  approvedPrices?: Record<string, number>,
): T[] {
  const repriced = rewriteModifierPrices(items, truth, approvedPrices);
  validateModifierGroupRules(repriced, linkedGroups, truth);
  return repriced;
}
