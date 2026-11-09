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

export interface TenantScope {
  tenantId: string;
  branchId?: number | null;
  userId?: number | null;
  // INV-REST-FNB-CLAIMS-POST: the comp/tip gates need the caller's identity.
  // accountId is the tenant account scope the journal posts under; role /
  // permissions are the caller's own, read from the session — never from
  // the request body. The controller forwards them from req.authContext.
  accountId?: string | null;
  role?: string | null;
  permissions?: string[];
}

export interface Toggle86ItemDto {
  productId: number;
  productName: string;
  componentProductId?: number | null;
  is86ed: boolean;
  reason?: string;
  autoRestoreHours?: number;
}

export interface CalculateTipPoolDto {
  shiftDate: string;
  shiftName?: string;
  totalCashTips?: number;
  totalCardTips?: number;
  distributionMethod: 'roles' | 'hours' | 'equal';
  staff: {
    employeeId: number;
    employeeName: string;
    roleName: string;
    hoursWorked: number;
    pointWeight?: number;
  }[];
  notes?: string;
}

export interface SaveTableZoneDto {
  id?: number;
  zoneCode: string;
  name: string;
  sortOrder?: number;
  capacitySeats?: number;
  tableNumbers: string[];
  minimumSpend?: number;
}

export interface GeneratePrepSheetDto {
  prepDate: string;
  shiftType?: 'morning' | 'evening' | 'night';
  notes?: string;
  items?: {
    productId: number;
    productName: string;
    unitName: string;
    parLevel: number;
  }[];
}

@Injectable()
export class RestaurantAdvancedFnbService {
  private readonly logger = new Logger(RestaurantAdvancedFnbService.name);

