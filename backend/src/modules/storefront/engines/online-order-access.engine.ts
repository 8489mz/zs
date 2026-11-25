import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { buildStorePublicBase } from './store-public-url.engine';

// Invariants SF-1 / SF-2 / SF-3 (ARCHITECTURE_INVARIANTS.md section 4).
//
// SF-1  A public storefront route reaches a specific order only with that order's secret
//       access token. `order_number` is per-tenant sequential (ON-YYMMDD-0001) — anyone can
//       enumerate it, so it is a label, never a credential (same lesson as F15).
// SF-2  A sandbox ("mock") payment is a UI simulation. It may only run when the tenant has
//       explicitly put its gateway in test mode, and it NEVER counts as money collected.
// SF-3  An online order is "collected" only when a real gateway confirmed it (webhook) or a
//       merchant user confirmed the transfer by hand. The customer choosing a payment method
//       is a claim, not a payment.

export const ORDER_ACCESS_TOKEN_HEADER = 'x-order-token';

/** Issues a new token. Only the hash is stored; the raw token goes back to the customer once. */
export function issueOrderAccessToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashOrderAccessToken(token) };
}

/** A retry can reproduce the token without storing it in plaintext beside the idempotency key. */
export function issueIdempotentOrderAccessToken(tenantId: string, key: string): { token: string; hash: string } {
  const secret = String(process.env.SESSION_CSRF_SECRET || '');
  if (secret.length < 16) throw new Error('SESSION_CSRF_SECRET is required for storefront idempotency');
  const token = createHmac('sha256', secret)
    .update(`storefront-order-access-v1:${tenantId}:${key}`, 'utf8')
    .digest('base64url');
  return { token, hash: hashOrderAccessToken(token) };
}

