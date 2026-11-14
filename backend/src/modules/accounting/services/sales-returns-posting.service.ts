/*
 * Sales and returns posting (split-3 out of AccountingPostingService).
 * Pure move: the sales/returns posting methods + residual COGS helpers,
 * unchanged, behind the AccountingPostingService delegating facade. The
 * facade owns the shared journal helpers; this service receives them bound
 * via SalesAndReturnsPostingDeps, so the moved bodies are byte-identical to
 * the originals (except the nine private helpers the facade keeps delegating
 * to — saleCogsResidual, readSaleResidualLines, residualCogsGroups,
 * salesReturnCogsResidual, salesReturnCogsAmount, addSaleRevenueCreditLegs,
 * priorSalesReturnRelief, priorSalesReturnReceivableCredit and
 * deliveryCustodyPartner — whose declarations drop `private` so the facade
 * delegations can call them: TS2341 forbids calling a private method of
 * another class. Their bodies are unchanged, and the facade keeps the exact
 * original private signatures, so the residualCogsGroups text pin still
 * passes and no outside caller changes.)
 */
import { Transaction } from 'kysely';
import { sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AppError } from '../../../common/errors/app-error';
import { calculateSalesReturnCost, resolveSalesReturnCostLines } from '../engines/sales-return-cost.engine';
import { cogsResidualAmount, type CogsResidualGroup } from '../engines/cogs-residual.engine';
import { currencyMoneyDigits, MoneyDigits } from '../engines/money-minor-units.engine';
import { Logger } from '@nestjs/common';
import { tenantBaseCurrency } from '../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';

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
type ResidualModifier = {
  componentId: number;
  qtyPerSoldUnit: number;
  consumptionQty: number;
  costPrice: number;
};

