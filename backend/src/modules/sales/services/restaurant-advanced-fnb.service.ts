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






@Injectable()
export class RestaurantAdvancedFnbService {
  private readonly logger = new Logger(RestaurantAdvancedFnbService.name);
  private readonly gates86: RestaurantFnbGates86Slice;
  private readonly tipsReadSlice: RestaurantFnbTipsReadSlice;
  private readonly tipsCreate: RestaurantFnbTipsCreateSlice;
  private readonly confirmZones: RestaurantFnbConfirmZonesSlice;
  private readonly prep: RestaurantFnbPrepSlice;
  private readonly stampsCosting: RestaurantFnbStampsCostingSlice;

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
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may record a comp.
    this.assertManagerCaller(scope);
    const compTypes = ['vip_guest', 'customer_complaint', 'staff_meal', 'promotional_tasting'] as const;
    if (!compTypes.includes(dto.compType as (typeof compTypes)[number])) {
      throw new AppError('نوع الضيافة غير معروف', 'INVALID_COMP_TYPE', 400);
    }
    if (!dto.amount || Number(dto.amount) <= 0) {
      throw new AppError('مبلغ الضيافة يجب أن يكون أكبر من الصفر', 'INVALID_COMP_AMOUNT', 400);
    }

    const accountId = String(scope.accountId || '').trim();
    if (!accountId) {
      throw new AppError('Tenant/account scope is required', 'TENANT_SCOPE_REQUIRED', 403);
    }

    // The comp row and its journal commit or roll back together.
    return this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const amount = roundMoney(Number(dto.amount), moneyDigits);
      if (amount <= 0) {
        throw new AppError('مبلغ الضيافة يجب أن يكون أكبر من الصفر', 'INVALID_COMP_AMOUNT', 400);
      }

      // INV-REST-FNB-CLAIMS-POST: the PIN the modal collects is actually
      // checked — via the one shared authorizeManagerSecret (PIN or an
      // active admin's login password; R3-D stores the PIN hashed). The
      // recorded manager is the VERIFIED approver it returns, never the
      // client-supplied free-text name.
      const isAdminCaller = String(scope.role || '') === 'admin' || String(scope.role || '') === 'super_admin';
      const cleanPin = String(dto.managerPin || '').trim();
      const approval = (!isAdminCaller || cleanPin)
        ? await authorizeManagerSecret(
            trx,
            { tenantId: scope.tenantId, accountId } as AuthContext,
            cleanPin,
          )
        : {
            mode: 'account' as const,
            authorizedById: Number(scope.userId || 0) || undefined,
            authorizedByName: String(scope.username || 'المدير'),
          };

