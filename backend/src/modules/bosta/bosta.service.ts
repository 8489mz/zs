import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { canManageShippingConfig, canOperateShipping } from '../../core/auth/utils/commerce-operation-guards';
import { BostaSettings, BostaCreateDeliveryDto, BostaDeliveryResponse, BostaTrackingResponse } from './bosta.types';

@Injectable()
export class BostaService {
  private readonly logger = new Logger(BostaService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * استرجاع إعدادات الربط مع بوسطة
   */
  async getSettings(actor: AuthContext): Promise<BostaSettings> {
    canManageShippingConfig(actor);
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'like', 'bosta_%')
      .execute();

    const map = new Map<string, any>();
    for (const r of rows) {
      try {
        map.set(r.key, JSON.parse(r.value));
      } catch {
        map.set(r.key, r.value);
      }
    }

    return {
      enabled: map.get('bosta_enabled') === true,
      environment: map.get('bosta_environment') === 'production' ? 'production' : 'sandbox',
      apiKey: map.get('bosta_api_key') ? '••••••••' : '',
      pickupBusinessName: map.get('bosta_pickup_business_name') || '',
      pickupPhone: map.get('bosta_pickup_phone') || '',
      pickupCity: map.get('bosta_pickup_city') || 'Cairo',
      pickupAddress: map.get('bosta_pickup_address') || '',
    };
  }

