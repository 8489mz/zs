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
export class XPayGatewayService implements IPaymentGateway {
  readonly gatewayName = 'xpay' as const;
  private readonly logger = new Logger(XPayGatewayService.name);

  private get apiKey(): string {
    return process.env.XPAY_API_KEY?.trim() || '';
  }

  private get communityId(): string {
    return process.env.XPAY_COMMUNITY_ID?.trim() || '';
  }

  private get baseUrl(): string {
    return process.env.XPAY_BASE_URL?.trim() || 'https://community.xpay.app';
  }

  private get webhookSecret(): string {
    return process.env.XPAY_WEBHOOK_SECRET?.trim() || '';
  }

  async initiatePayment(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    const transactionReference = `XPAY-${input.tenantSlug}-${Date.now()}`;

    // If live API keys are configured, call the XPay API
    if (this.apiKey && this.communityId) {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/payments/pay/variable-amount`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify({
            billing_data: {
              name: input.ownerName || input.businessName,
              email: input.ownerEmail || platformNoReplyEmail(),
              phone_number: input.ownerPhone || '01000000000',
            },
            amount: input.amount,
            currency: input.currency || 'EGP',
            community_id: this.communityId,
            custom_fields: [
              { field_label: 'tenant_id', value: input.tenantId },
              { field_label: 'plan_id', value: String(input.planId) },
              { field_label: 'duration_months', value: String(input.durationMonths) },
              { field_label: 'reference', value: transactionReference },
            ],
            redirect_url: input.redirectUrl || undefined,
          }),
        });

        if (response.ok) {
          const json: any = await response.json();
          const paymentUrl = json?.data?.iframe_url || json?.data?.payment_url || json?.data?.url;
          if (paymentUrl) {
            return {
              ok: true,
              gateway: 'xpay',
              paymentUrl,
              transactionReference: json?.data?.transaction_uuid || transactionReference,
              message: 'تم إنشاء رابط الدفع بنجاح عبر بوابة XPay.',
            };
          }
        }
        this.logger.warn(`XPay API response error: ${response.status} ${await response.text().catch(() => '')}`);
      } catch (err: any) {
        this.logger.error(`Failed to initiate XPay payment: ${err.message}`);
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
      gateway: 'xpay',
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
      gateway: 'xpay',
      paymentUrl,
      transactionReference,
      message: 'تم تجهيز أمر الدفع الإلكتروني عبر بوابة XPay (بيئة تجريبية Sandbox).',
    };
  }

  async verifyAndParseWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<WebhookValidationResult> {
    const signature = headers['x-xpay-signature'] || headers['x-signature'] || '';

    // Fail-closed: without a configured secret or a signature to check, the webhook is untrusted.
    let isValid = false;
    if (this.webhookSecret && signature) {
      try {
        const payload = rawBody ? rawBody : Buffer.from(JSON.stringify(body));
        const computed = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
        const sigBuf = Buffer.from(String(signature));
        const computedBuf = Buffer.from(computed);
        isValid = sigBuf.length === computedBuf.length && crypto.timingSafeEqual(sigBuf, computedBuf);
      } catch {
        isValid = false;
      }
    } else {
      this.logger.warn('XPay webhook rejected: XPAY_WEBHOOK_SECRET is not configured or signature header missing.');
    }

    const data = body?.data || body;
    const customFields = Array.isArray(data?.custom_fields) ? data.custom_fields : [];

    const getField = (label: string) => {
      const field = customFields.find((f: any) => f?.field_label === label || f?.name === label);
      return field?.value;
    };

    const tenantId = getField('tenant_id') || data?.tenant_id || data?.metadata?.tenant_id;
    const planId = Number(getField('plan_id') || data?.plan_id || data?.metadata?.plan_id) || undefined;
    const durationMonths =
      Number(getField('duration_months') || data?.duration_months || data?.metadata?.duration_months) || 12;
    const isSuccessful =
      data?.status === 'successful' || data?.status === 'paid' || data?.transaction_status === 'SUCCESS';

    return {
      isValid,
      isSuccessful,
      // No synthetic fallback: a payment we cannot name is a payment we cannot de-duplicate (F4).
      transactionReference: String(data?.transaction_uuid || data?.id || '').trim(),
      amount: Number(data?.total_amount || data?.amount || 0),
      currency: data?.currency || 'EGP',
      gateway: 'xpay',
      tenantId,
      planId,
      durationMonths,
      rawPayload: body,
    };
  }
}
