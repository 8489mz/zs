import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  PaymentInitiateInput,
  PaymentInitiateResult,
  WebhookValidationResult,
} from './payment-gateway.interface';
import * as crypto from 'crypto';
import { platformNoReplyEmail } from '../../storefront/engines/store-public-url.engine';
import { assertSubscriptionSandboxAllowed } from './subscription-sandbox-policy';

@Injectable()
export class PaymobGatewayService implements IPaymentGateway {
  readonly gatewayName = 'paymob' as const;
  private readonly logger = new Logger(PaymobGatewayService.name);

  private get apiKey(): string {
    return process.env.PAYMOB_API_KEY?.trim() || '';
  }

  private get hmacSecret(): string {
    return process.env.PAYMOB_HMAC_SECRET?.trim() || '';
  }

  private get integrationId(): string {
    return process.env.PAYMOB_INTEGRATION_ID?.trim() || '';
  }

  private get iframeId(): string {
    return process.env.PAYMOB_IFRAME_ID?.trim() || '';
  }

  async initiatePayment(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    const transactionReference = `PAYMOB-${input.tenantSlug}-${Date.now()}`;

    if (this.apiKey && this.integrationId) {
      try {
        // Step 1: Authentication request
        const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: this.apiKey }),
        });

        if (authRes.ok) {
          const authData: any = await authRes.json();
          const token = authData?.token;

          // Step 2: Order registration
          const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              auth_token: token,
              delivery_needed: 'false',
              amount_cents: Math.round(input.amount * 100),
              currency: input.currency || 'EGP',
              merchant_order_id: transactionReference,
              items: [],
            }),
          });

          if (orderRes.ok) {
            const orderData: any = await orderRes.json();
            const orderId = orderData?.id;

            // Step 3: Payment key request
            const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                auth_token: token,
                amount_cents: Math.round(input.amount * 100),
                expiration: 3600,
                order_id: orderId,
                billing_data: {
                  apartment: 'NA',
                  email: input.ownerEmail || platformNoReplyEmail(),
                  floor: 'NA',
                  first_name: input.ownerName || input.businessName,
                  street: 'NA',
                  building: 'NA',
                  phone_number: input.ownerPhone || '01000000000',
                  shipping_method: 'NA',
                  postal_code: 'NA',
                  city: 'Cairo',
                  country: 'EG',
                  last_name: 'Owner',
                  state: 'Cairo',
                },
                currency: input.currency || 'EGP',
                integration_id: Number(this.integrationId),
                lock_order_when_paid: 'false',
              }),
            });

            if (keyRes.ok) {
              const keyData: any = await keyRes.json();
              const paymentToken = keyData?.token;
              const iframe = this.iframeId || 'default';
              return {
                ok: true,
                gateway: 'paymob',
                paymentUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframe}?payment_token=${paymentToken}`,
                transactionReference: String(orderId),
                message: 'تم تجهيز رابط الدفع الإلكتروني عبر بوابة Paymob.',
              };
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Paymob initiation error: ${err.message}`);
      }
    }

    // A failed real gateway request must never fall back to a fake successful purchase.
    assertSubscriptionSandboxAllowed();
    // Sandbox / Simulation Checkout when live API keys are not configured
    let baseUrl = '';
    if (input.redirectUrl) {
      try {
        const u = new URL(input.redirectUrl);
        baseUrl = u.origin;
      } catch {}
    }
    const query = new URLSearchParams({
      gateway: 'paymob',
      ref: transactionReference,
      amount: String(input.amount),
      currency: input.currency || 'EGP',
      tenantId: input.tenantId,
      planId: String(input.planId),
      planName: input.planName,
      duration: String(input.durationMonths),
      businessName: input.businessName,
      redirectUrl: input.redirectUrl || '',
    }).toString();

    const paymentUrl = `${baseUrl}/api/tenant-subscription/sandbox-checkout?${query}`;

    return {
      ok: true,
      gateway: 'paymob',
      paymentUrl,
      transactionReference,
      message: 'تم تجهيز أمر الدفع الإلكتروني عبر بوابة Paymob (بيئة تجريبية Sandbox).',
    };
  }

  async verifyAndParseWebhook(headers: Record<string, any>, body: any): Promise<WebhookValidationResult> {
    const obj = body?.obj || body;
    const hmac = headers['hmac'] || '';

    // Fail-closed: without a configured secret or an hmac to check, the webhook is untrusted.
    let isValid = false;
    if (this.hmacSecret && hmac) {
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

      const computed = crypto.createHmac('sha512', this.hmacSecret).update(concatenated).digest('hex');
      try {
        const hmacBuf = Buffer.from(String(hmac).toLowerCase());
        const computedBuf = Buffer.from(computed.toLowerCase());
        isValid = hmacBuf.length === computedBuf.length && crypto.timingSafeEqual(hmacBuf, computedBuf);
      } catch {
        isValid = false;
      }
    } else {
      this.logger.warn('Paymob webhook rejected: PAYMOB_HMAC_SECRET is not configured or hmac query param missing.');
    }

    const isSuccessful = obj.success === true && obj.pending === false;
    const merchantOrderId = String(obj?.order?.merchant_order_id || '');

    return {
      isValid,
      isSuccessful,
      // No synthetic fallback: a payment we cannot name is a payment we cannot de-duplicate (F4).
      transactionReference: String(obj?.id || obj?.order?.id || '').trim(),
      amount: Number(obj?.amount_cents || 0) / 100,
      currency: obj?.currency || 'EGP',
      gateway: 'paymob',
      tenantId: obj?.order?.data?.tenant_id,
      planId: Number(obj?.order?.data?.plan_id) || undefined,
      durationMonths: Number(obj?.order?.data?.duration_months) || 12,
      rawPayload: body,
    };
  }
}