export function hashOrderAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Fails closed: an order with no stored hash (legacy rows) is never reachable publicly. */
export function verifyOrderAccessToken(presented: unknown, storedHash: string | null | undefined): boolean {
  if (typeof presented !== 'string' || typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) {
    return false;
  }
  const token = presented.trim();
  if (token.length < 16 || token.length > 128) return false;
  const a = Buffer.from(hashOrderAccessToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SandboxGatewayFlags {
  enabled: boolean;
  provider: string;
  testMode: boolean;
  xpayTestMode: boolean;
  tapTestMode: boolean;
  stripeTestMode: boolean;
}

/** SF-2: sandbox payment only when the merchant enabled online payment AND chose test mode. */
export function isSandboxPaymentAllowed(config: SandboxGatewayFlags): boolean {
  if (!config.enabled) return false;
  switch (config.provider) {
    case 'mock':
      return true;
    case 'paymob':
      return config.testMode === true;
    case 'xpay':
      return config.xpayTestMode === true;
    case 'tap':
      return config.tapTestMode === true;
    case 'stripe':
      return config.stripeTestMode === true;
    default:
      return false;
  }
}

/** Providers whose `paid` status is backed by a verified webhook or a merchant's confirmation. */
export const COLLECTING_PAYMENT_PROVIDERS = ['paymob', 'xpay', 'tap', 'stripe', 'manual'] as const;

/**
 * Marketplaces that collect the customer's payment themselves, before the
 * merchant ships. A synced marketplace order is born `paid` with the
 * marketplace as its gateway provider, and the money reaches the merchant
 * through the marketplace's bulk settlement — never through the courier.
 * Treating such an order as cash-on-delivery makes the courier collect a
 * second time. The settlement itself is a separate bulk reconciliation
 * (accounting_marketplace_settlements, unlinked to individual sales);
 * this list only decides the delivery invoice's collection side.
 */
export const MARKETPLACE_PROVIDERS = ['amazon', 'noon', 'jumia', 'trendyol'] as const;

/** Checkout method the marketplace sync writes for orders the marketplace already collected. */
export const MARKETPLACE_PREPAID_PAYMENT_METHOD = 'marketplace_prepaid';

export interface OnlineOrderPaymentState {
  payment_status?: string | null;
  payment_method?: string | null;
  gateway_provider?: string | null;
}

export interface OnlineOrderCollection {
  collected: boolean;
  /**
   * A channel the sales engine understands. `normalizeSalePayload` maps anything outside
   * cash|card|wallet|instapay to 'cash', so passing the gateway name ('stripe', 'paymob'...) used to
   * book a card payment into the cash drawer (account 1110) instead of the bank side.
   */
  paymentChannel: 'cash' | 'card' | 'instapay';
  /** Which gateway / confirmation backs the payment — for notes and audit, never for routing. */
  provider: string | null;
}

/** SF-3: decides whether the delivery invoice is already paid or is cash-on-delivery. */
export function resolveOnlineOrderCollection(order: OnlineOrderPaymentState): OnlineOrderCollection {
  const provider = String(order.gateway_provider || '')
    .trim()
    .toLowerCase();
  const isMarketplace =
    (MARKETPLACE_PROVIDERS as readonly string[]).includes(provider) ||
    String(order.payment_method || '')
      .trim()
      .toLowerCase() === MARKETPLACE_PREPAID_PAYMENT_METHOD;
  const collected =
    order.payment_status === 'paid' &&
    ((COLLECTING_PAYMENT_PROVIDERS as readonly string[]).includes(provider) || isMarketplace);

  if (!collected) {
    return { collected: false, paymentChannel: 'cash', provider: null };
  }
  if (provider === 'manual') {
    return { collected: true, paymentChannel: 'instapay', provider };
  }
  // 'card' is the only non-cash channel the sale engine understands for a
  // receipt that is not cash in the drawer (postSale books every non-cash
  // payment to the bank side, as it does for gateway-paid orders). A new
  // 'marketplace' channel value would be silently mapped back to 'cash' by
  // normalizeSalePayload — the exact failure this resolver exists to prevent.
  return { collected: true, paymentChannel: 'card', provider: provider || (isMarketplace ? 'marketplace' : null) };
}

/** Payment methods whose money arrives outside any gateway and must be confirmed by a merchant user. */
export const MANUALLY_CONFIRMED_PAYMENT_METHODS = ['instapay_wallet'] as const;

/**
 * SF-1 tracking link sent to the shopper. The token goes in the URL FRAGMENT (#t=...), which browsers
 * never send to a server — it stays out of access logs, proxies and Referer headers.
 */
export function buildOrderTrackingUrl(
  origin: string | undefined,
  slug: string,
  orderNumber: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = buildStorePublicBase(origin, slug, { legacyPrefix: 'store', env });
  if (!base) return null;
  return `${base}/track/${encodeURIComponent(orderNumber)}#t=${encodeURIComponent(token)}`;
}

/**
 * Where a card gateway (Tap / Stripe) sends the shopper after paying: the order's page in the store
 * (SF-10 address). No access token — the URL is handed to a third party and lands in its logs (SF-1).
 * The shopper's device already holds the token from checkout, so "My orders" opens the order.
 */
export function buildPaymentReturnUrl(
  origin: string | undefined,
  slug: string,
  orderNumber: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = buildStorePublicBase(origin, slug, { env });
  return base ? `${base}/track/${encodeURIComponent(orderNumber)}` : null;
}

/** Server-to-server callback a gateway posts to. Prefers the configured public app URL over the request host. */
export function buildGatewayWebhookUrl(
  origin: string | undefined,
  provider: 'tap' | 'stripe' | 'paymob' | 'xpay',
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const candidate of [env.APP_PUBLIC_URL, origin]) {
    const base = String(candidate || '')
      .trim()
      .replace(/\/$/, '');
    if (/^https?:\/\/[^\s/]+$/i.test(base)) return `${base}/api/storefront/webhooks/${provider}`;
  }
  return null;
}

/**
 * SF-11: Unwraps the canonical Sale domain entity from any nested query/write result wrapper
 * (e.g. { sale: mappedSale, scope } from getSaleById or { ok: true, sale: mappedSale } from createSale).
 * Guarantees that callers (and the frontend) receive the pure flat Sale object directly without nested wrappers.
 */
export function unwrapConvertedSale<T = any>(result: any): T | null {
  if (!result) return null;
  if (result.sale && typeof result.sale === 'object') {
    return unwrapConvertedSale<T>(result.sale);
  }
  return result as T;
}
