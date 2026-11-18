import { Inject, Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException, Optional } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { planWebhookOrderLookup, selectUnambiguousOrder } from './engines/webhook-order-resolution.engine';
import { verifyOrderAccessToken, isSandboxPaymentAllowed, buildPaymentReturnUrl, buildGatewayWebhookUrl } from './engines/online-order-access.engine';
import { platformNoReplyEmail } from './engines/store-public-url.engine';
import { releaseLocationStock } from '../../common/utils/location-stock-ledger';
import { resolveGatewayCurrency, toGatewayMajorAmount, toGatewayMinorAmount } from './engines/gateway-amount.engine';
import { classifyPaymobTransaction } from './engines/paymob-notification.engine';
import { extractReservationItems } from './engines/storefront-reservation.engine';
import * as crypto from 'crypto';
import { type LockedOnlineOrder, type StorefrontWebhookResult, type TenantPaymentConfig } from './storefront-payment.types';

@Injectable()
export class StorefrontPaymentService {
  private readonly logger = new Logger(StorefrontPaymentService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private async expectedPaymentCurrency(trx: Transaction<Database>, tenantId: string, provider: string): Promise<string> {
    const row = await trx.selectFrom('settings').select('value')
      .where(sql<boolean>`tenant_id = ${tenantId}`).where('key', '=', 'currency').executeTakeFirst();
    let value = String(row?.value || '');
    try { value = String(JSON.parse(value)); } catch {}
    return resolveGatewayCurrency(provider, value);
  }

  private paymentReviewReason(
    order: LockedOnlineOrder, provider: string, sessionId: string,
    amountMinor: unknown, currency: unknown, expectedCurrency: string,
  ): string | null {
    if (order.status === 'cancelled' || order.status === 'payment_failed' || order.status === 'review_required' ||
        order.sale_id != null || (order.stock_reserved === false && order.stock_reserved_at != null)) {
      return 'late_or_released_order';
    }
    if (order.gateway_provider !== provider || !order.gateway_order_id ||
        !sessionId || String(order.gateway_order_id) !== sessionId) return 'payment_session_mismatch';
    const paidMinor = Number(amountMinor);
    const expectedMinor = toGatewayMinorAmount(Number(order.total_amount), expectedCurrency);
    if (!Number.isSafeInteger(paidMinor) || paidMinor !== expectedMinor) return 'amount_mismatch';
    if (typeof currency !== 'string' || currency.toUpperCase() !== expectedCurrency) return 'currency_mismatch';
    return null;
  }

  private async markPaymentForReview(
    trx: Transaction<Database>, order: LockedOnlineOrder, provider: string,
    transactionId: string, sessionId: string, response: unknown, reason: string,
  ): Promise<StorefrontWebhookResult> {
    await trx.updateTable('online_orders').set({
      payment_status: 'paid', status: 'review_required',
      gateway_provider: order.payment_status === 'paid' ? order.gateway_provider : provider,
      gateway_transaction_id: order.payment_status === 'paid' ? order.gateway_transaction_id : transactionId,
      gateway_response_json: JSON.stringify({ reason, receivedTransactionId: transactionId,
        receivedSessionId: sessionId, previousTransactionId: order.gateway_transaction_id, webhook: response }),
      paid_at: order.paid_at || new Date(), updated_at: new Date(),
    }).where('id', '=', order.id).where(sql<boolean>`tenant_id = ${order.tenant_id}`).execute();
    this.logger.warn(`${provider} payment requires review for online order ${order.id}: ${reason}`);
    return { ok: true, status: 'review_required', orderNumber: order.order_number };
  }

  private isCurrentPaymentSession(order: LockedOnlineOrder, provider: string, sessionId: string): boolean {
    return order.gateway_provider === provider && Boolean(sessionId) &&
      Boolean(order.gateway_order_id) && String(order.gateway_order_id) === sessionId;
  }

  private isRepeatedPaidWebhook(order: LockedOnlineOrder, provider: string, transactionId: string, sessionId: string): boolean {
    return order.payment_status === 'paid' && order.gateway_provider === provider &&
      Boolean(transactionId) && String(order.gateway_transaction_id || '') === transactionId &&
      this.isCurrentPaymentSession(order, provider, sessionId);
  }

  private async getTenantBySlug(slug: string) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    if (!cleanSlug || cleanSlug === 'admin') throw new NotFoundException('المتجر غير موجود');

    let tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('slug', '=', cleanSlug)
      .executeTakeFirst();

    if (!tenant && cleanSlug.includes('.')) {
      tenant = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('custom_domain', '=', cleanSlug)
        .executeTakeFirst();
    }

    if (!tenant) {
      const slugSetting = await this.db
        .selectFrom('settings')
        .select('tenant_id')
        .where('key', '=', 'storefront_slug')
        .where(sql<boolean>`LOWER(TRIM(BOTH '"' FROM value)) = ${cleanSlug}`)
        .executeTakeFirst();

      if (slugSetting) {
        tenant = await this.db
          .selectFrom('tenants')
          .selectAll()
          .where('id', '=', slugSetting.tenant_id)
          .executeTakeFirst();
      }
    }

    if (!tenant && (cleanSlug === 'default' || cleanSlug === 'almhnds' || cleanSlug === 'slmhnds' || cleanSlug === 'elmhnds' || cleanSlug === 'almohandes' || cleanSlug === 'elmohandes')) {
      tenant = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('id', '=', 'default')
        .executeTakeFirst();

      if (!tenant) {
        tenant = await this.db
          .selectFrom('tenants')
          .selectAll()
          .orderBy('created_at', 'asc')
          .executeTakeFirst();
      }
    }

    if (!tenant) throw new NotFoundException('المتجر غير موجود');
    return tenant;
  }

