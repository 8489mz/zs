import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql, type Transaction, type Selectable } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  couponBoundInstant,
  couponDayState,
  getTenantTimezone,
  todayTenantDate,
} from '../../../common/utils/tenant-timezone.util';
import { CreateCouponDto, UpdateCouponDto } from '../dto/coupon.dto';
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from '../dto/delivery-zone.dto';
import { roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { storefrontMoneyDigits } from '../storefront-helpers';

/**
 * StorefrontCouponsService — slice T8 of the storefront split.
 * Pure move of 11 methods from StorefrontService (claimCouponUse,
 * releaseCouponUse, validateCoupon, listCoupons, createCoupon,
 * updateCoupon, deleteCoupon, listDeliveryZones, createDeliveryZone,
 * updateDeliveryZone, deleteDeliveryZone). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures for the 10 public methods.
 * Deps: db + the facade kernel fns getTenantBySlug / getTenantSettingsMap
 * (bound deps — the moved text calls this.getTenantBySlug /
 * this.getTenantSettingsMap byte-identically). claimCouponUse was
 * private in the facade and is PUBLIC here (its callers are the T2/T3/T4
 * slices, which call it through their bound couponsService dep; the
 * facade keeps NO delegate for it by design). Clock: coupon reads use
 * couponDayState + todayTenantDate, coupon writes use couponBoundInstant
 * — whole tenant days, never instants (NEW-I); the tenant-tz argument
 * travels with each method, byte-identical. This slice also creates
 * storefront-helpers.ts (the 8 free functions) — it is the first merge.
 */

export interface StorefrontCouponsDeps {
  db: Kysely<Database>;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
}

@Injectable()
export class StorefrontCouponsService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;

  constructor(deps: StorefrontCouponsDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
  }

  /** Atomic conditional claim of one coupon use (lost-update safe, enforces usage_limit on the live row). */
  async claimCouponUse(trx: Transaction<Database>, tenantId: string, couponId: number): Promise<void> {
    const claim = await trx
      .updateTable('storefront_coupons')
      .set({ times_used: sql`times_used + 1`, updated_at: new Date() })
      .where('id', '=', couponId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where(sql<boolean>`(usage_limit IS NULL OR times_used < usage_limit)`)
      .executeTakeFirst();
    if (Number(claim?.numUpdatedRows || 0) === 0) {
      throw new BadRequestException('تم استنفاد عدد مرات استخدام كوبون الخصم.');
    }
  }

  /** Gives back a use claimed by an order that no longer carries that coupon (edit swapped/removed it). */
  async releaseCouponUse(trx: Transaction<Database>, tenantId: string, couponCode: string): Promise<void> {
    await trx
      .updateTable('storefront_coupons')
      .set({ times_used: sql`GREATEST(times_used - 1, 0)`, updated_at: new Date() })
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('code', '=', couponCode.toUpperCase())
      .execute();
  }

  // --- Coupon & Promo Code Management ---

  async validateCoupon(slug: string, code: string, subtotal: number) {
    const tenant = await this.getTenantBySlug(slug);
    const codeUpper = String(code || '')
      .trim()
      .toUpperCase();
    if (!codeUpper) {
      throw new BadRequestException('يرجى إدخال كود الكوبون');
    }

    const coupon = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('code', '=', codeUpper)
      .executeTakeFirst();

    if (!coupon) {
      return { ok: false, message: 'كود الكوبون غير صحيح أو غير مسجل' };
    }

    if (!coupon.is_active) {
      return { ok: false, message: 'هذا الكوبون تم إيقافه حالياً من قِبل المتجر' };
    }

    // Coupon bounds are whole tenant days, never instants (NEW-I).
    const couponTimezone = await getTenantTimezone(this.db, tenant.id);
    const couponTodayKey = todayTenantDate(couponTimezone);
    const couponState = couponDayState(coupon.start_date, coupon.end_date, couponTodayKey, couponTimezone);
    if (couponState === 'not-started') {
      return { ok: false, message: 'عذراً، هذا الكوبون لم يبدأ بعد' };
    }
    if (couponState === 'expired') {
      return { ok: false, message: 'عذراً، هذا الكوبون انتهت فترة صلاحيته' };
    }

    if (coupon.usage_limit !== null && Number(coupon.times_used || 0) >= coupon.usage_limit) {
      return { ok: false, message: 'عذراً، استنفد هذا الكوبون الحد الأقصى لمرات الاستخدام المتاحة' };
    }

    const minOrder = Number(coupon.min_order_amount || 0);
    if (subtotal < minOrder) {
      return {
        ok: false,
        message: `لتفعيل هذا الكوبون، يجب أن تبلغ قيمة المشتريات ${minOrder} ج على الأقل (مشترياتك الآن: ${subtotal.toFixed(0)} ج)`,
      };
    }

    let discountAmount = 0;
    let isFreeShipping = false;
    if (coupon.discount_type === 'free_shipping') {
      isFreeShipping = true;
    } else if (coupon.discount_type === 'percentage') {
      const rawDiscount = (subtotal * Number(coupon.discount_value)) / 100;
      discountAmount = coupon.max_discount_amount
        ? Math.min(rawDiscount, Number(coupon.max_discount_amount))
        : rawDiscount;
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = Math.min(subtotal, Number(coupon.discount_value));
    }

    // D6a: the preview discount must agree with the charge the order
    // path computes (line ~1232 rounds the same discount at the same
    // book digits). A 2-decimal cut here showed a 3-decimal tenant
    // 100.13 while the order charged 100.125. Same helper the order
    // path uses (settings currency, then tenant currency); the
    // posting path still fail-closes on a misconfigured currency.
    const moneyDigits = storefrontMoneyDigits(await this.getTenantSettingsMap(tenant.id), tenant);

    return {
      ok: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: Number(coupon.discount_value),
      discountAmount: roundMoney(discountAmount, moneyDigits),
      isFreeShipping,
      minOrderAmount: minOrder,
      maxDiscountAmount: coupon.max_discount_amount ? Number(coupon.max_discount_amount) : null,
      message: isFreeShipping
        ? 'تم تطبيق كوبون الشحن المجاني بنجاح!'
        : `تم تطبيق كود الخصم بنجاح (- ${discountAmount.toFixed(0)} ج)!`,
    };
  }

  async listCoupons(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'desc')
      .execute();

    return {
      ok: true,
      coupons: rows.map((c) => ({
        id: c.id,
        code: c.code,
        discountType: c.discount_type,
        discountValue: Number(c.discount_value),
        minOrderAmount: Number(c.min_order_amount),
        maxDiscountAmount: c.max_discount_amount ? Number(c.max_discount_amount) : null,
        usageLimit: c.usage_limit,
        timesUsed: Number(c.times_used || 0),
        isActive: Boolean(c.is_active),
        startDate: c.start_date,
        endDate: c.end_date,
        createdAt: c.created_at,
      })),
    };
  }

  async createCoupon(dto: CreateCouponDto, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const codeClean = dto.code.trim().toUpperCase();
    // A coupon date means the whole tenant day (NEW-I).
    const businessTimezone = await getTenantTimezone(this.db, tenantId);

    const existing = await this.db
      .selectFrom('storefront_coupons')
      .select('id')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('code', '=', codeClean)
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`كود الكوبون "${codeClean}" موجود بالفعل، يرجى اختيار كود آخر`);
    }

    if (dto.discountType === 'percentage' && (Number(dto.discountValue) <= 0 || Number(dto.discountValue) > 100)) {
      throw new BadRequestException('نسبة الخصم يجب أن تكون بين 1% و 100%');
    }

    const inserted = await this.db
      .insertInto('storefront_coupons')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        code: codeClean,
        discount_type: dto.discountType,
        discount_value: dto.discountValue,
        min_order_amount: dto.minOrderAmount || 0,
        max_discount_amount: dto.maxDiscountAmount || null,
        usage_limit: dto.usageLimit || null,
        times_used: 0,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        start_date: couponBoundInstant(dto.startDate, businessTimezone, false),
        end_date: couponBoundInstant(dto.endDate, businessTimezone, true),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, coupon: inserted };
  }

  async updateCoupon(id: number, dto: UpdateCouponDto, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    // A coupon date means the whole tenant day (NEW-I).
    const businessTimezone = await getTenantTimezone(this.db, tenantId);
    const existing = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الكوبون غير موجود');
    }

    const effectiveType = dto.discountType || existing.discount_type;
    const effectiveValue = dto.discountValue !== undefined ? dto.discountValue : existing.discount_value;
    if (effectiveType === 'percentage' && (Number(effectiveValue) <= 0 || Number(effectiveValue) > 100)) {
      throw new BadRequestException('نسبة الخصم يجب أن تكون بين 1% و 100%');
    }

    const payload: any = { updated_at: new Date() };
    if (dto.code !== undefined) {
      payload.code = dto.code.trim().toUpperCase();
    }
    if (dto.discountType !== undefined) payload.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) payload.discount_value = dto.discountValue;
    if (dto.minOrderAmount !== undefined) payload.min_order_amount = dto.minOrderAmount;
    if (dto.maxDiscountAmount !== undefined) payload.max_discount_amount = dto.maxDiscountAmount;
    if (dto.usageLimit !== undefined) payload.usage_limit = dto.usageLimit;
    if (dto.isActive !== undefined) payload.is_active = dto.isActive;
    if (dto.startDate !== undefined) payload.start_date = couponBoundInstant(dto.startDate, businessTimezone, false);
    if (dto.endDate !== undefined) payload.end_date = couponBoundInstant(dto.endDate, businessTimezone, true);

    await this.db
      .updateTable('storefront_coupons')
      .set(payload)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  async deleteCoupon(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('storefront_coupons')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  // --- Delivery Zones Management ---

  async listDeliveryZones(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('storefront_delivery_zones')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute();

    return {
      ok: true,
      zones: rows.map((z) => ({
        id: z.id,
        name: z.name,
        deliveryFee: Number(z.delivery_fee || 0),
        estimatedTime: z.estimated_time || '',
        isActive: Boolean(z.is_active),
        sortOrder: Number(z.sort_order || 0),
        createdAt: z.created_at,
        updatedAt: z.updated_at,
      })),
    };
  }

  async createDeliveryZone(dto: CreateDeliveryZoneDto, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const nameClean = dto.name.trim();

    const inserted = await this.db
      .insertInto('storefront_delivery_zones')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: nameClean,
        delivery_fee: dto.deliveryFee,
        estimated_time: dto.estimatedTime ? dto.estimatedTime.trim() : null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        sort_order: dto.sortOrder !== undefined ? dto.sortOrder : 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ok: true,
      zone: {
        id: inserted.id,
        name: inserted.name,
        deliveryFee: Number(inserted.delivery_fee || 0),
        estimatedTime: inserted.estimated_time || '',
        isActive: Boolean(inserted.is_active),
        sortOrder: Number(inserted.sort_order || 0),
      },
    };
  }

  async updateDeliveryZone(id: number, dto: UpdateDeliveryZoneDto, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const existing = await this.db
      .selectFrom('storefront_delivery_zones')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('منطقة التوصيل غير موجودة');
    }

    const payload: any = { updated_at: new Date() };
    if (dto.name !== undefined) payload.name = dto.name.trim();
    if (dto.deliveryFee !== undefined) payload.delivery_fee = dto.deliveryFee;
    if (dto.estimatedTime !== undefined) payload.estimated_time = dto.estimatedTime ? dto.estimatedTime.trim() : null;
    if (dto.isActive !== undefined) payload.is_active = dto.isActive;
    if (dto.sortOrder !== undefined) payload.sort_order = dto.sortOrder;

    await this.db
      .updateTable('storefront_delivery_zones')
      .set(payload)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  async deleteDeliveryZone(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('storefront_delivery_zones')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }
}
