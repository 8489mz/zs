/**
 * Cross-origin policy for the public API endpoints under /api/public/.
 *
 * The pricing catalog and trial signup are public endpoints (no auth guard).
 * The marketing site at https://zsystemai.com reads the pricing catalog in
 * the browser, and the single endpoint is the one source of prices for the
 * website, the in-app client, and every other caller. A browser fetch is
 * blocked unless the response carries Access-Control-Allow-Origin matching
 * the page origin, so an allow-list that omits the marketing origin hides
 * prices silently: the site then shows its "could not fetch live prices"
 * state even though the endpoint itself answers 200 to a server request.
 *
 * The fix is deliberately env-independent: the marketing origin is allowed
 * by code, not by the CORS_ORIGINS deployment variable, so a missing env
 * entry can never hide prices again. Every other origin is allowed only
 * when it appears in the configured CORS_ORIGINS list, and anything else
 * is denied (no Access-Control-Allow-Origin header, so the browser blocks
 * the read). Exact string match only: no suffix, prefix, or subdomain
 * matching, so https://zsystemai.com.evil.example or a trailing-slash
 * variant never matches.
 *
 * The security-headers middleware uses the same path predicate to relax
 * Cross-Origin-Resource-Policy to cross-origin on these paths (the
 * storefront media precedent): CORP same-origin would otherwise block a
 * cross-origin read even when CORS allows it.
 */
export const MARKETING_SITE_ORIGIN = 'https://zsystemai.com';

export const PUBLIC_API_PATH_PREFIX = '/api/public/';

export function isPublicApiPath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const pathname = path.split('?')[0];
  return pathname === '/api/public' || pathname.startsWith(PUBLIC_API_PATH_PREFIX);
}

/**
 * Resolve the Access-Control-Allow-Origin value for a public-API request.
 * Returns the exact origin string when it is the marketing site origin or
 * an entry of the configured CORS_ORIGINS list; returns false otherwise
 * (the cors middleware then omits the header and the browser blocks the
 * read). An absent Origin header is denied: only real cross-origin browser
 * reads carry one, and server-to-server callers do not need CORS.
 */
export function resolvePublicApiCorsOrigin(
  origin: string | undefined,
  configuredOrigins: readonly string[],
): string | false {
  if (!origin) {
    return false;
  }
  if (origin === MARKETING_SITE_ORIGIN) {
    return origin;
  }
  if (configuredOrigins.includes(origin)) {
    return origin;
  }
  return false;
}
