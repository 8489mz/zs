/*
 * Restaurant + serials helpers (sales-write split-1 out of SalesWriteService).
 * Pure move: the 10 restaurant/serials methods, unchanged, behind the
 * SalesWriteService delegating facade. The facade owns the injected
 * services; this helper receives the three it needs bound via
 * SalesRestaurantAndSerialsDeps, so the moved bodies are byte-identical
 * to the originals.
 */
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { scaledBomOverhead } from '../../manufacturing/engines/manufacturing-overhead.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta, previewAssignedLocationStockQty } from '../../../common/utils/location-stock-ledger';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { enforceRestaurantModifierContract as enforceModifierContractPure, type ModifierGroupRule, type ModifierPriceTruth } from '../helpers/restaurant-modifier-contract.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { KdsService } from './kds.service';
import { isAnomalousImportLotShortfall } from '../../import-sales/helpers/import-lot-allocation.helper';

export type SalesRestaurantAndSerialsDeps = {
  kdsService?: KdsService;
  accountingPosting: AccountingPostingService;
  planFeatureService: PlanFeatureService;
};

export class SalesRestaurantAndSerialsHelper {
  private readonly kdsService?: KdsService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly planFeatureService: PlanFeatureService;

  constructor(deps: SalesRestaurantAndSerialsDeps) {
    this.kdsService = deps.kdsService;
    this.accountingPosting = deps.accountingPosting;
    this.planFeatureService = deps.planFeatureService;
  }

  /**
   * R4-E I17: hands the draft ticket's progress to the posted sale inside
   * the caller's transaction. Refuses loudly when KdsService is absent (a
   * manual construction without it) instead of silently dropping the
   * kitchen's progress. A corrupt KDS runtime state only logs and skips
   * (see transferTicketStateInTrx): a sale must never fail because KDS
   * progress is unreadable.
   */
  async transferKdsTicketStateInTrx(
    trx: Transaction<Database>,
    tenantId: string,
    draftSaleId: number,
    postedSaleId: number,
  ): Promise<void> {
    if (!this.kdsService) {
      throw new AppError('KDS service is not available to transfer the kitchen ticket', 'KDS_SERVICE_UNAVAILABLE', 500);
    }
    await this.kdsService.transferTicketStateInTrx(tenantId, draftSaleId, postedSaleId, trx);
  }

  /** R8-A INV-REST-FLAT-ADDON-COSTING: flat legacy addons are
   * addons-table rows, not products — a modifier with no optionId
   * whose productId is an addons row carries no stock and must be
   * costed from addons.cost_price, never from products.cost_price.
   * One indexed read of the single source of truth (the addons
   * table, the same table the R4-C price pre-pass reads); each gate
   * below resolves it where it needs it instead of threading the
   * pre-pass truth object through every lock call site. Returns
   * addon id -> cost_price for the modifiers on these items. */
  async loadFlatAddonCosts(
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ): Promise<Map<number, number>> {
    const ids = new Set<number>();
    for (const item of items) {
      for (const mod of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
        // Same optionId derivation as resolveSaleModifierCosts: a
        // modifier carrying an option is a group option, never a flat
        // addon, whatever its productId is.
        const optionId = Number(mod.optionId || mod.option_id || mod.id || 0);
        const productId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
        if (optionId <= 0 && productId > 0) ids.add(productId);
      }
    }
    if (!ids.size) return new Map();
    const rows = await trx.selectFrom('addons').select(['id', 'cost_price'])
      .where('tenant_id', '=', tenantId).where('id', 'in', [...ids]).execute();
    return new Map(rows.map((row) => [Number(row.id), Number(row.cost_price)]));
  }