      // INV-REST-FNB-CLAIMS-POST: a comp on a named sale posts against a
      // REAL, POSTED sale of this tenant only. The sale must already have
      // a journal (its receivable exists in the GL); a draft or an
      // unposted sale has no receivable to credit, so a comp on it is
      // refused — apply the comp to the cart before checkout instead.
      // The amount may not exceed what the customer still owes after
      // earlier posted comps on the same sale.
      let journalEntryId: number | null = null;
      let saleDocNo = '';
      if (dto.saleId) {
        const saleId = Number(dto.saleId);
        const sale = await trx
          .selectFrom('sales')
          .select(['id', 'doc_no', 'customer_id', 'total', 'paid_amount', 'store_credit_used', 'branch_id', 'location_id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', saleId)
          .executeTakeFirst();
        if (!sale) {
          throw new AppError('الفاتورة غير موجودة لدى هذه المنشأة', 'SALE_NOT_FOUND', 404);
        }
        const saleJournal = await trx
          .selectFrom('journal_entries')
          .select(['id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('source_type', '=', 'sale')
          .where('source_id', '=', saleId)
          .where('status', 'in', ['draft', 'posted'])
          .executeTakeFirst();
        if (!saleJournal) {
          throw new AppError(
            'الفاتورة لم تُرحَّل بعد؛ طبّق الضيافة على السلة قبل إتمام البيع',
            'SALE_NOT_POSTED',
            422,
          );
        }
        const priorCompRows = await trx
          .selectFrom('restaurant_manager_comps')
          .select(['id', 'amount'])
          .where('tenant_id', '=', scope.tenantId)
          .where('sale_id', '=', saleId)
          .execute();
        let priorPosted = 0;
        for (const row of priorCompRows) {
          const priorJournal = await trx
            .selectFrom('journal_entries')
            .select(['id'])
            .where('tenant_id', '=', scope.tenantId)
            .where('source_type', '=', 'manager_comp')
            .where('source_id', '=', Number(row.id))
            .where('status', '=', 'posted')
            .executeTakeFirst();
          if (priorJournal) priorPosted = roundMoney(priorPosted + Number(row.amount || 0), moneyDigits);
        }
        const remaining = roundMoney(
          Number(sale.total || 0) - Number(sale.paid_amount || 0) - Number(sale.store_credit_used || 0) - priorPosted,
          moneyDigits,
        );
        if (amount > remaining) {
          throw new AppError(
            `مبلغ الضيافة (${amount}) يتجاوز المتبقي على الفاتورة (${remaining})`,
            'COMP_EXCEEDS_RECEIVABLE',
            422,
          );
        }
        saleDocNo = String(sale.doc_no || sale.id);

        const [comp] = await trx
          .insertInto('restaurant_manager_comps')
          .values({
            tenant_id: scope.tenantId,
            branch_id: scope.branchId || null,
            sale_id: saleId,
            table_number: dto.tableNumber || null,
            comp_type: dto.compType,
            manager_name: approval.authorizedByName,
            amount,
            items_summary: dto.itemsSummary || null,
            notes: dto.notes || null,
            created_at: new Date(),
          })
          .returningAll()
          .execute();

        // INV-REST-FNB-CLAIMS-POST: the comp POSTS. A comp is a price
        // reduction on an already-posted sale, so it posts exactly the
        // discount leg postSale uses for a sale discount: debit the sales
        // discount account (settings sales_discount_account_id, fallback
        // code 4300), credit the customer receivable (settings
        // customer_receivable_account_id, fallback 1130). The journal is
        // the posting the old response claimed; the comp row and the
        // journal are linked by source_type 'manager_comp' + the comp id.
        const settings = await trx
          .selectFrom('accounting_settings')
          .select(['sales_discount_account_id', 'customer_receivable_account_id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', 1)
          .executeTakeFirst();
        const discountAccountId = await this.resolveCompAccount(
          trx,
          scope.tenantId,
          settings?.sales_discount_account_id ?? null,
          '4300',
        );
        const receivableAccountId = await this.resolveCompAccount(
          trx,
          scope.tenantId,
          settings?.customer_receivable_account_id ?? null,
          '1130',
        );
        const customerId = sale.customer_id ? Number(sale.customer_id) : null;
        if (!this.accountingPosting) {
          throw new AppError(
            'الضيافة على فاتورة مسجلة تحتاج خدمة الترحيل المحاسبي',
            'FNB_POSTING_UNAVAILABLE',
            500,
          );
        }
        journalEntryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'manager_comp',
          sourceId: Number(comp.id),
          tenantId: scope.tenantId,
          accountId,
          entryDate: new Date(),
          description: `ضيافة إدارة على الفاتورة ${saleDocNo} — ${dto.compType}`,
          branchId: sale.branch_id ? Number(sale.branch_id) : (scope.branchId || null),
          locationId: sale.location_id ? Number(sale.location_id) : null,
          createdBy: scope.userId || null,
          lines: [
            {
              accountId: discountAccountId,
              description: `ضيافة إدارة على الفاتورة ${saleDocNo}`,
              debit: amount,
              credit: 0,
              partnerType: 'none',
              partnerId: null,
              branchId: sale.branch_id ? Number(sale.branch_id) : null,
              locationId: sale.location_id ? Number(sale.location_id) : null,
            },
            {
              accountId: receivableAccountId,
              description: `تخفيض مديونية عميل بضيافة إدارة على الفاتورة ${saleDocNo}`,
              debit: 0,
              credit: amount,
              partnerType: customerId ? 'customer' : 'none',
              partnerId: customerId,
              branchId: sale.branch_id ? Number(sale.branch_id) : null,
              locationId: sale.location_id ? Number(sale.location_id) : null,
            },
          ],
        });

        return {
          success: true,
          comp,
          journalEntryId,
          message: `تم اعتماد وقيد ضيافة الإدارة بقيمة ${amount} على الفاتورة ${saleDocNo} بنجاح`,
        };
      }

      // INV-REST-FNB-CLAIMS-POST: no sale yet — this is the current-cart
      // authorization. There is no receivable to credit and no journal to
      // post against, so NO journal is posted here: the comp is recorded
      // as an approved authorization, and the discount posts with the
      // sale (the cart discount the POS applies, posted by postSale's
      // discount leg). Posting a journal now as well would count the same
      // discount twice. The response says exactly that — it never claims
      // a posting that did not happen.
      const [comp] = await trx
        .insertInto('restaurant_manager_comps')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          sale_id: null,
          table_number: dto.tableNumber || null,
          comp_type: dto.compType,
          manager_name: approval.authorizedByName,
          amount,
          items_summary: dto.itemsSummary || null,
          notes: dto.notes || null,
          created_at: new Date(),
        })
        .returningAll()
        .execute();

