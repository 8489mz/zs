import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface CreateFoodWasteLogDto {
  branchId: number;
  productId: number;
  quantity: number;
  reason: 'spoilage' | 'prep_error' | 'expired' | 'customer_complaint' | 'other';
  notes?: string;
  allowPending?: boolean;
}

@Injectable()
export class RestaurantFoodWasteService {
  private readonly logger = new Logger(RestaurantFoodWasteService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  /**
   * Log daily/shift food waste and deduct raw ingredient from inventory
   */
  async logWaste(auth: AuthContext, dto: CreateFoodWasteLogDto) {
    const scope = requireTenantScope(auth);
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('الكمية يجب أن تكون أكبر من الصفر وصالحة');
    }
    if (!Number.isSafeInteger(dto.branchId) || dto.branchId <= 0 ||
        !Number.isSafeInteger(dto.productId) || dto.productId <= 0) {
      throw new BadRequestException('الفرع والصنف مطلوبان');
    }

    return this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // Never record a fictitious expense without an actual warehouse deduction.
      const branch = await trx.selectFrom('branches')
        .select(['default_stock_location_id'])
        .where('id', '=', dto.branchId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (!branch) throw new BadRequestException('الفرع غير موجود في المنشأة');

      let locationId = branch.default_stock_location_id ? Number(branch.default_stock_location_id) : null;
      if (locationId) {
        const selectedLocation = await trx.selectFrom('stock_locations')
          .select('id').where('id', '=', locationId)
          .where('tenant_id', '=', scope.tenantId)
          .where('branch_id', '=', dto.branchId)
          .where('is_active', '=', true).executeTakeFirst();
        if (!selectedLocation) locationId = null;
      }
      if (!locationId) {
        const fallbackLocation = await trx.selectFrom('stock_locations')
          .select('id').where('branch_id', '=', dto.branchId)
          .where('is_active', '=', true).where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc').executeTakeFirst();
        locationId = fallbackLocation ? Number(fallbackLocation.id) : null;
      }
      if (!locationId) throw new BadRequestException('لا يوجد مخزن نشط للفرع؛ لا يمكن تسجيل تالف دون خصم مخزون');

      // Lock the costed product in the same transaction as the stock and GL.
      const product = await trx.selectFrom('products')
        .select(['id', 'name', 'cost_price', 'stock_qty']).where('id', '=', dto.productId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId).forUpdate().executeTakeFirst();
      if (!product) throw new NotFoundException('الصنف غير موجود');
      const costPrice = Number(product.cost_price);
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        throw new BadRequestException('تكلفة الصنف غير صالحة؛ لا يمكن تسجيل تالف بتكلفة وهمية');
      }
      const totalCost = roundMoney(costPrice * dto.quantity, moneyDigits);
      if (!Number.isFinite(totalCost)) throw new BadRequestException('قيمة التالف غير صالحة');

      // Check available stock at this location/branch
      const locationStock = await trx.selectFrom('product_location_stock')
        .select('qty')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', dto.productId)
        .where('location_id', '=', locationId)
        .executeTakeFirst();
      const currentQty = Number(locationStock?.qty || 0);

      if (currentQty < dto.quantity) {
        if (!dto.allowPending) {
          throw new BadRequestException(`الرصيد غير كافٍ لتسجيل الهدر؛ المتاح حالياً ${currentQty}`);
        }

        // Register pending waste incident awaiting inventory replenishment (no negative stock, no phantom GL)
        const log = await trx.insertInto('restaurant_food_waste_logs').values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          branch_id: dto.branchId,
          product_id: dto.productId,
          quantity: dto.quantity,
          cost_price: costPrice,
          total_cost: totalCost,
          reason: dto.reason,
          notes: `[بانتظار تسوية المخزون] ${dto.notes || ''}`.trim(),
          logged_by: auth.userId ? Number(auth.userId) : null,
        }).returning('id').executeTakeFirstOrThrow();