function residualModifierList(modifiers: unknown): ResidualModifier[] {
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
function residualSoldUnitRemaining(args: {
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

export class SalesAndReturnsPostingService {
  private readonly foundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: SalesAndReturnsPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'];
  private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'];
  private readonly addLine: SalesAndReturnsPostingDeps['addLine'];
  private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'];
  private readonly resolveSystemAccountByCode: SalesAndReturnsPostingDeps['resolveSystemAccountByCode'];
  private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'];
  private readonly getExistingSaleJournal: SalesAndReturnsPostingDeps['getExistingSaleJournal'];
  private readonly getExistingSaleReversalJournal: SalesAndReturnsPostingDeps['getExistingSaleReversalJournal'];
  private readonly getExistingSalesReturnJournal: SalesAndReturnsPostingDeps['getExistingSalesReturnJournal'];
  private readonly getActiveAccountMap: SalesAndReturnsPostingDeps['getActiveAccountMap'];
  private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'];
  private readonly logger: Logger;

  constructor(deps: SalesAndReturnsPostingDeps) {
    this.foundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
    this.resolveAccountWithFallback = deps.resolveAccountWithFallback;
    this.getExistingSaleJournal = deps.getExistingSaleJournal;
    this.getExistingSaleReversalJournal = deps.getExistingSaleReversalJournal;
    this.getExistingSalesReturnJournal = deps.getExistingSalesReturnJournal;
    this.getActiveAccountMap = deps.getActiveAccountMap;
    this.assertTransaction = deps.assertTransaction;
    this.logger = deps.logger;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.foundation.ensureForAuth(queryable, auth);
  }

  /**
   * INV-COGS-REMAINDER-ABSORPTION + INV-COGS-REMAINDER-SOLD-UNIT-BASIS:
   * COGS for a sale (or edited sale) is the residual of the pre-sale stock
   * value minus the remaining stock value at book digits, per product and
   * frozen unit cost. The remaining quantity is read AFTER the sale's stock
   * movement on the caller's transaction handle, summed across all branches
   * and locations (weighted cost is product-level), and converted to the
   * sold-unit basis before the residual (remaining VALUE at the frozen
   * per-base-unit costs, divided by the per-sold-unit frozen cost), so the
   * read and the journal commit or roll back together. Products with
   * no stock row (or a null product) contribute zero remaining
   * quantity, which makes the residual equal the old total
   * rounding for those lines.
   */
  async saleCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const saleItems = await this.readSaleResidualLines(queryable, tenantId, saleId);
    const groups = await this.residualCogsGroups(queryable, tenantId, saleItems, null);
    return cogsResidualAmount(groups, bookDigits);
  }

  async readSaleResidualLines(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ): Promise<Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>> {
    return queryable
      .selectFrom('sale_items')
      .select(['id', 'product_id', 'qty', 'cost_price', 'unit_multiplier', 'modifiers'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      // Deterministic line order: the remaining quantity of a product is
      // assigned to its first product-and-cost group, so the anchor must
      // not depend on the database's unspecified row order.
      .orderBy('id')
      .execute() as Promise<Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>>;
  }

  /*
   * Shared residual grouping for sale COGS and the sales-return mirror
   * (INV-SALES-RETURN-COGS-RESIDUAL-MIRROR). One grouping rule, two
   * quantities: in sale mode (qtySoldBySaleItemId null) each line
   * contributes its sold quantity and the anchor is the remaining
   * quantity read after the sale's stock movement. In return mode the
   * map holds the returned quantity per sale line (sold units); only
   * lines in the map participate, and the anchor is the post-sale
   * remaining quantity reconstructed as the current remaining stock
   * (read after the return's restock, on the same transaction) minus
   * the restocked base quantity of the group — so the reversal is
   * exactly the residual the sale would have posted for the returned
   * portion, and sequential returns telescope to the posted COGS.
   * Modifier anchoring, the per-group rule, and the deterministic
   * order are identical in both modes: soldProductIds and the
   * component pool are computed over ALL sale lines, while only
   * participating lines create groups.
   */
  async residualCogsGroups(
    queryable: Transaction<Database>,
    tenantId: string,
    saleItems: Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>,
    qtySoldBySaleItemId: Map<number, number> | null,
  ): Promise<CogsResidualGroup[]> {
    const soldProductIds = new Set<number>();
    for (const item of saleItems) {
      const id = Number(item.product_id || 0);
      if (id > 0) soldProductIds.add(id);
    }
    const modifierLists = saleItems.map((item) => residualModifierList((item as any).modifiers));
    const productIds = new Set<number>(soldProductIds);
    for (const mods of modifierLists) {
      for (const mod of mods) {
        if (mod.componentId > 0) productIds.add(mod.componentId);
      }
    }
    const remainingByProduct = new Map<number, number>();
    if (productIds.size > 0) {
      const stockRows = await queryable
        .selectFrom('product_location_stock')
        .select(['product_id', 'qty'])
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', [...productIds])
        .execute();
      for (const row of stockRows) {
        const id = Number(row.product_id || 0);
        remainingByProduct.set(id, (remainingByProduct.get(id) || 0) + Number(row.qty || 0));
      }
    }
    // Restocked base quantity per product-and-cost group (return mode
    // only): returned sold units converted back to base units through
    // each line's own multiplier, so the reconstructed post-sale
    // remaining quantity is in the same base units the stock read
    // reports. Sale mode contributes nothing here.
    const restockedBaseByGroup = new Map<string, number>();
    if (qtySoldBySaleItemId) {
      for (const item of saleItems) {
        const returned = qtySoldBySaleItemId.get(Number(item.id));
        if (!(returned! > 0)) continue;
        const rawMultiplier = Number((item as any).unit_multiplier ?? 1);
        const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
        const key = `${Number(item.product_id || 0)}|${Number(item.cost_price || 0)}`;
        restockedBaseByGroup.set(key, (restockedBaseByGroup.get(key) || 0) + returned! * multiplier);
      }
    }
    const anchoredModifierProducts = new Set<number>();
    const grouped = new Map<string, CogsResidualGroup>();
    saleItems.forEach((item, index) => {
      const productId = Number(item.product_id || 0);
      const unitCost = Number(item.cost_price || 0);
      const qtySold = qtySoldBySaleItemId
        ? (qtySoldBySaleItemId.get(Number(item.id)) || 0)
        : Number(item.qty || 0);
      if (qtySoldBySaleItemId && !(qtySold > 0)) return;
      const key = `${productId}|${unitCost}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.qtySold += qtySold;
        return;
      }
      const rawMultiplier = Number((item as any).unit_multiplier ?? 1);
      const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
      grouped.set(key, {
        qtySold,
        unitCost,
        qtyRemaining: residualSoldUnitRemaining({
          unitCost,
          multiplier,
          remainingBaseQty: productId > 0
            ? (remainingByProduct.get(productId) || 0) - (restockedBaseByGroup.get(key) || 0)
            : 0,
          modifiers: modifierLists[index],
          remainingByProduct,
          soldProductIds,
          anchoredModifierProducts,
          parentProductId: productId,
        }),
      });
    });
    return [...grouped.values()];
  }

  /*
   * INV-SALES-RETURN-COGS-RESIDUAL-MIRROR: a return reverses COGS on the
   * same residual basis the sale posted it. The plain qty x frozen cost
   * product ignores the anchor remainder the sale's COGS carries, so a
   * return stranded one minor unit in 1140 per affected return. The
   * mirror feeds the returned quantity through the shared residual
   * grouping with the post-sale remaining quantity reconstructed from
   * the post-restock stock read, so GL equals physical after sale +
   * return in the worked case and a full return nets COGS to zero.
   * Eligibility is deliberately narrow: every return line must resolve
   * to one original sale line at that line's frozen cost (a saved cost
   * of zero means a prepared composite whose COGS stays expensed and
   * contributes nothing; a differing nonzero saved cost keeps the
   * pinned plain-product override instead of inventing an anchor).
   * Anything else — no linked sale, an unresolvable line, a differing
   * saved cost — falls back to the legacy plain computation, which
   * keeps every previously pinned behaviour intact.
   */
  async salesReturnCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ): Promise<number> {
    const saleItems = await this.readSaleResidualLines(queryable, tenantId, saleId);
    const groups = await this.residualCogsGroups(queryable, tenantId, saleItems, returnedQtyBySaleItemId);
    return cogsResidualAmount(groups, bookDigits);
  }

  async salesReturnCogsAmount(
    queryable: Transaction<Database>,
    tenantId: string,
    sale: { id: number } | null,
    returnItems: Array<{ product_id: number | null; sale_item_id: number | null; qty: number | string; cost_price?: number | string | null }>,
    saleItems: Array<{ id: number; product_id: number | null; cost_price: number | string | null }>,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const legacy = calculateSalesReturnCost(returnItems, saleItems);
    if (!sale) return legacy;
    const saleCostById = new Map(saleItems.map((item) => [Number(item.id), Number(item.cost_price || 0)]));
    const returnedQtyBySaleItemId = new Map<number, number>();
    for (const line of resolveSalesReturnCostLines(returnItems, saleItems)) {
      if (line.saleItemId == null) return legacy;
      const saleCost = saleCostById.get(line.saleItemId);
      if (saleCost == null) return legacy;
      if (line.unitCost === 0) continue;
      if (Math.abs(line.unitCost - saleCost) > 0.0000001) return legacy;
      returnedQtyBySaleItemId.set(
        line.saleItemId,
        (returnedQtyBySaleItemId.get(line.saleItemId) || 0) + line.qty,
      );
    }
    if (returnedQtyBySaleItemId.size === 0) return 0;
    return this.salesReturnCogsResidual(queryable, tenantId, Number(sale.id), bookDigits, returnedQtyBySaleItemId);
  }

  /**
   * R4-A (INV-REST-SALE-MONEY-TRUTH): split the old single sale-revenue
   * credit into its true legs. Used by BOTH postSale and postSaleEdit
   * — the duplicated formula across the two functions was itself a
   * root cause, so the split lives here exactly once.
   *
   * Exclusive-tax case: Cr 4100 = subtotal; Cr 4200 = service charge
   * (+ the delivery fee when the store's own fleet delivered it);
   * Cr 2115 = delivery fee when a freelance courier delivered it
   * (a NULL stored mode defaults to freelance, matching the
   * sales writer's default); Cr 2147 = tip. The legs sum exactly
   * to the old single revenueCredit, so the journal balance is
   * preserved by construction.
   *
   * Tax-inclusive case: the same legs, but the tax embedded in the
   * goods + service-charge base is stripped pro-rata (residual to
   * 4100). The ex-tax base is (subtotal + serviceCharge) - taxAmount
   * — the discount is deliberately NOT netted here: it is carried
   * by the separate Dr 4300 leg, so netting it would double-count
   * it and unbalance the journal by the discount. (A corrupt tax
   * larger than the base keeps the old single-line shape so the
   * journal still balances instead of throwing on a negative leg.)
   *
   * The 4200/2115/2147 accounts resolve lazily, only when their leg
   * is non-zero, so an ordinary sale with no extras creates no new
   * accounts. 4200 is NOT auto-created: it is seeded by the COA
   * migration (as postService already assumes); 2115/2147
   * auto-create from the knownAccounts map above.
   */
  async addSaleRevenueCreditLegs(
    queryable: DbOrTx,
    tenantId: string,
    add: (line: JournalLineDraft) => void,
    input: {
      subtotal: number;
      taxAmount: number;
      deliveryFee: number;
      deliveryFeeMode: string | null | undefined;
      serviceCharge: number;
      tipAmount: number;
      pricesIncludeTax: boolean;
      revenueCredit: number;
      goodsAccountId: number;
      branchId: number | null;
      locationId: number | null;
      contextLabel: string;
    },
    bookDigits: MoneyDigits,
  ): Promise<void> {
    const { subtotal, taxAmount, deliveryFee, serviceCharge, tipAmount } = input;
    const isStoreFleet = String(input.deliveryFeeMode || '').trim() === 'store_fleet';
    const deliveryPayable = isStoreFleet ? 0 : deliveryFee;
    const deliveryRevenue = isStoreFleet ? deliveryFee : 0;

    let legs: { goods: number; service: number; deliveryPayable: number; deliveryRevenue: number; tip: number };
    if (input.pricesIncludeTax) {
      const base = this.toMoney(subtotal + serviceCharge - taxAmount, bookDigits);
      const denom = subtotal + serviceCharge;
      if (base < 0) {
        legs = { goods: input.revenueCredit, service: 0, deliveryPayable: 0, deliveryRevenue: 0, tip: 0 };
      } else {
        const serviceLeg = denom > 0 ? this.toMoney((base * serviceCharge) / denom, bookDigits) : 0;
        legs = {
          goods: this.toMoney(base - serviceLeg, bookDigits),
          service: serviceLeg,
          deliveryPayable,
          deliveryRevenue,
          tip: tipAmount,
        };
      }
    } else {
      legs = { goods: subtotal, service: serviceCharge, deliveryPayable, deliveryRevenue, tip: tipAmount };
    }

    const scope = { partnerType: 'none' as const, partnerId: null, branchId: input.branchId, locationId: input.locationId };
    if (legs.goods > 0) {
      add({ accountId: input.goodsAccountId, description: `إيراد مبيعات ${input.contextLabel}`, debit: 0, credit: legs.goods, ...scope });
    }
    if (legs.service > 0 || legs.deliveryRevenue > 0) {
      const serviceAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '4200');
      if (legs.service > 0) {
        add({ accountId: serviceAccountId, description: `رسم خدمة ${input.contextLabel}`, debit: 0, credit: legs.service, ...scope });
      }
      if (legs.deliveryRevenue > 0) {
        add({ accountId: serviceAccountId, description: `إيراد رسوم توصيل ${input.contextLabel}`, debit: 0, credit: legs.deliveryRevenue, ...scope });
      }
    }
    if (legs.deliveryPayable > 0) {
      const courierAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '2115');
      add({ accountId: courierAccountId, description: `رسوم توصيل مستحقة لمندوب حر ${input.contextLabel}`, debit: 0, credit: legs.deliveryPayable, ...scope });
    }
    if (legs.tip > 0) {
      const tipsAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '2147');
      add({ accountId: tipsAccountId, description: `إكراميات مستحقة للموظفين ${input.contextLabel}`, debit: 0, credit: legs.tip, ...scope });
    }
  }

  async postSale(queryable: Transaction<Database>, saleId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
    this.assertTransaction(queryable, 'postSale');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSaleJournal(queryable, saleId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const sale = await queryable
      .selectFrom('sales')
      .select([
        'id', 'doc_no', 'customer_id', 'subtotal', 'discount', 'tax_amount',
        'total', 'paid_amount', 'store_credit_used', 'exchange_return_id', 'branch_id', 'location_id', 'created_by', 'created_at',
        'delivery_fee', 'delivery_fee_mode', 'service_charge', 'tip_amount', 'prices_include_tax',
        'sale_origin', 'payment_type', 'collection_status',
      ])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting sale ${saleId}`);

    const payments = await queryable
      .selectFrom('sale_payments')
      .select(['payment_channel', 'amount'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const cashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const nonCashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') !== 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));

    const subtotal = toBookMoney(sale.subtotal);
    const discount = toBookMoney(sale.discount);
    const taxAmount = toBookMoney(sale.tax_amount);
    const deliveryFee = toBookMoney((sale as any).delivery_fee ?? 0);
    const serviceCharge = toBookMoney((sale as any).service_charge ?? 0);
    const tipAmount = toBookMoney((sale as any).tip_amount ?? 0);
    const paidAmount = toBookMoney(sale.paid_amount);
    const storeCreditUsed = toBookMoney(sale.store_credit_used);
    const saleTotal = toBookMoney(sale.total);
    const receivableAmount = toBookMoney(Math.max(0, saleTotal - paidAmount - storeCreditUsed));
    const revenueCredit = sale.prices_include_tax
      ? toBookMoney(subtotal + serviceCharge - taxAmount + deliveryFee + tipAmount)
      : toBookMoney(subtotal + serviceCharge + deliveryFee + tipAmount);

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const customerPartnerId = sale.customer_id ? Number(sale.customer_id) : null;

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = storeCreditUsed > 0
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesDiscountAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_discount_account_id, '4300');
    const salesRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

    if (cashAmount > 0) {
      addBookLine({
        accountId: cashAccountId,
        description: 'تحصيل نقدي من فاتورة بيع',
        debit: cashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (nonCashAmount > 0) {
      addBookLine({
        accountId: bankAccountId,
        description: 'تحصيل غير نقدي من فاتورة بيع',
        debit: nonCashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (receivableAmount > 0) {
      const isVanSale = String((sale as any).sale_origin || '') === 'van_sale';
      const paymentType = String((sale as any).payment_type || '');
      const branchIdVal = sale.branch_id ? Number(sale.branch_id) : null;
      const locationIdVal = sale.location_id ? Number(sale.location_id) : null;

      if (isVanSale && paymentType === 'cash') {
        // Cash collected in the field sits in rep custody (partnerType: 'none') until settleTrip clears it.
        // Even if customer_id is set on the invoice, the customer does not owe a receivable.
        addBookLine({
          accountId: customerAccountId,
          description: 'عهدة نقدية لدى مندوب التوزيع من فاتورة بيع نقدي',
          debit: receivableAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: branchIdVal,
          locationId: locationIdVal,
        });
      } else if (isVanSale && paymentType === 'split') {
        const creditLedgerRow = await (queryable as any)
          .selectFrom('customer_ledger')
          .select(['amount'])
          .where('reference_type', '=', 'sale')
          .where('reference_id', '=', saleId)
          .where('entry_type', '=', 'sale_credit')
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const creditPortion = toBookMoney(Math.min(receivableAmount, Math.max(0, Number(creditLedgerRow?.amount || 0))));
        const repCashPortion = toBookMoney(Math.max(0, receivableAmount - creditPortion));

        if (repCashPortion > 0) {
          addBookLine({
            accountId: customerAccountId,
            description: 'عهدة نقدية لدى مندوب التوزيع (الجزء النقدي من فاتورة مجزأة)',
            debit: repCashPortion,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: branchIdVal,
            locationId: locationIdVal,
          });
        }
        if (creditPortion > 0) {
          addBookLine({
            accountId: customerAccountId,
            description: 'مديونية عميل من فاتورة بيع مجزأة',
            debit: creditPortion,
            credit: 0,
            partnerType: customerPartnerId ? 'customer' : 'none',
            partnerId: customerPartnerId,
            branchId: branchIdVal,
            locationId: locationIdVal,
          });
        }
      } else {
        addBookLine({
          accountId: customerAccountId,
          description: 'مديونية عميل من فاتورة بيع',
          debit: receivableAmount,
          credit: 0,
          partnerType: customerPartnerId ? 'customer' : 'none',
          partnerId: customerPartnerId,
          branchId: branchIdVal,
          locationId: locationIdVal,
        });
      }
    }

    if (storeCreditUsed > 0) {
      addBookLine({
        accountId: storeCreditAccountId,
        description: 'استخدام رصيد دائن للعميل (Store Credit)',
        debit: storeCreditUsed,
        credit: 0,
        partnerType: customerPartnerId ? 'customer' : 'none',
        partnerId: customerPartnerId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (discount > 0) {
      addBookLine({
        accountId: salesDiscountAccountId,
        description: 'خصم مبيعات على الفاتورة',
        debit: discount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (revenueCredit > 0) {
      await this.addSaleRevenueCreditLegs(queryable, scope.tenantId, addBookLine, {
        subtotal,
        taxAmount,
        deliveryFee,
        deliveryFeeMode: (sale as any).delivery_fee_mode,
        serviceCharge,
        tipAmount,
        pricesIncludeTax: Boolean(sale.prices_include_tax),
        revenueCredit,
        goodsAccountId: salesRevenueAccountId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
        contextLabel: 'الفاتورة',
      }, bookDigits);
    }

    if (taxAmount > 0) {
      addBookLine({
        accountId: salesTaxAccountId,
        description: 'ضريبة مبيعات مستحقة',
        debit: 0,
        credit: taxAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    // Reliable COGS source: sale_items.cost_price captured at sale time.
    // In this codebase, sale_items.cost_price is stored per sold unit (already adjusted by unit_multiplier),
    // so do not multiply by unit_multiplier again here. The amount is
    // the remainder-absorbed residual (INV-COGS-REMAINDER-ABSORPTION):
    // pre-sale stock value minus remaining stock value at book digits.
    const cogsAmount = toBookMoney(await this.saleCogsResidual(queryable, scope.tenantId, saleId, bookDigits));

    if (cogsAmount > 0) {
      addBookLine({
        accountId: cogsAccountId,
        description: 'تكلفة البضاعة المباعة',
        debit: cogsAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
      addBookLine({
        accountId: inventoryAccountId,
        description: 'إخراج مخزون مقابل المبيعات',
        debit: 0,
        credit: cogsAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting sale ${saleId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting sale ${saleId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting sale ${saleId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (sale.exchange_return_id) {
      let returnLinesCollected = false;
      const returnPosting = await this.postSalesReturn(queryable, Number(sale.exchange_return_id), auth, (returnLines) => {
        returnLinesCollected = returnLines.length > 0;
        normalizedLines.push(...returnLines);
      });
      if (!returnLinesCollected || returnPosting.posted || returnPosting.journalEntryId != null) {
        throw new AppError('مرتجع الاستبدال مرتبط بقيد مستقل؛ يلزم تسوية يدوية', 'EXCHANGE_LEDGER_CONFLICT', 422);
      }
    }
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: sale.created_at ? new Date(sale.created_at) : new Date(),
      description: `قيد بيع تلقائي للفاتورة رقم ${sale.doc_no || `Z-${saleId}`}`,
      branchId: sale.branch_id ? Number(sale.branch_id) : null,
      locationId: sale.location_id ? Number(sale.location_id) : null,
      createdBy: sale.created_by ? Number(sale.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }

  async postSaleEdit(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
    reason?: string,
    options?: {
      preparedWaste?: {
        oldItems: Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>;
        restoredQtyBySaleItemId: Map<number, number>;
      };
    },
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    this.assertTransaction(queryable, 'postSaleEdit');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // Count postings vs reversals for this sale so we handle already-reversed states
    const counts = await queryable
      .selectFrom('journal_entries')
      .select([
        sql<number>`count(*) filter (where source_type in ('sale', 'sale_edit'))`.as('postings'),
        sql<number>`count(*) filter (where source_type = 'sale_reversal')`.as('reversals'),
      ])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const totalPostings = Number(counts?.postings || 0);
    const totalReversals = Number(counts?.reversals || 0);
    const activePostings = totalPostings - totalReversals;

    if (totalPostings > 0 && activePostings <= 0) {
      throw new AppError('لا يمكن ترحيل تعديل لفاتورة ملغاة ومعكوسة بالكامل', 'SALE_ALREADY_REVERSED', 400);
    }

    if (activePostings > 0) {
      const reversalReason = reason ? `تعديل فاتورة: ${reason}` : 'تعديل فاتورة مبيعات';
      // INV-SALE-EDIT-PREPARED-WASTE: exclude the consumed portion's
      // residual COGS from the reversal, so the waste cost stays posted
      // exactly as cancelSale's full exclusion keeps it. Both residual
      // evaluations read the same post-movement remaining stock, so a
      // kept line excludes zero and a removed line excludes its full
      // old residual.
      let preparedWasteCogsExclusion = 0;
      if (options?.preparedWaste) {
        const { oldItems, restoredQtyBySaleItemId } = options.preparedWaste;
        const oldGroups = await this.residualCogsGroups(queryable, scope.tenantId, oldItems, null);
        const restoredItems = oldItems.map((oldItem) => ({
          ...oldItem,
          qty: Number(restoredQtyBySaleItemId.get(Number(oldItem.id)) || 0),
        }));
        const restoredGroups = await this.residualCogsGroups(queryable, scope.tenantId, restoredItems, null);
        preparedWasteCogsExclusion = Math.max(0, toBookMoney(
          cogsResidualAmount(oldGroups, bookDigits) - cogsResidualAmount(restoredGroups, bookDigits)));
      }
      const reversal = await this.reverseSaleJournal(
        queryable, saleId, reversalReason, auth,
        preparedWasteCogsExclusion > 0 ? { preparedWasteCogsExclusion } : undefined,
      );
      if (!reversal.reversed && reversal.journalEntryId == null) {
        throw new AppError('تعذر عكس قيد المبيعات السابق للفاتورة المعدلة', 'SALE_EDIT_REVERSAL_FAILED', 409);
      }
    }

    const sale = await queryable
      .selectFrom('sales')
      .select([
        'id', 'doc_no', 'customer_id', 'subtotal', 'discount', 'tax_amount',
        'total', 'paid_amount', 'store_credit_used', 'exchange_return_id', 'branch_id', 'location_id', 'created_by', 'created_at',
        'delivery_fee', 'delivery_fee_mode', 'service_charge', 'tip_amount', 'prices_include_tax',
        'sale_origin', 'payment_type',
      ])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting edited sale ${saleId}`);

    const payments = await queryable
      .selectFrom('sale_payments')
      .select(['payment_channel', 'amount'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const cashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const nonCashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') !== 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));

    const subtotal = toBookMoney(sale.subtotal);
    const discount = toBookMoney(sale.discount);
    const taxAmount = toBookMoney(sale.tax_amount);
    const deliveryFee = toBookMoney((sale as any).delivery_fee ?? 0);
    const serviceCharge = toBookMoney((sale as any).service_charge ?? 0);
    const tipAmount = toBookMoney((sale as any).tip_amount ?? 0);
    const paidAmount = toBookMoney(sale.paid_amount);
    const storeCreditUsed = toBookMoney(sale.store_credit_used);
    const saleTotal = toBookMoney(sale.total);
    const receivableAmount = toBookMoney(Math.max(0, saleTotal - paidAmount - storeCreditUsed));
    const revenueCredit = sale.prices_include_tax
      ? toBookMoney(subtotal + serviceCharge - taxAmount + deliveryFee + tipAmount)
      : toBookMoney(subtotal + serviceCharge + deliveryFee + tipAmount);

    const lines: JournalLineDraft[] = [];
    const customerPartnerId = sale.customer_id ? Number(sale.customer_id) : null;

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = storeCreditUsed > 0
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesDiscountAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_discount_account_id, '4300');
    const salesRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

    if (cashAmount > 0) {
      this.addLine(lines, {
        accountId: cashAccountId,
        description: 'تحصيل نقدي من تعديل فاتورة بيع',
        debit: cashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (nonCashAmount > 0) {
      this.addLine(lines, {
        accountId: bankAccountId,
        description: 'تحصيل غير نقدي من تعديل فاتورة بيع',
        debit: nonCashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (receivableAmount > 0) {
      const isVanSale = String((sale as any).sale_origin || '') === 'van_sale';
      const paymentType = String((sale as any).payment_type || '');
      const branchIdVal = sale.branch_id ? Number(sale.branch_id) : null;
      const locationIdVal = sale.location_id ? Number(sale.location_id) : null;

      if (isVanSale && paymentType === 'cash') {
        this.addLine(lines, {
          accountId: customerAccountId,
          description: 'عهدة نقدية لدى مندوب التوزيع من تعديل فاتورة بيع نقدي',
          debit: receivableAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: branchIdVal,
          locationId: locationIdVal,
        }, bookDigits);
      } else if (isVanSale && paymentType === 'split') {
        const creditLedgerRow = await (queryable as any)
          .selectFrom('customer_ledger')
          .select(['amount'])
          .where('reference_type', '=', 'sale')
          .where('reference_id', '=', saleId)
          .where('entry_type', '=', 'sale_credit')
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const creditPortion = toBookMoney(Math.min(receivableAmount, Math.max(0, Number(creditLedgerRow?.amount || 0))));
        const repCashPortion = toBookMoney(Math.max(0, receivableAmount - creditPortion));

        if (repCashPortion > 0) {
          this.addLine(lines, {
            accountId: customerAccountId,
            description: 'عهدة نقدية لدى مندوب التوزيع (الجزء النقدي من تعديل بيع مجزأ)',
            debit: repCashPortion,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: branchIdVal,
            locationId: locationIdVal,
          }, bookDigits);
        }
        if (creditPortion > 0) {
          this.addLine(lines, {
            accountId: customerAccountId,
            description: 'مديونية عميل من تعديل فاتورة بيع مجزأة',
            debit: creditPortion,
            credit: 0,
            partnerType: customerPartnerId ? 'customer' : 'none',
            partnerId: customerPartnerId,
            branchId: branchIdVal,
            locationId: locationIdVal,
          }, bookDigits);
        }
      } else {
        this.addLine(lines, {
          accountId: customerAccountId,
          description: 'مديونية عميل من تعديل فاتورة بيع',
          debit: receivableAmount,
          credit: 0,
          partnerType: customerPartnerId ? 'customer' : 'none',
          partnerId: customerPartnerId,
          branchId: branchIdVal,
          locationId: locationIdVal,
        }, bookDigits);
      }
    }

    if (storeCreditUsed > 0) {
      this.addLine(lines, {
        accountId: storeCreditAccountId,
        description: 'استخدام رصيد دائن للعميل في تعديل الفاتورة',
        debit: storeCreditUsed,
        credit: 0,
        partnerType: customerPartnerId ? 'customer' : 'none',
        partnerId: customerPartnerId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (discount > 0) {
      this.addLine(lines, {
        accountId: salesDiscountAccountId,
        description: 'خصم مبيعات على تعديل الفاتورة',
        debit: discount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (revenueCredit > 0) {
      await this.addSaleRevenueCreditLegs(queryable, scope.tenantId, (line) => this.addLine(lines, line, bookDigits), {
        subtotal,
        taxAmount,
        deliveryFee,
        deliveryFeeMode: (sale as any).delivery_fee_mode,
        serviceCharge,
        tipAmount,
        pricesIncludeTax: Boolean(sale.prices_include_tax),
        revenueCredit,
        goodsAccountId: salesRevenueAccountId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
        contextLabel: 'تعديل فاتورة بيع',
      }, bookDigits);
    }

    if (taxAmount > 0) {
      this.addLine(lines, {
        accountId: salesTaxAccountId,
        description: 'ضريبة مبيعات مستحقة من تعديل الفاتورة',
        debit: 0,
        credit: taxAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    // Same remainder-absorbed residual as postSale
    // (INV-COGS-REMAINDER-ABSORPTION): the edited sale re-posts
    // against the stock remaining after the edit's movement.
    const cogsAmount = toBookMoney(await this.saleCogsResidual(queryable, scope.tenantId, saleId, bookDigits));

    if (cogsAmount > 0) {
      this.addLine(lines, {
        accountId: cogsAccountId,
        description: 'تكلفة البضاعة المباعة بعد تعديل البيع',
        debit: cogsAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: inventoryAccountId,
        description: 'إخراج مخزون بعد تعديل البيع',
        debit: 0,
        credit: cogsAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting edited sale ${saleId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting edited sale ${saleId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting edited sale ${saleId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced edited sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (sale.exchange_return_id) {
      let returnLinesCollected = false;
      const returnPosting = await this.postSalesReturn(queryable, Number(sale.exchange_return_id), auth, (returnLines) => {
        returnLinesCollected = returnLines.length > 0;
        normalizedLines.push(...returnLines);
      });
      if (!returnLinesCollected || returnPosting.posted || returnPosting.journalEntryId != null) {
        throw new AppError('مرتجع الاستبدال مرتبط بقيد مستقل؛ يلزم تسوية يدوية', 'EXCHANGE_LEDGER_CONFLICT', 422);
      }
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_edit',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد تعديل بيع تلقائي للفاتورة رقم ${sale.doc_no || `Z-${saleId}`}`,
      branchId: sale.branch_id ? Number(sale.branch_id) : null,
      locationId: sale.location_id ? Number(sale.location_id) : null,
      createdBy: sale.created_by ? Number(sale.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }

  async reverseSaleJournal(queryable: DbOrTx, saleId: number, reason: string, auth: AuthContext, options?: { isPreparedWaste?: boolean; preparedWasteCogsExclusion?: number }): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // Historical reversals (before reversed_by_entry_id linking) are not linked to their source.
    // Count postings vs reversals so a retried cancel can never reverse an already-offset entry.
    const counts = await queryable
      .selectFrom('journal_entries')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE source_type IN ('sale', 'sale_edit'))`.as('postings'),
        sql<number>`COUNT(*) FILTER (WHERE source_type = 'sale_reversal')`.as('reversals'),
      ])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const activePostings = Number(counts?.postings || 0) - Number(counts?.reversals || 0);

    const sourceJournal = activePostings > 0 ? await queryable
      .selectFrom('journal_entries')
      .select(['id', 'branch_id', 'location_id', 'created_by'])
      .where('source_type', 'in', ['sale', 'sale_edit'])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('reversed_by_entry_id', 'is', null)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst() : undefined;
    if (!sourceJournal) {
      const existingReversal = await this.getExistingSaleReversalJournal(queryable, saleId, scope.tenantId);
      if (existingReversal) {
        this.logger.warn(`Skipping duplicate sale reversal journal for sale ${saleId}; existing entry ${existingReversal.id}`);
        return { reversed: false, journalEntryId: Number(existingReversal.id) };
      }
      this.logger.warn(`No posted sale journal found for sale ${saleId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    let linesToReverse = sourceLines;
    if (options?.isPreparedWaste) {
      const invAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1140');
      const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '5100');
      const excludedIds = new Set<number>();
      if (invAccountId > 0) excludedIds.add(invAccountId);
      if (cogsAccountId > 0) excludedIds.add(cogsAccountId);
      linesToReverse = sourceLines.filter(line => !excludedIds.has(Number(line.account_id)));
    }

    const reversalLines: JournalLineDraft[] = linesToReverse.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد بيع'}`,
      debit: toBookMoney(line.credit),
      credit: toBookMoney(line.debit),
      partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
      partnerId: line.partner_id ? Number(line.partner_id) : null,
      branchId: line.branch_id ? Number(line.branch_id) : null,
      locationId: line.location_id ? Number(line.location_id) : null,
    })).filter((line) => line.debit > 0 || line.credit > 0);

    // INV-SALE-EDIT-PREPARED-WASTE: a partial exclusion reduces only
    // the COGS/inventory reversal lines, by the residual value of the
    // consumed portion, so the waste cost stays posted. The inventory
    // (debit) side and the COGS (credit) side are reduced by the same
    // amount, so the reversal stays balanced; an exclusion larger than
    // either side fails closed instead of posting a lopsided reversal.
    if (options?.preparedWasteCogsExclusion && options.preparedWasteCogsExclusion > 0) {
      const exclusion = toBookMoney(options.preparedWasteCogsExclusion);
      const invAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1140');
      const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '5100');
      const totals = new Map<number, number>();
      for (const line of reversalLines) {
        totals.set(line.accountId, toBookMoney(Number(totals.get(line.accountId) || 0) + Number(line.debit || 0) + Number(line.credit || 0)));
      }
      if (exclusion > Number(totals.get(invAccountId) || 0) + 0.0001 || exclusion > Number(totals.get(cogsAccountId) || 0) + 0.0001) {
        throw new Error(`Prepared-waste COGS exclusion ${exclusion} exceeds the reversal COGS/inventory totals for sale ${saleId}`);
      }
      let remainingInventoryExclusion = exclusion;
      for (const line of reversalLines) {
        if (remainingInventoryExclusion <= 0) break;
        if (line.accountId !== invAccountId) continue;
        const reducible = Math.min(Number(line.debit || 0), remainingInventoryExclusion);
        line.debit = toBookMoney(Number(line.debit || 0) - reducible);
        remainingInventoryExclusion = Number((remainingInventoryExclusion - reducible).toFixed(3));
      }
      if (remainingInventoryExclusion > 0.001) {
        throw new Error(`Prepared-waste COGS exclusion ${exclusion} could not be applied to the inventory reversal lines for sale ${saleId}`);
      }
      let remainingCogsExclusion = exclusion;
      for (const line of reversalLines) {
        if (remainingCogsExclusion <= 0) break;
        if (line.accountId !== cogsAccountId) continue;
        const reducible = Math.min(Number(line.credit || 0), remainingCogsExclusion);
        line.credit = toBookMoney(Number(line.credit || 0) - reducible);
        remainingCogsExclusion = Number((remainingCogsExclusion - reducible).toFixed(3));
      }
      if (remainingCogsExclusion > 0.001) {
        throw new Error(`Prepared-waste COGS exclusion ${exclusion} could not be applied to the COGS reversal lines for sale ${saleId}`);
      }
      for (let i = reversalLines.length - 1; i >= 0; i--) {
        if (!(Number(reversalLines[i].debit) > 0 || Number(reversalLines[i].credit) > 0)) reversalLines.splice(i, 1);
      }
    }

    // D-SF-02 (INV-SF-COD-CUSTODY-GL): a dispatched COD sale carries
    // a custody-reclassification journal (Dr 1130 custody / Cr 1130
    // customer). Reversing only the sale journal would strand the
    // custody debit and drive the customer leg negative, so the
    // reversal also negates the reclassification journal's lines.
    // The pair is balanced, so the balance check below still holds.
    let reclassEntryId: number | null = null;
    const reclassEntry = await queryable.selectFrom('journal_entries').select(['id'])
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('reversed_by_entry_id', 'is', null)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (reclassEntry) {
      reclassEntryId = Number(reclassEntry.id);
      const reclassLines = await queryable.selectFrom('journal_entry_lines')
        .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
        .where('journal_entry_id', '=', reclassEntryId)
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc')
        .execute();
      for (const line of reclassLines) {
        reversalLines.push({
          accountId: Number(line.account_id),
          costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
          description: `عكس: ${line.description || 'قيد عهدة مندوب'}`,
          debit: toBookMoney(line.credit),
          credit: toBookMoney(line.debit),
          partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
          partnerId: line.partner_id ? Number(line.partner_id) : null,
          branchId: line.branch_id ? Number(line.branch_id) : null,
          locationId: line.location_id ? Number(line.location_id) : null,
        });
      }
    }

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    if (reclassEntryId) {
      await queryable.updateTable('journal_entries').set({ reversed_by_entry_id: entryId, updated_at: sql`NOW()` })
        .where('id', '=', reclassEntryId).where('tenant_id', '=', scope.tenantId).execute();
    }

    this.logger.warn(`Posted sale reversal journal for sale ${saleId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  /**
   * Targeted sale reversal for P2 remediation.
   * Unlike reverseSaleJournal(), which reverses the *latest* unreversed
   * journal for a sale, this reverses the journal identified by
   * journalId, even when it is not the latest. It reverses the full
   * journal, including COGS / inventory, and returns
   * { reversed: false, journalEntryId: <existing reversal id> } when
   * the journal was already reversed, so the repair engine can record
   * the sale as already_repaired instead of failing it.
   */
  async reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // FOR UPDATE is essential, not optional: a concurrent repair that
    // is already reversing this journal blocks here until it commits,
    // and this load then sees reversed_by_entry_id set and returns
    // already-reversed instead of attempting a second reversal.
    const sourceJournal = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'source_id', 'source_type', 'status', 'reversed_by_entry_id', 'branch_id', 'location_id', 'created_by'])
      .where('id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();
    if (!sourceJournal) {
      return { reversed: false, journalEntryId: null };
    }
    if (Number(sourceJournal.source_id) !== saleId || !['sale', 'sale_edit'].includes(String(sourceJournal.source_type))) {
      throw new AppError('Reversal journal does not belong to the requested sale', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.status !== 'posted') {
      throw new AppError('Original journal is not posted', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.reversed_by_entry_id) {
      const existingReversal = await queryable
        .selectFrom('journal_entries')
        .select(['id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('reversal_of_entry_id', '=', journalId)
        .where('source_type', '=', 'sale_reversal')
        .where('status', '=', 'posted')
        .executeTakeFirst();
      return { reversed: false, journalEntryId: existingReversal ? Number(existingReversal.id) : null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    // Full mirror, exactly as reverseSaleJournal(): no isPreparedWaste
    // exclusion here. A remediation reversal must reverse COGS and
    // inventory as well, otherwise those accounts stay double-counted.
    const reversalLines: JournalLineDraft[] = sourceLines.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد بيع'}`,
      debit: toBookMoney(line.credit),
      credit: toBookMoney(line.debit),
      partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
      partnerId: line.partner_id ? Number(line.partner_id) : null,
      branchId: line.branch_id ? Number(line.branch_id) : null,
      locationId: line.location_id ? Number(line.location_id) : null,
    })).filter((line) => line.debit > 0 || line.credit > 0);

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: journalId,
    });

    this.logger.warn(`Posted targeted sale reversal journal for sale ${saleId} (stale journal ${journalId}) as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  /**
   * R6-E (INV-REST-SALE-MONEY-TRUTH-2) + R7-A F3: tip / courier-fee
   * relief already posted by earlier returns of the same sale, read
   * back from their posted return journals. Prior returns are found
   * via return_documents.invoice_id; their journals via
   * journal_entries.source_type IN ('sales_return','return'). The
   * 2147/2115 legs carry partnerType 'none', so there is no
   * per-sale subledger to read — the posted return journals ARE
   * the record. Exchange-collected returns post no return journal
   * (their lines ride inside the new sale's journal), so their
   * relief is read from the return row instead
   * (exchange_tip_relief / exchange_courier_relief, migration
   * 0311, recorded by postSalesReturn in the collectExchangeLines
   * branch). A prior return is counted exactly once: from its
   * journal when one exists, from its row columns otherwise.
   */
  async priorSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
    excludeReturnId: number | null,
  ): Promise<{ tip: number; courier: number }> {
    const empty = { tip: 0, courier: 0 };
    let priorReturnsQuery = queryable
      .selectFrom('return_documents')
      .select(['id', 'exchange_tip_relief', 'exchange_courier_relief'])
      .where('invoice_id', '=', saleId)
      .where('return_type', '=', 'sale')
      .where(sql<boolean>`tenant_id = ${tenantId}`);
    if (excludeReturnId != null) {
      priorReturnsQuery = priorReturnsQuery.where('id', '!=', excludeReturnId);
    }
    const priorReturns = await priorReturnsQuery.execute();
    if (priorReturns.length === 0) return empty;
    const priorJournals = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'source_id'])
      .where('source_type', 'in', ['sales_return', 'return'])
      .where('source_id', 'in', priorReturns.map((row) => Number(row.id)))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('status', 'in', ['draft', 'posted'])
      .execute();
    const relieved = { tip: 0, courier: 0 };
    if (priorJournals.length > 0) {
      const reliefAccounts = await queryable
        .selectFrom('accounting_accounts')
        .select(['id', 'code'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['2147', '2115'])
        .execute();
      const accountIdByCode = new Map(reliefAccounts.map((row) => [String(row.code), Number(row.id)]));
      const sums = await queryable
        .selectFrom('journal_entry_lines')
        .select([
          'account_id',
          sql<number>`coalesce(sum(debit), 0)`.as('relieved'),
        ])
        .where('journal_entry_id', 'in', priorJournals.map((row) => Number(row.id)))
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('account_id')
        .execute();
      for (const row of sums) {
        const amount = Number((row as any).relieved || 0);
        if (Number((row as any).account_id) === accountIdByCode.get('2147')) relieved.tip += amount;
        if (Number((row as any).account_id) === accountIdByCode.get('2115')) relieved.courier += amount;
      }
    }
    // R7-A F3: an exchange-collected prior return has no journal —
    // its relief lives only on its row. Count it here, and only
    // here (a return with a journal is already counted above).
    const journaledReturnIds = new Set(priorJournals.map((row) => Number((row as any).source_id)));
    for (const prior of priorReturns) {
      if (journaledReturnIds.has(Number(prior.id))) continue;
      relieved.tip += Number((prior as any).exchange_tip_relief || 0);
      relieved.courier += Number((prior as any).exchange_courier_relief || 0);
    }
    return relieved;
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the receivable a prior
   * return of this sale already reversed, read back from the posted
   * return journals (Cr 1130 legs). Mirrors priorSalesReturnRelief:
   * the journal is the record, so a stored allocation that was
   * topped up in-memory by postSalesReturn (pre-F1 documents) is
   * still counted at its posted value. Exchange-collected returns
   * cannot exist here: prepareExchangeReturn refuses an unpaid
   * source (EXCHANGE_UNPAID_SOURCE), and a COD sale's paid_amount
   * never moves on settlement — so no exchange return of an
   * unsettled COD sale can carry a receivable leg in the new
   * sale's journal. If that gate ever changes, this must count
   * exchange-collected receivable legs too.
   */
  async priorSalesReturnReceivableCredit(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
  ): Promise<number> {
    const priorReturns = await queryable
      .selectFrom('return_documents')
      .select('id')
      .where('invoice_id', '=', saleId)
      .where('return_type', '=', 'sale')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
    if (priorReturns.length === 0) return 0;
    const priorJournals = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', 'in', ['sales_return', 'return'])
      .where('source_id', 'in', priorReturns.map((row) => Number(row.id)))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('status', 'in', ['draft', 'posted'])
      .execute();
    if (priorJournals.length === 0) return 0;
    const receivableAccount = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', '1130')
      .executeTakeFirst();
    if (!receivableAccount) return 0;
    const credited = await queryable
      .selectFrom('journal_entry_lines')
      .select(sql<number>`coalesce(sum(credit), 0)`.as('credited'))
      .where('journal_entry_id', 'in', priorJournals.map((row) => Number(row.id)))
      .where('account_id', '=', Number(receivableAccount.id))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    return Number((credited as any)?.credited || 0);
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the settlement basis
   * for a delivery order, derived from the REMAINING amounts —
   * the single source of truth for both postDeliveryRepSettlement
   * (validation + credit leg) and the delivery-reps callers (the
   * cash the rep actually hands over).
   *
   * Decision (recorded): the settlement is derived from the
   * remaining receivable, NOT by blocking returns of unsettled COD
   * orders. A customer returning part of a COD order before the
   * rep settles is ordinary merchant work; blocking it would stop
   * real returns for a bookkeeping convenience, against the
   * spirit-of-the-law (workflow guards block only real loss).
   *
   * remainingReceivable = sale total - store credit used at sale
   * time - paid amount - receivable already reversed by prior
   * returns (their posted Cr 1130 legs). That is exactly the Dr
   * 1130 postSale posted for this sale
   * (receivableAmount = total - paid - storeCreditUsed), minus
   * what returns already reversed — so the settlement credit
   * lands 1130 at zero instead of over-crediting it by the
   * returned share. remainingFee = original fee - prior courier
   * relief (0 for a store-fleet sale: its fee went to Cr 4200
   * revenue, never to 2115).
   */
  async deliverySettlementBasis(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const sale = await queryable
      .selectFrom('sales')
      .select(['total', 'delivery_fee', 'delivery_fee_mode', 'store_credit_used', 'paid_amount'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();
    const totalDebt = toBookMoney(sale.total);
    const priorRelief = await this.priorSalesReturnRelief(queryable, scope.tenantId, saleId, null);
    const priorReceivable = await this.priorSalesReturnReceivableCredit(queryable, scope.tenantId, saleId);
    const isStoreFleetDelivery = String((sale as any)?.delivery_fee_mode ?? '').trim() === 'store_fleet';
    const remainingFee = toBookMoney(isStoreFleetDelivery
      ? 0
      : Math.max(0, Number(sale.delivery_fee || 0) - priorRelief.courier));
    const remainingReceivable = toBookMoney(Math.max(0,
      totalDebt - Number(sale.store_credit_used || 0) - Number(sale.paid_amount || 0) - priorReceivable));
    return { totalDebt, remainingReceivable, remainingFee };
  }

  /**
   * D-SF-02 (INV-SF-COD-CUSTODY-GL) + M12 (INV-REP-CUSTODY-LEDGER): the
   * receivable a courier is carrying moves off the customer the moment
   * the order is dispatched — Dr 1130 partnerType 'rep' + partnerId =
   * the delivery_representatives.id (per-rep custody, so the GL itself
   * carries a balance per rep to reconcile against) / Cr 1130
   * partnerType 'customer'. The caller (dispatchOrders) moves the
   * customer ledger in the same transaction via its own ledger leg;
   * this method posts only the GL half.
   *
   * Decisions (recorded):
   * - partnerType 'rep' (M12, supersedes the old 'none' shape): the
   *   old 'none' debit mixed every rep's custody into one aggregate
   *   1130 balance with no per-rep balance to reconcile against.
   *   Migration 0319 extends the journal_entry_lines CHECK (0110
   *   precedent: DROP + ADD) to include 'rep'; the partner id is a
   *   delivery_representatives.id, validated tenant-scoped in
   *   insertPostedJournal. No sync exemption is needed:
   *   syncPostedPartnerLedger runs only for its 12 listed source
   *   types, and the custody / settle / return source types are not
   *   among them. The van precedent (1130 'none' field cash) is a
   *   different flow and keeps its shape.
   * - The amount is the REMAINING receivable
   *   (deliverySettlementBasis), not the original total: a return
   *   before dispatch already reversed part of it on the customer
   *   leg, and reclassifying the full total would drive the
   *   customer leg negative.
   * - Idempotent on (source_type, source_id): a re-dispatch to
   *   the same rep re-runs this and finds the posted entry.
   * - Fail-closed (not a silent no-op) when the sale is not in
   *   courier custody at call time: the caller just marked it
   *   out_for_delivery, so anything else is a caller bug. A
   *   prepaid / fully-returned sale is a silent no-op instead:
   *   there is no receivable to move.
   */
  async postDeliveryCustodyReclassification(
    queryable: Transaction<Database>,
    saleId: number,
    repId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; amount: number; customerId: number | null; docNo: string }> {
    this.assertTransaction(queryable, 'postDeliveryCustodyReclassification');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const sale = await queryable
      .selectFrom('sales')
      .select(['customer_id', 'doc_no', 'delivery_status', 'delivery_rep_id', 'branch_id', 'location_id'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!sale) throw new AppError('Order not found', 'ORDER_NOT_FOUND', 404);
    const docNo = (sale as any).doc_no || `Z-${saleId}`;
    if (String((sale as any).delivery_status || '') !== 'out_for_delivery') {
      throw new AppError('Only a dispatched delivery order can move its receivable to courier custody', 'DELIVERY_CUSTODY_RECLASSIFICATION_INVALID', 409);
    }
    if (Number((sale as any).delivery_rep_id || 0) !== Number(repId)) {
      throw new AppError('Order is not in this representative\'s custody', 'DELIVERY_CUSTODY_RECLASSIFICATION_INVALID', 409);
    }
    const customerId = (sale as any).customer_id ? Number((sale as any).customer_id) : null;

    const existing = await queryable.selectFrom('journal_entries').select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id), amount: 0, customerId, docNo };

    const basis = await this.deliverySettlementBasis(queryable, saleId, auth);
    const amount = toBookMoney(basis.remainingReceivable);
    if (!(amount > 0)) return { posted: false, journalEntryId: null, amount: 0, customerId, docNo };
    if (!customerId) return { posted: false, journalEntryId: null, amount: 0, customerId, docNo };

    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1130');
    const branchId = (sale as any).branch_id ? Number((sale as any).branch_id) : null;
    const locationId = (sale as any).location_id ? Number((sale as any).location_id) : null;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: customerAccountId,
      description: `عهدة نقدية لدى مندوب التوصيل من فاتورة #${docNo}`,
      debit: amount,
      credit: 0,
      partnerType: 'rep',
      partnerId: repId,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: customerAccountId,
      description: `نقل مديونية عميل إلى عهدة مندوب التوصيل للفاتورة #${docNo}`,
      debit: 0,
      credit: amount,
      partnerType: 'customer',
      partnerId: customerId,
      branchId,
      locationId,
    });
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'delivery_custody_reclassification',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد نقل مديونية فاتورة #${docNo} إلى عهدة مندوب التوصيل`,
      branchId,
      locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId, amount, customerId, docNo };
  }

  /**
   * D-SF-02 (INV-SF-COD-CUSTODY-GL): does this sale already carry a
   * posted custody reclassification? The settle / return / reversal
   * legs credit the custody leg instead of the customer leg exactly
   * when this is true, so a pre-dispatch settle or return keeps the
   * old customer-leg behaviour.
   */
  async hasDeliveryCustodyReclassification(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<boolean> {
    const scope = requireTenantScope(auth);
    const existing = await queryable.selectFrom('journal_entries').select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    return Boolean(existing);
  }

  /**
   * M12 (INV-REP-CUSTODY-LEDGER): the partner identity of the custody
   * debit a dispatch posted for this sale — the leg the settle /
   * return credit must mirror so the per-rep balance clears. Post-M12
   * that is ('rep', repId); an order dispatched before M12 carries
   * the old ('none', null) leg, and mirroring it keeps the
   * transitional order clearing exactly where its debit sits instead
   * of driving the rep balance negative. Falls back to ('none',
   * null) when no reclassification exists or its debit leg cannot be
   * read — the pre-M12 shape.
   */
  async deliveryCustodyPartner(
    queryable: DbOrTx,
    saleId: number,
  ): Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }> {
    const entry = await queryable.selectFrom('journal_entries').select('id')
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (!entry) return { partnerType: 'none', partnerId: null };
    const leg = await queryable.selectFrom('journal_entry_lines')
      .select(['partner_type', 'partner_id'])
      .where('journal_entry_id', '=', Number(entry.id))
      .where('debit', '>', 0)
      .executeTakeFirst();
    if (!leg) return { partnerType: 'none', partnerId: null };
    const partnerType = String((leg as any).partner_type || 'none');
    return {
      partnerType: partnerType === 'rep' ? 'rep' : 'none',
      partnerId: partnerType === 'rep' && (leg as any).partner_id != null ? Number((leg as any).partner_id) : null,
    };
  }

  /**
   * M12 (INV-REP-CUSTODY-LEDGER): the rep's 1130 custody balance
   * straight from the GL — net Dr − Cr over posted lines on the 1130
   * account with partner_type 'rep' and partner_id = repId. This is
   * the per-rep balance getRepSummary / listOrders can reconcile
   * against instead of re-deriving it from sales rows; it is
   * prospective from M12 onward — pre-M12 custody sits on 'none'
   * legs and is not attributed to any rep here (the aggregate 1130
   * balance still reconciles in total). A rep with no custody reads 0.
   */
  async getRepCustodyBalance(
    queryable: DbOrTx,
    repId: number,
    auth: AuthContext,
  ): Promise<number> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1130');
    const row = await queryable
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as j', (join) => join
        .onRef('j.id', '=', 'l.journal_entry_id')
        .onRef('j.tenant_id', '=', 'l.tenant_id'))
      .select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('balance'))
      .where('l.tenant_id', '=', scope.tenantId)
      .where('l.account_id', '=', customerAccountId)
      .where(sql<boolean>`l.partner_type = 'rep'`)
      .where('l.partner_id', '=', repId)
      .where('j.status', '=', 'posted')
      .executeTakeFirst();
    return this.toMoney(Number((row as any)?.balance || 0), bookDigits);
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F1: the tip / courier-fee
   * relief a return owes, shared by postSalesReturn (the journal)
   * and ReturnsService.createSaleReturn (the payout loop) so both
   * sides move the SAME numbers. One function, two call sites —
   * a second copy of this ratio would drift and re-open the F1
   * shortfall (journal top-up vs subledger movement).
   *
   * Rules (from R6-E, unchanged): relieve the tip / courier-fee
   * payables the original sale credited (Cr 2147 / Cr 2115),
   * pro-rata by the returned net goods value over the sale's net
   * goods base. Exclusive-tax base: subtotal - discount.
   * Tax-inclusive base: the SAME ex-tax goods leg postSale
   * stripped — (subtotal + serviceCharge - tax) with the service
   * share removed — net of the discount the return lines carry.
   * Tip only when the sale credited one; courier only for a
   * freelance delivery (NULL mode counts as freelance, as in
   * addSaleRevenueCreditLegs). A store-fleet fee went to Cr 4200
   * revenue, which a return does not relieve either.
   * FUNDING (decision, recorded): the relief is part of the REFUND
   * — the customer is refunded the relieved shares on top of the
   * return total. CUMULATIVE CAP: this return's relief is capped
   * at originalCredited - priorRelief (prior returns of the same
   * sale, via priorSalesReturnRelief); without it two 60%
   * returns relieve 120%.
   *
   * The caller supplies netReturnAmount (return total minus its
   * tax share): postSalesReturn reads it from the stored return
   * items, ReturnsService from the in-memory lines (the document
   * does not exist yet when it allocates). excludeReturnId is the
   * return being posted (its own journal does not exist yet, so
   * excluding it is belt-and-braces); pass null when the return
   * has no row yet.
   */
  async computeSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    sale: { id: number; subtotal?: unknown; discount?: unknown; tip_amount?: unknown; delivery_fee?: unknown; delivery_fee_mode?: unknown; service_charge?: unknown; tax_amount?: unknown; prices_include_tax?: unknown } | null | undefined,
    returnTotal: number,
    netReturnAmount: number,
    excludeReturnId: number | null,
  ): Promise<{ tipRelief: number; courierRelief: number; totalRelief: number }> {
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const saleSubtotal = toBookMoney(sale?.subtotal ?? 0);
    const saleDiscount = toBookMoney(sale?.discount ?? 0);
    const saleTip = toBookMoney(sale?.tip_amount ?? 0);
    const saleDeliveryFee = toBookMoney(sale?.delivery_fee ?? 0);
    const saleDeliveryMode = String(sale?.delivery_fee_mode ?? '').trim();
    const isStoreFleetDelivery = saleDeliveryMode === 'store_fleet';
    const saleServiceCharge = toBookMoney(sale?.service_charge ?? 0);
    const saleTaxAmount = toBookMoney(sale?.tax_amount ?? 0);
    const salePricesIncludeTax = Boolean(sale?.prices_include_tax);
    let netGoodsBase = 0;
    if (sale) {
      if (salePricesIncludeTax) {
        const strippedBase = toBookMoney(saleSubtotal + saleServiceCharge - saleTaxAmount);
        if (strippedBase >= 0) {
          const inclusiveDenom = saleSubtotal + saleServiceCharge;
          const serviceLeg = inclusiveDenom > 0
            ? toBookMoney((strippedBase * saleServiceCharge) / inclusiveDenom) : 0;
          netGoodsBase = toBookMoney(Math.max(0, strippedBase - serviceLeg - saleDiscount));
        }
      } else {
        netGoodsBase = toBookMoney(Math.max(0, saleSubtotal - saleDiscount));
      }
    }
    const reliefRatio = sale && returnTotal > 0 && netGoodsBase > 0
      ? Math.min(1, Math.max(0, netReturnAmount / netGoodsBase)) : 0;
    let tipRelief = saleTip > 0 && reliefRatio > 0 ? toBookMoney(saleTip * reliefRatio) : 0;
    let courierRelief = saleDeliveryFee > 0 && !isStoreFleetDelivery && reliefRatio > 0
      ? toBookMoney(saleDeliveryFee * reliefRatio) : 0;
    if (sale && (tipRelief > 0 || courierRelief > 0)) {
      const priorRelief = await this.priorSalesReturnRelief(queryable, tenantId, Number(sale.id), excludeReturnId);
      tipRelief = toBookMoney(Math.max(0, Math.min(tipRelief, saleTip - priorRelief.tip)));
      courierRelief = toBookMoney(Math.max(0, Math.min(courierRelief, saleDeliveryFee - priorRelief.courier)));
    }
    const totalRelief = toBookMoney(tipRelief + courierRelief);
    return { tipRelief, courierRelief, totalRelief };
  }

  async postSalesReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext,
    collectExchangeLines?: (lines: JournalLineDraft[]) => void): Promise<{ posted: boolean; journalEntryId: number | null }> {
    this.assertTransaction(queryable, 'postSalesReturn');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSalesReturnJournal(queryable, returnId, scope.tenantId);
    if (existing) {
      this.logger.warn(`Skipping duplicate sales return journal for return ${returnId}; existing entry ${existing.id}`);
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const returnDocument = await queryable
      .selectFrom('return_documents')
      .select([
        'id',
        'doc_no',
        'return_type',
        'invoice_id',
        'settlement_mode',
        'refund_method',
        'refund_allocations',
        'total',
        'branch_id',
        'location_id',
        'created_by',
        'created_at',
      ])
      .where('id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!returnDocument || returnDocument.return_type !== 'sale') {
      this.logger.warn(`Sales return document ${returnId} not found or not a sale return; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const sale = returnDocument.invoice_id
      ? await queryable
        .selectFrom('sales')
        // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the relief below needs
        // the sale's money columns — the return document carries
        // none of them (no tip/delivery columns exist on it).
        .select(['id', 'doc_no', 'payment_type', 'customer_id', 'tax_amount', 'total',
          'subtotal', 'discount', 'tip_amount', 'delivery_fee', 'delivery_fee_mode',
          'service_charge', 'prices_include_tax'])
        .where('id', '=', Number(returnDocument.invoice_id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst()
      : null;

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting sales return ${returnId}`);

    const salesReturnsAccount = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', '4400')
      .executeTakeFirst();
    const fallbackRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesReturnsAccountId = Number(salesReturnsAccount?.id || 0) > 0 ? Number(salesReturnsAccount?.id || 0) : fallbackRevenueAccountId;
    if (!(Number(salesReturnsAccount?.id || 0) > 0) && fallbackRevenueAccountId > 0) {
      this.logger.warn(`Sales returns account code 4400 not found for return ${returnId}; falling back to sales revenue account ${fallbackRevenueAccountId}`);
    }

    const rawRefundAllocations: unknown = typeof returnDocument.refund_allocations === 'string'
      ? JSON.parse(returnDocument.refund_allocations) : returnDocument.refund_allocations;
    const refundAllocations = Array.isArray(rawRefundAllocations) ? rawRefundAllocations as Array<{ tender: string; amount: number }> : null;
    if (returnDocument.refund_allocations != null && (!refundAllocations || refundAllocations.some((entry) =>
      !entry || !['cash', 'card', 'store_credit', 'receivable'].includes(entry.tender) ||
      !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0))) {
      throw new Error(`Invalid refund tender allocation for return ${returnId}`);
    }
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = returnDocument.settlement_mode === 'store_credit' || refundAllocations?.some((entry) => entry.tender === 'store_credit')
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

    const total = toBookMoney(returnDocument.total);
    const originalSaleTotal = Number(sale?.total || 0);
    const originalSaleTax = Number(sale?.tax_amount || 0);
    const taxRatio = originalSaleTotal > 0 && originalSaleTax > 0 ? (originalSaleTax / originalSaleTotal) : 0;
    const returnTax = await queryable.selectFrom('return_items')
      .select([
        sql<number>`coalesce(sum(allocated_tax), 0)`.as('allocated_tax'),
        sql<number>`count(*) filter (where allocated_tax is null)`.as('unallocated_lines'),
      ])
      .where('return_document_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const taxAmount = Number(returnTax?.unallocated_lines || 0) === 0
      ? toBookMoney(returnTax?.allocated_tax || 0) : toBookMoney(total * taxRatio);
    const netReturnAmount = toBookMoney(Math.max(0, total - taxAmount));

    // R6-E (INV-REST-SALE-MONEY-TRUTH-2): relieve the tip /
    // courier-fee payables the original sale credited (Cr 2147 /
    // Cr 2115 in addSaleRevenueCreditLegs), pro-rata by the
    // returned net goods value over the sale's net goods base.
    // - Exclusive-tax base: subtotal - discount (the net goods
    //   value the customer paid; the discount rides Dr 4300).
    // - Tax-inclusive base: the SAME ex-tax goods leg postSale
    //   stripped — (subtotal + serviceCharge - tax) with the
    //   service share removed — net of the discount the return
    //   lines carry. Reusing the exclusive formula here would
    //   over-relieve (its subtotal still holds the embedded tax).
    //   A corrupt tax larger than the base keeps postSale's old
    //   single-line shape (no 2147/2115 legs exist), so no relief
    //   is owed either.
    // - Tip only when the sale credited one; courier only for a
    //   freelance delivery (NULL mode counts as freelance, as in
    //   addSaleRevenueCreditLegs). A store-fleet fee went to
    //   Cr 4200 revenue, which a return does not relieve either.
    // - FUNDING (decision, recorded): the relief is part of the
    //   REFUND — the customer is refunded the relieved shares on
    //   top of the return total, so the refund credit side below
    //   grows by tipRelief + courierRelief. The rejected shape
    //   (fund it by shrinking Dr 4400) misstates sales returns
    //   and under-refunds the customer; it is only correct if the
    //   business keeps the extras, in which case no relief is
    //   owed at all.
    // - CUMULATIVE CAP: this return's relief is capped at
    //   originalCredited - priorRelief (prior returns of the same
    //   sale, via priorSalesReturnRelief); without it two 60%
    //   returns relieve 120%.
    // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F1: the relief math lives
    // in computeSalesReturnRelief, shared with ReturnsService (which
    // needs the same numbers BEFORE its payout loop). The base /
    // funding / cumulative-cap rules are documented on that method.
    const { tipRelief, courierRelief, totalRelief } = await this.computeSalesReturnRelief(
      queryable, scope.tenantId, sale, total, netReturnAmount, returnId,
    );

    const customerPartnerId = sale?.customer_id ? Number(sale.customer_id) : null;
    // D-SF-02 (INV-SF-COD-CUSTODY-GL): a return of a dispatched COD
    // sale nets the courier custody leg, not the customer leg — the
    // receivable left the customer's books at dispatch, so a
    // customer-leg credit here would drive it negative while the
    // custody debit stands. The 'store_credit' tender is untouched.
    const saleInCourierCustody = sale?.id
      ? await this.hasDeliveryCustodyReclassification(queryable, Number(sale.id), auth)
      : false;
    // M12 (INV-REP-CUSTODY-LEDGER): a receivable-tender return of a
    // dispatched sale credits the SAME custody partner the dispatch
    // posted (deliveryCustodyPartner), so the per-rep balance nets.
    const custodyPartner = saleInCourierCustody && sale?.id
      ? await this.deliveryCustodyPartner(queryable, Number(sale.id))
      : null;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = returnDocument.branch_id ? Number(returnDocument.branch_id) : null;
    const locationId = returnDocument.location_id ? Number(returnDocument.location_id) : null;
    const invoiceNo = sale?.doc_no || returnDocument.doc_no || `Z-${returnDocument.invoice_id || ''}`;

    if (netReturnAmount > 0) {
      addBookLine({
        accountId: salesReturnsAccountId,
        description: `مردودات مبيعات للفاتورة رقم ${invoiceNo}`,
        debit: netReturnAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (taxAmount > 0) {
      addBookLine({
        accountId: salesTaxAccountId,
        description: `تخفيض ضريبة مبيعات من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: taxAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the relief debits. The
    // accounts resolve lazily, only when their leg is non-zero, so
    // an ordinary return with no tip/fee creates no new accounts.
    // A return followed by a freelance settlement must not
    // double-relieve 2115: postDeliveryRepSettlement validates its
    // fee against the REMAINING courier fee (original minus prior
    // return relief), so the reduced amount settles and a stale
    // full-fee amount fails closed instead of over-relieving.
    if (tipRelief > 0) {
      const tipsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2147');
      addBookLine({
        accountId: tipsAccountId,
        description: `تخفيض إكراميات مستحقة للموظفين من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: tipRelief,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }
    if (courierRelief > 0) {
      const courierAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2115');
      addBookLine({
        accountId: courierAccountId,
        description: `تخفيض رسوم توصيل مستحقة لمندوب حر من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: courierRelief,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    const settlementMode = String(returnDocument.settlement_mode || '').trim().toLowerCase();
    const refundMethod = String(returnDocument.refund_method || '').trim().toLowerCase();
    const originalSalePaymentType = String(sale?.payment_type || '').trim().toLowerCase();

    if (total > 0) {
      // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the refund covers the
      // return total PLUS the relieved tip/courier shares (see the
      // funding decision above), so the refund target is
      // total + totalRelief and the allocations must sum to it.
      // Stored allocations are built by returns.service from the
      // return total PLUS the reliefs (R7-A F1), so a stored set
      // summing to the refund target is the normal case and is used
      // as-is. The in-memory top-up below survives only as the
      // fallback for documents stored before that fix (whose
      // allocations sum to the return total alone) and for
      // exchange-collected lines (whose stored set is the prepared
      // total); anything else fails closed below. The stored
      // document itself is not rewritten here.
      const refundTarget = toBookMoney(total + totalRelief);
      const allocations = refundAllocations ?? [{
        tender: settlementMode === 'store_credit' ? 'store_credit'
          : originalSalePaymentType === 'credit' ? 'receivable'
            : refundMethod === 'cash' ? 'cash' : 'card',
        amount: refundTarget,
      }];
      let effectiveAllocations = allocations;
      if (refundAllocations && totalRelief > 0) {
        const storedSum = toBookMoney(allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        if (Math.abs(storedSum - refundTarget) <= this.maxAllowedDifference(bookDigits)) {
          effectiveAllocations = allocations;
        } else if (Math.abs(storedSum - total) <= this.maxAllowedDifference(bookDigits)) {
          effectiveAllocations = allocations.map((entry, index) => index === allocations.length - 1
            ? { ...entry, amount: toBookMoney(Number(entry.amount || 0) + totalRelief) }
            : entry);
        }
      }
      const rawAllocated = effectiveAllocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      if (Math.abs(rawAllocated - refundTarget) > this.maxAllowedDifference(bookDigits)) {
        throw new Error(`Refund tenders do not balance for return ${returnId}: allocated=${rawAllocated} total=${refundTarget}`);
      }
      let allocatedTotalSoFar = 0;
      for (let i = 0; i < effectiveAllocations.length; i++) {
        const allocation = effectiveAllocations[i];
        const isLast = i === effectiveAllocations.length - 1;
        const lineAmount = isLast
          ? toBookMoney(refundTarget - allocatedTotalSoFar)
          : toBookMoney(allocation.amount);
        allocatedTotalSoFar = toBookMoney(allocatedTotalSoFar + lineAmount);
        const accountId = allocation.tender === 'store_credit' ? storeCreditAccountId
          : allocation.tender === 'receivable' ? customerAccountId
            : allocation.tender === 'cash' ? cashAccountId : bankAccountId;
        const partner = allocation.tender === 'store_credit' || allocation.tender === 'receivable';
        const custodyReceivable = allocation.tender === 'receivable' && saleInCourierCustody;
        addBookLine({
          accountId,
          description: `تسوية مرتجع فاتورة رقم ${invoiceNo} - ${allocation.tender}`,
          debit: 0,
          credit: lineAmount,
          partnerType: custodyReceivable && custodyPartner ? custodyPartner.partnerType : (partner && customerPartnerId ? 'customer' : 'none'),
          partnerId: custodyReceivable && custodyPartner ? custodyPartner.partnerId : (partner ? customerPartnerId : null),
          branchId,
          locationId,
        });
      }
    }

    // Reliable cost source for return COGS reversal: original sale_items.cost_price at sale time.
    const returnItems = await queryable
      .selectFrom('return_items')
      .select(['product_id', 'sale_item_id', 'qty', 'cost_price'])
      .where('return_document_id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const saleItems = sale?.id
      ? await queryable
        .selectFrom('sale_items')
        .select(['id', 'product_id', 'cost_price', 'unit_multiplier', 'modifiers'])
        .where('sale_id', '=', Number(sale.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute()
      : [];

    // INV-SALES-RETURN-COGS-RESIDUAL-MIRROR: reverse COGS on the same
    // residual basis the sale posted it; the legacy plain product is
    // kept for every shape the mirror does not cover (see
    // salesReturnCogsAmount).
    const inventoryReversalAmount = toBookMoney(await this.salesReturnCogsAmount(
      queryable, scope.tenantId, sale ? { id: Number(sale.id) } : null, returnItems, saleItems, bookDigits,
    ));

    if (inventoryReversalAmount > 0) {
      addBookLine({
        accountId: inventoryAccountId,
        description: `إرجاع المخزون من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: inventoryReversalAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cogsAccountId,
        description: `عكس تكلفة البضاعة المباعة لمرتجع فاتورة رقم ${invoiceNo}`,
        debit: 0,
        credit: inventoryReversalAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting sales return ${returnId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting sales return ${returnId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting sales return ${returnId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sales return journal for return ${returnId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (collectExchangeLines) {
      // R7-A F3: record the relief this exchange collected on the
      // return row (migration 0311), so a later return's cumulative
      // cap counts it via priorSalesReturnRelief. The return has no
      // journal of its own — these columns are its only record.
      await queryable.updateTable('return_documents').set({
        exchange_tip_relief: tipRelief,
        exchange_courier_relief: courierRelief,
      }).where('id', '=', returnId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      collectExchangeLines(normalizedLines);
      return { posted: false, journalEntryId: null };
    }
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sales_return',
      sourceId: returnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: returnDocument.created_at ? new Date(returnDocument.created_at) : new Date(),
      description: `قيد مرتجع بيع للفاتورة رقم ${invoiceNo}`,
      branchId,
      locationId,
      createdBy: returnDocument.created_by ? Number(returnDocument.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
