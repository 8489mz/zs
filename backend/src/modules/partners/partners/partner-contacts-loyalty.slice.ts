import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../../core/audit/audit.service';
import type { RawBuilder } from 'kysely';

export interface PartnerContactsLoyaltySliceBoundDeps {
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  tenantId: (actor: AuthContext) => string;
  accountId: (actor: AuthContext) => string;
}

export class PartnerContactsLoyaltySlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: PartnerContactsLoyaltySliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return this.bound.tenantPredicate(actor, alias);
  }

  private tenantFields(actor: AuthContext) {
    return this.bound.tenantFields(actor);
  }

  private tenantId(actor: AuthContext): string {
    return this.bound.tenantId(actor);
  }

  private accountId(actor: AuthContext): string {
    return this.bound.accountId(actor);
  }

  async listContacts(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const contacts = await this.db
      .selectFrom('partner_contacts')
      .selectAll()
      .where('partner_type', '=', partnerType)
      .where('partner_id', '=', partnerId)
      .where(this.tenantPredicate(actor))
      .execute();
    return { ok: true, contacts };
  }

  async createContact(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    const [id] = await this.db
      .insertInto('partner_contacts')
      .values({
        partner_type: partnerType,
        partner_id: partnerId,
        name: payload.name,
        phone: payload.phone || null,
        email: payload.email || null,
        ...this.tenantFields(actor),
      } as any)
      .returning(['id'])
      .execute();
    return this.listContacts(partnerType, partnerId, actor);
  }

  async listAddresses(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const addresses = await this.db
      .selectFrom('partner_addresses')
      .selectAll()
      .where('partner_type', '=', partnerType)
      .where('partner_id', '=', partnerId)
      .where(this.tenantPredicate(actor))
      .execute();
    return { ok: true, addresses };
  }

  async createAddress(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    const [id] = await this.db
      .insertInto('partner_addresses')
      .values({
        partner_type: partnerType,
        partner_id: partnerId,
        label: payload.label,
        city: payload.city || null,
        address_line: payload.addressLine || null,
        ...this.tenantFields(actor),
      } as any)
      .returning(['id'])
      .execute();
    return this.listAddresses(partnerType, partnerId, actor);
  }

  async adjustCustomerLoyaltyPoints(
    id: number,
    pointsChange: number,
    actionType: 'earn' | 'redeem' | 'manual_adjust',
    notes: string | undefined,
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'loyalty_points'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const currentPoints = Number(customer.loyalty_points || 0);
    const newBalance = Math.max(0, Number((currentPoints + pointsChange).toFixed(2)));

    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('customers')
        .set({ loyalty_points: newBalance, updated_at: now } as any)
        .where('id', '=', id)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .insertInto('customer_loyalty_logs')
        .values({
          tenant_id: this.tenantId(actor),
          account_id: this.accountId(actor),
          customer_id: id,
          points_change: pointsChange,
          balance_after: newBalance,
          action_type: actionType,
          sale_id: null,
          notes: notes?.trim() || null,
          created_at: now,
        } as any)
        .execute();
    });

    await this.audit.log(
      'تعديل نقاط الولاء',
      `تم تعديل نقاط العميل ${customer.name} بمقدار (${pointsChange > 0 ? `+${pointsChange}` : pointsChange}) ليصبح الرصيد ${newBalance} بواسطة ${actor.username}`,
      actor,
    );

    return { ok: true, customerId: id, previousBalance: currentPoints, balance: newBalance };
  }

  async getCustomerLoyaltyHistory(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const logs = await this.db
      .selectFrom('customer_loyalty_logs')
      .selectAll()
      .where('customer_id', '=', id)
      .where(this.tenantPredicate(actor))
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    return { ok: true, logs };
  }

  async getInactiveCustomersMarketing(daysInactive = 30, actor: AuthContext): Promise<Record<string, unknown>> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysInactive);

    const customers = await this.db
      .selectFrom('customers as c')
      .leftJoin('sales as s', (join) =>
        join.onRef('s.customer_id', '=', 'c.id').on('s.status', '=', 'posted'),
      )
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.balance',
        'c.loyalty_points',
        sql<Date>`max(s.created_at)`.as('last_sale_at'),
        sql<number>`count(s.id)`.as('total_sales_count'),
      ])
      .where('c.is_active', '=', true)
      .where(this.tenantPredicate(actor, 'c'))
      .groupBy(['c.id', 'c.name', 'c.phone', 'c.balance', 'c.loyalty_points'])
      .having((eb) =>
        eb.or([
          sql<boolean>`max(s.created_at) is null`,
          sql<boolean>`max(s.created_at) < ${thresholdDate}`,
        ]),
      )
      .orderBy(sql`max(s.created_at) asc nulls first`)
      .limit(150)
      .execute();

    return {
      ok: true,
      count: customers.length,
      daysInactive,
      customers: customers.map((c) => ({
        id: String(c.id),
        name: c.name,
        phone: c.phone || '',
        balance: Number(c.balance || 0),
        loyaltyPoints: Number(c.loyalty_points || 0),
        lastSaleAt: c.last_sale_at || null,
        totalSalesCount: Number(c.total_sales_count || 0),
      })),
    };
  }
}