  /** Cost every restaurant component at the LOCKED tenant product WAC, never
   * at user-supplied modifier.costPrice or modifier.consumptionQty. */
  async resolveSaleModifierCosts(
    trx: Kysely<Database> | Transaction<Database>, items: any[],
    tenantId: string, restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ): Promise<void> {
    const optionIds = new Set<number>();
    const componentIds = new Set<number>();
    if (restaurantEnabled) for (const item of items) for (const mod of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
      const optionId = Number(mod.optionId || mod.option_id || mod.id || 0);
      const componentId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
      if (optionId > 0) optionIds.add(optionId);
      if (componentId > 0) componentIds.add(componentId);
    }
    const optionRows = optionIds.size ? await trx.selectFrom('pos_modifier_options')
      .select(['id','component_product_id','consumption_qty','price','group_id'])
      .where('tenant_id','=',tenantId).where('id','in',[...optionIds]).execute() : [];
    const options = new Map(optionRows.map(row => [Number(row.id),row]));
    optionRows.forEach(row => { if (Number(row.component_product_id || 0) > 0) componentIds.add(Number(row.component_product_id)); });
    const ids = [...new Set([...items.map(item => Number(item.productId)), ...componentIds])];
    const costRows = await trx.selectFrom('products').select(['id','cost_price'])
      .where('tenant_id','=',tenantId).where('id','in',ids).execute();
    const costs = new Map(costRows.map(row => [Number(row.id),Number(row.cost_price)]));
    // R8-A: flat addons cost addons.cost_price, not a product WAC.
    // Loaded only when the restaurant feature is on — with it off the
    // early return below still costs every modifier at 0 (R4-C scope
    // boundary, unchanged).
    const addonCosts = restaurantEnabled ? await this.loadFlatAddonCosts(trx, tenantId, items) : new Map<number, number>();
    for (const item of items) {
      let modifiersCost = 0;
      item.modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map((mod: any) => {
        if (!restaurantEnabled) return {...mod,costPrice:0};
        const optionId = Number(mod.optionId || mod.option_id || mod.id || 0);
        const option = optionId ? options.get(optionId) : undefined;
        // SF-3 D-SF-03: a frozen option deleted after placement costs
        // from its stored component (or 0 when it has none) instead of
        // throwing — the sale price is already frozen by the pre-pass.
        const frozenOption = optionId > 0 && !option && approvedModifierPrices?.[`option:${optionId}`] !== undefined;
        if (optionId && !option && !frozenOption) throw new AppError('Restaurant modifier option missing',
          'RESTAURANT_MODIFIER_OPTION_INVALID',422);
        const directId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
        const configuredId = Number(option?.component_product_id || 0);
        if (option && directId > 0 && directId !== configuredId) throw new AppError(
          'Restaurant modifier differs from configured stock component',
          'RESTAURANT_MODIFIER_COMPONENT_MISMATCH',422);
        const componentId = configuredId || directId;
        const qty = Number(mod.qty ?? 1);
        const rate = option ? Number(option.consumption_qty ?? 1) : 1;
        const stockUnits = qty * rate;
        if (!Number.isFinite(stockUnits) || stockUnits <= 0 ||
            Math.abs(stockUnits - Number(stockUnits.toFixed(3))) > 0.00000001)
          throw new AppError('Invalid restaurant modifier stock units','RESTAURANT_MODIFIER_QUANTITY_INVALID',422);
        // R8-A: a flat addon (no option, component is an addons row, no
        // product WAC) costs addons.cost_price at rate 1 — no
        // consumption_qty, which belongs to group options only. The
        // client-sent costPrice stays ignored; the server re-derives.
        const addonUnitCost = !option && componentId > 0 && !costs.has(componentId)
          ? addonCosts.get(componentId) : undefined;
        if (componentId > 0 && ((addonUnitCost === undefined && !costs.has(componentId)) || item.isService))
          throw new AppError('Restaurant modifier component cannot be consumed from this line',
            'RESTAURANT_MODIFIER_STOCK_INVALID',422);
        const unitWac = addonUnitCost !== undefined ? addonUnitCost
          : (componentId > 0 ? Number(costs.get(componentId)) : 0);
        if (!Number.isFinite(unitWac) || unitWac < 0)
          throw new AppError('Invalid modifier inventory WAC','RESTAURANT_MODIFIER_COST_INVALID',422);
        modifiersCost += stockUnits * unitWac;
        return {...mod,qty,consumptionQty:rate,costPrice:Number((rate*unitWac).toFixed(6)),
          ...(componentId > 0 ? {productId:componentId} : {})};
      });
      const parentCost = costs.get(Number(item.productId));
      if (parentCost === undefined || !Number.isFinite(parentCost))
        throw new AppError('Sale WAC product missing','SALE_COST_PRODUCT_MISSING',409);
      item.costPrice = Number((parentCost * Number(item.unitMultiplier || 1) + modifiersCost).toFixed(6));
    }
  }

