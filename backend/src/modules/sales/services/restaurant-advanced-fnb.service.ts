import { Injectable, Inject, Logger } from '@nestjs/common';
import { Database } from '../../../database/database.types';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql, type Transaction } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import type { TenantScope, Toggle86ItemDto, CalculateTipPoolDto, SaveTableZoneDto, GeneratePrepSheetDto } from './restaurant-fnb/restaurant-fnb-types';
export type { Toggle86ItemDto, CalculateTipPoolDto, SaveTableZoneDto, GeneratePrepSheetDto } from './restaurant-fnb/restaurant-fnb-types';
import { RestaurantFnbGates86Slice } from './restaurant-fnb/restaurant-fnb-gates-86';
import { RestaurantFnbTipsReadSlice } from './restaurant-fnb/restaurant-fnb-tips-read';
import { RestaurantFnbTipsCreateSlice } from './restaurant-fnb/restaurant-fnb-tips-create';
import { RestaurantFnbConfirmZonesSlice } from './restaurant-fnb/restaurant-fnb-confirm-zones';
import { RestaurantFnbPrepSlice } from './restaurant-fnb/restaurant-fnb-prep';
import { RestaurantFnbStampsCostingSlice } from './restaurant-fnb/restaurant-fnb-stamps-costing';
import { RestaurantFnbManagerCompSlice } from './restaurant-fnb/restaurant-fnb-manager-comp';
import { RestaurantFnbRatingsDriveThruSlice } from './restaurant-fnb/restaurant-fnb-ratings-drive-thru';






@Injectable()
export class RestaurantAdvancedFnbService {
  private readonly logger = new Logger(RestaurantAdvancedFnbService.name);
  private readonly gates86: RestaurantFnbGates86Slice;
  private readonly tipsReadSlice: RestaurantFnbTipsReadSlice;
  private readonly tipsCreate: RestaurantFnbTipsCreateSlice;
  private readonly confirmZones: RestaurantFnbConfirmZonesSlice;
  private readonly prep: RestaurantFnbPrepSlice;
  private readonly stampsCosting: RestaurantFnbStampsCostingSlice;
  private readonly managerComp: RestaurantFnbManagerCompSlice;
  private readonly ratingsDriveThru: RestaurantFnbRatingsDriveThruSlice;

