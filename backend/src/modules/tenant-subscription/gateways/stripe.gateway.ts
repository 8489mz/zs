import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IPaymentGateway,
  PaymentInitiateInput,
  PaymentInitiateResult,
  WebhookValidationResult,
} from './payment-gateway.interface';

function subscriptionPageUrl(): string {
  const base = String(process.env.APP_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  return `${/^https?:\/\/[^\s/]+$/i.test(base) ? base : ''}/settings/subscription`;
}

@Injectable()
export class StripeGatewayService implements IPaymentGateway {
  readonly gatewayName = 'stripe' as const;
  private readonly logger = new Logger(StripeGatewayService.name);

  private get secretKey(): string {
    return process.env.STRIPE_SECRET_KEY?.trim() || '';
  }

  private get webhookSecret(): string {
    return process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  }

  async initiatePayment(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    const transactionReference = `STRIPE-${input.tenantSlug}-${Date.now()}`;

    if (this.secretKey) {
      try {
        const body = new URLSearchParams({
          'payment_method_types[0]': 'card',
          'line_items[0][price_data][currency]': (input.currency || 'USD').toLowerCase(),
          'line_items[0][price_data][product_data][name]': `Z-Systems Subscription: ${input.planName}`,
          'line_items[0][price_data][unit_amount]': String(Math.round(input.amount * 100)),
          'line_items[0][quantity]': '1',
          mode: 'payment',
          // The default used to be app.z-systems.cloud, which is not our domain: a merchant paying
          // their own subscription landed nowhere. APP_PUBLIC_URL is where this deployment lives.
          success_url: input.redirectUrl || `${subscriptionPageUrl()}?status=success`,
          cancel_url: input.redirectUrl || `${subscriptionPageUrl()}?status=cancelled`,
          client_reference_id: input.tenantId,
          'metadata[tenant_id]': input.tenantId,
          'metadata[plan_id]': String(input.planId),
          'metadata[duration_months]': String(input.durationMonths),
        });

        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (response.ok) {
          const json: any = await response.json();
          if (json?.url) {
            return {
              ok: true,
              gateway: 'stripe',
              paymentUrl: json.url,
              transactionReference: json.id,
              message: 'تم تجهيز رابط الدفع عبر Stripe بنجاح.',
            };
          }
        }
      } catch (err: any) {
        this.logger.error(`Stripe initiation error: ${err.message}`);
      }
    }

    // A fabricated checkout URL is not evidence that Stripe accepted a payment.
    throw new ServiceUnavailableException('Stripe checkout is not configured or temporarily unavailable.');
  }

  private verifySignature(rawBody: Buffer | undefined, signatureHeader: string): boolean {
    if (!this.webhookSecret || !signatureHeader || !rawBody) return false;

    const parts = String(signatureHeader)
      .split(',')
      .reduce<Record<string, string>>((acc, part) => {
        const [key, value] = part.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
      }, {});
    const timestamp = parts['t'];
    const providedSig = parts['v1'];
    if (!timestamp || !providedSig) return false;

    // Reject stale events (replay protection), matching Stripe's default 5-minute tolerance.
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      return false;
    }

    try {
      const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
      const computed = crypto.createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
      const providedBuf = Buffer.from(providedSig);
      const computedBuf = Buffer.from(computed);
      return providedBuf.length === computedBuf.length && crypto.timingSafeEqual(providedBuf, computedBuf);
    } catch {
      return false;
    }
  }

  async verifyAndParseWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<WebhookValidationResult> {
    const event = body;
    const isSuccessful = event?.type === 'checkout.session.completed' || event?.type === 'payment_intent.succeeded';
    const session = event?.data?.object || {};

    // Fail-closed: without a configured secret or a valid signature, the webhook is untrusted.
    const signatureHeader = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
    const isValid = this.verifySignature(rawBody, signatureHeader);
    if (!isValid) {
      this.logger.warn('Stripe webhook rejected: missing/invalid signature or STRIPE_WEBHOOK_SECRET not configured.');
    }

    return {
      isValid,
      isSuccessful,
      // No synthetic fallback: a payment we cannot name is a payment we cannot de-duplicate (F4).
      transactionReference: String(session?.id || '').trim(),
      amount: Number(session?.amount_total || 0) / 100,
      currency: (session?.currency || 'USD').toUpperCase(),
      gateway: 'stripe',
      tenantId: session?.metadata?.tenant_id || session?.client_reference_id,
      planId: Number(session?.metadata?.plan_id) || undefined,
      durationMonths: Number(session?.metadata?.duration_months) || 12,
      rawPayload: body,
    };
  }
}
