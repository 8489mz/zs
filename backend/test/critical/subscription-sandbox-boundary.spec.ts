import { strict as assert } from 'node:assert';
import { assertSubscriptionSandboxAllowed } from '../../src/modules/tenant-subscription/gateways/subscription-sandbox-policy';
import { XPayGatewayService } from '../../src/modules/tenant-subscription/gateways/xpay.gateway';
import { PaymobGatewayService } from '../../src/modules/tenant-subscription/gateways/paymob.gateway';
import { StripeGatewayService } from '../../src/modules/tenant-subscription/gateways/stripe.gateway';
import { TenantSubscriptionController } from '../../src/modules/tenant-subscription/tenant-subscription.controller';
import { CompleteSandboxCheckoutDto } from '../../src/modules/tenant-subscription/dto/sandbox-checkout-write.dto';
import { PaymentManagerService } from '../../src/modules/tenant-subscription/gateways/payment-manager.service';

const payment = {
  tenantId: 'merchant-a',
  tenantSlug: 'merchant-a',
  planId: 2,
  planName: 'Suite',
  amount: 100,
  currency: 'EGP',
  durationMonths: 12,
  businessName: 'Merchant',
  ownerName: 'Owner',
  ownerPhone: '01000000000',
  redirectUrl: '/settings/subscription',
};

async function withEnv(vars: Record<string, string | undefined>, action: () => Promise<void>): Promise<void> {
  const old = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await action();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function run() {
  const absentCredentials = {
    XPAY_API_KEY: undefined,
    XPAY_COMMUNITY_ID: undefined,
    PAYMOB_API_KEY: undefined,
    PAYMOB_INTEGRATION_ID: undefined,
    STRIPE_SECRET_KEY: undefined,
  };
  for (const mode of ['CLOUD_SAAS', 'UNRECOGNIZED', undefined]) {
    await withEnv({ ...absentCredentials, APP_MODE: mode }, async () => {
      assert.throws(() => assertSubscriptionSandboxAllowed(), /unavailable in Cloud SaaS/);
      await assert.rejects(() => new XPayGatewayService().initiatePayment(payment), /unavailable in Cloud SaaS/);
      await assert.rejects(() => new PaymobGatewayService().initiatePayment(payment), /unavailable in Cloud SaaS/);
      // Direct service invocations must not bypass the HTTP controller's protection.
      const manager = new PaymentManagerService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
      await assert.rejects(
        () =>
          manager.processDirectPayment({
            gatewayName: 'xpay',
            tenantId: 'merchant-a',
            amount: 0,
            currency: 'EGP',
            transactionReference: 'FAKE-1',
          }),
        /unavailable in Cloud SaaS/,
      );
      const controller = new TenantSubscriptionController({} as any, manager);
      await assert.rejects(
        () =>
          controller.completeSandboxCheckout(
            // D10: the sandbox form posts planId/amount as STRINGS; the
            // pipe coerces them to numbers before the controller sees
            // them, and the service coerces again — the cast keeps the
            // direct-call shape (the service, not the DTO, owns the
            // coercion for direct callers).
            { gateway: 'xpay', planId: '2', amount: '0' } as unknown as CompleteSandboxCheckoutDto,
            { authContext: { tenantId: 'merchant-a', role: 'admin', permissions: [] } } as any,
            {} as any,
          ),
        /unavailable in Cloud SaaS/,
      );
    });
  }
  for (const mode of ['SELF_CONTAINED', 'LOCAL_PILOT']) {
    await withEnv({ ...absentCredentials, APP_MODE: mode }, async () => {
      assert.doesNotThrow(() => assertSubscriptionSandboxAllowed());
      const result = await new XPayGatewayService().initiatePayment(payment);
      assert.match(result.paymentUrl, /sandbox-checkout/);
    });
  }
  await withEnv(
    { ...absentCredentials, APP_MODE: 'SELF_CONTAINED', XPAY_API_KEY: 'live', XPAY_COMMUNITY_ID: 'configured' },
    async () => {
      assert.throws(() => assertSubscriptionSandboxAllowed(), /disabled when real payment credentials/);
    },
  );
  await withEnv({ ...absentCredentials, APP_MODE: 'CLOUD_SAAS' }, async () => {
    await assert.rejects(
      () => new StripeGatewayService().initiatePayment(payment),
      /Stripe checkout is not configured/,
    );
  });
  console.log('Subscription simulation stays local-only; cloud cannot mint free paid subscriptions.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
