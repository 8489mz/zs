import { Inject, Injectable } from '@nestjs/common';
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
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface UpsertFmcgPromotionDto {
  name: string;
  code?: string;
  promoType: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;
  applyType: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;
  buyConditions: any;
  reward: any;
  customerTypes?: string[];
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  maxApplicationsPerOrder?: number;
  priority?: number;
  notes?: string | null;
}

@Injectable()
export class VanPromotionsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  async listPromotions(
    tenantId: string,
    filters?: { isActive?: boolean; promoType?: string },
  ): Promise<FmcgPromotion[]> {
    let query = this.anyDb
      .selectFrom('fmcg_promotions')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.isActive !== undefined) {
      query = query.where('is_active', '=', filters.isActive);
    }
    if (filters?.promoType) {
      query = query.where('promo_type', '=', filters.promoType);
    }

    const rows = await query
      .orderBy('priority', 'desc')
      .orderBy('id', 'desc')
      .execute();

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

    const code = dto.code && dto.code.trim()
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

  async updatePromotion(
    tenantId: string,
    id: number,
    dto: Partial<UpsertFmcgPromotionDto>,
  ): Promise<FmcgPromotion> {
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
    if (dto.maxApplicationsPerOrder !== undefined) updatePayload.max_applications_per_order = dto.maxApplicationsPerOrder;
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
    await this.anyDb
      .deleteFrom('fmcg_promotions')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();

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
    return evaluateFmcgCartPromotions({
      cartItems: payload.cartItems || [],
      invoiceSubtotal: payload.invoiceSubtotal,
      customerType: payload.customerType,
      activePromotions,
      moneyDigits,
    });
  }

  private mapPromotionRow(r: any): FmcgPromotion {
    const parseJson = (val: any) => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
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
      startDate: r.start_date ? String(r.start_date).slice(0, 10) : null,
      endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
      isActive: Boolean(r.is_active),
      maxApplicationsPerOrder: Number(r.max_applications_per_order || 1),
      priority: Number(r.priority || 0),
      notes: r.notes || null,
    };
  }
}
