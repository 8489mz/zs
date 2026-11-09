/* INV-REST-MODIFIER-CONTRACT-2 (R4-C): pure-helper spec for the
 * restaurant modifier contract (price re-resolution + mandatory/min/max
 * rules). No DB: the helper works over plain data maps, and the service
 * pre-pass only loads those maps from the caller's transaction.
 *
 * WHAT THIS PINS:
 * - An option mod is re-priced to its configured option price, whatever
 *   the client sent (0 -> 10, -5 -> 10); a missing option is 422
 *   RESTAURANT_MODIFIER_OPTION_INVALID; a negative configured price is
 *   a 500 data-corruption failure, never a silent discount.
 * - A combo-component mod is priced from the product retail price;
 *   a combo mod for an unknown product is 422 PRICE_UNVERIFIED.
 * - A flat legacy addon (productId is an addon id, not a product id)
 *   is priced from addons.price; products win on id collision.
 * - A bare product mod keeps a sane client price (bundled ingredient
 *   portion at 0 stays 0); a negative client price is 422, and a mod
 *   with no truth at all (unknown product, name-only) is 422.
 * - Group rules resolve the group from the DB option, never the
 *   client-sent groupId: mandatory with zero selections is 422, min 2
 *   with 1 selection is 422, 3 selections with max 2 is 422, a
 *   single-select group caps at 1, and a client groupId pointing at a
 *   different group does not satisfy the mandatory group.
 */
import assert from 'node:assert/strict';
import {
  effectiveMaxSelections,
  enforceRestaurantModifierContract,
  rewriteModifierPrices,
  validateModifierGroupRules,
  type ModifierGroupRule,
  type ModifierPriceTruth,
} from '../../src/modules/sales/helpers/restaurant-modifier-contract.helper';

const truth: ModifierPriceTruth = {
  options: new Map([
    [11, { price: 10, groupId: 1 }],
    [12, { price: 0, groupId: 1 }],
    [13, { price: 5, groupId: 1 }],
    [14, { price: -3, groupId: 2 }],
    [21, { price: 7, groupId: 2 }],
  ]),
  products: new Map([
    [100, 60],
    [101, 25],
  ]),
  addons: new Map([
    [100, 9],
    [500, 15],
  ]),
};

const mandatoryGroup: ModifierGroupRule = {
  id: 1, name: 'Sauces', selectionType: 'multiple',
  isMandatory: true, minSelections: 1, maxSelections: 2, isActive: true,
};
const minTwoGroup: ModifierGroupRule = {
  id: 2, name: 'Toppings', selectionType: 'multiple',
  isMandatory: false, minSelections: 2, maxSelections: 10, isActive: true,
};
const singleGroup: ModifierGroupRule = {
  id: 3, name: 'Cooking', selectionType: 'single',
  isMandatory: false, minSelections: 0, maxSelections: 10, isActive: true,
};

