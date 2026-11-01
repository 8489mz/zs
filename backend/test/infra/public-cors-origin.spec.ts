import assert from 'node:assert/strict';
import {
  MARKETING_SITE_ORIGIN,
  isPublicApiPath,
  resolvePublicApiCorsOrigin,
} from '../../src/common/utils/public-cors-origin.util';
import { SecurityHeadersMiddleware } from '../../src/common/middleware/security-headers.middleware';

// Path predicate: only the public API subtree, never a lookalike prefix.
assert.equal(MARKETING_SITE_ORIGIN, 'https://zsystemai.com');
assert.equal(isPublicApiPath('/api/public/pricing-catalog'), true);
assert.equal(isPublicApiPath('/api/public/trial-signup'), true);
assert.equal(isPublicApiPath('/api/public/pricing-catalog?product=retail&country=EG'), true);
assert.equal(isPublicApiPath('/api/public'), true);
assert.equal(isPublicApiPath('/api/public-trial-signup'), false);
assert.equal(isPublicApiPath('/api/publicity'), false);
assert.equal(isPublicApiPath('/api/storefront/tenant/catalog'), false);
assert.equal(isPublicApiPath('/api/updates/latest'), false);
assert.equal(isPublicApiPath(undefined), false);
assert.equal(isPublicApiPath(''), false);

// Resolver: the marketing origin is allowed even when the configured
// CORS_ORIGINS list does not mention it (a missing env entry must never
// hide prices); configured origins keep working; everything else denied.
const configured = ['http://localhost:5173', 'http://127.0.0.1:5173'];
assert.equal(resolvePublicApiCorsOrigin('https://zsystemai.com', configured), 'https://zsystemai.com');
assert.equal(resolvePublicApiCorsOrigin('https://zsystemai.com', []), 'https://zsystemai.com');
assert.equal(resolvePublicApiCorsOrigin('http://localhost:5173', configured), 'http://localhost:5173');
assert.equal(resolvePublicApiCorsOrigin('https://zsystemai.com.evil.example', configured), false);
assert.equal(resolvePublicApiCorsOrigin('https://evilzsystemai.com', configured), false);
assert.equal(resolvePublicApiCorsOrigin('https://zsystemai.com/', configured), false);
assert.equal(resolvePublicApiCorsOrigin('https://sub.zsystemai.com', configured), false);
assert.equal(resolvePublicApiCorsOrigin(undefined, configured), false);
assert.equal(resolvePublicApiCorsOrigin('', configured), false);

// Middleware: CORP cross-origin on public paths only, all other headers
// unchanged, and the legacy no-path mock still answers same-origin.
function createResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    removeHeader(name: string) {
      headers.delete(name);
    },
  };
}

const middleware = new SecurityHeadersMiddleware();
const publicResponse = createResponse();
middleware.use(
  { secure: true, headers: {}, path: '/api/public/pricing-catalog' } as any,
  publicResponse as any,
  () => undefined,
);
assert.equal(publicResponse.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
assert.equal(publicResponse.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(publicResponse.headers.get('X-Frame-Options'), 'DENY');
assert.equal(
  publicResponse.headers.get('Content-Security-Policy'),
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
);

const privateResponse = createResponse();
middleware.use(
  { secure: true, headers: {}, path: '/api/sales/invoices' } as any,
  privateResponse as any,
  () => undefined,
);
assert.equal(privateResponse.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');

const legacyResponse = createResponse();
middleware.use({ secure: true, headers: {} } as any, legacyResponse as any, () => undefined);
assert.equal(legacyResponse.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');

console.log('public-cors-origin.spec.ts passed');