  /**
   * حفظ أو تحديث إعدادات الربط مع بوسطة
   */
  async saveSettings(payload: Partial<BostaSettings>, actor: AuthContext): Promise<{ ok: boolean }> {
    canManageShippingConfig(actor);
    const { tenantId, accountId } = requireTenantScope(actor);

    const updates: Array<{ key: string; val: any }> = [];
    if (payload.enabled !== undefined) updates.push({ key: 'bosta_enabled', val: payload.enabled });
    if (payload.environment !== undefined) updates.push({ key: 'bosta_environment', val: payload.environment });
    if (payload.apiKey && payload.apiKey !== '••••••••') {
      updates.push({ key: 'bosta_api_key', val: payload.apiKey });
    }
    if (payload.pickupBusinessName !== undefined)
      updates.push({ key: 'bosta_pickup_business_name', val: payload.pickupBusinessName });
    if (payload.pickupPhone !== undefined) updates.push({ key: 'bosta_pickup_phone', val: payload.pickupPhone });
    if (payload.pickupCity !== undefined) updates.push({ key: 'bosta_pickup_city', val: payload.pickupCity });
    if (payload.pickupAddress !== undefined) updates.push({ key: 'bosta_pickup_address', val: payload.pickupAddress });

    for (const item of updates) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${item.key}, ${JSON.stringify(item.val)}, ${tenantId}, ${accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
      `.execute(this.db);
    }

    return { ok: true };
  }

  /**
   * جلب مفتاح API الحقيقي المخزن
   */
  private async getRawApiKey(tenantId: string): Promise<string> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'bosta_api_key')
      .executeTakeFirst();
    return row?.value ? row.value.replace(/^"|"$/g, '') : '';
  }

  /**
   * إنشاء شحنة بوسطة لطلب أونلاين
   */
  async createDelivery(
    orderId: number,
    dto: BostaCreateDeliveryDto,
    actor: AuthContext,
  ): Promise<BostaDeliveryResponse> {
    canOperateShipping(actor);
    const { tenantId } = requireTenantScope(actor);

    // 1. جلب بيانات الطلب من قاعدة البيانات
    const order = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException(`الطلب رقم #${orderId} غير موجود.`);
    }

    if (order.status === 'cancelled') {
      throw new BadRequestException('لا يمكن شحن طلب ملغى.');
    }

    // 2. فحص إعدادات بوسطة
    const settings = await this.getSettings(actor);
    const rawApiKey = await this.getRawApiKey(tenantId);
    const isSandbox = settings.environment === 'sandbox' || !rawApiKey || rawApiKey.includes('test');

    // 3. حساب قيمة التحصيل (COD)
    // إذا كان الطلب مسدداً إلكترونياً فإن مبلغ التحصيل يكون 0، وإلا فإن المبلغ هو الإجمالي
    const totalOrderAmount = Number(order.total_amount || 0);
    const isPaidOnline = order.payment_status === 'paid';
    const finalCod = dto.cod !== undefined ? Number(dto.cod) : isPaidOnline ? 0 : totalOrderAmount;

    // تجهيز بيانات المستلم
    const receiverPhone = order.customer_phone || '';
    const receiverName = order.customer_name || 'عميل المتجر';
    const receiverAddress = dto.receiverAddress || order.customer_address || 'العنوان غير محدد';
    const cityName = dto.receiverCity || order.delivery_zone_name || 'Cairo';

    let deliveryId = '';
    let trackingNumber = '';
    let awbUrl = '';
    let bostaStatus = 'Created';

    if (!isSandbox && rawApiKey) {
      // اتصال حقيقي مع Bosta Production API
      try {
        const baseUrl = 'https://app.bosta.co/api/v1';
        const payload = {
          type: 10, // Deliver & Collect Cash
          specs: {
            packageType: dto.specs?.packageType || 'Parcel',
            size: dto.specs?.size || 'SMALL',
            packageDetails: {
              itemsCount: dto.specs?.itemsCount || 1,
              description: dto.specs?.description || `طلب متجر #${order.order_number}`,
            },
          },
          dropOffAddress: {
            firstLine: receiverAddress,
            city: cityName,
          },
          receiver: {
            firstName: receiverName.split(' ')[0] || receiverName,
            lastName: receiverName.split(' ').slice(1).join(' ') || 'عميل',
            phone: receiverPhone,
          },
          cod: finalCod,
          notes: dto.notes || order.customer_notes || '',
        };

        const res = await fetch(`${baseUrl}/deliveries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: rawApiKey,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok || !data?.data?._id) {
          throw new Error(data?.message || `فشل إنشاء الشحنة في بوسطة (كود: ${res.status})`);
        }

        deliveryId = data.data._id;
        trackingNumber = String(data.data.trackingNumber);
        bostaStatus = data.data.status?.value || 'Created';
        awbUrl = `https://app.bosta.co/api/v1/deliveries/awb/${deliveryId}`;
      } catch (err: any) {
        this.logger.error(`Bosta API Error: ${err.message}`);
        throw new BadRequestException(`خطأ في التواصل مع بوسطة: ${err.message}`);
      }
    } else {
      // محاكاة سريعة وواقعية لبيئة الـ Sandbox التجريبية
      const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
      deliveryId = `bst_mock_${Date.now()}`;
      trackingNumber = `24${randomDigits}`;
      bostaStatus = 'Created';
      awbUrl = `https://stg-app.bosta.co/api/v1/deliveries/awb/${deliveryId}`;
    }

    // 4. حفظ بيانات الشحنة في جدول online_orders
    await this.db
      .updateTable('online_orders')
      .set({
        shipping_carrier: 'bosta',
        bosta_delivery_id: deliveryId,
        bosta_tracking_number: trackingNumber,
        bosta_status: bostaStatus,
        bosta_awb_url: awbUrl,
        bosta_created_at: new Date(),
        status: 'shipped',
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', orderId)
      .execute();

    return {
      ok: true,
      deliveryId,
      trackingNumber,
      status: bostaStatus,
      awbUrl,
      isSandbox,
      message: isSandbox
        ? `تم إنشاء شحنة بوسطة تجريبية بنجاح برقم تتبع #${trackingNumber}`
        : `تم تسجيل الشحنة بنجاح في بوسطة وتوليد رقم التتبع #${trackingNumber}`,
    };
  }

  /**
   * تتبع حالة الشحنة
   */
  async getTracking(trackingNumber: string, actor: AuthContext): Promise<BostaTrackingResponse> {
    const { tenantId } = requireTenantScope(actor);
    const settings = await this.getSettings(actor);
    const rawApiKey = await this.getRawApiKey(tenantId);
    const isSandbox = settings.environment === 'sandbox' || !rawApiKey;

    if (!isSandbox && rawApiKey) {
      try {
        const res = await fetch(`https://app.bosta.co/api/v1/deliveries/track/${trackingNumber}`, {
          headers: { Authorization: rawApiKey },
        });
        const data = await res.json();
        if (res.ok && data?.data) {
          return {
            ok: true,
            trackingNumber,
            currentStatus: data.data.state || 'IN_TRANSIT',
            history: (data.data.transitEvents || []).map((ev: any) => ({
              state: ev.state || ev.status,
              timestamp: ev.timestamp || new Date().toISOString(),
              reason: ev.reason,
            })),
          };
        }
      } catch (err: any) {
        this.logger.warn(`Bosta tracking error: ${err.message}`);
      }
    }

    // حالة المحاكاة يجب ألا تدّعي أن شحنة حقيقية خرجت للتسليم.
    return {
      ok: true,
      trackingNumber,
      currentStatus: 'SANDBOX_CREATED',
      history: [
        {
          state: 'SANDBOX_CREATED',
          timestamp: new Date().toISOString(),
          reason: 'هذه شحنة محاكاة ولم تُرسل إلى بوسطة.',
        },
      ],
    };
  }

  /**
   * إلغاء الشحنة في بوسطة
   */
  async cancelDelivery(deliveryId: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    canOperateShipping(actor);
    const { tenantId } = requireTenantScope(actor);
    const rawApiKey = await this.getRawApiKey(tenantId);

    if (rawApiKey && !deliveryId.startsWith('bst_mock_')) {
      try {
        await fetch(`https://app.bosta.co/api/v1/deliveries/${deliveryId}`, {
          method: 'DELETE',
          headers: { Authorization: rawApiKey },
        });
      } catch (err: any) {
        this.logger.warn(`Bosta cancel warning: ${err.message}`);
      }
    }

    // تحديث حالة الطلب في قاعدة البيانات
    await this.db
      .updateTable('online_orders')
      .set({
        bosta_status: 'Cancelled',
        status: 'confirmed',
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('bosta_delivery_id', '=', deliveryId)
      .execute();

    return {
      ok: true,
      message: 'تم إلغاء شحنة بوسطة بنجاح وإعادة الطلب لحالة مؤكد.',
    };
  }

  async getAwbUrl(
    deliveryId: string,
    actor: AuthContext,
  ): Promise<{ url: string; isSandbox: boolean; trackingNumber: string }> {
    const { tenantId } = requireTenantScope(actor);
    const order = await this.db
      .selectFrom('online_orders')
      .select(['bosta_awb_url', 'bosta_delivery_id', 'bosta_tracking_number'])
      .where('tenant_id', '=', tenantId)
      .where('bosta_delivery_id', '=', deliveryId)
      .executeTakeFirst();
    if (!order || !order.bosta_awb_url) {
      throw new NotFoundException('بوليصة الشحن غير موجودة لهذا المتجر.');
    }
    const url = String(order.bosta_awb_url).trim();
    const isSandbox = url.startsWith('https://stg-app.bosta.co/');
    if (!isSandbox && !url.startsWith('https://app.bosta.co/')) {
      throw new BadRequestException('رابط بوليصة الشحن غير موثوق.');
    }
    return { url, isSandbox, trackingNumber: String(order.bosta_tracking_number || deliveryId) };
  }
}
