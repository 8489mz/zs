import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { UpsertShortageDto } from '../dto/upsert-shortage.dto';

export class ShortagesSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // -------------------------------------------------------------
  // 6. SHORTAGES BOOK (كشكول النواقص الرقمي)
  // -------------------------------------------------------------
  async listShortages(
    auth: AuthContext,
    filters?: {
      status?: string;
      priority?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_shortages')
      .where('tenant_id', '=', scope.tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status);
    }

    if (filters?.priority && filters.priority !== 'all') {
      query = query.where('priority', '=', filters.priority);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(product_name) like ${term}
        OR lower(coalesce(active_ingredient, '')) like ${term}
        OR lower(coalesce(customer_name, '')) like ${term}
        OR lower(coalesce(suggested_distributor, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const shortages = await query
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      shortages,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async upsertShortage(auth: AuthContext, dto: UpsertShortageDto) {
    const scope = requireTenantScope(auth);

    if (dto.id) {
      return await this.db
        .updateTable('pharmacy_shortages')
        .set({
          product_name: dto.productName,
          active_ingredient: dto.activeIngredient ?? null,
          suggested_distributor: dto.suggestedDistributor ?? null,
          requested_quantity: dto.requestedQuantity || 1,
          priority: dto.priority || 'normal',
          customer_name: dto.customerName ?? null,
          customer_phone: dto.customerPhone ?? null,
          status: dto.status || 'needed',
          notes: dto.notes ?? null,
          updated_at: sql`now()`,
        })
        .where('id', '=', dto.id)
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return await this.db
      .insertInto('pharmacy_shortages')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        product_name: dto.productName,
        active_ingredient: dto.activeIngredient ?? null,
        suggested_distributor: dto.suggestedDistributor ?? null,
        requested_quantity: dto.requestedQuantity || 1,
        priority: dto.priority || 'normal',
        customer_name: dto.customerName ?? null,
        customer_phone: dto.customerPhone ?? null,
        status: dto.status || 'needed',
        notes: dto.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateShortageStatus(auth: AuthContext, id: number, status: string) {
    const scope = requireTenantScope(auth);
    return await this.db
      .updateTable('pharmacy_shortages')
      .set({ status, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