      return {
        success: true,
        comp,
        journalEntryId: null,
        message: `تم اعتماد ضيافة الإدارة بقيمة ${amount} وتسجيلها؛ يُرحَّل الخصم مع الفاتورة عند إتمام البيع`,
      };
    });
  }

  // ==========================================
  // 8. TABLE QR RATING & RESCUE ALERT ENGINE
  // ==========================================

  async recordTableRating(scope: TenantScope, dto: {
    tableNumber: string;
    saleId?: number;
    rating: number;
    feedbackCategory?: string;
    notes?: string;
  }) {
    if (!dto.tableNumber || !dto.rating) {
      throw new AppError('رقم الطاولة والتقييم مطلوبان', 'INVALID_RATING_DATA', 400);
    }

    const isNegative = dto.rating <= 2;

    const [rating] = await this.db
      .insertInto('restaurant_table_ratings')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        table_number: dto.tableNumber,
        sale_id: dto.saleId || null,
        rating: dto.rating,
        feedback_category: dto.feedbackCategory || 'food_quality',
        notes: dto.notes || null,
        is_rescued: false,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    // If customer rated <= 2 stars, instantly dispatch a high-priority rescue service call!
    if (isNegative) {
      await this.db
        .insertInto('restaurant_table_service_calls')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          table_number: dto.tableNumber,
          call_type: 'rescue',
          status: 'pending',
          created_at: new Date(),
        })
        .execute();
    }

    return {
      success: true,
      rating,
      isRescueAlertTriggered: isNegative,
      message: isNegative
        ? 'شكراً لملاحظاتك! مدير الصالة في طريقه إليك فوراً لحل أي إزعاج.'
        : 'شكراً لتقييمك الرائع! نتطلع لزيارتك القادمة.',
    };
  }

  async resolveRescueAlert(scope: TenantScope, ratingId: number, managerName: string) {
    // INV-REST-FLOOR-DESIGN-GATES (B2, decision): deliberately NOT
    // manager-gated. This only flips is_rescued on a guest rating with a
    // free-text managerName attribution — a service-recovery note, not a
    // floor-state or money write. The name is a label, not a verified
    // identity, and the staff member who actually soothed the guest is
    // the one who records it. Pinned by restaurant-floor-state.spec.ts
    // check (14).
    await this.db
      .updateTable('restaurant_table_ratings')
      .set({
        is_rescued: true,
        rescued_by: managerName,
      })
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', ratingId)
      .execute();

    return { success: true, message: 'تم توثيق حل وتدارك الموقف مع الضيف بنجاح' };
  }

  // ==========================================
  // 9. TABLE MINIMUM SPEND CALCULATION ENGINE
  // ==========================================

  calculateMinimumSpend(currentTotal: number, minimumSpend: number) {
    const validTotal = Math.max(0, Number(currentTotal || 0));
    const validMin = Math.max(0, Number(minimumSpend || 0));
    const hasDeficit = validMin > 0 && validTotal < validMin;
    const deficitAmount = hasDeficit ? Math.round((validMin - validTotal) * 100) / 100 : 0;
    const finalTotal = hasDeficit ? validMin : validTotal;

    return {
      hasDeficit,
      deficitAmount,
      minimumSpend: validMin,
      foodAndBeverageTotal: validTotal,
      finalTotal,
    };
  }

  // ==========================================
  // 10. DRIVE-THRU LANE & SPEED OF SERVICE (SOS)
  // ==========================================

  async getDriveThruOrders(scope: TenantScope) {
    const orders = await this.db
      .selectFrom('restaurant_drive_thru_orders')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    const now = Date.now();
    const enriched = orders.map((o) => {
      let currentSos = o.sos_seconds;
      if (!currentSos && o.order_time) {
        currentSos = Math.round((now - new Date(o.order_time).getTime()) / 1000);
      }
      return {
        ...o,
        liveSosSeconds: currentSos,
        sosSeverity: (currentSos || 0) < 90 ? 'normal' : (currentSos || 0) <= 180 ? 'warning' : 'critical',
      };
    });

    const completedWithSos = orders.filter((o) => o.status === 'completed' && o.sos_seconds);
    const avgSosSeconds = completedWithSos.length > 0
      ? Math.round(completedWithSos.reduce((sum, o) => sum + (o.sos_seconds || 0), 0) / completedWithSos.length)
      : 0;

    return {
      orders: enriched,
      activeCount: enriched.filter((o) => o.status === 'order_taken' || o.status === 'at_window').length,
      averageSosSeconds: avgSosSeconds,
    };
  }

  async createDriveThruOrder(scope: TenantScope, dto: {
    vehiclePlate: string;
    vehicleDesc?: string;
    totalAmount?: number;
    notes?: string;
  }) {
    if (!dto.vehiclePlate) {
      throw new AppError('رقم لوحة السيارة مطلوب', 'VEHICLE_PLATE_REQUIRED', 400);
    }

    const [order] = await this.db
      .insertInto('restaurant_drive_thru_orders')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        vehicle_plate: dto.vehiclePlate,
        vehicle_desc: dto.vehicleDesc || null,
        status: 'order_taken',
        order_time: new Date(),
        total_amount: dto.totalAmount || 0,
        notes: dto.notes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    return { success: true, order, message: 'تم إدراج سيارة جديدة في مسار طلبات السيارات' };
  }

  async updateDriveThruStatus(scope: TenantScope, id: number, status: 'order_taken' | 'at_window' | 'completed' | 'cancelled') {
    const existing = await this.db
      .selectFrom('restaurant_drive_thru_orders')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new AppError('طلب مسار السيارات غير موجود', 'DRIVE_THRU_NOT_FOUND', 404);
    }

    const now = new Date();
    const updatePayload: any = {
      status,
      updated_at: now,
    };

    if (status === 'at_window' && !existing.window_arrival_time) {
      updatePayload.window_arrival_time = now;
    } else if (status === 'completed') {
      updatePayload.completed_time = now;
      const startMs = new Date(existing.order_time).getTime();
      updatePayload.sos_seconds = Math.round((now.getTime() - startMs) / 1000);
    }

    await this.db
      .updateTable('restaurant_drive_thru_orders')
      .set(updatePayload)
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .execute();

    return {
      success: true,
      message: status === 'completed'
        ? `تم تسليم الطلب وخروج السيارة من المسار (${updatePayload.sos_seconds || 0} ثانية)`
        : 'تم تحديث حالة السيارة في المسار بنجاح',
    };
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
