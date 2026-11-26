import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../database/database.types';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';

/**
 * INV-VAN-PRICE-LIST-WIRING: the price-list resolution core, extracted
 * as pure functions of a queryable so the preview endpoint, the POS
 * sale path and the van sale path all run ONE computation (repo rule:
 * engines are extracted and imported identically by service and
 * tests, never re-implemented per caller).
 *
 * Resolution order (pinned): the customer's assigned list when it
 * exists AND is active; otherwise the tenant's active default list;
 * otherwise no list (base price). An assigned list that was deleted
 * or deactivated falls through to the default list instead of
 * failing the sale — the assignment is preserved on the customer
 * (re-activating the list restores it) and the engine resolves it as
 * "no list" for this sale.
 *
 * The context is resolved ONCE per sale (one customer read + at most
 * two list reads) and passed per line; only the per-product list-item
 * read runs per line. A pool-handle read must never run inside an
 * open transaction (PGlite single-connection deadlock): sale paths
 * resolve the context on the transaction handle just before the item
 * loop (van) or on the sale transaction (POS).
 */

export type PriceListContext = {
  priceListId: number;
  defaultDiscountPercent: number;
  name: string;
} | null;

export type PriceListItemSnapshot = {
  min_quantity: unknown;
  fixed_price: unknown;
  discount_percent: unknown;
};

type Queryable = Kysely<Database> | Transaction<Database>;

export async function prefetchPriceListItemsByProduct(
  queryable: Queryable,
  tenantId: string,
  priceListId: number,
  productIds: number[],
): Promise<Map<number, PriceListItemSnapshot[]>> {
  const uniqueIds = Array.from(new Set(productIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  const byProduct = new Map<number, PriceListItemSnapshot[]>();
  if (!uniqueIds.length || !(priceListId > 0)) return byProduct;

  const rows = await queryable
    .selectFrom('price_list_items')
    .select(['product_id', 'min_quantity', 'fixed_price', 'discount_percent'])
    .where('tenant_id', '=', tenantId)
    .where('price_list_id', '=', priceListId)
    .where('product_id', 'in', uniqueIds)
    .orderBy('min_quantity', 'desc')
    .execute();

  for (const row of rows) {
    const pid = Number(row.product_id);
    const bucket = byProduct.get(pid);
    if (bucket) bucket.push(row);
    else byProduct.set(pid, [row]);
  }
  return byProduct;
}

export async function resolvePriceListContext(
  queryable: Queryable,
  tenantId: string,
  customerId: number | null,
): Promise<PriceListContext> {
  let priceListId: number | null = null;
  if (customerId) {
    const cust = await queryable
      .selectFrom('customers')
      .select(['price_list_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', customerId)
      .executeTakeFirst();
    if (cust?.price_list_id) {
      priceListId = Number(cust.price_list_id);
    }
  }

  // An assigned list that is gone or inactive falls through to the
  // default list (see the header): the is_active check lives here,
  // once per sale, not per line.
  if (priceListId) {
    const assigned = await queryable
      .selectFrom('price_lists')
      .select(['id', 'default_discount_percent', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', priceListId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (assigned) {
      return {
        priceListId: Number(assigned.id),
        defaultDiscountPercent: Number(assigned.default_discount_percent || 0),
        name: String(assigned.name || ''),
      };
    }
    priceListId = null;
  }

  const defaultList = await queryable
    .selectFrom('price_lists')
    .select(['id', 'default_discount_percent', 'name'])
    .where('tenant_id', '=', tenantId)
    .where('is_default', '=', true)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (defaultList) {
    return {
      priceListId: Number(defaultList.id),
      defaultDiscountPercent: Number(defaultList.default_discount_percent || 0),
      name: String(defaultList.name || ''),
    };
  }
  return null;
}

export async function resolveListEffectivePrice(
  queryable: Queryable,
  tenantId: string,
  context: PriceListContext,
  productId: number,
  quantity: number,
  basePrice: number,
  options?: {
    paymentTerms?: 'cash' | 'credit';
    prefetchedCreditPrice?: number | null;
    prefetchedListItems?: PriceListItemSnapshot[];
  },
  moneyDigits?: MoneyDigits,
): Promise<{
  effectivePrice: number;
  discountPercent: number;
  appliedRule: string;
  priceListId: number | null;
  priceListName?: string;
}> {
  const digits: MoneyDigits = moneyDigits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));

  // The credit branch re-bases to the product's credit price when the
  // sale is on credit terms. Sale paths pass the tier price as the
  // base and pass paymentTerms 'cash' for wholesale-typed customers,
  // so the wholesale-beats-credit precedence survives this branch.
  if (options?.paymentTerms === 'credit') {
    if (options.prefetchedCreditPrice !== undefined) {
      if (options.prefetchedCreditPrice != null && Number(options.prefetchedCreditPrice) > 0) {
        basePrice = Number(options.prefetchedCreditPrice);
      }
    } else {
      const prod = await queryable
        .selectFrom('products')
        .select(['credit_price'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', productId)
        .executeTakeFirst();
      if (prod?.credit_price != null && Number(prod.credit_price) > 0) {
        basePrice = Number(prod.credit_price);
      }
    }
  }

  if (!context) {
    return {
      effectivePrice: basePrice,
      discountPercent: 0,
      appliedRule: 'none',
      priceListId: null,
    };
  }

  // The highest-minimum-quantity item matching this product wins.
  const specificItem =
    options?.prefetchedListItems !== undefined
      ? options.prefetchedListItems.find((entry) => Number(entry.min_quantity ?? 0) <= quantity)
      : await queryable
          .selectFrom('price_list_items')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('price_list_id', '=', context.priceListId)
          .where('product_id', '=', productId)
          .where('min_quantity', '<=', quantity)
          .orderBy('min_quantity', 'desc')
          .executeTakeFirst();

  if (specificItem) {
    if (specificItem.fixed_price != null && Number(specificItem.fixed_price) >= 0) {
      return {
        effectivePrice: Number(specificItem.fixed_price),
        discountPercent: basePrice > 0 ? Math.round((1 - Number(specificItem.fixed_price) / basePrice) * 100) : 0,
        appliedRule: 'product_fixed_price',
        priceListId: context.priceListId,
        priceListName: context.name,
      };
    }
    if (specificItem.discount_percent != null && Number(specificItem.discount_percent) > 0) {
      const disc = Number(specificItem.discount_percent);
      const finalPrice = Math.max(0, basePrice * (1 - disc / 100));
      return {
        effectivePrice: roundMoney(finalPrice, digits),
        discountPercent: disc,
        appliedRule: 'product_discount',
        priceListId: context.priceListId,
        priceListName: context.name,
      };
    }
  }

  // Fallback to the list's default discount.
  if (context.defaultDiscountPercent > 0) {
    const finalPrice = Math.max(0, basePrice * (1 - context.defaultDiscountPercent / 100));
    return {
      effectivePrice: roundMoney(finalPrice, digits),
      discountPercent: context.defaultDiscountPercent,
      appliedRule: 'list_default_discount',
      priceListId: context.priceListId,
      priceListName: context.name,
    };
  }

  return {
    effectivePrice: basePrice,
    discountPercent: 0,
    appliedRule: 'list_no_discount',
    priceListId: context.priceListId,
    priceListName: context.name,
  };
}