  /** R4-C INV-REST-MODIFIER-CONTRACT-2: price-resolution + group-rule
   * pre-pass. Runs BEFORE the prepared-items loop in createSale and
   * updateSale, inside the same transaction, so buildPreparedSaleItem
   * prices every line from server prices — a price fix inside
   * resolveSaleModifierCosts would be too late (lineTotal is already
   * frozen by then). Skipped entirely when the restaurant feature is
   * off, so non-restaurant sales (including flat legacy addons) keep
   * their exact current behaviour. Rewrites each modifier's price in
   * place on the normalized items; throws 422/500 from the pure
   * helper (see restaurant-modifier-contract.helper.ts) before any
   * stock, tender or journal work. */
  async enforceRestaurantModifierContract(
    trx: Kysely<Database> | Transaction<Database>, items: any[],
    tenantId: string, restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ): Promise<void> {
    if (!restaurantEnabled) return;
    const optionIds = new Set<number>();
    const modProductIds = new Set<number>();
    const lineProductIds = new Set<number>();
    for (const item of items) {
      if (Number(item.productId || 0) > 0) lineProductIds.add(Number(item.productId));
      for (const mod of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
        const optionId = Number(mod.optionId || mod.option_id || 0);
        const productId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
        if (optionId > 0) optionIds.add(optionId);
        if (productId > 0) modProductIds.add(productId);
      }
    }
    const optionRows = optionIds.size ? await trx.selectFrom('pos_modifier_options')
      .select(['id', 'price', 'group_id'])
      .where('tenant_id', '=', tenantId).where('id', 'in', [...optionIds]).execute() : [];
    const truth: ModifierPriceTruth = {
      options: new Map(optionRows.map((row) => [Number(row.id),
        { price: Number(row.price), groupId: Number(row.group_id) }])),
      products: new Map(),
      addons: new Map(),
    };
    if (modProductIds.size) {
      const productRows = await trx.selectFrom('products').select(['id', 'retail_price'])
        .where('tenant_id', '=', tenantId).where('id', 'in', [...modProductIds]).execute();
      for (const row of productRows) truth.products.set(Number(row.id), Number(row.retail_price));
      const addonRows = await trx.selectFrom('addons').select(['id', 'price'])
        .where('tenant_id', '=', tenantId).where('id', 'in', [...modProductIds]).execute();
      for (const row of addonRows) truth.addons.set(Number(row.id), Number(row.price));
    }
    const linkedGroups = new Map<number, ModifierGroupRule[]>();
    if (lineProductIds.size) {
      const links = await trx.selectFrom('product_pos_modifiers')
        .select(['product_id', 'modifier_group_id'])
        .where('tenant_id', '=', tenantId).where('product_id', 'in', [...lineProductIds]).execute();
      const groupIds = [...new Set(links.map((l) => Number(l.modifier_group_id)))];
      const groupRows = groupIds.length ? await trx.selectFrom('pos_modifier_groups')
        .select(['id', 'name', 'selection_type', 'is_mandatory', 'min_selections', 'max_selections', 'is_active'])
        .where('tenant_id', '=', tenantId).where('id', 'in', groupIds)
        .where('is_active', '=', true).execute() : [];
      const groupsById = new Map(groupRows.map((g) => [Number(g.id), {
        id: Number(g.id), name: String(g.name), selectionType: String(g.selection_type || 'multiple'),
        isMandatory: Boolean(g.is_mandatory), minSelections: Number(g.min_selections || 0),
        maxSelections: Number(g.max_selections || 10), isActive: Boolean(g.is_active),
      }]));
      for (const link of links) {
        const group = groupsById.get(Number(link.modifier_group_id));
        if (!group) continue;
        const list = linkedGroups.get(Number(link.product_id)) || [];
        list.push(group);
        linkedGroups.set(Number(link.product_id), list);
      }
    }
    // SF-3 D-SF-03: a frozen option deleted after placement keeps its
    // stored price AND its stored group, so the order still converts at
    // the agreed amount and still counts toward its group instead of
    // throwing RESTAURANT_MODIFIER_OPTION_INVALID.
    if (approvedModifierPrices) {
      for (const item of items) {
        for (const mod of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
          const optionId = Number(mod.optionId || mod.option_id || 0);
          if (optionId > 0 && approvedModifierPrices[`option:${optionId}`] !== undefined && !truth.options.has(optionId)) {
            truth.options.set(optionId, {
              price: approvedModifierPrices[`option:${optionId}`],
              groupId: Number(mod.groupId || mod.group_id || 0),
            });
          }
        }
      }
    }
    const repriced = enforceModifierContractPure(items, truth, linkedGroups, approvedModifierPrices);
    repriced.forEach((item, index) => { items[index].modifiers = item.modifiers; });
  }

async claimSaleSerials(
    trx: Kysely<Database>, item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number, saleItemId: number, tenantId: string,
  ): Promise<string[]> {
    const product = await trx.selectFrom('products').select('track_serials')
      .where('id', '=', item.productId).where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
    const submitted = Array.isArray(item.serials) ? item.serials : [];
    if (submitted.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new AppError('أدخل أرقاماً تسلسلية صحيحة للصنف', 'SALE_SERIAL_INVALID', 400);
    }
    const serials = submitted.map((value: string) => value.trim().toLowerCase());
    if (!product.track_serials && serials.length === 0) return [];
    if (!Number.isInteger(item.requiredQty) || serials.length !== item.requiredQty || new Set(serials).size !== serials.length) {
      throw new AppError('عدد الأرقام التسلسلية يجب أن يطابق عدد القطع دون تكرار', 'SALE_SERIAL_COUNT_MISMATCH', 400);
    }
    const rows = await trx.selectFrom('product_serials').select(['id', 'product_id', 'serial_number', 'imei_2', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', item.productId)
      .where('status', '=', 'in_stock')
      .where((eb) => eb.or([
        sql<boolean>`LOWER(serial_number) in (${sql.join(serials)})`,
        sql<boolean>`LOWER(imei_2) in (${sql.join(serials)})`,
      ]))
      .orderBy('id', 'desc').forUpdate().execute();
    if (rows.length !== serials.length ||
        serials.some((serial) => !rows.some((row) => row.serial_number.toLowerCase() === serial || row.imei_2?.toLowerCase() === serial))) {
      throw new AppError('سيريال غير موجود بالمخزون أو سبق بيعه', 'SALE_SERIAL_UNAVAILABLE', 409);
    }
    await trx.updateTable('product_serials').set({ status: 'sold', sale_id: saleId, sale_item_id: saleItemId, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId).where('id', 'in', rows.map((row) => row.id)).execute();
    return rows.map((row) => row.serial_number);
  }

async releaseSaleSerials(trx: Kysely<Database>, saleId: number, tenantId: string): Promise<void> {
    await trx.updateTable('product_serials')
      .set({ status: 'in_stock', sale_id: null, sale_item_id: null, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId).where('sale_id', '=', saleId).where('status', '=', 'sold').execute();
  }

async autoProduceShortfall(
    trx: Kysely<Database> | Transaction<Database>,
    items: { productId: number; requiredQty: number; availableQty: number; hasBOM?: boolean; bomId?: number; unitMultiplier?: number }[],
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    scope: { tenantId: string; accountId: string },
    auth: AuthContext,
    visitedProductIds: Set<number> = new Set(),
    depth = 0,
  ) {
    if (depth > 6) {
      throw new AppError('تجاوز الحد الأقصى لعمق شجرة التركيبات التصنيعية المتداخلة', 'BOM_RECURSION_LIMIT', 400);
    }

    // Restaurant BOMs are kitchen recipes: restaurants must consume real ingredients
    // even without the unrelated Manufacturing feature. Otherwise hasBOM lets a
    // sale bypass stock checks while no recipe is actually produced.
    if (!this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'manufacturing') &&
        !this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')) {
      return;
    }

    for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
      if (!item.hasBOM || !item.bomId) continue;
      if (visitedProductIds.has(item.productId)) {
        throw new AppError(`اكتشاف حلقة تكرار دائرية في تركيبة التصنيع للمنتج #${item.productId}`, 'CIRCULAR_BOM_DETECTED', 400);
      }
      const nextVisited = new Set(visitedProductIds);
      nextVisited.add(item.productId);

      const shortfall = item.requiredQty - item.availableQty;
      if (shortfall <= 0) continue;

      const qtyToProduce = shortfall;
      const baseShortfall = Number(qtyToProduce.toFixed(3)); // requiredQty and availableQty are already base stock units
      
      const bom = await trx.selectFrom('manufacturing_boms')
        .select(['expected_cost', 'quantity', 'overhead_cost', 'is_active'])
        .where('id', '=', item.bomId)
        .where('product_id', '=', item.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (!bom || !bom.is_active || !Number.isFinite(Number(bom.quantity)) || Number(bom.quantity) <= 0) {
        throw new AppError('الوجبة مرتبطة بوصفة BOM غير صالحة أو غير نشطة', 'RESTAURANT_BOM_INVALID', 409);
      }

      const bomQuantity = Number(bom.quantity);
      // Same book-precision rule as manufacturing completion: the work order
      // created here is posted by postManufacturingWorkOrder, so its cost
      // must already be at book precision, not 2dp. (tenantBaseCurrency,
      // currencyMoneyDigits and roundMoney are already imported in this file.)
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      let totalCost = scaledBomOverhead(Number(bom.overhead_cost || 0), baseShortfall, bomQuantity, moneyDigits);
      const wo = await trx.insertInto('manufacturing_work_orders').values({
        bom_id: item.bomId,
        quantity_to_produce: baseShortfall,
        produced_quantity: baseShortfall,
        status: 'done',
        source_location_id: locationId,
        destination_location_id: locationId,
        total_cost: totalCost,
        note: `إنتاج تلقائي للمبيعات فاتورة S-${saleId}`,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).returning('id').executeTakeFirstOrThrow();
      
      const woId = Number(wo.id);

      const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
        .innerJoin('products as p', (join) => join
          .onRef('p.id', '=', 'l.component_product_id')
          .on('p.tenant_id', '=', scope.tenantId))
        .select(['l.component_product_id', 'l.quantity', 'l.unit_multiplier', 'l.expected_cost', 'l.waste_percentage', 'p.name as component_name'])
        .where('l.bom_id', '=', item.bomId)
        .execute();
      if (!bomLines.length) {
        throw new AppError('وصفة الوجبة لا تحتوي على خامات', 'RESTAURANT_BOM_EMPTY', 409);
      }

      for (const line of [...bomLines].sort((a, b) => Number(a.component_product_id) - Number(b.component_product_id))) {
        const wasteFactor = 1 / (1 - (Number(line.waste_percentage || 0) / 100));
        const lineMultiplier = Number(line.unit_multiplier || 1);
        const quantityConsumedInSelectedUnit = Number(line.quantity) * wasteFactor * (baseShortfall / bomQuantity);
        const requiredMaterialQty = Number((quantityConsumedInSelectedUnit * lineMultiplier).toFixed(3));
        if (!Number.isFinite(requiredMaterialQty) || requiredMaterialQty <= 0 ||
            !Number.isFinite(Number(line.waste_percentage)) || Number(line.waste_percentage) < 0 ||
            Number(line.waste_percentage) >= 100) {
          throw new AppError('معدل استهلاك أو نسبة هدر الوصفة غير صالحة', 'RESTAURANT_BOM_QUANTITY_INVALID', 409);
        }

        // Recursive BOM check
        const componentStock = await previewAssignedLocationStockQty(trx, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          productId: Number(line.component_product_id),
          branchId,
          locationId: locationId || 0
        });

        if (componentStock < requiredMaterialQty) {
           const subBom = await trx.selectFrom('manufacturing_boms')
            .select(['id', 'is_active'])
            .where('product_id', '=', Number(line.component_product_id))
            .where('is_active', '=', true)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
            
           if (subBom) {
              await this.autoProduceShortfall(trx, [{
                productId: Number(line.component_product_id),
                requiredQty: requiredMaterialQty,
                availableQty: componentStock,
                hasBOM: true,
                bomId: subBom.id,
                unitMultiplier: 1 // base units
              }], saleId, branchId, locationId, scope, auth, nextVisited, depth + 1);
           }
        }

        const material = await trx.selectFrom('products').select('cost_price').where('tenant_id', '=', scope.tenantId).where('id', '=', Number(line.component_product_id)).executeTakeFirstOrThrow();
        const actualUnitCost = Number(material.cost_price);
        if (!Number.isFinite(actualUnitCost) || actualUnitCost < 0) throw new AppError('Invalid material cost', 'MANUFACTURING_COST_INVALID', 409);
        const lineTotalCost = roundMoney(requiredMaterialQty * actualUnitCost, moneyDigits);
        totalCost += lineTotalCost;
        await trx.insertInto('manufacturing_wo_consumptions').values({
          work_order_id: woId,
          component_product_id: Number(line.component_product_id),
          quantity_consumed: requiredMaterialQty,
          unit_cost: actualUnitCost,
          line_total: lineTotalCost,
        }).execute();

        const stockChange = await applyStockDelta(trx, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          productId: Number(line.component_product_id),
          branchId,
          locationId,
          delta: -requiredMaterialQty,
          allowNegative: false,
        });

        await trx.insertInto('stock_movements').values({
          product_id: Number(line.component_product_id),
          movement_type: 'manufacturing_consumption',
          unit_cost: actualUnitCost, total_cost: lineTotalCost,
          qty: -requiredMaterialQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'استهلاك تصنيع تلقائي',
          note: `أمر إنتاج تلقائي #${woId} لفاتورة S-${saleId}`,
          reference_type: 'manufacturing_work_order',
          reference_id: woId,
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      const fgStockChange = await applyStockDelta(trx, {
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        productId: item.productId,
        branchId,
        locationId,
        delta: baseShortfall,
      });

      await trx.insertInto('stock_movements').values({
        product_id: item.productId,
        movement_type: 'manufacturing_production',
        // Do not re-round the book amount coarser than itself: totalCost is
        // already at book precision and is also written to the work order
        // that the GL posts. A toFixed(2) here would make the movement
        // disagree with the journal for 3dp tenants.
        unit_cost: totalCost / baseShortfall, total_cost: totalCost,
        qty: baseShortfall,
        before_qty: fgStockChange.scopeBefore,
        after_qty: fgStockChange.scopeAfter,
        reason: 'إنتاج تام تلقائي',
        note: `أمر إنتاج تلقائي #${woId} لفاتورة S-${saleId}`,
        reference_type: 'manufacturing_work_order',
        reference_id: woId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).execute();

      await valueStockReceipt(trx, scope.tenantId, item.productId, fgStockChange.globalAfter, baseShortfall, totalCost);
      await trx.updateTable('manufacturing_work_orders').set({ completed_at: new Date(), total_cost: totalCost } as any).where('tenant_id', '=', scope.tenantId).where('id', '=', woId).execute();

      const posting = await this.accountingPosting.postManufacturingWorkOrder(trx, woId, auth);
      // INV-MANUFACTURING-ZERO-COST: a zero-cost auto-produced order posts
      // no journal by design; only a positive-cost order missing its
      // journal is a ledger failure.
      if (!posting.journalEntryId && totalCost > 0) throw new AppError(`Manufacturing work order ${woId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
    }
  }

  /**
   * Record anomalous import-lot shortfalls instead of discarding the
   * allocation result (INV-IMPORT-LOT-SHORTFALL-RECORD). The sale itself
   * is not blocked: for ordinary POS sales the GL COGS comes from WAC,
   * so a lot shortfall is traceability-only — but it must leave a
   * persistent, queryable record (pos_audit_events) when it is
   * anomalous per isAnomalousImportLotShortfall, so an import-tracked
   * product sold with missing provenance is visible instead of silent.
   * Runs inside the sale transaction, so a rolled-back sale leaves no
   * orphan gap record.
   */
  async recordImportLotShortfalls(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleLineId: number,
    allocation: { items: Array<{ productId: number; requestedQty: number; allocatedQty: number; shortfallQty: number; fullyCovered: boolean; reason: string }> },
    auth: AuthContext,
  ): Promise<void> {
    for (const item of allocation.items) {
      if (item.fullyCovered || item.shortfallQty <= 0.0001) continue;
      const anyLot = await trx
        .selectFrom('import_inventory_lots')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', Number(item.productId))
        .limit(1)
        .executeTakeFirst();
      if (!isAnomalousImportLotShortfall(item as any, Boolean(anyLot))) continue;
      await trx.insertInto('pos_audit_events').values({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        event_type: 'import_lot_shortfall', user_id: auth.userId, sale_id: saleId,
        product_id: Number(item.productId), amount: Number(item.shortfallQty),
        reason: `Import lot shortfall (${item.reason}): requested ${item.requestedQty}, allocated ${item.allocatedQty}, shortfall ${item.shortfallQty}`,
        metadata: { saleLineId, requestedQty: item.requestedQty, allocatedQty: item.allocatedQty, shortfallQty: item.shortfallQty, reason: item.reason },
      }).execute();
    }
  }

async deductPharmacyBatchesFefo(
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ): Promise<void> {
    const drug = await trx.selectFrom('pharmacy_drugs').select('id')
      .where('product_id', '=', productId).where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const linkedBatch = await trx.selectFrom('pharmacy_batches').select('id')
      .where('product_id', '=', productId).where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!drug && !linkedBatch) return;

    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    for (const allocation of allocations) {
      let remaining = Number(allocation.qty.toFixed(3));
      const batches = await trx
        .selectFrom('pharmacy_batches')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('product_id', '=', productId),
            eb(
              'drug_id',
              'in',
              trx
                .selectFrom('pharmacy_drugs')
                .select('id')
                .where('product_id', '=', productId)
                .where(sql<boolean>`tenant_id = ${scope.tenantId}`),
            ),
          ]),
        )
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('status', '=', 'active')
        .where('quantity', '>', 0)
        .where((eb) => allocation.locationId == null
          ? eb('location_id', 'is', null)
          : eb.or([eb('location_id', '=', allocation.locationId), eb('location_id', 'is', null)]))
        .orderBy('expiry_date', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      for (const batch of batches) {
        if (remaining <= 0) break;
        const exp = String(batch.expiry_date || '').trim().slice(0, 10);
        if (!exp || (exp.length === 7 ? exp < currentMonthIso : exp < todayIso)) continue;

        const batchQty = Number(batch.quantity || 0);
        const alloc = Math.min(batchQty, remaining);
        const newQty = Number((batchQty - alloc).toFixed(3));
        const nextStatus = newQty <= 0 ? 'depleted' : 'active';

        await trx
          .updateTable('pharmacy_batches')
          .set({
            quantity: newQty,
            status: nextStatus,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', Number(batch.id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        await trx.insertInto('sale_pharmacy_batch_allocations').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, sale_id: saleId,
          sale_item_id: saleItemId, product_id: productId,
          pharmacy_batch_id: Number(batch.id), quantity: alloc,
        }).execute();

        remaining = Number((remaining - alloc).toFixed(3));
      }
      if (remaining > 0) {
        throw new AppError('لا توجد كمية كافية من تشغيلة دوائية سارية الصلاحية في المخزن المحدد', 'PHARMACY_FEFO_STOCK_UNAVAILABLE', 422);
      }
    }
  }

async restoreSalePharmacyBatches(
    trx: Kysely<Database> | Transaction<Database>, saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string }, removeAllocations: boolean,
  ): Promise<void> {
    const rows = await trx.selectFrom('sale_pharmacy_batch_allocations').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId)
      .orderBy('pharmacy_batch_id', 'asc').forUpdate().execute();
    const tracked = new Set(rows.map((row) => Number(row.sale_item_id)));
    const itemIds = items.map((item) => Number(item.product_id)).filter((id) => id > 0);
    const drugs = itemIds.length ? await trx.selectFrom('pharmacy_drugs').select('product_id')
      .where('tenant_id', '=', scope.tenantId).where('product_id', 'in', itemIds).execute() : [];
    const drugProducts = new Set(drugs.map((drug) => Number(drug.product_id)));
    if (items.some((item) => drugProducts.has(Number(item.product_id)) && !tracked.has(Number(item.id)))) {
      throw new AppError('فاتورة دوائية قديمة بلا ربط بالتشغيلات تحتاج تسوية قبل التعديل أو الإلغاء', 'PHARMACY_BATCH_RECONCILIATION_REQUIRED', 422);
    }
    const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    for (const row of rows) {
      const batch = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'expiry_date'])
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(row.pharmacy_batch_id))
        .forUpdate().executeTakeFirstOrThrow();
      const expiry = String(batch.expiry_date || '').slice(0, 10);
      const expired = !expiry || (expiry.length === 7 ? expiry < today.slice(0, 7) : expiry < today);
      await trx.updateTable('pharmacy_batches').set({
        quantity: Number((Number(batch.quantity) + Number(row.quantity)).toFixed(3)),
        status: expired ? 'expired' : 'active', updated_at: sql`NOW()`,
      }).where('tenant_id', '=', scope.tenantId).where('id', '=', Number(batch.id)).execute();
    }
    if (removeAllocations && rows.length) {
      await trx.deleteFrom('sale_pharmacy_batch_allocations')
        .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId).execute();
    }
  }
}
