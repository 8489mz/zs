import { Injectable, Inject, Logger } from '@nestjs/common';
import { Database } from '../../../database/database.types';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, type Transaction } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import type {
  TenantScope,
  Toggle86ItemDto,
  CalculateTipPoolDto,
  SaveTableZoneDto,
  GeneratePrepSheetDto,
} from './restaurant-fnb/restaurant-fnb-types';
import type { TableLayoutItemDto } from '../dto/restaurant-fnb.dto';
export type {
  TenantScope,
  Toggle86ItemDto,
  CalculateTipPoolDto,
  SaveTableZoneDto,
  GeneratePrepSheetDto,
} from './restaurant-fnb/restaurant-fnb-types';
import { RestaurantFnbGates86Slice } from './restaurant-fnb/restaurant-fnb-gates-86';
import { RestaurantFnbTipsReadSlice } from './restaurant-fnb/restaurant-fnb-tips-read';
import { RestaurantFnbTipsCreateSlice } from './restaurant-fnb/restaurant-fnb-tips-create';
import { RestaurantFnbConfirmZonesSlice } from './restaurant-fnb/restaurant-fnb-confirm-zones';
import { RestaurantFnbPrepSlice } from './restaurant-fnb/restaurant-fnb-prep';
import { RestaurantFnbStampsCostingSlice } from './restaurant-fnb/restaurant-fnb-stamps-costing';
import { RestaurantFnbManagerCompSlice } from './restaurant-fnb/restaurant-fnb-manager-comp';
import { RestaurantFnbRatingsDriveThruSlice } from './restaurant-fnb/restaurant-fnb-ratings-drive-thru';
import { RestaurantFnbUpsellLayoutsSlice } from './restaurant-fnb/restaurant-fnb-upsell-layouts';

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
  private readonly upsellLayouts: RestaurantFnbUpsellLayoutsSlice;

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
    this.managerComp = new RestaurantFnbManagerCompSlice(
      this.db,
      this.assertManagerCaller.bind(this),
      this.resolveCompAccount.bind(this),
      this.accountingPosting,
    );
    this.ratingsDriveThru = new RestaurantFnbRatingsDriveThruSlice(this.db);
    this.upsellLayouts = new RestaurantFnbUpsellLayoutsSlice(this.db, this.assertManagerCaller.bind(this));
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

  async recordManagerComp(
    scope: TenantScope,
    dto: {
      saleId?: number;
      tableNumber?: string;
      compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
      managerName: string;
      managerPin?: string;
      amount: number;
      itemsSummary?: string;
      notes?: string;
    },
  ) {
    return this.managerComp.recordManagerComp(scope, dto);
  }

  async recordTableRating(
    scope: TenantScope,
    dto: {
      tableNumber: string;
      saleId?: number;
      rating: number;
      feedbackCategory?: string;
      notes?: string;
    },
  ) {
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

  async createDriveThruOrder(
    scope: TenantScope,
    dto: {
      vehiclePlate: string;
      vehicleDesc?: string;
      totalAmount?: number;
      notes?: string;
    },
  ) {
    return this.ratingsDriveThru.createDriveThruOrder(scope, dto);
  }

  async updateDriveThruStatus(
    scope: TenantScope,
    id: number,
    status: 'order_taken' | 'at_window' | 'completed' | 'cancelled',
  ) {
    return this.ratingsDriveThru.updateDriveThruStatus(scope, id, status);
  }

  async getUpsellRecommendations(scope: TenantScope, triggerProductId?: number, categoryName?: string) {
    return this.upsellLayouts.getUpsellRecommendations(scope, triggerProductId, categoryName);
  }

  async createUpsellRule(
    scope: TenantScope,
    dto: {
      triggerProductId?: number;
      triggerCategoryName?: string;
      suggestedProductId: number;
      suggestedProductName: string;
      title: string;
      discountAmount?: number;
    },
  ) {
    return this.upsellLayouts.createUpsellRule(scope, dto);
  }

  async getTableLayouts(scope: TenantScope, branchId?: number | null) {
    return this.upsellLayouts.getTableLayouts(scope, branchId);
  }

  async saveTableLayouts(
    scope: TenantScope,
    // D5: the parameter type is the DTO item type, not the old
    // inline shape that declared table_number / x_pos / y_pos
    // required. The body tolerates their absence (a missing
    // table_number skips the item; missing coordinates default
    // to 10), so the type now says what the body does. Type-only
    // change — behaviour unchanged.
    layouts: TableLayoutItemDto[],
    branchId?: number | null,
  ) {
    return this.upsellLayouts.saveTableLayouts(scope, layouts, branchId);
  }

  async deleteTableLayout(scope: TenantScope, id: number) {
    return this.upsellLayouts.deleteTableLayout(scope, id);
  }

  async renameHeldDraftTable(scope: TenantScope, draftId: number, toTableNumber: string) {
    return this.upsellLayouts.renameHeldDraftTable(scope, draftId, toTableNumber);
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
  const ids = [
    ...new Set(items.map((item) => Number(item.productId)).filter((id) => Number.isSafeInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return;
  const rows = await queryable
    .selectFrom('restaurant_86_items')
    .select(['product_id', 'product_name'])
    .where('tenant_id', '=', tenantId)
    .where('is_86ed', '=', true)
    .where('product_id', 'in', ids)
    .where((eb) =>
      branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null),
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
