import { ForbiddenException } from '@nestjs/common';
import { isDesktopRuntimeMode } from '../../../config/app-mode';

/**
 * Fake payments create real subscription grants. They must never be reachable
 * from Cloud SaaS, even when production gateway credentials are missing.
 * Only explicitly selected local runtimes may simulate checkout.
 */
export function assertSubscriptionSandboxAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!isDesktopRuntimeMode(env.APP_MODE)) {
    throw new ForbiddenException('Subscription payment simulation is unavailable in Cloud SaaS.');
  }

  const livePaymentConfigured = Boolean(
    (env.XPAY_API_KEY?.trim() && env.XPAY_COMMUNITY_ID?.trim()) ||
    (env.PAYMOB_API_KEY?.trim() && env.PAYMOB_INTEGRATION_ID?.trim()) ||
    env.STRIPE_SECRET_KEY?.trim(),
  );
  if (livePaymentConfigured) {
    throw new ForbiddenException(
      'Subscription payment simulation is disabled when real payment credentials are configured.',
    );
  }
}
