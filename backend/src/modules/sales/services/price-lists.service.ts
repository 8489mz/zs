import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { canManagePriceLists } from '../../../core/auth/utils/commerce-operation-guards';
import { KYSELY_DB } from '../../../database/database.constants';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { resolveListEffectivePrice, resolvePriceListContext } from '../engines/price-list-resolution.engine';

export interface UpsertPriceListDto {
  name: string;
  code: string;
  currency?: string;
  type?: 'percentage' | 'fixed_override' | 'markup_cost';
  default_discount_percent?: number;
  is_default?: boolean;
  is_active?: boolean;
  notes?: string;
  items?: Array<{
    product_id?: number | null;
    product_name?: string | null;
    category_id?: number | null;
    min_quantity: number;
    fixed_price?: number | null;
    discount_percent?: number | null;
  }>;
}

@Injectable()
export class PriceListsService {
  private readonly logger = new Logger(PriceListsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async listPriceLists(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const lists = await this.db
      .selectFrom('price_lists')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc')
      .execute();

    // Get item counts
    const counts = await this.db
      .selectFrom('price_list_items')
      .select(['price_list_id', sql<number>`count(*)::int`.as('item_count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('price_list_id')
      .execute();

    const countMap = new Map<number, number>();
    for (const c of counts) {
      countMap.set(Number(c.price_list_id), Number(c.item_count));
    }

    return lists.map((l) => ({
      ...l,
      id: Number(l.id),
      default_discount_percent: Number(l.default_discount_percent || 0),
      items_count: countMap.get(Number(l.id)) || 0,
    }));
  }

  async getPriceList(auth: AuthContext, id: number) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const priceList = await this.db
      .selectFrom('price_lists')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!priceList) {
      throw new NotFoundException('قائمة الأسعار غير موجودة');
    }

    const items = await this.db
      .selectFrom('price_list_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('price_list_id', '=', id)
      .orderBy('min_quantity', 'asc')
      .execute();

    return {
      ...priceList,
      id: Number(priceList.id),
      default_discount_percent: Number(priceList.default_discount_percent || 0),
      items: items.map((it) => ({
        ...it,
        id: Number(it.id),
        min_quantity: Number(it.min_quantity || 1),
        fixed_price: it.fixed_price != null ? Number(it.fixed_price) : null,
        discount_percent: it.discount_percent != null ? Number(it.discount_percent) : null,
      })),
    };
  }

  async createPriceList(auth: AuthContext, dto: UpsertPriceListDto) {
    canManagePriceLists(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const accountId = scope.accountId;

    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('اسم قائمة الأسعار مطلوب');
    }

    const code = (dto.code || dto.name).trim().toUpperCase().replace(/\s+/g, '_');

    // Check duplicate code
    const existing = await this.db
      .selectFrom('price_lists')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException('كود قائمة الأسعار مستخدم بالفعل');
    }

    return await this.db.transaction().execute(async (trx) => {
      if (dto.is_default) {
        // Reset previous default
        await trx.updateTable('price_lists').set({ is_default: false }).where('tenant_id', '=', tenantId).execute();
      }

      const inserted = await trx
        .insertInto('price_lists')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          name: dto.name.trim(),
          code: code,
          currency: dto.currency || 'EGP',
          type: dto.type || 'percentage',
          default_discount_percent: dto.default_discount_percent || 0,
          is_default: Boolean(dto.is_default),
          is_active: dto.is_active !== undefined ? Boolean(dto.is_active) : true,
          notes: dto.notes || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          await trx
            .insertInto('price_list_items')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              price_list_id: Number(inserted.id),
              product_id: item.product_id ? Number(item.product_id) : null,
              product_name: item.product_name || null,
              category_id: item.category_id ? Number(item.category_id) : null,
              min_quantity: item.min_quantity || 1,
              fixed_price: item.fixed_price != null ? item.fixed_price : null,
              discount_percent: item.discount_percent != null ? item.discount_percent : null,
            })
            .execute();
        }
      }

      return inserted;
    });
  }

  async updatePriceList(auth: AuthContext, id: number, dto: UpsertPriceListDto) {
    canManagePriceLists(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const accountId = scope.accountId;

    const existing = await this.db
      .selectFrom('price_lists')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('قائمة الأسعار غير موجودة');
    }

    const code = (dto.code || existing.code).trim().toUpperCase().replace(/\s+/g, '_');

    return await this.db.transaction().execute(async (trx) => {
      if (dto.is_default) {
        await trx
          .updateTable('price_lists')
          .set({ is_default: false })
          .where('tenant_id', '=', tenantId)
          .where('id', '!=', id)
          .execute();
      }

      await trx
        .updateTable('price_lists')
        .set({
          name: dto.name ? dto.name.trim() : existing.name,
          code: code,
          currency: dto.currency || existing.currency,
          type: dto.type || existing.type,
          default_discount_percent:
            dto.default_discount_percent !== undefined
              ? dto.default_discount_percent
              : existing.default_discount_percent,
          is_default: dto.is_default !== undefined ? Boolean(dto.is_default) : existing.is_default,
          is_active: dto.is_active !== undefined ? Boolean(dto.is_active) : existing.is_active,
          notes: dto.notes !== undefined ? dto.notes : existing.notes,
          updated_at: sql`now()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();

      if (dto.items) {
        await trx
          .deleteFrom('price_list_items')
          .where('tenant_id', '=', tenantId)
          .where('price_list_id', '=', id)
          .execute();

        for (const item of dto.items) {
          await trx
            .insertInto('price_list_items')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              price_list_id: id,
              product_id: item.product_id ? Number(item.product_id) : null,
              product_name: item.product_name || null,
              category_id: item.category_id ? Number(item.category_id) : null,
              min_quantity: item.min_quantity || 1,
              fixed_price: item.fixed_price != null ? item.fixed_price : null,
              discount_percent: item.discount_percent != null ? item.discount_percent : null,
            })
            .execute();
        }
      }

      return { success: true, id };
    });
  }

  async deletePriceList(auth: AuthContext, id: number) {
    canManagePriceLists(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    return await this.db.transaction().execute(async (trx) => {
      // Detach from customers
      await trx
        .updateTable('customers')
        .set({ price_list_id: null })
        .where('tenant_id', '=', tenantId)
        .where('price_list_id', '=', id)
        .execute();

      await trx
        .deleteFrom('price_list_items')
        .where('tenant_id', '=', tenantId)
        .where('price_list_id', '=', id)
        .execute();

      await trx.deleteFrom('price_lists').where('tenant_id', '=', tenantId).where('id', '=', id).execute();

      return { success: true };
    });
  }

  /**
   * Calculates the effective price according to active price list and quantity tiers.
   * Delegates to price-list-resolution.engine (INV-VAN-PRICE-LIST-WIRING):
   * the same computation the POS and van sale paths run per line, so the
   * preview endpoint can never drift from the real sale path. An
   * assigned list that is gone or inactive falls through to the
   * tenant's active default list (then the base price).
   */
  async calculateEffectivePrice(
    auth: AuthContext,
    customerId: number | null,
    productId: number,
    quantity: number,
    basePrice: number,
    options?: { paymentTerms?: 'cash' | 'credit' },
  ) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    // Book digits resolved once (D4): effective prices round at the
    // tenant's book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const context = await resolvePriceListContext(this.db, tenantId, customerId);
    return resolveListEffectivePrice(this.db, tenantId, context, productId, quantity, basePrice, options, moneyDigits);
  }
}
