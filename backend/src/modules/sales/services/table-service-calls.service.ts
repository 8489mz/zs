import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { CreateTableServiceCallDto } from '../dto/table-service-call.dto';
import { findTenantByStorefrontSlug } from '../../storefront/storefront-slug-resolution';

@Injectable()
export class TableServiceCallsService {
  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<Database>,
  ) {}

  /**
   * INV-TABLE-CALL-SLUG-TENANT: resolve the tenant for a public
   * table call from the storefront slug, server-side. An unknown or
   * missing slug fails closed; there is no 'default' tenant fallback
   * and no caller-supplied tenant is ever consulted.
   */
  async resolveTenantBySlug(slug: string | undefined): Promise<string> {
    const tenant = await findTenantByStorefrontSlug(this.db as any, slug || '');
    if (!tenant) {
      throw new NotFoundException('المتجر غير موجود');
    }
    return tenant.id;
  }

  async listPendingCalls(tenantId: string, branchId?: number) {
    let query = this.db
      .selectFrom('restaurant_table_service_calls')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'pending');

    if (branchId) {
      query = query.where((eb) =>
        eb.or([
          eb('branch_id', '=', branchId),
          eb('branch_id', 'is', null),
        ]),
      );
    }

    return query.orderBy('created_at', 'desc').execute();
  }

  async createCall(tenantId: string, dto: CreateTableServiceCallDto) {
    // Check if there is already an active pending call of this type for this table
    const existing = await this.db
      .selectFrom('restaurant_table_service_calls')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('table_number', '=', dto.tableNumber)
      .where('call_type', '=', dto.callType || 'waiter')
      .where('status', '=', 'pending')
      .executeTakeFirst();

    if (existing) {
      return existing; // idempotent return
    }

    const [created] = await this.db
      .insertInto('restaurant_table_service_calls')
      .values({
        tenant_id: tenantId,
        branch_id: dto.branchId ?? null,
        table_number: dto.tableNumber,
        call_type: dto.callType || 'waiter',
        status: 'pending',
      })
      .returningAll()
      .execute();

    return created;
  }

  async resolveCall(tenantId: string, id: number) {
    const existing = await this.db
      .selectFrom('restaurant_table_service_calls')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('نداء الطاولة غير موجود');
    }

    const [updated] = await this.db
      .updateTable('restaurant_table_service_calls')
      .set({
        status: 'resolved',
        resolved_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .execute();

    return updated;
  }

  async resolveCallsForTable(tenantId: string, tableNumber: string) {
    return this.db
      .updateTable('restaurant_table_service_calls')
      .set({
        status: 'resolved',
        resolved_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('table_number', '=', tableNumber)
      .where('status', '=', 'pending')
      .execute();
  }
}
