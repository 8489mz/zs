import { UnauthorizedException, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import { Database } from '../../database/database.types';
import { type WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { planWebhookOrderLookup, selectUnambiguousOrder } from './engines/webhook-order-resolution.engine';
import { releaseLocationStock } from '../../common/utils/location-stock-ledger';
import { classifyPaymobTransaction } from './engines/paymob-notification.engine';
import { extractReservationItems } from './engines/storefront-reservation.engine';
import * as crypto from 'crypto';
import {
  type TenantPaymentConfig,
  type StorefrontWebhookResult,
  type LockedOnlineOrder,
} from './storefront-payment.types';

/**
 * StorefrontPaymentWebhooksService — slice S3 of the storefront payment split.
 * Pure move of the shared webhook helpers and the Paymob and XPay entry
 * points from the storefront payment service. No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures. The slice reaches the small helpers and
 * the session config only through bound deps — it never imports another
 * slice service.
 */

export interface StorefrontPaymentWebhooksDeps {
  db: Kysely<Database>;
  whatsappService?: WhatsAppGatewayService;
  // Bound helpers from the helpers and session slices (passed bound so
  // the moved bodies stay byte-identical).
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
}

@Injectable()
export class StorefrontPaymentWebhooksService {
  private readonly db: Kysely<Database>;
  private readonly whatsappService?: WhatsAppGatewayService;
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
  private readonly logger = new Logger(StorefrontPaymentWebhooksService.name);

  constructor(deps: StorefrontPaymentWebhooksDeps) {
    this.db = deps.db;
    this.whatsappService = deps.whatsappService;
    this.paymentReviewReason = deps.paymentReviewReason;
    this.markPaymentForReview = deps.markPaymentForReview;
    this.isCurrentPaymentSession = deps.isCurrentPaymentSession;
    this.isRepeatedPaidWebhook = deps.isRepeatedPaidWebhook;
    this.getTenantPaymentConfig = deps.getTenantPaymentConfig;
  }

  /**
   * Single resolution path for every public payment webhook — executes the plan
   * produced by `planWebhookOrderLookup` (invariant WH-1, see that engine for why
   * `order_number` alone is not an identity across tenants).
   */
  async resolveWebhookOrder(params: {
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
  async compensateFailedOrderPayment(trx: Transaction<Database>, order: any, gatewayResponse: any): Promise<void> {
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

  async processPaymobWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
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
      this.logger.warn(
        `Paymob webhook rejected: storefront_paymob_hmac_secret not configured or hmac header missing for order ${order.order_number}`,
      );
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
      this.logger.log(
        `Paymob authorization-only notification for order ${order.order_number}; awaiting capture, no state change.`,
      );
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
        if (
          isSuccessful &&
          !this.isRepeatedPaidWebhook(lockedOrder, 'paymob', String(obj.id || ''), String(obj.order?.id || ''))
        ) {
          return this.markPaymentForReview(
            trx,
            lockedOrder,
            'paymob',
            String(obj.id || ''),
            String(obj.order?.id || ''),
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
          this.logger.warn(
            `Order ${lockedOrder.order_number} marked as FAILED via Paymob Webhook (void/refund); stock reservation released.`,
          );
          return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
        }
        // A successful callback carrying none of Paymob's capture flags
        // proves nothing; route it to a human instead of marking paid.
        if (transactionKind === 'unclassified') {
          return this.markPaymentForReview(
            trx,
            lockedOrder,
            'paymob',
            String(obj.id || ''),
            sessionId,
            body,
            'non_capture_transaction',
          );
        }
        const reason = this.paymentReviewReason(
          lockedOrder,
          'paymob',
          sessionId,
          obj.amount_cents,
          obj.currency,
          'EGP',
        );
        if (reason)
          return this.markPaymentForReview(trx, lockedOrder, 'paymob', String(obj.id || ''), sessionId, body, reason);

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
        if (
          !this.isCurrentPaymentSession(lockedOrder, 'paymob', String(obj.order?.id || '')) ||
          lockedOrder.status !== 'pending'
        ) {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(
          `Order ${lockedOrder.order_number} marked as FAILED via Paymob Webhook; stock reservation released.`,
        );
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }
    });

    // Trigger WhatsApp notification outside transaction
    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }

  async processXPayWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
    this.logger.log(`XPay Webhook received: ${JSON.stringify(body)}`);
    const data = body?.data || body;
    const transactionStatus = String(
      data?.transaction_status || body?.transaction_status || data?.status || '',
    ).toUpperCase();
    const transactionId = String(data?.transaction_id || data?.id || body?.transaction_id || '');

    // Extract orderNumber from custom_fields or payload
    let orderNumber = '';
    let tenantId = '';
    const customFields = Array.isArray(data?.custom_fields)
      ? data.custom_fields
      : Array.isArray(body?.custom_fields)
        ? body.custom_fields
        : [];
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
    const signatureHeader = (headers['x-xpay-signature'] ||
      headers['xpay-signature'] ||
      headers['x-signature'] ||
      headers['signature'] ||
      '') as string;

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

    const isSuccessful =
      transactionStatus === 'SUCCESSFUL' || transactionStatus === 'SUCCESS' || transactionStatus === 'PAID';
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
          return this.markPaymentForReview(
            trx,
            lockedOrder,
            'xpay',
            transactionId,
            transactionId,
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
        const amount = data?.amount ?? data?.total_amount ?? body?.amount;
        const amountMinor = amount === undefined || amount === null ? undefined : Math.round(Number(amount) * 100);
        const reason = this.paymentReviewReason(
          lockedOrder,
          'xpay',
          transactionId,
          amountMinor,
          data?.currency ?? body?.currency,
          'EGP',
        );
        if (reason)
          return this.markPaymentForReview(trx, lockedOrder, 'xpay', transactionId, transactionId, body, reason);

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
        if (
          !['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(transactionStatus) ||
          !this.isCurrentPaymentSession(lockedOrder, 'xpay', transactionId) ||
          lockedOrder.status !== 'pending'
        ) {
          return { ok: true, received: true };
        }
        await this.compensateFailedOrderPayment(trx, lockedOrder, body);
        this.logger.warn(
          `Order ${lockedOrder.order_number} marked as FAILED via XPay Webhook; stock reservation released.`,
        );
        return { ok: true, status: 'failed', orderNumber: lockedOrder.order_number };
      }
    });

    if (shouldNotifyWhatsApp && this.whatsappService) {
      void this.whatsappService.sendOnlineOrderNotification(order.id, order.tenant_id).catch(() => undefined);
    }

    return result;
  }
}