(function restaurantModifierContractHelperSpec() {
  // I47: option mods are re-priced to the configured price.
  const repriced = rewriteModifierPrices(
    [{ productId: 100, modifiers: [
      { optionId: 11, productId: 0, name: 'Extra cheese', qty: 1, price: 0 },
      { optionId: 11, productId: 0, name: 'Extra cheese', qty: 1, price: -5 },
    ] }],
    truth,
  );
  assert.equal(repriced[0].modifiers![0].price, 10);
  assert.equal(repriced[0].modifiers![1].price, 10);

  // Missing option: 422, never a silent pass-through.
  assert.throws(
    () => rewriteModifierPrices([{ productId: 100, modifiers: [{ optionId: 999, price: 0 }] }], truth),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_OPTION_INVALID' && e.statusCode === 422,
  );
  // Negative configured price: data corruption, fail closed (500).
  assert.throws(
    () => rewriteModifierPrices([{ productId: 100, modifiers: [{ optionId: 14, price: 0 }] }], truth),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_PRICE_CORRUPT' && e.statusCode === 500,
  );

  // I52: combo components price from the product retail price.
  const combo = rewriteModifierPrices(
    [{ productId: 100, modifiers: [
      { productId: 101, name: 'Fries', qty: 1, price: 0, isComboComponent: true },
      { productId: 101, name: 'Fries', qty: 1, price: 999, isComboComponent: true },
    ] }],
    truth,
  );
  assert.equal(combo[0].modifiers![0].price, 25);
  assert.equal(combo[0].modifiers![1].price, 25);
  assert.throws(
    () => rewriteModifierPrices(
      [{ productId: 100, modifiers: [{ productId: 404, name: 'Ghost side', qty: 1, price: 5, isComboComponent: true }] }],
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_PRICE_UNVERIFIED' && e.statusCode === 422,
  );

  // Flat legacy addon: productId is an addon id; products win on collision.
  const addon = rewriteModifierPrices(
    [{ productId: 100, modifiers: [
      { productId: 500, name: 'Dip', qty: 1, price: 0 },
      { productId: 100, name: 'Cheese portion', qty: 0.2, price: 0 },
    ] }],
    truth,
  );
  assert.equal(addon[0].modifiers![0].price, 15);
  // Bare product mod keeps a sane client price (bundled ingredient at 0).
  assert.equal(addon[0].modifiers![1].price, 0);

  // Negative client price on a bare product mod: no configured modifier
  // price to fall back to, so it is rejected, not re-priced to retail.
  assert.throws(
    () => rewriteModifierPrices(
      [{ productId: 100, modifiers: [{ productId: 101, name: 'Side', qty: 1, price: -5 }] }],
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_PRICE_UNVERIFIED' && e.statusCode === 422,
  );
  // Name-only mod (old hardcoded combo delta shape): no truth at all.
  assert.throws(
    () => rewriteModifierPrices([{ productId: 100, modifiers: [{ name: 'Fries', price: 12 }] }], truth),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_PRICE_UNVERIFIED' && e.statusCode === 422,
  );

  // I48: mandatory group with zero selections is 422.
  assert.throws(
    () => validateModifierGroupRules(
      [{ productId: 100, modifiers: [] }],
      new Map([[100, [mandatoryGroup]]]),
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_RULE_VIOLATED' && String(e.message).includes('Sauces'),
  );
  // One selection satisfies the mandatory group.
  assert.doesNotThrow(() => validateModifierGroupRules(
    [{ productId: 100, modifiers: [{ optionId: 11, price: 10 }] }],
    new Map([[100, [mandatoryGroup]]]),
    truth,
  ));
  // 3 selections with max 2 is 422.
  assert.throws(
    () => validateModifierGroupRules(
      [{ productId: 100, modifiers: [{ optionId: 11 }, { optionId: 12 }, { optionId: 13 }] }],
      new Map([[100, [mandatoryGroup]]]),
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_RULE_VIOLATED',
  );
  // Min 2 with 1 selection is 422; 2 selections pass.
  assert.throws(
    () => validateModifierGroupRules(
      [{ productId: 100, modifiers: [{ optionId: 21 }] }],
      new Map([[100, [minTwoGroup]]]),
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_RULE_VIOLATED',
  );
  assert.doesNotThrow(() => validateModifierGroupRules(
    [{ productId: 100, modifiers: [{ optionId: 21 }, { optionId: 14 }] }],
    new Map([[100, [minTwoGroup]]]),
    truth,
  ));
  // An optional (non-mandatory) group may be skipped entirely: zero
  // selections pass even when minSelections is 2. (The minimum binds
  // only once the cashier picks at least one option from the group.)
  assert.doesNotThrow(() => validateModifierGroupRules(
    [{ productId: 100, modifiers: [] }],
    new Map([[100, [minTwoGroup]]]),
    truth,
  ));
  // Single-select groups cap at 1 even when maxSelections says 10.
  assert.equal(effectiveMaxSelections(singleGroup), 1);
  assert.equal(effectiveMaxSelections(mandatoryGroup), 2);
  // A client-sent groupId pointing at the mandatory group does not
  // satisfy it when the DB option belongs to another group.
  assert.throws(
    () => validateModifierGroupRules(
      [{ productId: 100, modifiers: [{ optionId: 21, groupId: 1 }] }],
      new Map([[100, [mandatoryGroup]]]),
      truth,
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_RULE_VIOLATED',
  );
  // An option from an unlinked group does not count toward a linked
  // group and is not rejected here (the cost resolver's component
  // check still guards it).
  assert.doesNotThrow(() => validateModifierGroupRules(
    [{ productId: 100, modifiers: [{ optionId: 21 }] }],
    new Map([[100, [singleGroup]]]),
    truth,
  ));
  // The combined contract re-prices first, then enforces rules.
  const combined = enforceRestaurantModifierContract(
    [{ productId: 100, modifiers: [{ optionId: 11, price: 0 }] }],
    truth,
    new Map([[100, [mandatoryGroup]]]),
  );
  assert.equal(combined[0].modifiers![0].price, 10);
  assert.throws(
    () => enforceRestaurantModifierContract(
      [{ productId: 100, modifiers: [] }],
      truth,
      new Map([[100, [mandatoryGroup]]]),
    ),
    (e: any) => e.code === 'RESTAURANT_MODIFIER_RULE_VIOLATED',
  );
  // Items without modifiers pass through untouched.
  assert.deepEqual(enforceRestaurantModifierContract([{ productId: 100 }], truth, new Map()), [{ productId: 100 }]);

  console.log('restaurant modifier contract helper spec passed');
})();
