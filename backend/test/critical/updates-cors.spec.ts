/*
 * INV-UPDATES-CORS-ALLOWLIST: GET /api/updates/* used to reflect any Origin
 * with credentials:true (`main.ts`: `origin: originHeader || true`), so any
 * website could read the release history cross-origin. In dev mode that
 * response carries the stored per-release activation passcode
 * (`offline-releases.service.ts` `listReleaseHistory`, `passcode: isDev ? ...`),
 * and those are the real live codes that gate `apply`/`simulate` — the leak
 * is not a dev-only dummy. The updates branch is deleted: GET /api/updates/*
 * is now governed by the default CORS_ORIGINS allowlist like every other
 * endpoint, via the extracted `buildCorsOriginCallback` (main.ts only
 * registers it; importing main.ts would boot the app, so the callback is
 * what this spec drives).
 *
 * This spec pins that in two ways: (1) behaviour — it runs the REAL `cors`
 * middleware with the REAL callback main.ts registers and asserts the
 * response carries no Access-Control-Allow-Origin for an evil origin on
 * every GET /api/updates/* route, while the legitimate Electron renderer
 * (`file://`), localhost, and the marketing origin still get one; (2)
 * static — no `originHeader || true` reflection and no `/api/updates/`
 * special-case branch remain in main.ts or the util.
 *
 * Fail-first: with the old reflect-any branch restored, the evil-origin
 * cases fail (Access-Control-Allow-Origin: https://evil.example).
 */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import cors from 'cors';
import { buildCorsOriginCallback } from '../../src/common/utils/cors-options.util';
import { MARKETING_SITE_ORIGIN } from '../../src/common/utils/public-cors-origin.util';


const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * The CORS_ORIGINS the Electron launcher sets (frontend/electron/main.cjs)
 * plus the cloud marketing origin: localhost / 127.0.0.1 / file:// are the
 * in-app updates callers, https://zsystemai.com is the marketing site.
 */
const CONFIGURED_ORIGINS = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'file://',
  'https://zsystemai.com',
];

const EVIL_ORIGIN = 'https://evil.example';

function createMockResponse(): {
  headers: Map<string, string>;
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  removeHeader: (name: string) => void;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string): void {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string): string | undefined {
      return headers.get(name.toLowerCase());
    },
    removeHeader(name: string): void {
      headers.delete(name.toLowerCase());
    },
  };
}

/**
 * Runs the REAL `cors` middleware (the same package Nest's enableCors
 * uses) with the REAL callback main.ts registers, and returns the response
 * Access-Control-Allow-Origin header — undefined means no header was sent,
 * so the browser blocks the cross-origin read.
 */
function allowOriginHeader(
  method: string,
  url: string,
  origin: string | undefined,
): string | undefined {
  const middleware = cors(buildCorsOriginCallback(CONFIGURED_ORIGINS));
  const req: any = {
    method,
    url,
    headers: origin === undefined ? {} : { origin },
  };
  const res = createMockResponse();
  let nextCalled = false;
  middleware(req, res as any, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, 'cors middleware must call next()');
  return res.getHeader('access-control-allow-origin');
}

/** Invokes the callback directly and returns the resolved `origin` option. */
function resolveOriginOption(
  method: string,
  url: string,
  origin: string | undefined,
): unknown {
  let resolved: unknown;
  buildCorsOriginCallback(CONFIGURED_ORIGINS)(
    { method, url, headers: origin === undefined ? {} : { origin } },
    (_err: unknown, opts: any) => {
      resolved = opts.origin;
    },
  );
  return resolved;
}

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key] as string;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
  }
}

