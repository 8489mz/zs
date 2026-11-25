import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql, type Selectable } from 'kysely';
import { type Database, type TenantTable, type OnlineOrderTable } from '../../database/database.types';
import { buildPaymentReturnUrl, buildGatewayWebhookUrl } from './engines/online-order-access.engine';
import { platformNoReplyEmail } from './engines/store-public-url.engine';
import { resolveGatewayCurrency, toGatewayMajorAmount, toGatewayMinorAmount } from './engines/gateway-amount.engine';
import { type TenantPaymentConfig } from './storefront-payment.types';

/**
 * StorefrontPaymentSessionService — slice S2 of the storefront payment split.
 * Pure move of the payment-session entry points from the storefront
 * payment service. No behavior change: the bodies are byte-identical;
 * the facade keeps thin public delegates with the same names and
 * signatures. The slice reaches the small helpers only through bound
 * deps — it never imports another slice service.
 */

export interface StorefrontPaymentSessionDeps {
  db: Kysely<Database>;
  // Bound helpers from the helpers slice (passed bound so the moved
  // bodies stay byte-identical).
  getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  findOrderByToken: (
    tenantId: string,
    orderNumber: string,
    token: string | undefined,
  ) => Promise<Selectable<OnlineOrderTable>>;
  sandboxSessionOrThrow: (config: TenantPaymentConfig, session: Record<string, unknown>) => Record<string, unknown>;
}

@Injectable()
export class StorefrontPaymentSessionService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  private readonly findOrderByToken: (
    tenantId: string,
    orderNumber: string,
    token: string | undefined,
  ) => Promise<Selectable<OnlineOrderTable>>;
  private readonly sandboxSessionOrThrow: (
    config: TenantPaymentConfig,
    session: Record<string, unknown>,
  ) => Record<string, unknown>;
  private readonly logger = new Logger(StorefrontPaymentSessionService.name);

  constructor(deps: StorefrontPaymentSessionDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.findOrderByToken = deps.findOrderByToken;
    this.sandboxSessionOrThrow = deps.sandboxSessionOrThrow;
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
    const isGcc =
      ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'].includes(rawCountry) ||
      ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR'].includes(rawCurrency);
    const defaultProvider = isGcc ? 'tap' : 'paymob';
    const provider = (map.get('storefront_online_payment_provider') || defaultProvider) as
      'paymob' | 'xpay' | 'tap' | 'stripe' | 'mock';
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
          const formattedPhone = phone.startsWith('+') ? phone : phone.startsWith('0') ? `+2${phone}` : `+20${phone}`;

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
}
