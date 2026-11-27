import { Inject, Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import {
  evaluateFmcgCartPromotions,
  FmcgPromotion,
  CartItemInput,
  CartPromotionEvaluationResult,
} from '../fmcg-promotions.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { formatLocalCalendarDay, getTenantTimezone } from '../../../common/utils/tenant-timezone.util';

/**
 * Converts a pg DATE column value to its YYYY-MM-DD calendar-day key.
 * node-postgres returns DATE columns as local-midnight JS Dates, so
 * String(value).slice(0, 10) yields "Sat Nov 14", not a date -- and the
 * engine's string comparison then skips every promotion with a startDate
 * ("Sat Nov 14" > any YYYY-MM-DD) and never expires one ("Sat Nov 13"
 * < any YYYY-MM-DD is false). A Date is rendered from its local calendar
 * parts (the stored day); a string already in YYYY-MM-DD form passes
 * through; any other string is parsed and rendered the same way.
 */
export function promotionDateKey(value: unknown): string {
  if (value instanceof Date) return formatLocalCalendarDay(value);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isFinite(parsed.getTime()) ? formatLocalCalendarDay(parsed) : s;
}

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): buyConditions is an ARRAY for
 * mix_and_match and an OBJECT for tiered_qty / invoice_threshold, and
 * the stock IsObject validator rejects arrays (probed against the
 * installed class-validator: 1 error on an array, 0 on an object).
 * This custom validator accepts either shape and rejects strings,
 * numbers, and booleans.
 */
