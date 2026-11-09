import type { ModifierGroup, ModifierOption } from '@/shared/api/addons.api';

export interface GroupModifierSelection {
  productId: number;
  optionId: number;
  groupId: number;
  groupName: string;
  name: string;
  qty: number;
  price: number;
  costPrice: number;
}

/* Build the cart modifier stored when a cashier picks a structured group
 * option in the POS modifiers modal. The backend contract
 * (resolveSaleModifierCosts, sales-write.service.ts) is: optionId is the
 * pos_modifier_options row, productId is the option's linked stock
 * component (component_product_id). A productId that is neither the
 * configured component nor 0 makes the backend reject the sale with
 * RESTAURANT_MODIFIER_COMPONENT_MISMATCH (422); productId 0 means the
 * option has no stock component and is costed at 0 with no stock movement. */
export function buildGroupModifierSelection(
  group: ModifierGroup,
  opt: ModifierOption,
): GroupModifierSelection {
  return {
    productId: Number(opt.componentProductId || 0),
    optionId: Number(opt.id),
    groupId: group.id,
    groupName: group.name,
    name: opt.name,
    qty: 1,
    price: Number(opt.price || 0),
    costPrice: Number(opt.costPrice || 0),
  };
}
