import { Database } from '../../../../database/database.types';
import { Kysely, sql } from 'kysely';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { TenantScope } from './restaurant-fnb-types';

export class RestaurantFnbStampsCostingSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // ==========================================
  // 5. DIGITAL STAMP LOYALTY CARDS (PUNCH CARDS)
  // ==========================================

  async getCustomerStampCard(scope: TenantScope, customerId: number) {
    let card = await this.db
      .selectFrom('restaurant_stamp_cards')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('customer_id', '=', customerId)
      .executeTakeFirst();

    if (!card) {
      // Auto-create initial card
      const [newCard] = await this.db
        .insertInto('restaurant_stamp_cards')
        .values({
          tenant_id: scope.tenantId,
          customer_id: customerId,
          program_name: 'كوبون المشروبات والقهوة',
          target_stamps: 6,
          current_stamps: 0,
          total_completed_cards: 0,
          reward_description: 'مشروب مجاني عند اكتمال الختم',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .execute();
      card = newCard;
    }

    return card;
  }

  async addCustomerStamp(scope: TenantScope, customerId: number, countToAdd: number = 1) {
    const card = await this.getCustomerStampCard(scope, customerId);

    const target = card.target_stamps || 6;
    let newStamps = (card.current_stamps || 0) + countToAdd;
    let newCompleted = card.total_completed_cards || 0;
    let rewardUnlocked = false;

    if (newStamps >= target) {
      rewardUnlocked = true;
      newCompleted += Math.floor(newStamps / target);
      newStamps = newStamps % target;
    }

    await this.db
      .updateTable('restaurant_stamp_cards')
      .set({
        current_stamps: newStamps,
        total_completed_cards: newCompleted,
        last_stamped_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', card.id)
      .execute();

    return {
      success: true,
      currentStamps: newStamps,
      targetStamps: target,
      totalCompletedCards: newCompleted,
      rewardUnlocked,
      message: rewardUnlocked
        ? `تهانينا! اكتمل كرت الأختام وحصل العميل على [${card.reward_description || 'مكافأة مجانية'}]!`
        : `تم إضافة ${countToAdd} ختم بنجاح (المتبقي للمكافأة: ${target - newStamps})`,
    };
  }

  // ==========================================
  // 6. LIVE FOOD INFLATION & PLATE COST RADAR
  // ==========================================

  async getPlateCostFluctuations(scope: TenantScope) {
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    // Queries products that have BOM recipes and evaluates recent purchase costs vs standard recipe costs
    const productsWithBom = await sql<any>`
      SELECT
        p.id as product_id,
        p.name as product_name,
        p.price as selling_price,
        p.cost_price as standard_cost,
        COALESCE(
          (SELECT SUM(l.quantity * COALESCE(comp.cost_price, 0))
           FROM manufacturing_boms b
           JOIN manufacturing_bom_lines l ON l.bom_id = b.id
           JOIN products comp ON comp.id = l.component_product_id
           WHERE b.product_id = p.id AND b.tenant_id = ${scope.tenantId} AND b.is_active = true
           LIMIT 1),
          p.cost_price
        ) as live_recipe_cost
      FROM products p
      WHERE p.tenant_id = ${scope.tenantId}
        AND p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM manufacturing_boms b
          WHERE b.product_id = p.id AND b.tenant_id = ${scope.tenantId}
        )
      LIMIT 50;
    `.execute(this.db);

    const rows = productsWithBom.rows || [];

    return rows.map((r: any) => {
      const sellingPrice = Number(r.selling_price || 0);
      const standardCost = Number(r.standard_cost || 0);
      const liveCost = Number(r.live_recipe_cost || standardCost);
      const costInflationPct =
        standardCost > 0 ? Number((((liveCost - standardCost) / standardCost) * 100).toFixed(1)) : 0;

      const currentMarginPct =
        sellingPrice > 0 ? Number((((sellingPrice - liveCost) / sellingPrice) * 100).toFixed(1)) : 0;

      // Desired standard margin is 65% for restaurants
      const targetMargin = 0.65;
      const suggestedPrice = roundMoney(liveCost / (1 - targetMargin), moneyDigits);

      return {
        productId: r.product_id,
        productName: r.product_name,
        sellingPrice,
        standardCost,
        liveCost,
        costInflationPct,
        currentMarginPct,
        suggestedPrice: suggestedPrice > sellingPrice ? suggestedPrice : sellingPrice,
        isAlert: costInflationPct > 5 || currentMarginPct < 50,
      };
    });
  }

  // ==========================================
  // 7. MANAGER COMPS & VIP ON-THE-HOUSE ENGINE
  // ==========================================

  async getManagerComps(scope: TenantScope) {
    return this.db
      .selectFrom('restaurant_manager_comps')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
  }
}
