/**
 * SF-10: the single place that decides a store's public address.
 *
 * Two modes, chosen by `STOREFRONT_ROOT_DOMAIN` (e.g. `zsystemai.com`):
 * - set:   every store lives on its own subdomain → `https://<slug>.<root>`.
 *          Same database, same tenant lookup by slug — the slug just moves from the path to the host.
 * - unset: the legacy path form on whatever origin served the request → `<origin>/st/<slug>`.
 *          Desktop (Electron) and any deployment without a wildcard DNS record stay here.
 *
 * A slug that cannot be a subdomain (reserved name, not a valid DNS label) always uses the path form,
 * so no store ever gets a link that resolves to the ERP or to nothing.
 *
 * The frontend mirror is `frontend/src/lib/store-public-url.ts`; keep the reserved
 * list identical in both.
 */

/**
 * Names a store (tenant slug or storefront slug) may not take: they are platform hosts under the root
 * domain, or paths the app already owns.
 */
export const RESERVED_STORE_SLUGS: ReadonlySet<string> = new Set([
  'app',
  'www',
  'api',
  'admin',
  'mail',
  'email',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'media',
  'status',
  'docs',
  'help',
  'support',
  'blog',
  'dev',
  'staging',
  'test',
  'demo',
  'erp',
  'portal',
  'dashboard',
  'billing',
  'pay',
  'payment',
  'payments',
  'webhook',
  'webhooks',
  'auth',
  'sso',
  'oauth',
  'login',
  'logout',
  'register',
  'signup',
  'trial',
  'store',
  'st',
  'shop',
  'profile',
  'settings',
  'pos',
  'system',
  'driver',
  'track',
  'public',
  'default',
  'root',
  'ns1',
  'ns2',
  'uptime-probe',
]);

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isReservedStoreSlug(slug: unknown): boolean {
  return RESERVED_STORE_SLUGS.has(
    String(slug ?? '')
      .trim()
      .toLowerCase(),
  );
}

/** The configured root domain, lower-cased, or '' when subdomain stores are off. */
export function storefrontRootDomain(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.STOREFRONT_ROOT_DOMAIN || '').trim();
  if (explicit) {
    return explicit
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^\.+|\.+$/g, '');
  }
  const appUrl = String(env.APP_LOGIN_URL || env.APP_PUBLIC_URL || env.CORS_ORIGINS || '');
  if (appUrl.includes('zsystemai.com')) {
    return 'zsystemai.com';
  }
  return '';
}

/** True when this slug can be served as `<slug>.<root>`. */
export function canUseStoreSubdomain(slug: unknown): boolean {
  const clean = String(slug ?? '')
    .trim()
    .toLowerCase();
  return DNS_LABEL.test(clean) && !RESERVED_STORE_SLUGS.has(clean);
}

/**
 * A sender/contact address on our own domain, for the places a payment gateway demands an email but
 * we have none (a storefront shopper gives a phone, not an email). It used to be a literal
 * `@z-systems.cloud`, a domain that is not ours and does not resolve.
 */
export function platformNoReplyEmail(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    storefrontRootDomain(env) ||
    String(env.APP_PUBLIC_URL || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[:/].*$/, '')
      .replace(/^app\./, '');
  return root ? `no-reply@${root}` : 'no-reply@localhost';
}

function cleanOrigin(origin: string | undefined): string | null {
  const base = String(origin || '')
    .trim()
    .replace(/\/$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(base) ? base : null;
}

/**
 * Store home URL with no trailing slash; sub-pages append `/p/<id>`, `/track/<n>`, `?table=<n>`.
 * Returns null only in path mode when there is no usable origin.
 */
export function buildStorePublicBase(
  origin: string | undefined,
  slug: string,
  options: { legacyPrefix?: 'st' | 'store'; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const clean = String(slug || '')
    .trim()
    .toLowerCase();
  const root = storefrontRootDomain(options.env);
  if (root && canUseStoreSubdomain(clean)) return `https://${clean}.${root}`;
  const base = cleanOrigin(origin);
  if (!base || !clean) return null;
  return `${base}/${options.legacyPrefix || 'st'}/${encodeURIComponent(clean)}`;
}