  // The posting service is optional ONLY so existing direct constructions
  // (d6c-misc-book-digits.spec.ts builds the service with the db alone to
  // test tip splits) keep compiling: Nest always injects it, and the sale
  // comp path refuses to post without it (FNB_POSTING_UNAVAILABLE below)
  // instead of crashing on an undefined call.
  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<Database>,
    private readonly accountingPosting?: AccountingPostingService,
  ) {}

  /**
   * INV-REST-FNB-CLAIMS-POST: the manager gate for the comp/tip endpoints.
   * The caller must BE a manager by the same definition the POS uses for
   * its manager tiles (isManager = admin role, or the pos_manager /
   * manage_restaurant permission). A PermissionsGuard decorator alone
   * cannot express this: the guard checks permission strings only, and
   * SUPER_ADMIN_PERMISSIONS does not contain pos_manager /
   * manage_restaurant, so a decorator would lock out tenant admins while
   * the UI still shows them as managers. The verified manager PIN (checked
   * separately via authorizeManagerSecret) is the approval second factor —
   * it proves a manager approved, it does not make the caller a manager.
   */
  private assertManagerCaller(scope: TenantScope): void {
    const role = String(scope.role || '');
    const permissions = scope.permissions ?? [];
    const isManager =
      role === 'admin' ||
      role === 'super_admin' ||
      permissions.includes('pos_manager') ||
      permissions.includes('manage_restaurant');
    if (!isManager) {
      throw new AppError('هذا الإجراء يتطلب صلاحية مدير', 'MANAGER_PERMISSION_REQUIRED', 403);
    }
  }

  /**
   * INV-REST-FNB-CLAIMS-POST: resolve an accounting account the way
   * postSale does — the tenant's configured account when it exists and is
   * active, otherwise the canonical account code. Mirrors
   * AccountingPostingService.resolveAccountWithFallback, which is private.
   */
  private async resolveCompAccount(
    queryable: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    if (configuredId && Number(configuredId) > 0) {
      const configured = await queryable
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(configuredId))
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (configured) return Number(configured.id);
    }
    const fallback = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', fallbackCode)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (fallback) return Number(fallback.id);
    throw new AppError(
      `حساب الضيافة (${fallbackCode}) غير موجود أو غير مفعّل لهذا المستأجر`,
      'COMP_ACCOUNT_NOT_FOUND',
      409,
    );
  }

  // ==========================================
  // 1. FAST 86 ENGINE (OUT-OF-STOCK TOGGLE)
  // ==========================================

  async get86Items(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_86_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_86ed', '=', true);

    if (branchId) {
      query = query.where((eb) =>
        eb.or([
          eb('branch_id', '=', branchId),
          eb('branch_id', 'is', null),
        ])
      );
    }

    const items = await query.orderBy('updated_at', 'desc').execute();
    return items;
  }

  async toggle86Item(scope: TenantScope, dto: Toggle86ItemDto) {
    if (!dto.productId) {
      throw new AppError('معرف المنتج مطلوب لتحديث حالة الاستبعاد', 'INVALID_PRODUCT_ID', 400);
    }

    const existing = await this.db
      .selectFrom('restaurant_86_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', dto.productId)
      .executeTakeFirst();

    const autoRestoreAt = dto.autoRestoreHours && dto.autoRestoreHours > 0
      ? new Date(Date.now() + dto.autoRestoreHours * 3600 * 1000)
      : null;

    if (existing) {
      await this.db
        .updateTable('restaurant_86_items')
        .set({
          is_86ed: dto.is86ed,
          reason: dto.reason || (dto.is86ed ? 'نفاد الكمية' : null),
          auto_restore_at: autoRestoreAt,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();

      return {
        success: true,
        productId: dto.productId,
        is86ed: dto.is86ed,
        message: dto.is86ed
          ? `تم استبعاد الصنف [${dto.productName || existing.product_name}] ووسمه بـ 86 بنجاح`
          : `تمت إعادة إتاحة الصنف [${dto.productName || existing.product_name}] للبيع بنجاح`,
      };
    } else {
      await this.db
        .insertInto('restaurant_86_items')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          product_id: dto.productId,
          product_name: dto.productName || `صنف #${dto.productId}`,
          component_product_id: dto.componentProductId || null,
          is_86ed: dto.is86ed,
          reason: dto.reason || 'نفاد الكمية',
          auto_restore_at: autoRestoreAt,
          created_by: scope.userId || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      return {
        success: true,
        productId: dto.productId,
        is86ed: dto.is86ed,
        message: `تم استبعاد الصنف ووسمه بـ 86 فورياً`,
      };
    }
  }

  // ==========================================
  // 2. TIP POOLING & SHIFT DISTRIBUTION ENGINE
  // ==========================================

  async getTipPools(scope: TenantScope, shiftDate?: string) {
    let query = this.db
      .selectFrom('restaurant_tip_pools')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId);

    if (shiftDate) {
      query = query.where('shift_date', '=', shiftDate);
    }

    const pools = await query.orderBy('created_at', 'desc').limit(30).execute();

    const poolIds = pools.map((p) => p.id);
    let distributions: any[] = [];
    if (poolIds.length > 0) {
      distributions = await this.db
        .selectFrom('restaurant_tip_pool_distributions')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('pool_id', 'in', poolIds)
        .execute();
    }

    const distMap = new Map<number, any[]>();
    for (const d of distributions) {
      if (!distMap.has(d.pool_id)) distMap.set(d.pool_id, []);
      distMap.get(d.pool_id)!.push(d);
    }

    return pools.map((p) => ({
      ...p,
      distributions: distMap.get(p.id) || [],
    }));
  }

  async calculateAndSaveTipPool(scope: TenantScope, dto: CalculateTipPoolDto) {
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may create a pool.
    this.assertManagerCaller(scope);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shiftDate = dto.shiftDate || (await resolveBusinessDateKey(this.db, scope.tenantId, new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      throw new AppError('تاريخ الوردية يجب أن يكون بصيغة YYYY-MM-DD', 'INVALID_SHIFT_DATE', 400);
    }
    const cashTips = roundMoney(Number(dto.totalCashTips || 0), moneyDigits);
    const cardTips = roundMoney(Number(dto.totalCardTips || 0), moneyDigits);
    const totalTips = roundMoney(cashTips + cardTips, moneyDigits);

    if (totalTips <= 0) {
      throw new AppError('إجمالي مجمع الإكراميات يجب أن يكون أكبر من الصفر', 'INVALID_TIP_AMOUNT', 400);
    }

    if (!dto.staff || dto.staff.length === 0) {
      throw new AppError('يجب تحديد موظف واحد على الأقل لتوزيع الإكراميات', 'NO_STAFF_SELECTED', 400);
    }

    // INV-REST-FNB-CLAIMS-POST: one pool per branch + shift date. A second
    // pool for the same shift would distribute the same tips twice. A
    // cancelled pool does not block a fresh one.
    const branchId = scope.branchId || null;
    let duplicateQuery = this.db
      .selectFrom('restaurant_tip_pools')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('shift_date', '=', shiftDate)
      .where('status', 'in', ['draft', 'distributed']);
    duplicateQuery = branchId
      ? duplicateQuery.where('branch_id', '=', branchId)
      : duplicateQuery.where('branch_id', 'is', null);
    const duplicate = await duplicateQuery.executeTakeFirst();
    if (duplicate) {
      throw new AppError(
        'يوجد مجمع إكراميات بالفعل لنفس الفرع وتاريخ الوردية',
        'TIP_POOL_EXISTS',
        409,
      );
    }

    // INV-REST-FNB-CLAIMS-POST: every recipient must be a real, active
    // employee of this tenant — a hardcoded id or a Date.now() id is not a
    // person. The id is the validated identity; the name/role travel with
    // the shift roster as submitted.
    const employeeIds = dto.staff.map((m) => Number(m.employeeId || 0));
    if (employeeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AppError('كل موظف في التوزيع يجب أن يكون له معرف موظف صحيح', 'UNKNOWN_EMPLOYEE', 422);
    }
    if (new Set(employeeIds).size !== employeeIds.length) {
      throw new AppError('لا يمكن تكرار نفس الموظف في توزيع واحد', 'DUPLICATE_EMPLOYEE', 400);
    }
    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', employeeIds)
      .where('status', '=', 'active')
      .execute();
    if (employees.length !== employeeIds.length) {
      const found = new Set(employees.map((e) => Number(e.id)));
      const missing = employeeIds.find((id) => !found.has(id));
      throw new AppError(
        `الموظف رقم ${missing} غير موجود أو غير نشط لدى هذه المنشأة`,
        'UNKNOWN_EMPLOYEE',
        422,
      );
    }

    // INV-REST-FNB-CLAIMS-POST: the pool distributes ONLY the tips the
    // branch actually collected on that business day — posted, non-credit
    // sales whose tenant-local business date is the shift date. A credit
    // sale's tip is a receivable, not collected money, so it is excluded.
    // The cash/card split is recorded as stated; the reconciled figure is
    // the TOTAL, within one minor unit. An invented total fails here and
    // no pool row is created.
    const actualTips = await this.sumCollectedTips(this.db, scope, shiftDate);
    const tolerance = Math.pow(10, -moneyDigits);
    if (Math.abs(totalTips - actualTips) > tolerance) {
      throw new AppError(
        `إجمالي الإكراميات المُدخل (${totalTips}) لا يطابق الإكراميات المحصّلة فعلياً لذلك الفرع والوردية (${actualTips})`,
        'TIP_TOTAL_MISMATCH',
        422,
      );
    }

    // Role default weights if method is 'roles'
    const roleWeights: Record<string, number> = {
      waiter: 1.2,
      captain: 1.5,
      barista: 1.0,
      kitchen: 0.8,
      cashier: 0.8,
      runner: 0.6,
    };

    // Calculate distribution allocations
    let totalScore = 0;
    const computedStaff = dto.staff.map((member) => {
      let weight = member.pointWeight && member.pointWeight > 0 ? member.pointWeight : 1;
      if (dto.distributionMethod === 'roles') {
        weight = roleWeights[member.roleName.toLowerCase()] || 1;
      } else if (dto.distributionMethod === 'equal') {
        weight = 1;
      }

      const hours = member.hoursWorked && member.hoursWorked > 0 ? member.hoursWorked : 8;
      const score = dto.distributionMethod === 'equal' ? 1 : weight * (dto.distributionMethod === 'hours' ? hours : 1);
      totalScore += score;

      return {
        ...member,
        hoursWorked: hours,
        weight,
        score,
      };
    });

    if (totalScore <= 0) totalScore = 1;

    let allocatedSum = 0;
    const distributions = computedStaff.map((member, idx) => {
      // Last person gets the remainder to avoid 0.01 currency rounding discrepancies
      let amount = roundMoney((member.score / totalScore) * totalTips, moneyDigits);
      allocatedSum += amount;
      if (idx === computedStaff.length - 1) {
        const delta = roundMoney(totalTips - allocatedSum, moneyDigits);
        amount = roundMoney(amount + delta, moneyDigits);
      }
      return {
        ...member,
        allocatedAmount: Math.max(0, amount),
      };
    });

    // Save pool header
    const [insertedPool] = await this.db
      .insertInto('restaurant_tip_pools')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        shift_date: shiftDate,
        shift_name: dto.shiftName || 'وردية العمل',
        total_cash_tips: cashTips,
        total_card_tips: cardTips,
        total_tips: totalTips,
        distribution_method: dto.distributionMethod,
        status: 'draft',
        notes: dto.notes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    // Insert distribution lines
    for (const dist of distributions) {
      await this.db
        .insertInto('restaurant_tip_pool_distributions')
        .values({
          tenant_id: scope.tenantId,
          pool_id: insertedPool.id,
          employee_id: dist.employeeId,
          employee_name: dist.employeeName,
          role_name: dist.roleName,
          hours_worked: dist.hoursWorked,
          point_weight: dist.weight,
          allocated_amount: dist.allocatedAmount,
          is_paid: false,
          created_at: new Date(),
        })
        .execute();
    }

    return {
      pool: insertedPool,
      distributions,
      totalTips,
      actualTips,
    };
  }

  /**
   * INV-REST-FNB-CLAIMS-POST: the tips a branch actually collected on one
   * tenant-local business day — the sum of tip_amount over posted,
   * non-credit sales whose created_at falls on that day in the tenant's
   * timezone (settings key 'timezone', default Africa/Cairo). Drafts never
   * collected anything and cancelled sales collected nothing, so both are
   * excluded; a credit sale's tip is a receivable, not collected money.
   */
  private async sumCollectedTips(
    queryable: Kysely<Database> | Transaction<Database>,
    scope: TenantScope,
    shiftDate: string,
  ): Promise<number> {
    const timeZone = await getTenantTimezone(queryable as Kysely<Database>, scope.tenantId);
    const branchId = scope.branchId || null;
    const row = await sql<{ actual: string }>`
      SELECT COALESCE(SUM(tip_amount), 0) AS actual FROM sales
      WHERE tenant_id = ${scope.tenantId}
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      AND status = 'posted'
      AND payment_type <> 'credit'
      AND to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') = ${shiftDate}
    `.execute(queryable);
    return Number(row.rows?.[0]?.actual || 0);
  }

  async confirmTipDistribution(scope: TenantScope, poolId: number) {
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may confirm a pool.
    this.assertManagerCaller(scope);
    const pool = await this.db
      .selectFrom('restaurant_tip_pools')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', poolId)
      .executeTakeFirst();

    if (!pool) {
      throw new AppError('مجمع الإكراميات غير موجود', 'POOL_NOT_FOUND', 404);
    }

    // INV-REST-FNB-CLAIMS-POST: confirm is an APPROVAL, not a payout. An
    // already-distributed pool cannot be confirmed again — confirming twice
    // used to re-mark the same tips paid. And the distribution rows stay
    // unpaid (is_paid false, paid_at null) until a real payout moves the
    // money; the old code flipped them to paid with no journal, no cash
    // movement and no payroll link while the message claimed "صرف".
    if (pool.status === 'distributed') {
      throw new AppError('مجمع الإكراميات معتمَد بالفعل ولا يمكن اعتماده مرة أخرى', 'POOL_ALREADY_DISTRIBUTED', 409);
    }
    if (pool.status === 'cancelled') {
      throw new AppError('مجمع الإكراميات ملغى ولا يمكن اعتماده', 'POOL_CANCELLED', 409);
    }

    await this.db
      .updateTable('restaurant_tip_pools')
      .set({
        status: 'distributed',
        distributed_by: scope.userId || null,
        distributed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', poolId)
      .execute();

    return {
      success: true,
      payoutPending: true,
      message: 'تم اعتماد توزيع الإكراميات على طاقم الوردية؛ الصرف معلّق حتى تنفيذ الدفع الفعلي للموظفين',
    };
  }

  // ==========================================
  // 3. MULTI-ZONE FLOOR PLAN & ZONES
  // ==========================================

  async getZones(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_table_zones')
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

    const zones = await query.orderBy('sort_order', 'asc').execute();

    // If tenant has no custom zones yet, provide clean initial industry presets
    if (zones.length === 0) {
      return [
        { id: 1, zone_code: 'main', name: 'الصالة الرئيسية', sort_order: 1, capacity_seats: 4, table_numbers: ['1', '2', '3', '4', '5', '6'] },
        { id: 2, zone_code: 'patio', name: 'التراس الخارجي', sort_order: 2, capacity_seats: 4, table_numbers: ['7', '8', '9', '10'] },
        { id: 3, zone_code: 'family', name: 'قسم العائلات', sort_order: 3, capacity_seats: 6, table_numbers: ['11', '12', '13', '14'] },
        { id: 4, zone_code: 'vip', name: 'جناح الـ VIP', sort_order: 4, capacity_seats: 8, table_numbers: ['15', '16'] },
      ];
    }

    return zones;
  }

  async saveZone(scope: TenantScope, dto: SaveTableZoneDto) {
    if (!dto.name || !dto.zoneCode) {
      throw new AppError('اسم وكود المنطقة مطلوبان', 'INVALID_ZONE_DATA', 400);
    }

    if (dto.id) {
      await this.db
        .updateTable('restaurant_table_zones')
        .set({
          name: dto.name,
          zone_code: dto.zoneCode,
          sort_order: dto.sortOrder || 0,
          capacity_seats: dto.capacitySeats || 4,
          table_numbers: JSON.stringify(dto.tableNumbers || []),
          minimum_spend: dto.minimumSpend !== undefined ? dto.minimumSpend : 0,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', dto.id)
        .execute();

      return { success: true, message: 'تم تحديث منطقة الصالة بنجاح' };
    } else {
      const [inserted] = await this.db
        .insertInto('restaurant_table_zones')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          zone_code: dto.zoneCode,
          name: dto.name,
          sort_order: dto.sortOrder || 0,
          capacity_seats: dto.capacitySeats || 4,
          table_numbers: JSON.stringify(dto.tableNumbers || []),
          minimum_spend: dto.minimumSpend || 0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .execute();

      return { success: true, zone: inserted, message: 'تم إنشاء منطقة الصالة بنجاح' };
    }
  }

  // ==========================================
  // 4. CENTRAL PREP KITCHEN & DAILY PREP SHEETS
  // ==========================================

  async getPrepSheets(scope: TenantScope, prepDate?: string) {
    let query = this.db
      .selectFrom('restaurant_prep_sheets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId);

    if (prepDate) {
      query = query.where('prep_date', '=', prepDate);
    }

    const sheets = await query.orderBy('created_at', 'desc').limit(15).execute();
    const sheetIds = sheets.map((s) => s.id);

    let items: any[] = [];
    if (sheetIds.length > 0) {
      items = await this.db
        .selectFrom('restaurant_prep_sheet_items')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('prep_sheet_id', 'in', sheetIds)
        .execute();
    }

    const itemsMap = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsMap.has(item.prep_sheet_id)) itemsMap.set(item.prep_sheet_id, []);
      itemsMap.get(item.prep_sheet_id)!.push(item);
    }

    return sheets.map((s) => ({
      ...s,
      items: itemsMap.get(s.id) || [],
    }));
  }

  async generateDailyPrepSheet(scope: TenantScope, dto: GeneratePrepSheetDto) {
    const prepDate = dto.prepDate || (await resolveBusinessDateKey(this.db, scope.tenantId, new Date()));

    // Create header
    const [sheet] = await this.db
      .insertInto('restaurant_prep_sheets')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        prep_date: prepDate,
        shift_type: dto.shiftType || 'morning',
        status: 'in_progress',
        prepared_by: scope.userId || null,
        notes: dto.notes || null,
        created_at: new Date(),
      })
      .returningAll()
      .execute();

    // Default prep templates if no items passed
    const prepItems = dto.items && dto.items.length > 0
      ? dto.items
      : [
          { productId: 101, productName: 'تتبيل شاورما ولحم البرجر', unitName: 'كجم', parLevel: 25 },
          { productId: 102, productName: 'تحضير صوص الثومية والباربيكيو', unitName: 'لتر', parLevel: 15 },
          { productId: 103, productName: 'تقطيع بطاطس وخضار السلطة', unitName: 'كجم', parLevel: 30 },
          { productId: 104, productName: 'عجين البيتزا والمخبوزات', unitName: 'قطعة', parLevel: 50 },
          { productId: 105, productName: 'تجهيز صوص الشوكولاتة والكراميل', unitName: 'لتر', parLevel: 8 },
        ];

    const insertedItems = [];
    for (const item of prepItems) {
      const parLevel = Number(item.parLevel || 10);
      const onHand = 0; // can fetch live stock if available
      const prepRequired = Math.max(0, parLevel - onHand);

      const [row] = await this.db
        .insertInto('restaurant_prep_sheet_items')
        .values({
          tenant_id: scope.tenantId,
          prep_sheet_id: sheet.id,
          product_id: item.productId,
          product_name: item.productName,
          unit_name: item.unitName || 'كجم',
          par_level: parLevel,
          current_on_hand: onHand,
          prep_required: prepRequired,
          prep_actual: 0,
          status: 'pending',
          updated_at: new Date(),
        })
        .returningAll()
        .execute();

      insertedItems.push(row);
    }

    return { sheet, items: insertedItems };
  }

  async recordPrepProduction(scope: TenantScope, itemId: number, actualQty: number) {
    const item = await this.db
      .selectFrom('restaurant_prep_sheet_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', itemId)
      .executeTakeFirst();

    if (!item) {
      throw new AppError('بند ورقة التحضير غير موجود', 'PREP_ITEM_NOT_FOUND', 404);
    }

    await this.db
      .updateTable('restaurant_prep_sheet_items')
      .set({
        prep_actual: actualQty,
        status: actualQty >= Number(item.prep_required) ? 'prepped' : 'pending',
        updated_at: new Date(),
      })
      .where('id', '=', itemId)
      .execute();

    return {
      success: true,
      message: `تم تسجيل تحضير ${actualQty} ${item.unit_name} من [${item.product_name}] بنجاح`,
    };
  }

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
      const costInflationPct = standardCost > 0
        ? Number((((liveCost - standardCost) / standardCost) * 100).toFixed(1))
        : 0;

      const currentMarginPct = sellingPrice > 0
        ? Number((((sellingPrice - liveCost) / sellingPrice) * 100).toFixed(1))
        : 0;

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
      const approval = await authorizeManagerSecret(
        trx,
        { tenantId: scope.tenantId, accountId } as AuthContext,
        dto.managerPin ?? '',
      );

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
