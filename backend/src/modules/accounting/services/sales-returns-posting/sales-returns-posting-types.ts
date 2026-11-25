import type { Transaction } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AccountingTenantFoundationService } from '../../accounting-tenant-foundation.service';
import type { MoneyDigits } from '../../engines/money-minor-units.engine';
import type { Logger } from '@nestjs/common';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';

/*
 * COGS remainder-absorption input shaping (INV-COGS-REMAINDER-SOLD-UNIT-BASIS).
 *
 * sale_items.cost_price is stored PER SOLD UNIT (frozen WAC x unit_multiplier
 * plus restaurant modifier costs), while product_location_stock.qty is in BASE
 * units. The residual engine anchors on (remaining + sold) x unit cost, so the
 * remaining quantity must be converted to the sold-unit basis before the
 * residual is computed, or a multi-unit sale re-opens the one-minor-unit
 * GL-vs-physical split the remainder absorption closed.
 *
 * Modifier lists are read from the stored sale_items.modifiers JSON. The
 * writer stores either a plain array or the offer wrapper
 * { mods: [...], offer: {...} }; both shapes are unwrapped here (the frozen-
 * cost helper only understands the plain array, so the wrapper must not be
 * mistaken for "no modifiers"). A modifier entry carries, per sold unit,
 * qty, consumptionQty (base units of the component per modifier unit) and
 * costPrice (component WAC x consumptionQty, 6dp, from
 * resolveSaleModifierCosts, which costs every component at the LOCKED
 * product WAC). An unparseable value fails safe to "no modifiers", matching
 * the frozen-cost helper's posture; nothing here re-reads the current WAC,
 * so frozen costs stay frozen on edits.
 */
export type ResidualModifier = {
  componentId: number;
  qtyPerSoldUnit: number;
  consumptionQty: number;
  costPrice: number;
};

export function residualModifierList(modifiers: unknown): ResidualModifier[] {
  let value: unknown = modifiers;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list: unknown = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as any).mods)
      ? (value as any).mods
      : null;
  if (!Array.isArray(list)) return [];
  const parsed: ResidualModifier[] = [];
  for (const mod of list as Array<Record<string, any>>) {
    if (!mod || typeof mod !== 'object') continue;
    parsed.push({
      componentId: Number(mod.productId || mod.componentProductId || mod.component_product_id || 0) || 0,
      qtyPerSoldUnit: Number(mod.qty ?? 1),
      consumptionQty: Number(mod.consumptionQty ?? mod.consumption_qty ?? 1),
      costPrice: Number(mod.costPrice ?? mod.cost_price ?? 0),
    });
  }
  return parsed;
}

/*
 * Convert one residual group's remaining quantity (base units) to the
 * sold-unit basis the residual engine anchors on: the remaining VALUE
 * (parent stock at its per-base-unit frozen WAC plus anchored modifier
 * components at theirs) divided by the group's per-sold-unit frozen cost.
 * With no modifiers this is exactly remaining / unit_multiplier.
 *
 * Apportionment follows the existing per-group rule: the full remaining
 * quantity of a product is assigned to the first occurrence of EACH
 * product-and-cost group, as before — a product sold at two frozen
 * costs in one sale therefore carries one minor unit of anchor
 * rounding per group, and the remaining GL equals physical exactly
 * for the single-group-per-product cases. A modifier component's remaining stock is
 * anchored at most once per sale, in the first group that consumes it; a
 * component that is itself a sold line in the same sale is anchored by its
 * own line group, never twice, and a component identical to the parent
 * product shares the parent pool and is not counted again. Zero, negative
 * or non-finite frozen costs keep the old base-unit assignment, so the
 * residual engine's existing fail-closed behaviour for those inputs is
 * unchanged. A stored modifier mix whose contributions exceed the frozen
 * line cost by more than a rounding hair is corrupt frozen data and fails
 * closed instead of inventing an anchor.
 */
export function residualSoldUnitRemaining(args: {
  unitCost: number;
  multiplier: number;
  remainingBaseQty: number;
  modifiers: ResidualModifier[];
  remainingByProduct: Map<number, number>;
  soldProductIds: Set<number>;
  anchoredModifierProducts: Set<number>;
  parentProductId: number;
}): number {
  if (!(args.unitCost > 0)) return args.remainingBaseQty;
  let modifierContribution = 0;
  for (const mod of args.modifiers) {
    if (Number.isFinite(mod.qtyPerSoldUnit) && Number.isFinite(mod.costPrice)) {
      modifierContribution += mod.qtyPerSoldUnit * mod.costPrice;
    }
  }
  let parentPerSoldUnit = args.unitCost - modifierContribution;
  if (parentPerSoldUnit < 0) {
    if (parentPerSoldUnit < -0.001) {
      throw new Error('Stored sale line cost is inconsistent with its modifier costs');
    }
    parentPerSoldUnit = 0;
  }
  let remainingValue = args.remainingBaseQty * (parentPerSoldUnit / args.multiplier);
  for (const mod of args.modifiers) {
    if (mod.componentId <= 0 || mod.componentId === args.parentProductId) continue;
    if (args.soldProductIds.has(mod.componentId)) continue;
    if (args.anchoredModifierProducts.has(mod.componentId)) continue;
    if (!(mod.consumptionQty > 0) || !Number.isFinite(mod.costPrice)) continue;
    const componentWac = mod.costPrice / mod.consumptionQty;
    remainingValue += (args.remainingByProduct.get(mod.componentId) || 0) * componentWac;
    args.anchoredModifierProducts.add(mod.componentId);
  }
  return remainingValue / args.unitCost;
}

export type SalesAndReturnsPostingDeps = {
  foundation: AccountingTenantFoundationService;
  getTenantAccountingSettings: (queryable: DbOrTx, tenantId: string) => Promise<any>;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  maxAllowedDifference: (bookDigits: MoneyDigits) => number;
  addLine: (lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3) => void;
  insertPostedJournal: (
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ) => Promise<number>;
  resolveSystemAccountByCode: (queryable: DbOrTx, tenantId: string, code: string) => Promise<number>;
  resolveAccountWithFallback: (
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ) => Promise<number>;
  getExistingSaleJournal: (queryable: DbOrTx, saleId: number, tenantId: string) => Promise<any>;
  getExistingSaleReversalJournal: (queryable: DbOrTx, saleId: number, tenantId: string) => Promise<any>;
  getExistingSalesReturnJournal: (queryable: DbOrTx, returnId: number, tenantId: string) => Promise<any>;
  getActiveAccountMap: (queryable: DbOrTx, tenantId: string, accountIds: number[]) => Promise<Map<number, boolean>>;
  assertTransaction: (queryable: unknown, method: string) => asserts queryable is Transaction<Database>;
  logger: Logger;
};
