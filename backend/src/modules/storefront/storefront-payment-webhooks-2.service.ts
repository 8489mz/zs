import { BadRequestException, UnauthorizedException, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql, type Transaction, type Selectable } from 'kysely';
import { type Database, type TenantTable, type OnlineOrderTable } from '../../database/database.types';
import { type WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { isSandboxPaymentAllowed } from './engines/online-order-access.engine';
import { toGatewayMinorAmount } from './engines/gateway-amount.engine';
import * as crypto from 'crypto';
import {
  type TenantPaymentConfig,
  type StorefrontWebhookResult,
  type LockedOnlineOrder,
} from './storefront-payment.types';

/**
 * StorefrontPaymentWebhooks2Service — slice S4 of the storefront payment split.
 * Pure move of the second webhook entry points from the storefront
 * payment service. No behavior change: the bodies are byte-identical;
 * the facade keeps thin public delegates with the same names and
 * signatures. The slice reaches the small helpers and the shared
 * webhook helpers only through bound deps — it never imports another
 * slice service.
 */

export interface StorefrontPaymentWebhooks2Deps {
  db: Kysely<Database>;
  whatsappService?: WhatsAppGatewayService;
  // Bound cross-slice deps from the facade's own methods (passed bound
  // so the moved bodies stay byte-identical).
  getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  findOrderByToken: (
    tenantId: string,
    orderNumber: string,
    token: string | undefined,
  ) => Promise<Selectable<OnlineOrderTable>>;
  expectedPaymentCurrency: (trx: Transaction<Database>, tenantId: string, provider: string) => Promise<string>;
  paymentReviewReason: (
    order: LockedOnlineOrder,
    provider: string,
    sessionId: string,
    amountMinor: unknown,
    currency: unknown,
    expectedCurrency: string,
  ) => string | null;
  markPaymentForReview: (
    trx: Transaction<Database>,
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
    response: unknown,
    reason: string,
  ) => Promise<StorefrontWebhookResult>;
  isCurrentPaymentSession: (order: LockedOnlineOrder, provider: string, sessionId: string) => boolean;
  isRepeatedPaidWebhook: (
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
  ) => boolean;
  getTenantPaymentConfig: (tenantId: string) => Promise<TenantPaymentConfig>;
  resolveWebhookOrder: (params: {
    provider: string;
    tenantId: string;
    orderNumber: string;
    gatewayOrderId: string;
  }) => Promise<Selectable<OnlineOrderTable> | null>;
  compensateFailedOrderPayment: (trx: Transaction<Database>, order: any, gatewayResponse: any) => Promise<void>;
}

@Injectable()
export class StorefrontPaymentWebhooks2Service {
  private readonly db: Kysely<Database>;
  private readonly whatsappService?: WhatsAppGatewayService;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  private readonly findOrderByToken: (
    tenantId: string,
    orderNumber: string,
    token: string | undefined,
  ) => Promise<Selectable<OnlineOrderTable>>;
  private readonly expectedPaymentCurrency: (
    trx: Transaction<Database>,
    tenantId: string,
    provider: string,
  ) => Promise<string>;
  private readonly paymentReviewReason: (
    order: LockedOnlineOrder,
    provider: string,
    sessionId: string,
    amountMinor: unknown,
    currency: unknown,
    expectedCurrency: string,
  ) => string | null;
  private readonly markPaymentForReview: (
    trx: Transaction<Database>,
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
    response: unknown,
    reason: string,
  ) => Promise<StorefrontWebhookResult>;
  private readonly isCurrentPaymentSession: (order: LockedOnlineOrder, provider: string, sessionId: string) => boolean;
  private readonly isRepeatedPaidWebhook: (
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
  ) => boolean;
  private readonly getTenantPaymentConfig: (tenantId: string) => Promise<TenantPaymentConfig>;
  private readonly resolveWebhookOrder: (params: {
    provider: string;
    tenantId: string;
    orderNumber: string;
    gatewayOrderId: string;
  }) => Promise<Selectable<OnlineOrderTable> | null>;
  private readonly compensateFailedOrderPayment: (
    trx: Transaction<Database>,
    order: any,
    gatewayResponse: any,
  ) => Promise<void>;
  private readonly logger = new Logger(StorefrontPaymentWebhooks2Service.name);

  constructor(deps: StorefrontPaymentWebhooks2Deps) {
    this.db = deps.db;
    this.whatsappService = deps.whatsappService;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.findOrderByToken = deps.findOrderByToken;
    this.expectedPaymentCurrency = deps.expectedPaymentCurrency;
    this.paymentReviewReason = deps.paymentReviewReason;
    this.markPaymentForReview = deps.markPaymentForReview;
    this.isCurrentPaymentSession = deps.isCurrentPaymentSession;
    this.isRepeatedPaidWebhook = deps.isRepeatedPaidWebhook;
    this.getTenantPaymentConfig = deps.getTenantPaymentConfig;
    this.resolveWebhookOrder = deps.resolveWebhookOrder;
    this.compensateFailedOrderPayment = deps.compensateFailedOrderPayment;
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

    const orderNumber = String(metadata?.orderNumber || reference?.order || reference?.transaction || '');
    const tenantId = String(metadata?.tenantId || '');

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
      const computedFromFields = crypto
        .createHmac('sha256', config.tapSecretKey.trim())
        .update(strToHash)
        .digest('hex');
      const computedFromRaw =
        rawBody && rawBody.length > 0
          ? crypto.createHmac('sha256', config.tapSecretKey.trim()).update(rawBody).digest('hex')
          : '';

      const hashBuf = Buffer.from(hashHeader.toLowerCase());
      const fBuf = Buffer.from(computedFromFields.toLowerCase());
      const rBuf = Buffer.from(computedFromRaw.toLowerCase());

      if (
        (hashBuf.length === fBuf.length && crypto.timingSafeEqual(hashBuf, fBuf)) ||
        (rBuf.length > 0 && hashBuf.length === rBuf.length && crypto.timingSafeEqual(hashBuf, rBuf))
      ) {
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
          if (
            (fetchedStatus === 'CAPTURED' || fetchedStatus === 'PAID') &&
            ['CAPTURED', 'PAID', 'SUCCESS'].includes(status) &&
            Math.round(fetchedAmount * 100) === Math.round(Number(body?.amount) * 100) &&
            fetchedCurrency === String(body?.currency || '').toUpperCase() &&
            fetchedOrderNum === order.order_number
          ) {
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
        return {
          ok: true,
          status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid',
          orderNumber: lockedOrder.order_number,
          alreadyPaid: true,
        };
      }

      if (isSuccessful) {
        const currency = await this.expectedPaymentCurrency(trx, lockedOrder.tenant_id, 'tap');
        const amountMinor =
          body?.amount === undefined ? undefined : toGatewayMinorAmount(Number(body.amount), currency);
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
        this.logger.warn(
          `Order ${lockedOrder.order_number} marked as FAILED via Tap Webhook; stock reservation released.`,
        );
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }

      return { ok: true, status: status.toLowerCase(), orderNumber: lockedOrder.order_number };
    });

    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }

  async processStripeWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
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
      this.logger.warn(
        `Stripe webhook rejected: missing secret, signature, or rawBody for order ${order.order_number}`,
      );
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
          return this.markPaymentForReview(
            trx,
            lockedOrder,
            'stripe',
            paidTransactionId,
            sessionId,
            body,
            'additional_payment',
          );
        }
        return {
          ok: true,
          status: lockedOrder.status === 'review_required' ? 'review_required' : 'paid',
          orderNumber: lockedOrder.order_number,
          alreadyPaid: true,
        };
      }

      if (isSuccessful) {
        const currency = await this.expectedPaymentCurrency(trx, lockedOrder.tenant_id, 'stripe');
        const txnId = String(obj?.payment_intent || obj?.id || '');
        const reason = this.paymentReviewReason(
          lockedOrder,
          'stripe',
          sessionId,
          obj?.amount_total,
          obj?.currency,
          currency,
        );
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
        this.logger.warn(
          `Order ${lockedOrder.order_number} marked as FAILED via Stripe Webhook; stock reservation released.`,
        );
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
