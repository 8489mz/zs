/* INV-REST-GROUP-MODIFIER-CONTRACT: a chosen group option must send
 * productId = its linked stock component (component_product_id) and
 * optionId = the option id. At base the modal stored productId = opt.id,
 * so the backend resolver threw RESTAURANT_MODIFIER_COMPONENT_MISMATCH
 * (422) for every real group option and no group-modified sale could
 * post. When no component is linked, productId must be 0 so the backend
 * treats the option as a no-stock modifier instead of rejecting it. */
import { describe, it, expect } from 'vitest';
import { buildGroupModifierSelection } from './group-modifier-mapping';
import type { ModifierGroup, ModifierOption } from '@/shared/api/addons.api';

function group(overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 5,
    name: 'Extras',
    selectionType: 'multiple',
    isMandatory: false,
    minSelections: 0,
    maxSelections: 0,
    displayOrder: 1,
    isActive: true,
    options: [],
    ...overrides,
  };
}

function option(overrides: Partial<ModifierOption> = {}): ModifierOption {
  return {
    id: 7,
    groupId: 5,
    name: 'Extra cheese',
    price: 12,
    costPrice: 0,
    isActive: true,
    componentProductId: 42,
    consumptionQty: 1,
    ...overrides,
  };
}

describe('buildGroupModifierSelection', () => {
  it('sends the linked component product as productId and the option id as optionId', () => {
    const selected = buildGroupModifierSelection(group(), option({ id: 7, componentProductId: 42 }));

    expect(selected.productId).toBe(42);
    expect(selected.optionId).toBe(7);
    expect(selected.productId).not.toBe(7);
  });

  it('sends productId 0 when the option has no linked component (no-stock modifier)', () => {
    const selected = buildGroupModifierSelection(group(), option({ id: 9, componentProductId: null }));

    expect(selected.productId).toBe(0);
    expect(selected.optionId).toBe(9);
  });

  it('sends productId 0 when the component id is missing entirely', () => {
    const { componentProductId, ...optWithoutComponent } = option({ id: 11 });
    const selected = buildGroupModifierSelection(group(), optWithoutComponent);

    expect(selected.productId).toBe(0);
    expect(selected.optionId).toBe(11);
  });

  it('keeps the selling price, group identity and qty 1 from the chosen option', () => {
    const selected = buildGroupModifierSelection(
      group({ id: 5, name: 'Sauces' }),
      option({ id: 7, componentProductId: 42, price: 15, costPrice: 3 }),
    );

    expect(selected).toMatchObject({
      groupId: 5,
      groupName: 'Sauces',
      name: 'Extra cheese',
      qty: 1,
      price: 15,
      costPrice: 3,
    });
  });

  it('still maps by field when the option id happens to equal the component id', () => {
    const selected = buildGroupModifierSelection(group(), option({ id: 42, componentProductId: 42 }));

    expect(selected.productId).toBe(42);
    expect(selected.optionId).toBe(42);
  });
});