function run(): void {
  // 1. The leak: an evil origin gets NO header on any GET /api/updates/*
  //    route (history carries the passcode in dev mode; check embeds the
  //    same history in every return branch).
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', EVIL_ORIGIN),
    undefined,
    'evil origin must get no Access-Control-Allow-Origin on GET /api/updates/history',
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/check?version=1.0.0', EVIL_ORIGIN),
    undefined,
    'evil origin must get no Access-Control-Allow-Origin on GET /api/updates/check',
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/version', EVIL_ORIGIN),
    undefined,
    'evil origin must get no Access-Control-Allow-Origin on GET /api/updates/version',
  );
  // Lookalike / suffix tricks must not escape the allowlist either.
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', 'https://evil.example.evil.example'),
    undefined,
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', `${EVIL_ORIGIN}/`),
    undefined,
  );

  // 2. The callback itself never resolves to the evil origin (not a string,
  //    not an array member, not reflect-all `true`).
  const evilResolved = resolveOriginOption('GET', '/api/updates/history', EVIL_ORIGIN);
  assert.notEqual(evilResolved, true, 'callback must not reflect-all');
  assert.ok(
    !(typeof evilResolved === 'string' && evilResolved === EVIL_ORIGIN),
    'callback must not resolve to the evil origin',
  );
  assert.ok(
    !(Array.isArray(evilResolved) && evilResolved.includes(EVIL_ORIGIN)),
    'callback allowlist must not contain the evil origin',
  );

  // 3. Legitimate callers still work: the Electron renderer (file://),
  //    localhost, and the marketing origin each get their own origin back.
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', 'file://'),
    'file://',
    'Electron renderer (file://) must still read the updates history',
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', 'http://localhost:3001'),
    'http://localhost:3001',
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/check?version=1.0.0', 'http://127.0.0.1:3001'),
    'http://127.0.0.1:3001',
  );
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', MARKETING_SITE_ORIGIN),
    MARKETING_SITE_ORIGIN,
  );

  // 4. No Origin header (server-to-server, curl, Electron main process)
  //    needs no CORS header — and must not get the old allow-all `true`.
  assert.equal(
    allowOriginHeader('GET', '/api/updates/history', undefined),
    undefined,
  );

  // 5. POST /api/updates/* was never in the open branch; it stays on the
  //    allowlist (regression pin).
  assert.equal(
    allowOriginHeader('POST', '/api/updates/apply', EVIL_ORIGIN),
    undefined,
  );
  assert.equal(
    allowOriginHeader('POST', '/api/updates/apply', 'http://localhost:3001'),
    'http://localhost:3001',
  );

  // 6. LAN-server Desktop: the default branch's 'null' allowance now also
  //    covers updates paths (the branch deletion must not drop it).
  withEnv(
    { APP_MODE: 'SELF_CONTAINED', ELECTRON_RUNTIME_MODE: 'lan_server' },
    () => {
      assert.equal(
        allowOriginHeader('GET', '/api/updates/history', 'null'),
        'null',
      );
    },
  );
  // ... and outside lan_server mode 'null' is denied again.
  withEnv(
    { APP_MODE: 'SELF_CONTAINED', ELECTRON_RUNTIME_MODE: undefined },
    () => {
      assert.equal(
        allowOriginHeader('GET', '/api/updates/history', 'null'),
        undefined,
      );
    },
  );

  // 7. The public branch is untouched by the extraction: evil denied,
  //    marketing allowed even when CORS_ORIGINS omits it.
  assert.equal(
    allowOriginHeader('GET', '/api/public/pricing-catalog', EVIL_ORIGIN),
    undefined,
  );
  assert.equal(
    allowOriginHeader('GET', '/api/public/pricing-catalog', MARKETING_SITE_ORIGIN),
    MARKETING_SITE_ORIGIN,
  );

  // 8. Static: no reflect-any and no updates special-case branch remain.
  const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'main.ts'), 'utf8');
  assert.ok(
    mainSrc.includes('buildCorsOriginCallback'),
    'main.ts must register the extracted CORS callback',
  );
  assert.ok(
    !mainSrc.includes('originHeader || true'),
    'main.ts must not contain the old reflect-any branch',
  );
  const utilSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'backend', 'src', 'common', 'utils', 'cors-options.util.ts'),
    'utf8',
  );
  assert.ok(
    !utilSrc.includes('originHeader || true'),
    'cors-options.util.ts must not contain the old reflect-any branch',
  );
  assert.ok(
    !utilSrc.includes("startsWith('/api/updates/"),
    'cors-options.util.ts must not special-case /api/updates/ anymore',
  );

  // 9. Wiring: this spec is in test:critical and its INV entry exists once.
  const specs = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'backend', 'scripts', 'critical-specs.json'), 'utf8'),
  ).specs as string[];
  assert.ok(
    specs.includes('test/critical/updates-cors.spec.ts'),
    'this spec must be wired into test:critical',
  );
  const invariants = fs.readFileSync(
    path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'),
    'utf8',
  );
  assert.equal(
    invariants.split('INV-UPDATES-CORS-ALLOWLIST').length - 1,
    1,
    'the invariant entry must exist exactly once',
  );

  console.log('updates-cors.spec: ok');
}

run();
