/*
 * New file: backend/test/critical/api-docs.spec.ts
 *
 * WHAT THIS PINS (INV-API-DOCS-SWAGGER, D12 — FINAL DTO package): the API
 * documentation is served by @nestjs/swagger at /api/docs (UI) and
 * /api/docs-json (OpenAPI document), built from the REAL Nest route
 * registration, and it covers the versioned (v1) routes too. The docs are
 * GATED: they mount ONLY when API_DOCS_ENABLED === 'true' AND
 * NODE_ENV !== 'production' — when gated off the routes do not exist at all
 * (404), not a 401. Reason (recorded in the log + INV): the SaaS host serves
 * real tenants; a public docs route leaks the whole API surface. An explicit
 * flag alone is not enough — a stray flag on the production host would open
 * it; the NODE_ENV check is the second lock. In dev (NODE_ENV unset or
 * 'development') a developer sets API_DOCS_ENABLED=true to see docs;
 * desktop copies (local-only) use the same flag.
 *
 * WHAT IS DRIVEN (the real Nest router + the real setupSwagger, no mocks):
 * (a) the gate function isApiDocsEnabled() under all four env combinations;
 * (b) a live HTTP probe through the REAL Nest router (@nestjs/testing,
 *     ephemeral port, the D11 probe module): gate ON — GET /api/docs returns
 *     200 HTML (Swagger UI) and GET /api/docs-json returns 200 with an
 *     OpenAPI 3.x document titled 'zs API' version '1.0' whose paths contain
 *     every probed route in BOTH its legacy and its /api/v1/... form
 *     (diagnostics upload get+post, diagnostics get, diagnostics download,
 *     diagnostics delete, partners customers get, partners contacts get);
 *     gate OFF (flag unset) and gate OFF (production + flag true) — the
 *     setup returns false and both /api/docs and /api/docs-json answer 404;
 * (c) source pins — main.ts calls setupSwagger(app) before app.listen and
 *     never calls SwaggerModule.setup itself; the double lock lives in
 *     src/config/swagger.ts only.
 *
 * D11 TRAPS CARRIED:
 * 1. Double-v1 trap: the 5 diagnostics /api/v1/... routes already existed
 *    before D11 — they are pinned here in BOTH forms, like every other
 *    route; no route set in this spec may silently drop them.
 * 2. A live HTTP probe through the real router needs route-guard overrides
 *    where Nest instantiates guards at init (D11 needed a
 *    DiagnosticsUploadRateLimitGuard override — the same probe module is
 *    reused here, with the same stub services).
 * 3. Pre-existing mismatches recorded, NOT fixed: the serials caller sends
 *    {serials} while the controller reads items; transferProducts never
 *    reads the caller-sent productIds.
 *
 * NOT DRIVEN: a live HTTP request through the full production app (needs a
 * booted AppModule + database); the services behind the probed routes
 * (their own specs own them); the frontend (untouched).
 *
 * Fail-first: on the unpatched tree src/config/swagger.ts does not exist,
 * so the import exits 1 with TS2307 (see the log). GREEN means the docs
 * serve through the real router exactly when the gate allows, the document
 * lists both forms of every probed route, and the gate really closes the
 * routes in production.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SaasDiagnosticsService } from '../../src/modules/saas-admin/saas-diagnostics.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { DiagnosticsUploadRateLimitGuard } from '../../src/modules/saas-admin/diagnostics-upload-rate-limit.guard';
import { SaasDiagnosticsController } from '../../src/modules/saas-admin/saas-diagnostics.controller';
import { PartnersController } from '../../src/modules/partners/partners.controller';
import { isApiDocsEnabled, setupSwagger } from '../../src/config/swagger';

// Every diagnostics route in BOTH forms (the 5 pre-existing v1 twins + the
// 5 legacy routes). OpenAPI path keys use {id} for the :id parameter.
const DIAGNOSTICS_PATHS: Array<{ path: string; methods: string[] }> = [
  { path: '/api/saas-admin/diagnostics/upload', methods: ['get', 'post'] },
  { path: '/api/v1/saas-admin/diagnostics/upload', methods: ['get', 'post'] },
  { path: '/api/saas-admin/diagnostics', methods: ['get'] },
  { path: '/api/v1/saas-admin/diagnostics', methods: ['get'] },
  { path: '/api/saas-admin/diagnostics/{id}/download', methods: ['get'] },
  { path: '/api/v1/saas-admin/diagnostics/{id}/download', methods: ['get'] },
  { path: '/api/saas-admin/diagnostics/{id}', methods: ['delete'] },
  { path: '/api/v1/saas-admin/diagnostics/{id}', methods: ['delete'] },
];

const PARTNERS_PATHS: Array<{ path: string; methods: string[] }> = [
  { path: '/api/customers', methods: ['get', 'post'] },
  { path: '/api/v1/customers', methods: ['get', 'post'] },
  // The contacts route is ':partnerType/:partnerId/contacts' (D11 probed it
  // as /api/customers/1/contacts) — the OpenAPI key carries both params,
  // in all four alias forms (get + post share the same path array).
  { path: '/api/{partnerType}/{partnerId}/contacts', methods: ['get', 'post'] },
  { path: '/api/v1/{partnerType}/{partnerId}/contacts', methods: ['get', 'post'] },
  { path: '/api/partners/{partnerType}/{partnerId}/contacts', methods: ['get', 'post'] },
  { path: '/api/v1/partners/{partnerType}/{partnerId}/contacts', methods: ['get', 'post'] },
];

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

async function main(): Promise<void> {
  const savedFlag = process.env.API_DOCS_ENABLED;
  const savedNodeEnv = process.env.NODE_ENV;
  function setEnv(flag: string | undefined, nodeEnv: string | undefined): void {
    if (flag === undefined) delete process.env.API_DOCS_ENABLED;
    else process.env.API_DOCS_ENABLED = flag;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }

  try {
    // 1. The gate function under all four env combinations.
    setEnv(undefined, 'development');
    assert.equal(isApiDocsEnabled(), false, 'flag unset + dev must be off');
    setEnv('false', 'development');
    assert.equal(isApiDocsEnabled(), false, "flag 'false' + dev must be off");
    setEnv('true', 'production');
    assert.equal(isApiDocsEnabled(), false, 'flag true + production must be off');
    setEnv('true', undefined);
    assert.equal(isApiDocsEnabled(), true, 'flag true + NODE_ENV unset must be on');
    setEnv('true', 'development');
    assert.equal(isApiDocsEnabled(), true, 'flag true + dev must be on');
    console.log('  gate function passed (all four env combinations)');

    // 2. Live probe — gate ON: the docs serve through the real router.
    @Module({
      controllers: [SaasDiagnosticsController, PartnersController],
      providers: [
        { provide: SaasDiagnosticsService, useValue: {} },
        {
          provide: PartnersService,
          useValue: {
            listCustomers: async () => ({ customers: [], total: 0 }),
            listContacts: async () => ({ contacts: [] }),
          },
        },
      ],
    })
    class ApiDocsProbeModule {}

    async function buildProbeApp() {
      const moduleRef = await Test.createTestingModule({ imports: [ApiDocsProbeModule] })
        .overrideGuard(SessionAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(DiagnosticsUploadRateLimitGuard)
        .useValue({ canActivate: () => true })
        .compile();
      return moduleRef.createNestApplication();
    }

    setEnv('true', 'development');
    {
      const app = await buildProbeApp();
      assert.equal(setupSwagger(app), true, 'setupSwagger must mount when the gate is on');
      await app.init();
      await app.listen(0, '127.0.0.1');
      try {
        const port = (app.getHttpServer().address() as { port: number }).port;
        const base = `http://127.0.0.1:${port}`;

        const ui = await fetch(`${base}/api/docs`);
        assert.equal(ui.status, 200, 'GET /api/docs must serve 200 when the gate is on');
        const uiBody = await ui.text();
        assert.ok(uiBody.includes('swagger-ui'), 'the /api/docs page must be the Swagger UI');

        const docRes = await fetch(`${base}/api/docs-json`);
        assert.equal(docRes.status, 200, 'GET /api/docs-json must serve 200 when the gate is on');
        const doc = (await docRes.json()) as {
          openapi: string;
          info: { title: string; version: string };
          paths: Record<string, Record<string, unknown>>;
        };
        assert.ok(doc.openapi.startsWith('3.'), `openapi must be 3.x, got ${doc.openapi}`);
        assert.equal(doc.info.title, 'zs API', 'document title must be zs API');
        assert.equal(doc.info.version, '1.0', 'document version must be 1.0');
        for (const { path, methods } of [...DIAGNOSTICS_PATHS, ...PARTNERS_PATHS]) {
          assert.ok(doc.paths[path], `document paths must contain ${path}`);
          for (const method of methods) {
            assert.ok(
              doc.paths[path][method] !== undefined,
              `document ${path} must carry the ${method.toUpperCase()} operation`,
            );
          }
        }
        console.log('  live probe passed (gate ON: UI 200, JSON 200, both forms in the document)');
      } finally {
        await app.close();
      }
    }

    // 3. Live probe — gate OFF (flag unset): setup returns false, routes 404.
    setEnv(undefined, 'development');
    {
      const app = await buildProbeApp();
      assert.equal(setupSwagger(app), false, 'setupSwagger must not mount when the flag is unset');
      await app.init();
      await app.listen(0, '127.0.0.1');
      try {
        const port = (app.getHttpServer().address() as { port: number }).port;
        const base = `http://127.0.0.1:${port}`;
        assert.equal((await fetch(`${base}/api/docs`)).status, 404, 'GET /api/docs must 404 when gated off');
        assert.equal((await fetch(`${base}/api/docs-json`)).status, 404, 'GET /api/docs-json must 404 when gated off');
        console.log('  live probe passed (gate OFF, flag unset: setup false, both routes 404)');
      } finally {
        await app.close();
      }
    }

    // 4. Live probe — gate OFF (production + flag true): the second lock holds.
    setEnv('true', 'production');
    {
      const app = await buildProbeApp();
      assert.equal(setupSwagger(app), false, 'setupSwagger must not mount in production even with the flag');
      await app.init();
      await app.listen(0, '127.0.0.1');
      try {
        const port = (app.getHttpServer().address() as { port: number }).port;
        const base = `http://127.0.0.1:${port}`;
        assert.equal((await fetch(`${base}/api/docs`)).status, 404, 'GET /api/docs must 404 in production');
        assert.equal((await fetch(`${base}/api/docs-json`)).status, 404, 'GET /api/docs-json must 404 in production');
        console.log('  live probe passed (gate OFF, production: setup false, both routes 404)');
      } finally {
        await app.close();
      }
    }

    // 5. Source pins — main.ts wires setupSwagger before listen; the double
    // lock lives in src/config/swagger.ts and nowhere else mounts the docs.
    const mainSrc = readSrc('main.ts');
    assert.ok(mainSrc.includes("from './config/swagger'"), 'main.ts must import setupSwagger from ./config/swagger');
    assert.ok(mainSrc.includes('setupSwagger(app)'), 'main.ts must call setupSwagger(app)');
    assert.ok(
      mainSrc.indexOf('setupSwagger(app)') < mainSrc.indexOf('app.listen('),
      'main.ts must call setupSwagger before app.listen',
    );
    assert.ok(!mainSrc.includes('SwaggerModule'), 'main.ts must not touch SwaggerModule directly');
    const swaggerSrc = readSrc('config/swagger.ts');
    assert.ok(swaggerSrc.includes("API_DOCS_ENABLED === 'true'"), 'swagger.ts must check API_DOCS_ENABLED === true');
    assert.ok(swaggerSrc.includes("NODE_ENV !== 'production'"), 'swagger.ts must check NODE_ENV !== production');
    assert.ok(swaggerSrc.includes('SwaggerModule.setup'), 'swagger.ts must be the only place that mounts the docs');
    console.log('  source pins passed');

    // 6. Wiring: this spec is in both critical lists, in identical order
    // (363 specs — the purchases-writer spec is the last entry).
    {
      const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 411);
      assert.equal(chain.length, 411);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/api-docs.spec.ts'));
      assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s5-business-date-r3.spec.ts');
      console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
    }

    console.log('API docs tests passed');
  } finally {
    if (savedFlag === undefined) delete process.env.API_DOCS_ENABLED;
    else process.env.API_DOCS_ENABLED = savedFlag;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
