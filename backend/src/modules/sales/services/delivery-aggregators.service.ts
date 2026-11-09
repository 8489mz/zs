import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface AggregatorChannelDto {
  code: string;
  name: string;
  name_en?: string;
  commission_rate: number;
  price_markup_percentage?: number;
  price_markup_fixed?: number;
  is_active: boolean;
  auto_accept_orders: boolean;
  api_key?: string;
  webhook_secret?: string;
}

export interface IngestOrderDto {
  aggregatorCode: string;
  externalOrderId: string;
  displayNumber?: string;
  branchId?: number;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  riderName?: string;
  riderPhone?: string;
  subtotal: number;
  deliveryFee?: number;
  commissionRate?: number;
  items: Array<{
    productId?: number;
    name: string;
    qty: number;
    unitPrice: number;
    modifiers?: Array<{ name: string; price?: number; qty?: number }>;
    notes?: string;
  }>;
  notes?: string;
}

@Injectable()
export class DeliveryAggregatorsService {
  private readonly logger = new Logger(DeliveryAggregatorsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private static readonly DEFAULT_EGYPT_CHANNELS = [
    { code: 'talabat', name: 'طلبات مصر (Talabat Egypt)', name_en: 'Talabat', commission_rate: 18.0 },
    { code: 'elmenus', name: 'المنيوز (Elmenus)', name_en: 'Elmenus', commission_rate: 15.0 },
    { code: 'noon_food', name: 'نون فود (Noon Food)', name_en: 'Noon Food', commission_rate: 14.0 },
    { code: 'mrsool', name: 'مرسول مصر (Mrsool)', name_en: 'Mrsool', commission_rate: 12.0 },
    { code: 'direct_delivery', name: 'خدمة التوصيل المباشر (دليفري المطعم)', name_en: 'Direct Delivery', commission_rate: 0.0 },
  ];

  private static readonly DEFAULT_KUWAIT_CHANNELS = [
    { code: 'talabat', name: 'طلبات الكويت (Talabat Kuwait)', name_en: 'Talabat', commission_rate: 20.0 },
    { code: 'deliveroo', name: 'دليفرو (Deliveroo)', name_en: 'Deliveroo', commission_rate: 18.5 },
    { code: 'cari', name: 'كاري (Cari - عمولة 0%)', name_en: 'Cari', commission_rate: 0.0 },
    { code: 'jahez', name: 'جاهز الكويت (Jahez)', name_en: 'Jahez', commission_rate: 16.0 },
    { code: 'keeta', name: 'كيتا (Keeta)', name_en: 'Keeta', commission_rate: 15.0 },
  ];

  private static readonly DEFAULT_SAUDI_CHANNELS = [
    { code: 'jahez', name: 'جاهز (Jahez)', name_en: 'Jahez', commission_rate: 18.0 },
    { code: 'hungerstation', name: 'هنقرستيشن (Hungerstation)', name_en: 'Hungerstation', commission_rate: 19.5 },
    { code: 'toyou', name: 'تويو (ToYou)', name_en: 'ToYou', commission_rate: 16.0 },
    { code: 'chefz', name: 'ذا شفز (The Chefz)', name_en: 'The Chefz', commission_rate: 17.5 },
    { code: 'keeta', name: 'كيتا (Keeta)', name_en: 'Keeta', commission_rate: 15.0 },
    { code: 'mrsool', name: 'مرسول (Mrsool)', name_en: 'Mrsool', commission_rate: 14.0 },
  ];

  /**
   * List all delivery aggregators for tenant, auto-seeding standard country channels if not yet present
   */
  async listAggregators(auth: AuthContext) {
    const scope = requireTenantScope(auth);

    // Resolve tenant country from settings
    const settingsRows = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    let rawCountry = '';
    let rawCurrency = '';
    for (const r of settingsRows) {
      if (r.key === 'country') {
        try { rawCountry = JSON.parse(r.value); } catch { rawCountry = String(r.value); }
      }
      if (r.key === 'currency') {
        try { rawCurrency = JSON.parse(r.value); } catch { rawCurrency = String(r.value); }
      }
    }
    const cleanCountry = String(rawCountry || '').trim().toUpperCase();
    const cleanCurrency = String(rawCurrency || '').trim().toUpperCase();
    let country = cleanCountry;
    if (!country) {
      if (cleanCurrency === 'KWD') country = 'KW';
      else if (cleanCurrency === 'SAR') country = 'SA';
      else if (cleanCurrency === 'AED') country = 'AE';
      else country = 'EG';
    }

    const defaultChannels = country === 'KW'
      ? DeliveryAggregatorsService.DEFAULT_KUWAIT_CHANNELS
      : country === 'SA'
      ? DeliveryAggregatorsService.DEFAULT_SAUDI_CHANNELS
      : DeliveryAggregatorsService.DEFAULT_EGYPT_CHANNELS;

    let rows = await this.db
      .selectFrom('pos_delivery_aggregators')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    if (rows.length === 0) {
      // Auto-seed default channels for this country
      for (const ch of defaultChannels) {
        await this.db
          .insertInto('pos_delivery_aggregators')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            code: ch.code,
            name: ch.name,
            name_en: ch.name_en,
            commission_rate: ch.commission_rate,
            is_active: true,
            auto_accept_orders: true,
          })
          .execute();
      }

      rows = await this.db
        .selectFrom('pos_delivery_aggregators')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc')
        .execute();
    } else {
      // Auto-seed any missing channel that belongs to this country
      const existingCodes = new Set(rows.map((r) => r.code));
      let hasAdded = false;
      for (const ch of defaultChannels) {
        if (!existingCodes.has(ch.code)) {
          await this.db
            .insertInto('pos_delivery_aggregators')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              code: ch.code,
              name: ch.name,
              name_en: ch.name_en,
              commission_rate: ch.commission_rate,
              is_active: true,
              auto_accept_orders: true,
            })
            .execute();
          hasAdded = true;
        }
      }
      if (hasAdded) {
        rows = await this.db
          .selectFrom('pos_delivery_aggregators')
          .selectAll()
          .where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc')
          .execute();
      }
    }

    // Strict country isolation: filter out foreign channels
    if (country === 'EG') {
      rows = rows.filter((r) => !['cari', 'deliveroo', 'hungerstation', 'toyou', 'chefz'].includes(r.code));
    } else if (country === 'KW') {
      rows = rows.filter((r) => !['elmenus', 'noon_food', 'hungerstation', 'toyou', 'chefz'].includes(r.code));
    } else if (country === 'SA') {
      rows = rows.filter((r) => !['cari', 'deliveroo', 'elmenus', 'noon_food'].includes(r.code));
    }

    return rows;
  }

  /**
   * Update aggregator settings (commission, active, auto-accept, keys)
   */
  async updateAggregator(auth: AuthContext, id: number, payload: Partial<AggregatorChannelDto>) {
    const scope = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('pos_delivery_aggregators')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('منصة التوصيل غير موجودة');
    }

    const updateObj: Record<string, any> = {
      updated_at: new Date(),
    };
    if (payload.commission_rate !== undefined) updateObj.commission_rate = payload.commission_rate;
    if (payload.price_markup_percentage !== undefined) updateObj.price_markup_percentage = payload.price_markup_percentage;
    if (payload.price_markup_fixed !== undefined) updateObj.price_markup_fixed = payload.price_markup_fixed;
    if (payload.is_active !== undefined) updateObj.is_active = payload.is_active;
    if (payload.auto_accept_orders !== undefined) updateObj.auto_accept_orders = payload.auto_accept_orders;
    if (payload.api_key !== undefined) updateObj.api_key = payload.api_key;
    if (payload.webhook_secret !== undefined) updateObj.webhook_secret = payload.webhook_secret;

    await this.db
      .updateTable('pos_delivery_aggregators')
      .set(updateObj)
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }

  /**
   * Ingest an incoming aggregator order (manual / mock push only).
   * INV-REST-FNB-TRUTH-2 (R-I7): this endpoint stays
   * session-authenticated — a real aggregator webhook has no staff
   * session, so live webhook ingestion cannot work through it, and
   * no real webhook / auto-sale integration is built here (LEAVE:
   * no real aggregator demand, marketplace sync deferred by user
   * decision 2026-11-05, no real aggregator contract exists). The
   * ingest records a tracking row only: no sale, no stock deduction,
   * no payment, no journal — the order reaches the kitchen via KDS
   * and becomes revenue only when someone re-keys it.
   */
  async ingestOrder(auth: AuthContext, dto: IngestOrderDto) {
    const scope = requireTenantScope(auth);
    const externalOrderId = String(dto.externalOrderId || '').trim();
    if (!externalOrderId || externalOrderId.length > 200) {
      throw new BadRequestException('معرف طلب منصة التوصيل مطلوب');
    }
    const aggregator = await this.db
      .selectFrom('pos_delivery_aggregators')
      .selectAll()
      .where('code', '=', dto.aggregatorCode)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!aggregator || !aggregator.is_active) {
      throw new BadRequestException(`منصة التوصيل ${dto.aggregatorCode} غير مفعلة`);
    }

    // INV-REST-FNB-TRUTH-2 (R-I7): the stored channel rate ALWAYS wins.
    // A caller-supplied commissionRate is accepted in the DTO so old
    // callers do not 400, but it is ignored — the configured rate is
    // the contract with the aggregator, and a caller override is
    // exactly the spoof vector (commissionRate: 0 used to store a
    // zero commission). R4-A does the same for service charge / tax:
    // the server recomputes from its own truth instead of trusting
    // the client.
    const commRate = Number(aggregator.commission_rate || 0);
    if (dto.commissionRate !== undefined && Number(dto.commissionRate) !== commRate) {
      this.logger.debug(
        `Aggregator ${dto.aggregatorCode}: caller commissionRate ${dto.commissionRate} ignored; stored rate ${commRate} applies`,
      );
    }
    const subtotal = Number(dto.subtotal || 0);
    const deliveryFee = Number(dto.deliveryFee || 0);
    // Commission and net payout are money: round at the tenant's book
    // digits (the old 2-decimal cut dropped a 3-decimal tenant's fils
    // before the amounts were stored on the aggregator order).
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const commissionAmount = roundMoney((subtotal * commRate) / 100, moneyDigits);
    // INV-REST-FNB-TRUTH-2 (R-I7): the delivery fee is money the
    // aggregator collects on the restaurant's behalf and owes back,
    // so it joins the payout. The commission base stays subtotal
    // only — no evidence any aggregator commissions the delivery fee.
    const netPayout = roundMoney(subtotal + deliveryFee - commissionAmount, moneyDigits);

    const initialStatus = aggregator.auto_accept_orders ? 'preparing' : 'received';

    return this.db.transaction().execute(async (trx) => {
      // Serialize provider retries across backend instances without a new migration.
      await trx.selectFrom('tenants').select('id').where('id','=',scope.tenantId)
        .forUpdate().executeTakeFirstOrThrow();
      const existing = await trx.selectFrom('pos_aggregator_orders')
        .select(['id','status','display_number','subtotal','delivery_fee','aggregator_commission','net_payout'])
        .where('tenant_id','=',scope.tenantId)
        .where('aggregator_id','=',Number(aggregator.id))
        .where('external_order_id','=',externalOrderId).executeTakeFirst();
      if (existing) {
        if (Math.abs(Number(existing.subtotal)-subtotal)>0.01 ||
            Math.abs(Number(existing.delivery_fee)-deliveryFee)>0.01) {
          throw new BadRequestException('معرف طلب التوصيل موجود بمبالغ مختلفة؛ يحتاج مراجعة');
        }
        return {
          orderId:Number(existing.id),status:existing.status,
          displayNumber:existing.display_number,netPayout:Number(existing.net_payout),
          commissionAmount:Number(existing.aggregator_commission),
        };
      }
      const inserted = await trx
      .insertInto('pos_aggregator_orders')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        aggregator_id: Number(aggregator.id),
        external_order_id: externalOrderId,
        display_number: dto.displayNumber || `${dto.aggregatorCode.toUpperCase()}-${dto.externalOrderId.slice(-4)}`,
        branch_id: dto.branchId ? Number(dto.branchId) : null,
        status: initialStatus,
        customer_name: dto.customerName || 'عميل تطبيق التوصيل',
        customer_phone: dto.customerPhone,
        delivery_address: dto.deliveryAddress,
        rider_name: dto.riderName,
        rider_phone: dto.riderPhone,
        subtotal: subtotal,
        delivery_fee: deliveryFee,
        aggregator_commission: commissionAmount,
        net_payout: netPayout,
        order_payload: dto as any,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return {
      orderId: Number(inserted.id),
      status: initialStatus,
      displayNumber: dto.displayNumber || `${dto.aggregatorCode.toUpperCase()}-${dto.externalOrderId.slice(-4)}`,
      netPayout,
      commissionAmount,
    };
    });
  }

  /**
   * List live aggregator orders with status filter
   */
  async listOrders(auth: AuthContext, filters?: { status?: string; limit?: number }) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pos_aggregator_orders as o')
      .innerJoin('pos_delivery_aggregators as a', 'a.id', 'o.aggregator_id')
      .select([
        'o.id',
        'o.aggregator_id',
        'a.code as aggregator_code',
        'a.name as aggregator_name',
        'o.external_order_id',
        'o.display_number',
        'o.status',
        'o.customer_name',
        'o.customer_phone',
        'o.delivery_address',
        'o.rider_name',
        'o.rider_phone',
        'o.subtotal',
        'o.delivery_fee',
        'o.aggregator_commission',
        'o.net_payout',
        'o.order_payload',
        'o.created_at',
      ])
      .where('o.tenant_id', '=', scope.tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('o.status', '=', filters.status);
    }

    return query
      .orderBy('o.created_at', 'desc')
      .limit(filters?.limit || 50)
      .execute();
  }

  /**
   * Update aggregator order status (e.g. ready for pickup, delivered).
   * INV-REST-FNB-TRUTH-2 (R-I7): only the six real lifecycle statuses
   * are accepted (400 on nonsense), and a missing id 404s — the old
   * code accepted any string and returned success for nonexistent ids.
   */
  async updateOrderStatus(auth: AuthContext, orderId: number, status: string) {
    const scope = requireTenantScope(auth);
    const allowedStatuses = ['received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled'];
    if (!allowedStatuses.includes(String(status || '').trim())) {
      throw new BadRequestException(`حالة طلب منصة التوصيل غير معروفة: ${status}`);
    }
    const result = await this.db
      .updateTable('pos_aggregator_orders')
      .set({
        status,
        updated_at: new Date(),
      })
      .where('id', '=', orderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows || 0) === 0) {
      throw new NotFoundException('طلب منصة التوصيل غير موجود');
    }

    return { success: true, status };
  }

  /**
   * Trigger 86 (Out of Stock) for a product across active delivery platforms
   */
  async trigger86(auth: AuthContext, productId: number, isAvailable: boolean) {
    const scope = requireTenantScope(auth);
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('الصنف غير موجود');
    }

    this.logger.log(
      `Tenant ${scope.tenantId}: Item 86 dispatched for Product #${productId} (${product.name}) -> Available: ${isAvailable}`,
    );

    return {
      productId,
      productName: product.name,
      isAvailable,
      broadcastedTo: ['jahez', 'hungerstation', 'talabat', 'keeta', 'deliveroo'],
      timestamp: new Date().toISOString(),
    };
  }
}
