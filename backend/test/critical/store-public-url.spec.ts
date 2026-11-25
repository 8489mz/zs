import { strict as assert } from 'node:assert';
import {
  buildStorePublicBase,
  canUseStoreSubdomain,
  isReservedStoreSlug,
  storefrontRootDomain,
  platformNoReplyEmail,
} from '../../src/modules/storefront/engines/store-public-url.engine';
import { validateEnv } from '../../src/config/env.schema';

// Regression coverage for invariant SF-10 (ARCHITECTURE_INVARIANTS.md section 4):
// one engine decides a store's public address; subdomain mode never hands out a link that lands on
// a platform host (app., www., api.) or on a name DNS cannot carry.

const ON = { STOREFRONT_ROOT_DOMAIN: 'zsystemai.com' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

function testPathModeIsTheDefault(): void {
  assert.equal(
    buildStorePublicBase('https://zsystemai.com', 'almhnds', { env: OFF }),
    'https://zsystemai.com/st/almhnds',
  );
  assert.equal(
    buildStorePublicBase('https://x.test/', 'Shop', { legacyPrefix: 'store', env: OFF }),
    'https://x.test/store/shop',
  );
  assert.equal(buildStorePublicBase('', 'almhnds', { env: OFF }), null, 'no origin, no link');
  assert.equal(buildStorePublicBase('https://evil.com/path', 'almhnds', { env: OFF }), null, 'origin only');
}

function testSubdomainMode(): void {
  assert.equal(
    buildStorePublicBase('https://app.zsystemai.com', 'almhnds', { env: ON }),
    'https://almhnds.zsystemai.com',
  );
  assert.equal(
    buildStorePublicBase(undefined, 'AlMhnds', { env: ON }),
    'https://almhnds.zsystemai.com',
    'no request origin needed',
  );
  assert.equal(
    buildStorePublicBase('https://evil.com', 'almhnds', { env: ON }),
    'https://almhnds.zsystemai.com',
    'a spoofed Host/X-Forwarded-Host cannot redirect store links',
  );
  assert.equal(
    storefrontRootDomain({ STOREFRONT_ROOT_DOMAIN: ' https://ZSystemAI.com/ ' } as NodeJS.ProcessEnv),
    'zsystemai.com',
  );
}

function testReservedAndInvalidFallBackToPath(): void {
  for (const slug of ['app', 'www', 'api', 'admin', 'st', 'login', 'trial']) {
    assert.equal(isReservedStoreSlug(slug), true, `${slug} is reserved`);
    assert.equal(canUseStoreSubdomain(slug), false);
    assert.equal(
      buildStorePublicBase('https://app.zsystemai.com', slug, { env: ON }),
      `https://app.zsystemai.com/st/${slug}`,
      `${slug} never becomes ${slug}.zsystemai.com`,
    );
  }
  assert.equal(isReservedStoreSlug(' APP '), true, 'case and spaces do not slip past');
  for (const slug of ['-shop', 'shop-', 'my_shop', 'a'.repeat(64), '']) {
    assert.equal(canUseStoreSubdomain(slug), false, `"${slug}" is not a DNS label`);
  }
  assert.equal(canUseStoreSubdomain('cairo-cafe-2'), true);
}

function testRootScopedSessionCookieIsRefused(): void {
  const base = {
    NODE_ENV: 'development',
    APP_MODE: 'LOCAL_PILOT',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'zs',
    DATABASE_USER: 'zs',
    DATABASE_PASSWORD: 'zs',
    SESSION_CSRF_SECRET: '1234567890123456',
    STOREFRONT_ROOT_DOMAIN: 'zsystemai.com',
  };
  for (const domain of ['.zsystemai.com', 'zsystemai.com', 'ZSystemAI.com']) {
    assert.throws(() => validateEnv({ ...base, SESSION_COOKIE_DOMAIN: domain }), /would share the ERP session/, domain);
  }
  assert.doesNotThrow(() => validateEnv({ ...base, SESSION_COOKIE_DOMAIN: '' }), 'host-only cookie is fine');
  assert.doesNotThrow(
    () => validateEnv({ ...base, SESSION_COOKIE_DOMAIN: 'app.zsystemai.com' }),
    'the app host itself is fine',
  );
  assert.doesNotThrow(
    () => validateEnv({ ...base, STOREFRONT_ROOT_DOMAIN: '', SESSION_COOKIE_DOMAIN: '.zsystemai.com' }),
    'no stores, no conflict',
  );
}

function testNoReplyAddressIsOnOurDomain(): void {
  // The gateways demand an email and a storefront shopper only gives a phone; the old literal was
  // `customer@z-systems.cloud`, a domain we do not own.
  assert.equal(platformNoReplyEmail(ON), 'no-reply@zsystemai.com');
  assert.equal(
    platformNoReplyEmail({ APP_PUBLIC_URL: 'https://app.zsystemai.com' } as NodeJS.ProcessEnv),
    'no-reply@zsystemai.com',
  );
  assert.equal(platformNoReplyEmail(OFF), 'no-reply@localhost', 'desktop / unconfigured stays local');
}

testPathModeIsTheDefault();
testSubdomainMode();
testReservedAndInvalidFallBackToPath();
testRootScopedSessionCookieIsRefused();
testNoReplyAddressIsOnOurDomain();
console.log('store-public-url.spec: all checks passed');