  /** SF-1: same contract as StorefrontService.findCustomerOrderByToken — one 404 for "missing" and "wrong token". */
  private async findOrderByToken(tenantId: string, orderNumber: string, token: string | undefined) {
    const cleanOrderNumber = String(orderNumber || '').trim();
    if (!cleanOrderNumber || !token) {
      throw new NotFoundException('الطلب غير موجود');
    }
    const candidates = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('order_number', '=', cleanOrderNumber)
      .limit(10)
      .execute();
    const order = candidates.find((row) => verifyOrderAccessToken(token, row.access_token_hash));
    if (!order) {
      throw new NotFoundException('الطلب غير موجود');
    }
    return order;
  }

  /**
   * SF-2: the simulator screen is offered only in test mode. With live credentials a failed
   * gateway call must surface as an error, never silently degrade into a fake checkout.
   */
  private sandboxSessionOrThrow(config: TenantPaymentConfig, session: Record<string, unknown>) {
    if (!isSandboxPaymentAllowed(config)) {
      throw new BadRequestException('تعذر بدء جلسة الدفع الإلكتروني حالياً، يرجى المحاولة لاحقاً أو اختيار الدفع عند الاستلام');
    }
    return session;
  }

  async getTenantPaymentConfig(tenantId: string): Promise<TenantPaymentConfig> {
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('key', 'in', [
        'currency',
        'country',
        'storefront_online_payment_enabled',
        'storefront_online_payment_provider',
        'storefront_paymob_api_key',
        'storefront_paymob_integration_id',
        'storefront_paymob_iframe_id',
        'storefront_paymob_hmac_secret',
        'storefront_paymob_test_mode',
        'storefront_xpay_api_key',
        'storefront_xpay_community_id',
        'storefront_xpay_test_mode',
        'storefront_tap_secret_key',
        'storefront_tap_publishable_key',
        'storefront_tap_test_mode',
        'storefront_stripe_secret_key',
        'storefront_stripe_publishable_key',
        'storefront_stripe_webhook_secret',
        'storefront_stripe_test_mode',
      ])
      .execute();

    const map = new Map<string, string>();
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.value);
        map.set(r.key, typeof parsed === 'string' ? parsed : String(parsed));
      } catch {
        map.set(r.key, r.value);
      }
    }

    const enabled = map.get('storefront_online_payment_enabled') === 'true';
    const rawCurrency = (map.get('currency') || '').toUpperCase();
    const rawCountry = (map.get('country') || '').toUpperCase();
    const isGcc = ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'].includes(rawCountry) ||
      ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR'].includes(rawCurrency);
    const defaultProvider = isGcc ? 'tap' : 'paymob';
    const provider = (map.get('storefront_online_payment_provider') || defaultProvider) as 'paymob' | 'xpay' | 'tap' | 'stripe' | 'mock';
    const apiKey = map.get('storefront_paymob_api_key') || '';
    const integrationId = map.get('storefront_paymob_integration_id') || '';
    const iframeId = map.get('storefront_paymob_iframe_id') || '';
    const hmacSecret = map.get('storefront_paymob_hmac_secret') || '';
    const testMode = map.get('storefront_paymob_test_mode') !== 'false';
    const xpayApiKey = map.get('storefront_xpay_api_key') || '';
    const xpayCommunityId = map.get('storefront_xpay_community_id') || '';
    const xpayTestMode = map.get('storefront_xpay_test_mode') !== 'false';
    const tapSecretKey = map.get('storefront_tap_secret_key') || '';
    const tapPublishableKey = map.get('storefront_tap_publishable_key') || '';
    const tapTestMode = map.get('storefront_tap_test_mode') !== 'false';
    const stripeSecretKey = map.get('storefront_stripe_secret_key') || '';
    const stripePublishableKey = map.get('storefront_stripe_publishable_key') || '';
    const stripeWebhookSecret = map.get('storefront_stripe_webhook_secret') || '';
    const stripeTestMode = map.get('storefront_stripe_test_mode') !== 'false';

    return {
      enabled,
      provider,
      apiKey,
      integrationId,
      iframeId,
      hmacSecret,
      testMode,
      xpayApiKey,
      xpayCommunityId,
      xpayTestMode,
      tapSecretKey,
      tapPublishableKey,
      tapTestMode,
      stripeSecretKey,
      stripePublishableKey,
      stripeWebhookSecret,
      stripeTestMode,
    };
  }

  async initiatePaymentSession(slug: string, orderNumber: string, token: string | undefined, origin?: string) {
    const tenant = await this.getTenantBySlug(slug);
    const order = await this.findOrderByToken(tenant.id, orderNumber, token);

    if (order.payment_status === 'paid') {
      return {
        ok: true,
        isPaid: true,
        orderNumber: order.order_number,
        paymentStatus: 'paid',
        transactionId: order.gateway_transaction_id,
        message: 'تم سداد هذا الطلب بالفعل.',
      };
    }

    if (['cancelled', 'payment_failed', 'review_required'].includes(order.status) || order.sale_id) {
      throw new BadRequestException('لا يمكن سداد هذا الطلب إلكترونياً في حالته الحالية.');
    }

    const totalAmount = Number(order.total_amount || 0);
    if (totalAmount <= 0) {
      throw new BadRequestException('إجمالي الطلب غير صحيح للدفع الإلكتروني.');
    }

    const config = await this.getTenantPaymentConfig(tenant.id);
    if (!config.enabled) {
      throw new BadRequestException('الدفع الإلكتروني غير مفعل في هذا المتجر حالياً.');
    }

    // Try Live Paymob Flow if provider is paymob and API key & Integration ID are present
    if (config.provider === 'paymob' && !config.testMode && config.apiKey && config.integrationId) {
      try {
        const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: config.apiKey }),
        });

        if (authRes.ok) {
          const authData: any = await authRes.json();
          const token = authData?.token;

          const merchantOrderId = `${tenant.id}__${order.order_number}`;

          const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              auth_token: token,
              delivery_needed: 'false',
              amount_cents: Math.round(totalAmount * 100),
              currency: 'EGP',
              merchant_order_id: merchantOrderId,
              items: [],
            }),
          });

          if (orderRes.ok) {
            const orderData: any = await orderRes.json();
            const paymobOrderId = orderData?.id;

            const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                auth_token: token,
                amount_cents: Math.round(totalAmount * 100),
                expiration: 3600,
                order_id: paymobOrderId,
                billing_data: {
                  first_name: order.customer_name?.split(' ')[0] || 'Customer',
                  last_name: order.customer_name?.split(' ').slice(1).join(' ') || 'Storefront',
                  email: platformNoReplyEmail(),
                  phone_number: order.customer_phone || '01000000000',
                  apartment: 'NA',
                  floor: 'NA',
                  street: order.customer_address || 'NA',
                  building: 'NA',
                  shipping_method: 'NA',
                  postal_code: 'NA',
                  city: 'Cairo',
                  country: 'EG',
                  state: 'Cairo',
                },
                currency: 'EGP',
                integration_id: Number(config.integrationId),
                lock_order_when_paid: 'false',
              }),
            });

            if (keyRes.ok) {
              const keyData: any = await keyRes.json();
              const paymentToken = keyData?.token;
              const iframe = config.iframeId || 'default';

              await this.db
                .updateTable('online_orders')
                .set({
                  gateway_provider: 'paymob',
                  gateway_order_id: String(paymobOrderId),
                  updated_at: new Date(),
                })
                .where('id', '=', order.id)
                .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
                .execute();

              return {
                ok: true,
                mode: 'paymob',
                provider: 'paymob',
                orderNumber: order.order_number,
                amount: totalAmount,
                paymentToken,
                iframeId: iframe,
                iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframe}?payment_token=${paymentToken}`,
                orderId: String(paymobOrderId),
                testMode: false,
              };
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Live Paymob initiation error: ${err.message}`);
      }
    }

    // Try Live XPay Flow if provider is xpay and credentials are present
    if (config.provider === 'xpay') {
      if (config.xpayApiKey && config.xpayCommunityId) {
        try {
          const xpayBase = config.xpayTestMode ? 'https://staging.xpay.app' : 'https://community.xpay.app';
          const phone = order.customer_phone || '01000000000';
          const formattedPhone = phone.startsWith('+') ? phone : (phone.startsWith('0') ? `+2${phone}` : `+20${phone}`);

          const xpayRes = await fetch(`${xpayBase}/api/v1/payments/pay/variable-amount`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.xpayApiKey,
            },
            body: JSON.stringify({
              billing_data: {
                name: order.customer_name || 'Customer',
                email: platformNoReplyEmail(),
                phone_number: formattedPhone,
              },
              amount: totalAmount,
              currency: 'EGP',
              community_id: config.xpayCommunityId,
              pay_using: 'card',
              custom_fields: [
                { field_label: 'OrderNumber', value: order.order_number },
                { field_label: 'TenantId', value: tenant.id },
              ],
            }),
          });

          if (xpayRes.ok) {
            const xpayData: any = await xpayRes.json();
            const iframeUrl = xpayData?.data?.iframe_url || xpayData?.data?.payment_url;
            const txnId = xpayData?.data?.transaction_id || xpayData?.data?.transaction_uuid;

            if (iframeUrl) {
              await this.db
                .updateTable('online_orders')
                .set({
                  gateway_provider: 'xpay',
                  gateway_order_id: String(txnId || ''),
                  updated_at: new Date(),
                })
                .where('id', '=', order.id)
                .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
                .execute();

              return {
                ok: true,
                mode: 'xpay',
                provider: 'xpay',
                orderNumber: order.order_number,
                amount: totalAmount,
                iframeUrl,
                transactionId: String(txnId || ''),
                testMode: config.xpayTestMode,
              };
            }
          } else {
            const errText = await xpayRes.text();
            this.logger.error(`XPay API response error (${xpayRes.status}): ${errText}`);
          }
        } catch (err: any) {
          this.logger.error(`Live XPay initiation error: ${err.message}`);
        }
      }

      // Default XPay Sandbox Simulator
      return this.sandboxSessionOrThrow(config, {
        ok: true,
        mode: 'mock',
        provider: 'xpay',
        orderNumber: order.order_number,
        amount: totalAmount,
        testMode: true,
        message: 'تم تجهيز جلسة الدفع عبر إكس باي في الوضع التجريبي (XPay Sandbox Mode).',
      });
    }

    // 3. Tap Payments (GCC - Mada 🇸🇦, KNET 🇰🇼, NAPS 🇶🇦, Apple Pay 🍎)
    if (config.provider === 'tap') {
      if (config.tapSecretKey) {
        try {
          const currencyRow = await this.db
            .selectFrom('settings')
            .select(['value'])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('key', '=', 'currency')
            .executeTakeFirst();
          let rawCurrency = '';
          if (currencyRow?.value) {
            try {
              const parsed = JSON.parse(currencyRow.value);
              rawCurrency = typeof parsed === 'string' ? parsed : String(parsed);
            } catch {
              rawCurrency = currencyRow.value;
            }
          }
          const currency = resolveGatewayCurrency('tap', rawCurrency);

          const rawPhone = (order.customer_phone || '500000000').replace(/[^0-9]/g, '');
          let countryCode = '966';
          let phoneNum = rawPhone;
          if (rawPhone.startsWith('966')) {
            countryCode = '966';
            phoneNum = rawPhone.slice(3);
          } else if (rawPhone.startsWith('965')) {
            countryCode = '965';
            phoneNum = rawPhone.slice(3);
          } else if (rawPhone.startsWith('974')) {
            countryCode = '974';
            phoneNum = rawPhone.slice(3);
          } else if (rawPhone.startsWith('971')) {
            countryCode = '971';
            phoneNum = rawPhone.slice(3);
          } else if (rawPhone.startsWith('20')) {
            countryCode = '20';
            phoneNum = rawPhone.slice(2);
          } else if (rawPhone.startsWith('0')) {
            phoneNum = rawPhone.slice(1);
          }

          // O67: these pointed at `<slug>.z-systems.cloud` (not our domain) and the merchant-only
          // `/storefront/orders`; the webhook never reached us, so Tap payments were never confirmed.
          const returnUrl = buildPaymentReturnUrl(origin, slug, order.order_number);
          const webhookUrl = buildGatewayWebhookUrl(origin, 'tap');
          if (!returnUrl || !webhookUrl) {
            throw new BadRequestException('تعذر تحديد رابط المتجر للرجوع بعد الدفع.');
          }
          const tapPayload = {
            amount: toGatewayMajorAmount(totalAmount, currency),
            currency: currency.toUpperCase(),
            threeDSecure: true,
            save_card: false,
            description: `Order #${order.order_number} - ${tenant.business_name}`,
            statement_descriptor: `Store ${tenant.slug}`,
            metadata: {
              orderNumber: order.order_number,
              tenantId: tenant.id,
            },
            reference: {
              transaction: order.order_number,
              order: order.order_number,
            },
            receipt: {
              email: false,
              sms: false,
            },
            customer: {
              first_name: order.customer_name?.split(' ')[0] || 'Customer',
              last_name: order.customer_name?.split(' ').slice(1).join(' ') || 'Storefront',
              email: platformNoReplyEmail(),
              phone: {
                country_code: countryCode,
                number: phoneNum || '500000000',
              },
            },
            source: { id: 'src_all' }, // Unified checkout: Mada, KNET, NAPS, Benefit, Apple Pay, Visa, MC
            redirect: {
              url: returnUrl,
            },
            post: {
              url: webhookUrl,
            },
          };

          const tapRes = await fetch('https://api.tap.company/v2/charges', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.tapSecretKey.trim()}`,
            },
            body: JSON.stringify(tapPayload),
          });

          if (tapRes.ok) {
            const tapData: any = await tapRes.json();
            const chargeUrl = tapData?.transaction?.url;
            const chargeId = tapData?.id;

            if (chargeUrl) {
              await this.db
                .updateTable('online_orders')
                .set({
                  gateway_provider: 'tap',
                  gateway_order_id: String(chargeId || ''),
                  updated_at: new Date(),
                })
                .where('id', '=', order.id)
                .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
                .execute();

              return {
                ok: true,
                mode: 'tap',
                provider: 'tap',
                orderNumber: order.order_number,
                amount: totalAmount,
                currency,
                iframeUrl: chargeUrl,
                checkoutUrl: chargeUrl,
                transactionId: String(chargeId || ''),
                testMode: config.tapTestMode,
              };
            }
          } else {
            const errText = await tapRes.text();
            this.logger.error(`Tap API response error (${tapRes.status}): ${errText}`);
          }
        } catch (err: any) {
          this.logger.error(`Live Tap initiation error: ${err.message}`);
        }
      }

      // Default Tap Sandbox Simulator
      return this.sandboxSessionOrThrow(config, {
        ok: true,
        mode: 'mock',
        provider: 'tap',
        orderNumber: order.order_number,
        amount: totalAmount,
        testMode: true,
        message: 'تم تجهيز جلسة الدفع عبر تاب للمدفوعات (Tap Payments GCC Sandbox - مدى / KNET / Apple Pay).',
      });
    }

    // 4. Stripe (International Cards & Apple Pay / Google Pay)
    if (config.provider === 'stripe') {
      if (config.stripeSecretKey) {
        try {
          const currencyRow = await this.db
            .selectFrom('settings')
            .select(['value'])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('key', '=', 'currency')
            .executeTakeFirst();
          let currency = 'USD';
          if (currencyRow?.value) {
            try {
              const parsed = JSON.parse(currencyRow.value);
              currency = typeof parsed === 'string' ? parsed : String(parsed);
            } catch {
              currency = currencyRow.value;
            }
          }

          // O67: same broken `<slug>.z-systems.cloud/storefront/orders` target as Tap.
          const returnUrl = buildPaymentReturnUrl(origin, slug, order.order_number);
          if (!returnUrl) {
            throw new BadRequestException('تعذر تحديد رابط المتجر للرجوع بعد الدفع.');
          }
          const successUrl = returnUrl;
          const cancelUrl = returnUrl;

          const params = new URLSearchParams();
          params.append('payment_method_types[0]', 'card');
          params.append('mode', 'payment');
          params.append('client_reference_id', `${tenant.id}__${order.order_number}`);
          params.append('metadata[orderNumber]', order.order_number);
          params.append('metadata[tenantId]', tenant.id);
          params.append('line_items[0][price_data][currency]', currency.toLowerCase());
          params.append('line_items[0][price_data][product_data][name]', `طلب رقم #${order.order_number}`);
          params.append('line_items[0][price_data][product_data][description]', `متجر ${tenant.business_name}`);
          params.append('line_items[0][price_data][unit_amount]', String(toGatewayMinorAmount(totalAmount, currency)));
          params.append('line_items[0][quantity]', '1');
          params.append('success_url', successUrl);
          params.append('cancel_url', cancelUrl);

          const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Bearer ${config.stripeSecretKey.trim()}`,
            },
            body: params.toString(),
          });

          if (stripeRes.ok) {
            const stripeData: any = await stripeRes.json();
            const sessionUrl = stripeData?.url;
            const sessionId = stripeData?.id;

            if (sessionUrl) {
              await this.db
                .updateTable('online_orders')
                .set({
                  gateway_provider: 'stripe',
                  gateway_order_id: String(sessionId || ''),
                  updated_at: new Date(),
                })
                .where('id', '=', order.id)
                .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
                .execute();

              return {
                ok: true,
                mode: 'stripe',
                provider: 'stripe',
                orderNumber: order.order_number,
                amount: totalAmount,
                currency,
                iframeUrl: sessionUrl,
                checkoutUrl: sessionUrl,
                transactionId: String(sessionId || ''),
                testMode: config.stripeTestMode,
              };
            }
          } else {
            const errText = await stripeRes.text();
            this.logger.error(`Stripe API response error (${stripeRes.status}): ${errText}`);
          }
        } catch (err: any) {
          this.logger.error(`Live Stripe initiation error: ${err.message}`);
        }
      }

      // Default Stripe Sandbox Simulator
      return this.sandboxSessionOrThrow(config, {
        ok: true,
        mode: 'mock',
        provider: 'stripe',
        orderNumber: order.order_number,
        amount: totalAmount,
        testMode: true,
        message: 'تم تجهيز جلسة الدفع عبر سترايب في الوضع التجريبي (Stripe Sandbox Mode).',
      });
    }

    // Default: Mock / Sandbox Simulator Mode
    return this.sandboxSessionOrThrow(config, {
      ok: true,
      mode: 'mock',
      provider: config.provider || 'mock',
      orderNumber: order.order_number,
      amount: totalAmount,
      testMode: true,
      message: 'تم تجهيز جلسة الدفع بالبطاقة البنكية في الوضع التجريبي الآمن (Sandbox Mode).',
    });
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