        return {
          id: Number(log.id),
          productName: product.name,
          quantity: dto.quantity,
          totalCost: 0,
          status: 'pending_reconciliation',
          journalEntryId: null,
          message: 'تم تسجيل واقعة الهدر بنجاح بحالة (بانتظار تسوية المخزون) دون خصم مخزني أو قيد مالي وهمي',
        };
      }

      // Stock is available: deduct stock with strict non-negative invariant and post GL
      const stockChange = await applyStockDelta(trx, {
        productId: dto.productId,
        delta: -dto.quantity,
        branchId: dto.branchId,
        locationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        allowNegative: false,
      });

      const log = await trx.insertInto('restaurant_food_waste_logs').values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        branch_id: dto.branchId,
        product_id: dto.productId,
        quantity: dto.quantity,
        cost_price: costPrice,
        total_cost: totalCost,
        reason: dto.reason,
        notes: dto.notes || null,
        logged_by: auth.userId ? Number(auth.userId) : null,
      }).returning('id').executeTakeFirstOrThrow();

      await trx.insertInto('stock_movements').values({
        product_id: dto.productId,
        movement_type: 'damaged',
        qty: -dto.quantity,
        before_qty: stockChange.scopeBefore,
        after_qty: stockChange.scopeAfter,
        reason: `food_waste_${dto.reason}`,
        note: `هدر مطبخ #${log.id}: ${dto.notes || dto.reason}`,
        reference_type: 'food_waste',
        reference_id: Number(log.id),
        branch_id: dto.branchId,
        location_id: locationId,
        created_by: auth.userId ? Number(auth.userId) : 0,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      } as any).execute();

      const journalResult = await this.accountingPosting.postFoodWaste(trx, Number(log.id), auth);

      return {
        id: Number(log.id),
        productName: product.name,
        quantity: dto.quantity,
        totalCost,
        status: 'posted',
        journalEntryId: journalResult.journalEntryId,
      };
    });
  }

  /**
   * Reconcile a pending food waste incident once inventory has been received
   */
  async reconcilePendingWaste(auth: AuthContext, logId: number) {
    const scope = requireTenantScope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    return this.db.transaction().execute(async (trx) => {
      const log = await trx.selectFrom('restaurant_food_waste_logs')
        .selectAll()
        .where('id', '=', logId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!log) throw new NotFoundException('سجل الهدر غير موجود');

      // Check if already reconciled via existing stock movement
      const existingMovement = await trx.selectFrom('stock_movements')
        .select('id')
        .where('reference_type', '=', 'food_waste')
        .where('reference_id', '=', logId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (existingMovement) {
        return { ok: true, id: logId, alreadyReconciled: true, message: 'واقعة الهدر تمت تسويتها مسبقاً' };
      }

      const branch = await trx.selectFrom('branches')
        .select(['default_stock_location_id'])
        .where('id', '=', Number(log.branch_id))
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (!branch) throw new BadRequestException('الفرع غير موجود');

      let locationId = branch.default_stock_location_id ? Number(branch.default_stock_location_id) : null;
      if (!locationId) {
        const fallback = await trx.selectFrom('stock_locations')
          .select('id').where('branch_id', '=', Number(log.branch_id))
          .where('is_active', '=', true).where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc').executeTakeFirst();
        locationId = fallback ? Number(fallback.id) : null;
      }
      if (!locationId) throw new BadRequestException('لا يوجد مخزن نشط للفرع لإتمام التسوية');

      const product = await trx.selectFrom('products')
        .select(['id', 'name', 'cost_price', 'stock_qty'])
        .where('id', '=', Number(log.product_id))
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate().executeTakeFirst();
      if (!product) throw new NotFoundException('الصنف غير موجود');

      const wasteQty = Number(log.quantity);
      const stockChange = await applyStockDelta(trx, {
        productId: Number(log.product_id),
        delta: -wasteQty,
        branchId: Number(log.branch_id),
        locationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        allowNegative: false,
      });

      const costPrice = Number(product.cost_price);
      const totalCost = roundMoney(costPrice * wasteQty, moneyDigits);

      await trx.insertInto('stock_movements').values({
        product_id: Number(log.product_id),
        movement_type: 'damaged',
        qty: -wasteQty,
        before_qty: stockChange.scopeBefore,
        after_qty: stockChange.scopeAfter,
        reason: `food_waste_${log.reason}`,
        note: `تسوية هدر مطبخ معلق #${logId}`,
        reference_type: 'food_waste',
        reference_id: logId,
        branch_id: Number(log.branch_id),
        location_id: locationId,
        created_by: auth.userId ? Number(auth.userId) : 0,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      } as any).execute();

      const cleanNotes = (log.notes || '').replace('[بانتظار تسوية المخزون]', '[تمت تسوية الهدر]').trim();
      await trx.updateTable('restaurant_food_waste_logs')
        .set({
          notes: cleanNotes,
          cost_price: costPrice,
          total_cost: totalCost,
        })
        .where('id', '=', logId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      const journalResult = await this.accountingPosting.postFoodWaste(trx, logId, auth);

      return {
        ok: true,
        id: logId,
        productName: product.name,
        quantity: wasteQty,
        totalCost,
        status: 'reconciled',
        journalEntryId: journalResult.journalEntryId,
      };
    });
  }

  /**
   * List recent waste logs with optional branch filter
   */
  async listLogs(auth: AuthContext, filters?: { branchId?: number; limit?: number }) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('restaurant_food_waste_logs as w')
      .innerJoin('products as p', 'p.id', 'w.product_id')
      .leftJoin('branches as b', 'b.id', 'w.branch_id')
      .select([
        'w.id',
        'w.branch_id',
        'b.name as branch_name',
        'w.product_id',
        'p.name as product_name',
        'w.quantity',
        'w.cost_price',
        'w.total_cost',
        'w.reason',
        'w.notes',
        'w.created_at',
      ])
      .where('w.tenant_id', '=', scope.tenantId);

    if (filters?.branchId) {
      query = query.where('w.branch_id', '=', filters.branchId);
    }

    return query
      .orderBy('w.created_at', 'desc')
      .limit(filters?.limit || 50)
      .execute();
  }

  /**
   * Get Food Cost Variance Summary (Theoretical consumption vs. waste)
   */
  async getVarianceSummary(auth: AuthContext, branchId?: number) {
    const scope = requireTenantScope(auth);

    // Sum total waste in last 30 days
    const wasteSummary = await this.db
      .selectFrom('restaurant_food_waste_logs')
      .select([
        sql<number>`COALESCE(SUM(total_cost), 0)`.as('total_waste_cost'),
        sql<number>`COALESCE(COUNT(*), 0)`.as('total_waste_incidents'),
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where(sql<boolean>`created_at >= NOW() - INTERVAL '30 days'`)
      .executeTakeFirst();

    // Group waste by reason
    const wasteByReason = await this.db
      .selectFrom('restaurant_food_waste_logs')
      .select([
        'reason',
        sql<number>`COALESCE(SUM(total_cost), 0)`.as('cost'),
        sql<number>`COUNT(*)`.as('count'),
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where(sql<boolean>`created_at >= NOW() - INTERVAL '30 days'`)
      .groupBy('reason')
      .execute();

    return {
      period: '30_days',
      totalWasteCost: Number(wasteSummary?.total_waste_cost || 0),
      totalWasteIncidents: Number(wasteSummary?.total_waste_incidents || 0),
      byReason: wasteByReason.map((r) => ({
        reason: r.reason,
        cost: Number(r.cost),
        count: Number(r.count),
      })),
    };
  }
}
