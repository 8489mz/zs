import assert from 'node:assert/strict';
import { SecurityHeadersMiddleware } from '../../src/common/middleware/security-headers.middleware';

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
let nextCalled = false;
const secureResponse = createResponse();
middleware.use({ secure: true, headers: {} } as any, secureResponse as any, () => {
  nextCalled = true;
});
assert.equal(nextCalled, true);
assert.equal(secureResponse.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(
  secureResponse.headers.get('Content-Security-Policy'),
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
);
assert.equal(secureResponse.headers.get('Strict-Transport-Security'), 'max-age=15552000; includeSubDomains');
assert.equal(secureResponse.headers.get('X-Permitted-Cross-Domain-Policies'), 'none');
assert.equal(secureResponse.headers.get('Origin-Agent-Cluster'), '?1');

const proxiedResponse = createResponse();
middleware.use(
  { secure: false, headers: { 'x-forwarded-proto': 'https' } } as any,
  proxiedResponse as any,
  () => undefined,
);
assert.equal(proxiedResponse.headers.get('Strict-Transport-Security'), 'max-age=15552000; includeSubDomains');

const insecureResponse = createResponse();
middleware.use({ secure: false, headers: {} } as any, insecureResponse as any, () => undefined);
assert.equal(insecureResponse.headers.has('Strict-Transport-Security'), false);

console.log('security-headers.middleware.spec.ts passed');