export function IsObjectOrArray(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isObjectOrArray',
      validator: {
        validate: (value: unknown): boolean => value !== null && typeof value === 'object',
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be an object or an array`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

/**
 * The promotion reward shape mirrors the engine's FmcgPromoReward
 * (fmcg-promotions.engine.ts): every field optional, because the form
 * builds only the keys its applyType needs (bonus fields for
 * free_bonus, discountPercent / discountAmount for the discount
 * types). bonusUom / targetProductId are engine fields the form does
 * not send today; they stay accepted so a caller that sets them does
 * not 400.
 */
export class FmcgPromotionRewardDto {
  @IsOptional()
  @IsInt()
  bonusProductId?: number;

  @IsOptional()
  @IsString()
  bonusProductName?: string;

  @IsOptional()
  @IsNumber()
  bonusQty?: number;

  @IsOptional()
  @IsString()
  bonusUom?: string;

  @IsOptional()
  @IsString()
  bonusReason?: string;

  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsInt()
  targetProductId?: number;
}

/**
 * The promotion upsert payload was an interface, so the global pipe
 * did nothing for it — it is now a class (create). name is required
 * and non-empty because createPromotion throws
 * INVALID_PROMOTION_NAME on a blank name. promoType / applyType /
 * buyConditions / reward are required because the admin form always
 * sends them (the service defaults them when absent, but the caller
 * rule governs the boundary); maxApplicationsPerOrder / priority are
 * optional numbers with no Min — the service coerces falsy values
 * with `|| 1` / `|| 0` instead of throwing, and an existing spec
 * (fmcg-promotion-date-mapping.spec.ts) constructs a promotion
 * without them, so the boundary must not narrow the service's
 * defaulting capability. The form's number inputs can yield a float,
 * so IsInt would 400 a real caller value.
 * startDate / endDate / notes arrive as null from the form when
 * empty (IsOptional skips null). customerTypes / isActive are never
 * sent by the form (isActive goes through the toggle route) and stay
 * optional.
 */
export class UpsertFmcgPromotionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  promoType!: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;

  @IsString()
  applyType!: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;

  @IsObjectOrArray()
  buyConditions!: unknown[] | Record<string, unknown>;

  @ValidateNested()
  @Type(() => FmcgPromotionRewardDto)
  reward!: FmcgPromotionRewardDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerTypes?: string[];

  @IsOptional()
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @IsString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  maxApplicationsPerOrder?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

/**
 * The update route takes Partial of the upsert shape at the service
 * (updatePromotion applies only defined fields), so a name-less
 * partial update is a legitimate service capability — the update DTO
 * is a separate all-optional class instead of reusing the create
 * class with its required name. Using one class with a required name
 * would narrow a real service capability at the boundary.
 */
export class UpdateFmcgPromotionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  promoType?: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;

  @IsOptional()
  @IsString()
  applyType?: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;

  @IsOptional()
  @IsObjectOrArray()
  buyConditions?: unknown[] | Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => FmcgPromotionRewardDto)
  reward?: FmcgPromotionRewardDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerTypes?: string[];

  @IsOptional()
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @IsString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  maxApplicationsPerOrder?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

@Injectable()
export class VanPromotionsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db;
  }

  async listPromotions(
    tenantId: string,
    filters?: { isActive?: boolean; promoType?: string },
  ): Promise<FmcgPromotion[]> {
    let query = this.anyDb.selectFrom('fmcg_promotions').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.isActive !== undefined) {
      query = query.where('is_active', '=', filters.isActive);
    }
    if (filters?.promoType) {
      query = query.where('promo_type', '=', filters.promoType);
    }

    const rows = await query.orderBy('priority', 'desc').orderBy('id', 'desc').execute();

    return rows.map((r: any) => this.mapPromotionRow(r));
  }

  async getPromotionById(tenantId: string, id: number): Promise<FmcgPromotion> {
    const row = await this.anyDb
      .selectFrom('fmcg_promotions')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!row) {
      throw new AppError('العرض الترويجي غير موجود', 'PROMOTION_NOT_FOUND', 404);
    }

    return this.mapPromotionRow(row);
  }

  async createPromotion(tenantId: string, dto: UpsertFmcgPromotionDto): Promise<FmcgPromotion> {
    if (!dto.name || !dto.name.trim()) {
      throw new AppError('اسم العرض الترويجي إلزامي', 'INVALID_PROMOTION_NAME', 400);
    }

    const code =
      dto.code && dto.code.trim()
        ? dto.code.trim().toUpperCase()
        : `PROMO-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const [inserted] = await this.anyDb
      .insertInto('fmcg_promotions')
      .values({
        tenant_id: tenantId,
        name: dto.name.trim(),
        code,
        promo_type: dto.promoType || 'mix_and_match',
        apply_type: dto.applyType || 'free_bonus',
        buy_conditions: JSON.stringify(dto.buyConditions || []),
        reward: JSON.stringify(dto.reward || {}),
        customer_types: JSON.stringify(dto.customerTypes || ['all']),
        start_date: dto.startDate || null,
        end_date: dto.endDate || null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        max_applications_per_order: dto.maxApplicationsPerOrder || 1,
        priority: dto.priority || 0,
        notes: dto.notes || null,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .returningAll()
      .execute();

    return this.mapPromotionRow(inserted);
  }

  async updatePromotion(tenantId: string, id: number, dto: Partial<UpsertFmcgPromotionDto>): Promise<FmcgPromotion> {
    await this.getPromotionById(tenantId, id);

    const updatePayload: any = {
      updated_at: sql`now()`,
    };

    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.code !== undefined) updatePayload.code = dto.code.trim().toUpperCase();
    if (dto.promoType !== undefined) updatePayload.promo_type = dto.promoType;
    if (dto.applyType !== undefined) updatePayload.apply_type = dto.applyType;
    if (dto.buyConditions !== undefined) updatePayload.buy_conditions = JSON.stringify(dto.buyConditions);
    if (dto.reward !== undefined) updatePayload.reward = JSON.stringify(dto.reward);
    if (dto.customerTypes !== undefined) updatePayload.customer_types = JSON.stringify(dto.customerTypes);
    if (dto.startDate !== undefined) updatePayload.start_date = dto.startDate || null;
    if (dto.endDate !== undefined) updatePayload.end_date = dto.endDate || null;
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;
    if (dto.maxApplicationsPerOrder !== undefined)
      updatePayload.max_applications_per_order = dto.maxApplicationsPerOrder;
    if (dto.priority !== undefined) updatePayload.priority = dto.priority;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const [updated] = await this.anyDb
      .updateTable('fmcg_promotions')
      .set(updatePayload)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .execute();

    return this.mapPromotionRow(updated);
  }

  async deletePromotion(tenantId: string, id: number): Promise<{ ok: boolean }> {
    await this.getPromotionById(tenantId, id);
    await this.anyDb.deleteFrom('fmcg_promotions').where('id', '=', id).where('tenant_id', '=', tenantId).execute();

    return { ok: true };
  }

  async toggleActive(tenantId: string, id: number, isActive: boolean): Promise<FmcgPromotion> {
    return this.updatePromotion(tenantId, id, { isActive });
  }

  async evaluateCart(
    tenantId: string,
    payload: {
      cartItems: CartItemInput[];
      invoiceSubtotal?: number;
      customerType?: string | null;
    },
  ): Promise<CartPromotionEvaluationResult> {
    const activePromotions = await this.listPromotions(tenantId, { isActive: true });
    // Pass the tenant's book digits into the pure engine: without this
    // the engine would default to 2 and cut a 3-decimal tenant's fils.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    // The promotion window is a business-day decision
    // (INV-BUSINESS-DATE-TENANT-LOCAL): pass the tenant-local day as
    // referenceDate. Without this the engine defaults to the UTC day,
    // so around local midnight a promo starting today is skipped and
    // one that ended yesterday still applies.
    const referenceDate = await resolveBusinessDateKey(this.anyDb, tenantId, new Date());
    // Tenant business timezone for the engine's reference day
    // (INV-SINGLE-SERVER-CLOCK-TENANT-TZ): the referenceDate string
    // above already carries the tenant day, so the engine's string
    // branch never consults this — the zone covers the Date branch
    // and pure-engine callers.
    const businessTimezone = await getTenantTimezone(this.anyDb, tenantId);
    return evaluateFmcgCartPromotions({
      cartItems: payload.cartItems || [],
      invoiceSubtotal: payload.invoiceSubtotal,
      customerType: payload.customerType,
      activePromotions,
      referenceDate,
      moneyDigits,
      businessTimezone,
    });
  }

  private mapPromotionRow(r: any): FmcgPromotion {
    const parseJson = (val: any) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val || {};
    };

    return {
      id: Number(r.id),
      name: r.name,
      code: r.code,
      promoType: r.promo_type,
      applyType: r.apply_type,
      buyConditions: parseJson(r.buy_conditions),
      reward: parseJson(r.reward),
      customerTypes: parseJson(r.customer_types),
      startDate: r.start_date ? promotionDateKey(r.start_date) : null,
      endDate: r.end_date ? promotionDateKey(r.end_date) : null,
      isActive: Boolean(r.is_active),
      maxApplicationsPerOrder: Number(r.max_applications_per_order || 1),
      priority: Number(r.priority || 0),
      notes: r.notes || null,
    };
  }
}
