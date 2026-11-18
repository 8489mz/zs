import { Inject, Injectable, Logger, BadRequestException, UnauthorizedException, Optional } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { planWebhookOrderLookup, selectUnambiguousOrder } from './engines/webhook-order-resolution.engine';
import { isSandboxPaymentAllowed } from './engines/online-order-access.engine';
import { releaseLocationStock } from '../../common/utils/location-stock-ledger';
import { resolveGatewayCurrency, toGatewayMinorAmount } from './engines/gateway-amount.engine';
import { classifyPaymobTransaction } from './engines/paymob-notification.engine';
import { extractReservationItems } from './engines/storefront-reservation.engine';
import * as crypto from 'crypto';
import { StorefrontPaymentHelpersService } from './storefront-payment-helpers.service';
import { StorefrontPaymentSessionService } from './storefront-payment-session.service';
import { type LockedOnlineOrder, type StorefrontWebhookResult, type TenantPaymentConfig } from './storefront-payment.types';

@Injectable()
export class StorefrontPaymentService {
  private readonly helpers: StorefrontPaymentHelpersService;
  private readonly logger = new Logger(StorefrontPaymentService.name);
  private readonly session: StorefrontPaymentSessionService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {
    this.helpers = new StorefrontPaymentHelpersService({
      db: this.db,
    });
    this.session = new StorefrontPaymentSessionService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      findOrderByToken: this.findOrderByToken.bind(this),
      sandboxSessionOrThrow: this.sandboxSessionOrThrow.bind(this),
    });
  }

  private async expectedPaymentCurrency(trx: Transaction<Database>, tenantId: string, provider: string): Promise<string> {
    return this.helpers.expectedPaymentCurrency(trx, tenantId, provider);
  }

  private paymentReviewReason(
    order: LockedOnlineOrder, provider: string, sessionId: string,
    amountMinor: unknown, currency: unknown, expectedCurrency: string,
  ): string | null {
    return this.helpers.paymentReviewReason(order, provider, sessionId, amountMinor, currency, expectedCurrency);
  }

  private async markPaymentForReview(
    trx: Transaction<Database>, order: LockedOnlineOrder, provider: string,
    transactionId: string, sessionId: string, response: unknown, reason: string,
  ): Promise<StorefrontWebhookResult> {
    return this.helpers.markPaymentForReview(trx, order, provider, transactionId, sessionId, response, reason);
  }

  private isCurrentPaymentSession(order: LockedOnlineOrder, provider: string, sessionId: string): boolean {
    return this.helpers.isCurrentPaymentSession(order, provider, sessionId);
  }

  private isRepeatedPaidWebhook(order: LockedOnlineOrder, provider: string, transactionId: string, sessionId: string): boolean {
    return this.helpers.isRepeatedPaidWebhook(order, provider, transactionId, sessionId);
  }

  private async getTenantBySlug(slug: string) {
    return this.helpers.getTenantBySlug(slug);
  }

  private async findOrderByToken(tenantId: string, orderNumber: string, token: string | undefined) {
    return this.helpers.findOrderByToken(tenantId, orderNumber, token);
  }

  private sandboxSessionOrThrow(config: TenantPaymentConfig, session: Record<string, unknown>) {
    return this.helpers.sandboxSessionOrThrow(config, session);
  }

  async getTenantPaymentConfig(tenantId: string): Promise<TenantPaymentConfig> {
    return this.session.getTenantPaymentConfig(tenantId);
  }

  async initiatePaymentSession(slug: string, orderNumber: string, token: string | undefined, origin?: string) {
    return this.session.initiatePaymentSession(slug, orderNumber, token, origin);
  }

  /**
   * Single resolution path for every public payment webhook — executes the plan
   * produced by `planWebhookOrderLookup` (invariant WH-1, see that engine for why
   * `order_number` alone is not an identity across tenants).
   */
  private async resolveWebhookOrder(params: {
    provider: string;
    tenantId: string;
    orderNumber: string;
    gatewayOrderId: string;
  }) {
    const plan = planWebhookOrderLookup(params);

    if (plan.mode === 'refuse') {
      this.logger.warn(
        `${params.provider} webhook refused (${plan.reason}): order "${params.orderNumber}" cannot be identified without crossing tenants.`,
      );
      return null;
    }

    if (plan.mode === 'tenant_scoped') {
      const order = await this.db
        .selectFrom('online_orders')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${plan.tenantId}`)
        .where(plan.by, '=', plan.value)
        .executeTakeFirst();

      return order ?? null;
    }

    // `.limit(2)` is what makes ambiguity detectable without scanning the table.
    const matches = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where('gateway_order_id', '=', plan.gatewayOrderId)
      .limit(2)
      .execute();

    const order = selectUnambiguousOrder(matches);
    if (!order) {
      this.logger.warn(
        `${params.provider} webhook gateway id "${plan.gatewayOrderId}" matched ${matches.length} orders; refusing ambiguous cross-tenant update.`,
      );
      return null;
    }

    return order;
  }

  /**
   * Compensates a failed, declined, or expired online payment.
   * Releases reserved location stock and claimed coupons, marking the order failed.
   */
  private async compensateFailedOrderPayment(
    trx: Transaction<Database>,
    order: any,
    gatewayResponse: any,
  ): Promise<void> {
    await trx
      .updateTable('online_orders')
      .set({
        payment_status: 'failed',
        status: 'payment_failed',
        stock_reserved: false,
        gateway_response_json: JSON.stringify(gatewayResponse),
        updated_at: new Date(),
      })
      .where('id', '=', order.id)
      .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
      .execute();

    if (order.stock_reserved) {
      const items = extractReservationItems(order.items_json);
      if (items.length > 0) {
        await releaseLocationStock(trx, {
          tenantId: order.tenant_id,
          accountId: order.account_id,
          branchId: order.reserved_branch_id ?? order.branch_id,
          locationId: order.reserved_location_id,
          items: items.map((it) => ({ productId: it.productId, qty: it.quantity })),
        });
      }
    }

    if (order.coupon_code) {
      await trx
        .updateTable('storefront_coupons')
        .set({ times_used: sql`GREATEST(times_used - 1, 0)`, updated_at: new Date() })
        .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
        .where('code', '=', String(order.coupon_code).toUpperCase())
        .execute();
    }
  }

  async processPaymobWebhook(headers: Record<string, any>, body: any, rawBody?: Buffer): Promise<StorefrontWebhookResult> {
    const obj = body?.obj || body;
    const merchantOrderId = String(obj?.order?.merchant_order_id || '');

    let tenantId = '';
    let orderNumber = '';

    if (merchantOrderId.includes('__')) {
      const parts = merchantOrderId.split('__');
      tenantId = parts[0];
      orderNumber = parts.slice(1).join('__');
    } else {
      orderNumber = merchantOrderId;
    }

    const order = await this.resolveWebhookOrder({
      provider: 'Paymob',
      tenantId,
      orderNumber,
      gatewayOrderId: String(obj?.order?.id || ''),
    });

    if (!order) {
      this.logger.warn(`Paymob Webhook received for unknown order: ${merchantOrderId}`);
      return { ok: false, message: 'Order not found' };
    }

    // Validate HMAC (Fail-Closed: without a configured secret or signature header, reject)
    const config = await this.getTenantPaymentConfig(order.tenant_id);
    const hmacHeader = (headers['hmac'] || headers['HMAC'] || '') as string;

    if (!config.hmacSecret || !hmacHeader) {
      this.logger.warn(`Paymob webhook rejected: storefront_paymob_hmac_secret not configured or hmac header missing for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع HMAC غير صحيح أو مفقود.');
    }

    const concatenated = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success,
    ].join('');

    const computedHmac = crypto.createHmac('sha512', config.hmacSecret).update(concatenated).digest('hex');
    const hmacBuf = Buffer.from(hmacHeader.toLowerCase());
    const computedBuf = Buffer.from(computedHmac.toLowerCase());

    if (hmacBuf.length !== computedBuf.length || !crypto.timingSafeEqual(hmacBuf, computedBuf)) {
      this.logger.error(`Paymob HMAC verification failed for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع HMAC غير صحيح.');
    }

    // success + not pending does NOT prove capture: Paymob notifies
    // authorization-only holds, voids, and refunds with the same shape.
    // An authorization-only notification changes nothing — the order
    // stays pending until the capture callback arrives.
    const transactionKind = classifyPaymobTransaction(obj);
    if (transactionKind === 'authorization_only') {
      this.logger.log(`Paymob authorization-only notification for order ${order.order_number}; awaiting capture, no state change.`);
      return { ok: true, received: true };
    }

    const isSuccessful = obj.success === true && obj.pending === false;
    let shouldNotifyWhatsApp = false;

    const result = await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedOrder) {
        return { ok: false, message: 'Order not found' };
      }

      if (lockedOrder.payment_status === 'paid') {
        if (isSuccessful && !this.isRepeatedPaidWebhook(lockedOrder, 'paymob', String(obj.id || ''), String(obj.order?.id || ''))) {
          return this.markPaymentForReview(trx, lockedOrder, 'paymob', String(obj.id || ''), String(obj.order?.id || ''), body, 'additional_payment');
        }
        return { ok: true, status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid', orderNumber: lockedOrder.order_number, alreadyPaid: true };
      }

      if (isSuccessful) {
        const sessionId = String(obj.order?.id || '');
        // A void or refund proves the attempt produced no money. The
        // failure branch below only handles definitive failures
        // (success=false), so void/refund needs its own explicit path:
        // fail the pending order and release its reservation instead of
        // leaving it pending on a dead authorization.
        if (transactionKind === 'void_or_refund') {
          if (!this.isCurrentPaymentSession(lockedOrder, 'paymob', sessionId) || lockedOrder.status !== 'pending') {
            return { ok: true, received: true };
          }
          await this.compensateFailedOrderPayment(trx, lockedOrder, body);
          this.logger.warn(`Order ${lockedOrder.order_number} marked as FAILED via Paymob Webhook (void/refund); stock reservation released.`);
          return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
        }
        // A successful callback carrying none of Paymob's capture flags
        // proves nothing; route it to a human instead of marking paid.
        if (transactionKind === 'unclassified') {
          return this.markPaymentForReview(trx, lockedOrder, 'paymob', String(obj.id || ''), sessionId, body, 'non_capture_transaction');
        }
        const reason = this.paymentReviewReason(lockedOrder, 'paymob', sessionId, obj.amount_cents, obj.currency, 'EGP');
        if (reason) return this.markPaymentForReview(trx, lockedOrder, 'paymob', String(obj.id || ''), sessionId, body, reason);

        await trx
          .updateTable('online_orders')
          .set({
            payment_status: 'paid',
            status: 'confirmed',
            gateway_provider: 'paymob',
            gateway_transaction_id: String(obj.id || ''),
            gateway_order_id: String(obj.order?.id || lockedOrder.gateway_order_id || ''),
            gateway_response_json: JSON.stringify(body),
            paid_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', lockedOrder.id)
          .where(sql<boolean>`tenant_id = ${lockedOrder.tenant_id}`)
          .execute();

        shouldNotifyWhatsApp = true;
        this.logger.log(`Order ${lockedOrder.order_number} marked as PAID via Paymob Webhook.`);
        return { ok: true, status: 'paid', orderNumber: lockedOrder.order_number };
      } else {
        if (obj.pending !== false || obj.success !== false) return { ok: true, received: true };
        if (!this.isCurrentPaymentSession(lockedOrder, 'paymob', String(obj.order?.id || '')) || lockedOrder.status !== 'pending') {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(`Order ${lockedOrder.order_number} marked as FAILED via Paymob Webhook; stock reservation released.`);
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }
    });

    // Trigger WhatsApp notification outside transaction
    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }

  async processXPayWebhook(headers: Record<string, any>, body: any, rawBody?: Buffer): Promise<StorefrontWebhookResult> {
    this.logger.log(`XPay Webhook received: ${JSON.stringify(body)}`);
    const data = body?.data || body;
    const transactionStatus = String(data?.transaction_status || body?.transaction_status || data?.status || '').toUpperCase();
    const transactionId = String(data?.transaction_id || data?.id || body?.transaction_id || '');

    // Extract orderNumber from custom_fields or payload
    let orderNumber = '';
    let tenantId = '';
    const customFields = Array.isArray(data?.custom_fields) ? data.custom_fields : Array.isArray(body?.custom_fields) ? body.custom_fields : [];
    for (const f of customFields) {
      if (f.field_label === 'OrderNumber' || f.label === 'OrderNumber') orderNumber = String(f.value || '');
      if (f.field_label === 'TenantId' || f.label === 'TenantId') tenantId = String(f.value || '');
    }

    const order = await this.resolveWebhookOrder({
      provider: 'XPay',
      tenantId,
      orderNumber,
      gatewayOrderId: transactionId,
    });

    if (!order) {
      this.logger.warn(`XPay Webhook received for unknown order. Transaction: ${transactionId}, Order: ${orderNumber}`);
      return { ok: false, message: 'Order not found' };
    }

    // Cryptographic signature check (Fail-closed)
    const config = await this.getTenantPaymentConfig(order.tenant_id);
    const xpaySecret = config.xpayApiKey || process.env.XPAY_WEBHOOK_SECRET || process.env.XPAY_API_KEY || '';
    const signatureHeader = (headers['x-xpay-signature'] || headers['xpay-signature'] || headers['x-signature'] || headers['signature'] || '') as string;

    if (!xpaySecret || !signatureHeader) {
      this.logger.warn(`XPay webhook rejected: secret or signature header missing for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع XPay غير صحيح أو مفقود.');
    }

    const payload = rawBody && rawBody.length > 0 ? rawBody : Buffer.from(JSON.stringify(body));
    const computed = crypto.createHmac('sha256', xpaySecret).update(payload).digest('hex');
    const sigBuf = Buffer.from(signatureHeader.toLowerCase());
    const compBuf = Buffer.from(computed.toLowerCase());

    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
      this.logger.error(`XPay signature verification failed for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع XPay غير صحيح.');
    }

    const isSuccessful = transactionStatus === 'SUCCESSFUL' || transactionStatus === 'SUCCESS' || transactionStatus === 'PAID';
    let shouldNotifyWhatsApp = false;

    const result = await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedOrder) {
        return { ok: false, message: 'Order not found' };
      }

      if (lockedOrder.payment_status === 'paid') {
        if (isSuccessful && !this.isRepeatedPaidWebhook(lockedOrder, 'xpay', transactionId, transactionId)) {
          return this.markPaymentForReview(trx, lockedOrder, 'xpay', transactionId, transactionId, body, 'additional_payment');
        }
        return { ok: true, status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid', orderNumber: lockedOrder.order_number, alreadyPaid: true };
      }

      if (isSuccessful) {
        const amount = data?.amount ?? data?.total_amount ?? body?.amount;
        const amountMinor = amount === undefined || amount === null ? undefined : Math.round(Number(amount) * 100);
        const reason = this.paymentReviewReason(lockedOrder, 'xpay', transactionId, amountMinor, data?.currency ?? body?.currency, 'EGP');
        if (reason) return this.markPaymentForReview(trx, lockedOrder, 'xpay', transactionId, transactionId, body, reason);

        await trx
          .updateTable('online_orders')
          .set({
            payment_status: 'paid',
            status: 'confirmed',
            gateway_provider: 'xpay',
            gateway_transaction_id: transactionId,
            gateway_response_json: JSON.stringify(body),
            paid_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', lockedOrder.id)
          .where(sql<boolean>`tenant_id = ${lockedOrder.tenant_id}`)
          .execute();

        shouldNotifyWhatsApp = true;
        this.logger.log(`Order ${lockedOrder.order_number} marked as PAID via XPay Webhook.`);
        return { ok: true, status: 'paid', orderNumber: lockedOrder.order_number };
      } else {
        if (!['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(transactionStatus) ||
            !this.isCurrentPaymentSession(lockedOrder, 'xpay', transactionId) || lockedOrder.status !== 'pending') {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(`Order ${lockedOrder.order_number} marked as FAILED via XPay Webhook; stock reservation released.`);
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }
    });

    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }

  async processMockPayment(
    slug: string,
    orderNumber: string,
    token: string | undefined,
    payload?: { cardNumber?: string; cardHolder?: string },
  ) {
    const tenant = await this.getTenantBySlug(slug);
    const order = await this.findOrderByToken(tenant.id, orderNumber, token);

    // SF-2 / F11: the simulator is callable directly, so it re-checks everything the UI assumes.
    const config = await this.getTenantPaymentConfig(tenant.id);
    if (!isSandboxPaymentAllowed(config)) {
      throw new BadRequestException('الدفع التجريبي غير متاح في هذا المتجر');
    }
    if (order.payment_status === 'paid') {
      throw new BadRequestException('تم سداد هذا الطلب بالفعل');
    }
    if (order.status === 'cancelled' || order.sale_id) {
      throw new BadRequestException('لا يمكن سداد هذا الطلب');
    }
    if (order.gateway_provider && order.gateway_provider !== 'mock') {
      throw new BadRequestException('هذا الطلب مرتبط بجلسة دفع حقيقية ولا يقبل الدفع التجريبي');
    }

    const transactionId = `MOCK-TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // gateway_provider = 'mock' is what keeps this out of the books: resolveOnlineOrderCollection
    // never treats a mock payment as collected, so the delivery invoice stays cash-on-delivery.
    const updated = await this.db
      .updateTable('online_orders')
      .set({
        payment_status: 'paid',
        status: 'confirmed',
        gateway_provider: 'mock',
        gateway_transaction_id: transactionId,
        paid_at: new Date(),
        gateway_response_json: JSON.stringify({
          mock: true,
          cardHolder: payload?.cardHolder || 'عميل تجريبي',
          last4: payload?.cardNumber ? payload.cardNumber.slice(-4) : '4242',
          paidAt: new Date().toISOString(),
        }),
        updated_at: new Date(),
      })
      .where('id', '=', order.id)
      .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
      .where(sql<boolean>`COALESCE(payment_status, 'pending') <> 'paid'`)
      .where('status', 'not in', ['cancelled', 'payment_failed', 'review_required'])
      .where('sale_id', 'is', null)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) {
      throw new BadRequestException('تغيرت حالة الطلب أثناء الدفع التجريبي؛ يرجى تحديث الصفحة');
    }

    // Trigger WhatsApp notification
    if (this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, tenant.id).catch(() => undefined);
    }

    return {
      ok: true,
      orderNumber: order.order_number,
      paymentStatus: 'paid',
      transactionId,
      message: 'تم سداد الطلب بنجاح في الوضع التجريبي (Sandbox Mock)!',
    };
  }

  async getOrderPaymentStatus(slug: string, orderNumber: string, token: string | undefined) {
    const tenant = await this.getTenantBySlug(slug);
    const order = await this.findOrderByToken(tenant.id, orderNumber, token);

    return {
      ok: true,
      orderNumber: order.order_number,
      paymentStatus: order.payment_status || 'pending',
      orderStatus: order.status,
      totalAmount: Number(order.total_amount || 0),
      gatewayProvider: order.gateway_provider || null,
      gatewayTransactionId: order.gateway_transaction_id || null,
      paidAt: order.paid_at || null,
    };
  }

  async processTapWebhook(headers: Record<string, any>, body: any, rawBody?: Buffer): Promise<StorefrontWebhookResult> {
    this.logger.log(`Tap Webhook received: ${JSON.stringify(body)}`);
    const chargeId = String(body?.id || '');
    const status = String(body?.status || '').toUpperCase();
    const metadata = body?.metadata || {};
    const reference = body?.reference || {};

    let orderNumber = String(metadata?.orderNumber || reference?.order || reference?.transaction || '');
    let tenantId = String(metadata?.tenantId || '');

    const order = await this.resolveWebhookOrder({
      provider: 'Tap',
      tenantId,
      orderNumber,
      gatewayOrderId: chargeId,
    });

    if (!order) {
      this.logger.warn(`Tap Webhook received for unknown order. ChargeId: ${chargeId}, Order: ${orderNumber}`);
      return { ok: false, message: 'Order not found' };
    }

    // Tap Verification (Fail-closed)
    const config = await this.getTenantPaymentConfig(order.tenant_id);
    if (!config.tapSecretKey) {
      this.logger.warn(`Tap webhook rejected: tapSecretKey not configured for order ${order.order_number}`);
      throw new UnauthorizedException('إعدادات بوابة Tap غير مكتملة.');
    }

    const hashHeader = (headers['hashstring'] || headers['Hashstring'] || headers['hash'] || '') as string;
    let isVerified = false;

    // 1. If hashstring is present, verify HMAC-SHA256
    if (hashHeader) {
      const strToHash = `${body?.id || ''}${Number(body?.amount || 0).toFixed(2)}${body?.currency || ''}${body?.gateway?.reference || ''}${body?.payment_reference || ''}${body?.status || ''}${body?.created || ''}`;
      const computedFromFields = crypto.createHmac('sha256', config.tapSecretKey.trim()).update(strToHash).digest('hex');
      const computedFromRaw = rawBody && rawBody.length > 0 ? crypto.createHmac('sha256', config.tapSecretKey.trim()).update(rawBody).digest('hex') : '';

      const hashBuf = Buffer.from(hashHeader.toLowerCase());
      const fBuf = Buffer.from(computedFromFields.toLowerCase());
      const rBuf = Buffer.from(computedFromRaw.toLowerCase());

      if ((hashBuf.length === fBuf.length && crypto.timingSafeEqual(hashBuf, fBuf)) ||
          (rBuf.length > 0 && hashBuf.length === rBuf.length && crypto.timingSafeEqual(hashBuf, rBuf))) {
        isVerified = true;
      }
    }

    // 2. If not verified by hash header, verify by fetching the charge directly from Tap API
    if (!isVerified && chargeId) {
      try {
        const tapCheckRes = await fetch(`https://api.tap.company/v2/charges/${chargeId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.tapSecretKey.trim()}`,
          },
        });
        if (tapCheckRes.ok) {
          const tapCheckData: any = await tapCheckRes.json();
          const fetchedStatus = String(tapCheckData?.status || '').toUpperCase();
          const fetchedAmount = Number(tapCheckData?.amount || 0);
          const fetchedCurrency = String(tapCheckData?.currency || '').toUpperCase();
          const fetchedOrderNum = String(tapCheckData?.metadata?.orderNumber || tapCheckData?.reference?.order || '');
          if ((fetchedStatus === 'CAPTURED' || fetchedStatus === 'PAID') &&
              ['CAPTURED', 'PAID', 'SUCCESS'].includes(status) &&
              Math.round(fetchedAmount * 100) === Math.round(Number(body?.amount) * 100) &&
              fetchedCurrency === String(body?.currency || '').toUpperCase() &&
              fetchedOrderNum === order.order_number) {
            isVerified = true;
          }
        }
      } catch (err: any) {
        this.logger.error(`Tap API verification failed: ${err.message}`);
      }
    }

    if (!isVerified) {
      this.logger.error(`Tap Webhook verification failed for order ${order.order_number}`);
      throw new UnauthorizedException('تعذر التحقق من صحة إشعار Tap.');
    }

    const isSuccessful = status === 'CAPTURED' || status === 'PAID' || status === 'SUCCESS';
    const isFailed = status === 'DECLINED' || status === 'CANCELLED' || status === 'FAILED';
    let shouldNotifyWhatsApp = false;

    const result = await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedOrder) {
        return { ok: false, message: 'Order not found' };
      }

      if (lockedOrder.payment_status === 'paid') {
        if (isSuccessful && !this.isRepeatedPaidWebhook(lockedOrder, 'tap', chargeId, chargeId)) {
          return this.markPaymentForReview(trx, lockedOrder, 'tap', chargeId, chargeId, body, 'additional_payment');
        }
        return { ok: true, status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid', orderNumber: lockedOrder.order_number, alreadyPaid: true };
      }

      if (isSuccessful) {
        const currency = await this.expectedPaymentCurrency(trx, lockedOrder.tenant_id, 'tap');
        const amountMinor = body?.amount === undefined ? undefined : toGatewayMinorAmount(Number(body.amount), currency);
        const reason = this.paymentReviewReason(lockedOrder, 'tap', chargeId, amountMinor, body?.currency, currency);
        if (reason) return this.markPaymentForReview(trx, lockedOrder, 'tap', chargeId, chargeId, body, reason);

        await trx
          .updateTable('online_orders')
          .set({
            payment_status: 'paid',
            status: 'confirmed',
            gateway_provider: 'tap',
            gateway_transaction_id: chargeId,
            gateway_response_json: JSON.stringify(body),
            paid_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', lockedOrder.id)
          .where(sql<boolean>`tenant_id = ${lockedOrder.tenant_id}`)
          .execute();

        shouldNotifyWhatsApp = true;
        this.logger.log(`Order ${lockedOrder.order_number} marked as PAID via Tap Webhook.`);
        return { ok: true, status: 'paid', orderNumber: lockedOrder.order_number };
      } else if (isFailed) {
        if (!this.isCurrentPaymentSession(lockedOrder, 'tap', chargeId) || lockedOrder.status !== 'pending') {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(`Order ${lockedOrder.order_number} marked as FAILED via Tap Webhook; stock reservation released.`);
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }

      return { ok: true, status: status.toLowerCase(), orderNumber: lockedOrder.order_number };
    });

    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }

  async processStripeWebhook(headers: Record<string, any>, body: any, rawBody?: Buffer): Promise<StorefrontWebhookResult> {
    this.logger.log(`Stripe Webhook received: ${body?.type}`);
    const eventType = String(body?.type || '');
    const obj = body?.data?.object || body;

    let orderNumber = String(obj?.metadata?.orderNumber || '');
    let tenantId = String(obj?.metadata?.tenantId || '');
    const clientRef = String(obj?.client_reference_id || '');

    if (!orderNumber && clientRef.includes('__')) {
      const parts = clientRef.split('__');
      tenantId = parts[0];
      orderNumber = parts.slice(1).join('__');
    }

    const sessionId = String(obj?.id || '');

    const order = await this.resolveWebhookOrder({
      provider: 'Stripe',
      tenantId,
      orderNumber,
      gatewayOrderId: sessionId,
    });

    if (!order) {
      this.logger.warn(`Stripe Webhook received for unknown order: Session: ${sessionId}, Order: ${orderNumber}`);
      return { ok: false, message: 'Order not found' };
    }

    // Cryptographic signature check (Fail-closed + Replay Protection)
    const config = await this.getTenantPaymentConfig(order.tenant_id);
    const stripeSecret = config.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '';
    const sigHeader = (headers['stripe-signature'] || headers['Stripe-Signature'] || '') as string;

    if (!stripeSecret || !sigHeader || !rawBody) {
      this.logger.warn(`Stripe webhook rejected: missing secret, signature, or rawBody for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع Stripe غير صحيح أو مفقود.');
    }

    const parts = sigHeader.split(',').reduce((acc: Record<string, string>, item: string) => {
      const [k, v] = item.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const timestamp = parts['t'];
    const providedSig = parts['v1'];
    if (!timestamp || !providedSig) {
      throw new UnauthorizedException('ترويسة توقيع Stripe غير مكتملة.');
    }

    // 300s replay protection
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      throw new UnauthorizedException('تم رفض توقيع Stripe بسبب انتهاء صلاحية الختم الزمني (Replay Protection).');
    }

    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const computed = crypto.createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
    const providedBuf = Buffer.from(providedSig);
    const computedBuf = Buffer.from(computed);

    if (providedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(providedBuf, computedBuf)) {
      this.logger.error(`Stripe signature verification failed for order ${order.order_number}`);
      throw new UnauthorizedException('توقيع Stripe غير صحيح.');
    }

    // A Checkout Session can be completed while an asynchronous payment is still unpaid.
    const isSuccessful = eventType === 'checkout.session.completed' && obj?.payment_status === 'paid';

    const isFailed =
      eventType === 'payment_intent.payment_failed' ||
      eventType === 'checkout.session.expired' ||
      obj?.status === 'failed' ||
      obj?.status === 'canceled';

    let shouldNotifyWhatsApp = false;

    const result = await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedOrder) {
        return { ok: false, message: 'Order not found' };
      }

      if (lockedOrder.payment_status === 'paid') {
        const paidTransactionId = String(obj?.payment_intent || obj?.id || '');
        if (isSuccessful && !this.isRepeatedPaidWebhook(lockedOrder, 'stripe', paidTransactionId, sessionId)) {
          return this.markPaymentForReview(trx, lockedOrder, 'stripe', paidTransactionId, sessionId, body, 'additional_payment');
        }
        return { ok: true, status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid', orderNumber: lockedOrder.order_number, alreadyPaid: true };
      }

      if (isSuccessful) {
        const currency = await this.expectedPaymentCurrency(trx, lockedOrder.tenant_id, 'stripe');
        const txnId = String(obj?.payment_intent || obj?.id || '');
        const reason = this.paymentReviewReason(lockedOrder, 'stripe', sessionId, obj?.amount_total, obj?.currency, currency);
        if (reason) return this.markPaymentForReview(trx, lockedOrder, 'stripe', txnId, sessionId, body, reason);

        await trx
          .updateTable('online_orders')
          .set({
            payment_status: 'paid',
            status: 'confirmed',
            gateway_provider: 'stripe',
            gateway_transaction_id: txnId,
            gateway_response_json: JSON.stringify(body),
            paid_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', lockedOrder.id)
          .where(sql<boolean>`tenant_id = ${lockedOrder.tenant_id}`)
          .execute();

        shouldNotifyWhatsApp = true;
        this.logger.log(`Order ${lockedOrder.order_number} marked as PAID via Stripe Webhook.`);
        return { ok: true, status: 'paid', orderNumber: lockedOrder.order_number };
      } else if (isFailed) {
        if (!this.isCurrentPaymentSession(lockedOrder, 'stripe', sessionId) || lockedOrder.status !== 'pending') {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(`Order ${lockedOrder.order_number} marked as FAILED via Stripe Webhook; stock reservation released.`);
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }

      return { ok: true, received: true };
    });

    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }
}