  // The posting service is optional ONLY so existing direct constructions
  // (d6c-misc-book-digits.spec.ts builds the service with the db alone to
  // test tip splits) keep compiling: Nest always injects it, and the sale
  // comp path refuses to post without it (FNB_POSTING_UNAVAILABLE below)
  // instead of crashing on an undefined call.
  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<Database>,
    private readonly accountingPosting?: AccountingPostingService,
  ) {
    this.gates86 = new RestaurantFnbGates86Slice(this.db);
    this.tipsReadSlice = new RestaurantFnbTipsReadSlice(this.db);
    this.tipsCreate = new RestaurantFnbTipsCreateSlice(this.db, this.assertManagerCaller.bind(this));
    this.confirmZones = new RestaurantFnbConfirmZonesSlice(this.db, this.assertManagerCaller.bind(this));
    this.prep = new RestaurantFnbPrepSlice(this.db);
    this.stampsCosting = new RestaurantFnbStampsCostingSlice(this.db);
    this.managerComp = new RestaurantFnbManagerCompSlice(this.db, this.assertManagerCaller.bind(this), this.resolveCompAccount.bind(this), this.accountingPosting);
    this.ratingsDriveThru = new RestaurantFnbRatingsDriveThruSlice(this.db);
  }

  private assertManagerCaller(scope: TenantScope): void {
    return this.gates86.assertManagerCaller(scope);
  }

  private async resolveCompAccount(
    queryable: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    return this.gates86.resolveCompAccount(queryable, tenantId, configuredId, fallbackCode);
  }

  async get86Items(scope: TenantScope, branchId?: number | null) {
    return this.gates86.get86Items(scope, branchId);
  }

  async toggle86Item(scope: TenantScope, dto: Toggle86ItemDto) {
    return this.gates86.toggle86Item(scope, dto);
  }

  async getTipPools(scope: TenantScope, shiftDate?: string) {
    return this.tipsReadSlice.getTipPools(scope, shiftDate);
  }

  async getTipPoolStaff(scope: TenantScope) {
    return this.tipsReadSlice.getTipPoolStaff(scope);
  }

  async calculateAndSaveTipPool(scope: TenantScope, dto: CalculateTipPoolDto) {
    return this.tipsCreate.calculateAndSaveTipPool(scope, dto);
  }


  async confirmTipDistribution(scope: TenantScope, poolId: number) {
    return this.confirmZones.confirmTipDistribution(scope, poolId);
  }

  async getZones(scope: TenantScope, branchId?: number | null) {
    return this.confirmZones.getZones(scope, branchId);
  }

  async saveZone(scope: TenantScope, dto: SaveTableZoneDto) {
    return this.confirmZones.saveZone(scope, dto);
  }

  async getPrepSheets(scope: TenantScope, prepDate?: string) {
    return this.prep.getPrepSheets(scope, prepDate);
  }

  async generateDailyPrepSheet(scope: TenantScope, dto: GeneratePrepSheetDto) {
    return this.prep.generateDailyPrepSheet(scope, dto);
  }

  async recordPrepProduction(scope: TenantScope, itemId: number, actualQty: number) {
    return this.prep.recordPrepProduction(scope, itemId, actualQty);
  }

  async getCustomerStampCard(scope: TenantScope, customerId: number) {
    return this.stampsCosting.getCustomerStampCard(scope, customerId);
  }

  async addCustomerStamp(scope: TenantScope, customerId: number, countToAdd: number = 1) {
    return this.stampsCosting.addCustomerStamp(scope, customerId, countToAdd);
  }

  async getPlateCostFluctuations(scope: TenantScope) {
    return this.stampsCosting.getPlateCostFluctuations(scope);
  }

  async getManagerComps(scope: TenantScope) {
    return this.stampsCosting.getManagerComps(scope);
  }

  async recordManagerComp(scope: TenantScope, dto: {
    saleId?: number;
    tableNumber?: string;
    compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
    managerName: string;
    managerPin?: string;
    amount: number;
    itemsSummary?: string;
    notes?: string;
  }) {
    return this.managerComp.recordManagerComp(scope, dto);
  }

  async recordTableRating(scope: TenantScope, dto: {
    tableNumber: string;
    saleId?: number;
    rating: number;
    feedbackCategory?: string;
    notes?: string;
  }) {
    return this.ratingsDriveThru.recordTableRating(scope, dto);
  }

  async resolveRescueAlert(scope: TenantScope, ratingId: number, managerName: string) {
    return this.ratingsDriveThru.resolveRescueAlert(scope, ratingId, managerName);
  }

  calculateMinimumSpend(currentTotal: number, minimumSpend: number) {
    return this.ratingsDriveThru.calculateMinimumSpend(currentTotal, minimumSpend);
  }

  async getDriveThruOrders(scope: TenantScope) {
    return this.ratingsDriveThru.getDriveThruOrders(scope);
  }

  async createDriveThruOrder(scope: TenantScope, dto: {
    vehiclePlate: string;
    vehicleDesc?: string;
    totalAmount?: number;
    notes?: string;
  }) {
    return this.ratingsDriveThru.createDriveThruOrder(scope, dto);
  }

  async updateDriveThruStatus(scope: TenantScope, id: number, status: 'order_taken' | 'at_window' | 'completed' | 'cancelled') {
    return this.ratingsDriveThru.updateDriveThruStatus(scope, id, status);
  }

  // ==========================================
  // 11. SMART UPSELLING & CROSS-SELLING ENGINE
  // ==========================================

  async getUpsellRecommendations(scope: TenantScope, triggerProductId?: number, categoryName?: string) {
    let query = this.db
      .selectFrom('restaurant_upsell_rules')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);

    if (triggerProductId) {
      query = query.where('trigger_product_id', '=', Number(triggerProductId));
    } else if (categoryName) {
      query = query.where('trigger_category_name', '=', categoryName);
    }

    const rules = await query.limit(5).execute();
    return rules;
  }

  async createUpsellRule(scope: TenantScope, dto: {
    triggerProductId?: number;
    triggerCategoryName?: string;
    suggestedProductId: number;
    suggestedProductName: string;
    title: string;
    discountAmount?: number;
  }) {
    const [rule] = await this.db
      .insertInto('restaurant_upsell_rules')
      .values({
        tenant_id: scope.tenantId,
        trigger_product_id: dto.triggerProductId ? Number(dto.triggerProductId) : null,
        trigger_category_name: dto.triggerCategoryName || null,
        suggested_product_id: Number(dto.suggestedProductId),
        suggested_product_name: dto.suggestedProductName,
        title: dto.title,
        discount_amount: dto.discountAmount || 0,
        is_active: true,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    return { success: true, rule, message: 'تم حفظ قاعدة الاقتراح الذكي بنجاح' };
  }

  // ==========================================
  // 12. VISUAL FLOOR PLAN CANVAS & TABLE LAYOUTS
  // ==========================================

  async getTableLayouts(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_table_layouts')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);

    if (branchId) {
      query = query.where((eb) =>
        eb.or([
          eb('branch_id', '=', branchId),
          eb('branch_id', 'is', null),
        ])
      );
    }

    const layouts = await query.orderBy('id', 'asc').execute();
    return layouts.map((l) => ({
      ...l,
      x_pos: Number(l.x_pos || 10),
      y_pos: Number(l.y_pos || 10),
      width: Number(l.width || 80),
      height: Number(l.height || 80),
      seats: Number(l.seats || 4),
      rotation: Number(l.rotation || 0),
    }));
  }

  async saveTableLayouts(
    scope: TenantScope,
    layouts: Array<{
      id?: number;
      table_number: string;
      zone_code?: string;
      shape?: 'square' | 'round' | 'rectangle' | 'booth';
      x_pos: number;
      y_pos: number;
      width?: number;
      height?: number;
      seats?: number;
      rotation?: number;
    }>,
    branchId?: number | null,
  ) {
    // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I37): design mode is
    // manager-only. A cashier overwriting the shared floor layout could
    // hide live orders; the gate lives here (not in a decorator) because
    // the manager definition is admin role OR pos_manager /
    // manage_restaurant permission — the same definition the POS uses for
    // its manager tiles — and PermissionsGuard checks permission strings
    // only. Read stays authenticated-any.
    this.assertManagerCaller(scope);
    if (!Array.isArray(layouts)) return [];

    return await this.db.transaction().execute(async (trx) => {
      const saved: any[] = [];
      for (const item of layouts) {
        if (!item.table_number) continue;

        const existing = await trx
          .selectFrom('restaurant_table_layouts')
          .select(['id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('table_number', '=', String(item.table_number).trim())
          .executeTakeFirst();

        if (existing) {
          const [updated] = await trx
            .updateTable('restaurant_table_layouts')
            .set({
              zone_code: item.zone_code || 'main',
              shape: item.shape || 'square',
              x_pos: Number(item.x_pos || 10),
              y_pos: Number(item.y_pos || 10),
              width: Number(item.width || 80),
              height: Number(item.height || 80),
              seats: Number(item.seats || 4),
              rotation: Number(item.rotation || 0),
              updated_at: new Date(),
            })
            .where('id', '=', existing.id)
            .returningAll()
            .execute();
          saved.push(updated);
        } else {
          const [created] = await trx
            .insertInto('restaurant_table_layouts')
            .values({
              tenant_id: scope.tenantId,
              branch_id: branchId ? Number(branchId) : null,
              table_number: String(item.table_number).trim(),
              zone_code: item.zone_code || 'main',
              shape: item.shape || 'square',
              x_pos: Number(item.x_pos || 10),
              y_pos: Number(item.y_pos || 10),
              width: Number(item.width || 80),
              height: Number(item.height || 80),
              seats: Number(item.seats || 4),
              rotation: Number(item.rotation || 0),
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returningAll()
            .execute();
          saved.push(created);
        }
      }
      return saved;
    });
  }

  async deleteTableLayout(scope: TenantScope, id: number) {
    // INV-REST-FLOOR-DESIGN-GATES (B2): deleting a layout is a design
    // write like saving one — manager-only (R5-D). At base any
    // authenticated caller could delete the shared floor through the API.
    this.assertManagerCaller(scope);
    await this.db
      .deleteFrom('restaurant_table_layouts')
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .execute();
    return { success: true };
  }

  /*
   * INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): real whole-table transfer
   * for a held draft. The rename updates ONLY held_sales.table_number —
   * no other column is touched — so it needs no dependency on the
   * hold/recall snapshot work (R5-B): the draft's cart, totals and
   * discounts are never re-saved, only re-pointed at the target table.
   * A target table that already holds a draft is refused (409), the
   * same one-draft-per-table rule saveHeldSale enforces (R4-D I42).
   */
  async renameHeldDraftTable(scope: TenantScope, draftId: number, toTableNumber: string) {
    // INV-REST-FLOOR-DESIGN-GATES (B2, decision): deliberately NOT
    // manager-gated. This is the whole-table TRANSFER engine
    // (transferTableOrder + the held-drafts dialog rename, both open to
    // any POS role in the UI) — it changes ONLY held_sales.table_number,
    // no amounts or cart contents, is fully reversible, and the 409
    // occupied-table guard prevents collisions. Gating it would block
    // every waiter/cashier table move; a table move is neither loss nor
    // fraud. Pinned by restaurant-floor-state.spec.ts check (13).
    const to = String(toTableNumber || '').trim();
    if (!to) {
      throw new AppError('رقم الطاولة الجديدة إلزامي.', 'HELD_DRAFT_TABLE_REQUIRED', 400);
    }
    const draft = await this.db
      .selectFrom('held_sales')
      .selectAll()
      .where('id', '=', Number(draftId))
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!draft) {
      throw new AppError('الطلب المحفوظ غير موجود.', 'HELD_DRAFT_NOT_FOUND', 404);
    }
    if (String(draft.table_number).trim() === to) return draft;
    const occupant = await this.db
      .selectFrom('held_sales')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('table_number', '=', to)
      .where('id', '!=', Number(draftId))
      .executeTakeFirst();
    if (occupant) {
      throw new AppError(`الطاولة ${to} مشغولة بالفعل بطلب محفوظ.`, 'HELD_DRAFT_TABLE_OCCUPIED', 409);
    }
    const [renamed] = await this.db
      .updateTable('held_sales')
      .set({ table_number: to, updated_at: new Date() })
      .where('id', '=', Number(draftId))
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .execute();
    return renamed;
  }
}

/**
 * INV-REST-FNB-TRUTH-2 (R-I11): 86 enforcement, shared by both server
 * entry points (createSale, createOnlineOrder). An 86 row blocks the
 * product tenant-wide (branch_id null) or for its branch only; a row
 * with is_86ed false blocks nothing. Throws AppError ITEM_86ED 422
 * naming the first blocked item — the same shape as the R4-C
 * modifier contract errors — so the cashier/kiosk can remove that
 * line. Held drafts whose item becomes 86'd afterwards are rejected
 * at submit by the same check; the line is never silently dropped.
 */
export async function assertProductsNot86ed(
  queryable: Kysely<Database> | Transaction<Database>,
  tenantId: string,
  branchId: number | null | undefined,
  items: Array<{ productId: number | string; name?: string }>,
): Promise<void> {
  const ids = [...new Set(
    items
      .map((item) => Number(item.productId))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )];
  if (ids.length === 0) return;
  const rows = await queryable
    .selectFrom('restaurant_86_items')
    .select(['product_id', 'product_name'])
    .where('tenant_id', '=', tenantId)
    .where('is_86ed', '=', true)
    .where('product_id', 'in', ids)
    .where((eb) =>
      branchId
        ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)])
        : eb('branch_id', 'is', null),
    )
    .execute();
  if (rows.length === 0) return;
  const byId = new Map<number, string>();
  for (const row of rows) byId.set(Number(row.product_id), String(row.product_name || ''));
  for (const item of items) {
    const name = byId.get(Number(item.productId));
    if (name !== undefined) {
      throw new AppError(
        `الصنف [${name || item.name || item.productId}] غير متاح حالياً (86) — تم استبعاده من البيع`,
        'ITEM_86ED',
        422,
      );
    }
  }
}
