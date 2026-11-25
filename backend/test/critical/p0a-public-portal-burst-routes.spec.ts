import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source-level regression: Nest middleware registration for public portal
// login and public RFQ write routes cannot be accidentally removed.
function run() {
  const source = readFileSync(resolve(__dirname, '../../src/app.module.ts'), 'utf8');
  for (const route of [
    'api/hr/portal/login',
    'api/hr/mobile-punch/login',
    'api/driver-portal/login',
    'api/freight-portal/auth/login',
    'api/freight-portal/auth/token-login',
    'api/maritime-freight/portal/auth/login',
    'api/public/freight-tracking/rfq/:id/bid',
    'api/public/carrier-quote/rfq/:id/bid',
  ]) {
    assert.ok(
      source.includes(`{ path: '${route}', method: RequestMethod.POST }`),
      `Missing public burst limit: ${route}`,
    );
  }
}
run();
