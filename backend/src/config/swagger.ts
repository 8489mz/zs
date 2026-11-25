// API documentation (Swagger/OpenAPI) — backend/src/main.ts mounts it through
// setupSwagger(app) before app.listen.
//
// GATE (INV-API-DOCS-SWAGGER, D12): the docs mount ONLY when
// API_DOCS_ENABLED === 'true' AND NODE_ENV !== 'production'. When gated off
// the routes do not exist at all (404), not a 401 — no surface, no auth to
// bypass. The SaaS host serves real tenants; a public docs route would leak
// the whole API surface. An explicit flag alone is not enough — a stray flag
// on the production host would open it; the NODE_ENV check is the second
// lock. In dev (NODE_ENV unset or 'development') a developer sets
// API_DOCS_ENABLED=true to see docs; desktop copies (local-only) use the
// same flag. The document covers both forms of every route (legacy /api/...
// and versioned /api/v1/...) because it is built from the app's own route
// registration.
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** The docs UI path (the JSON document is served at `${API_DOCS_PATH}-json`). */
export const API_DOCS_PATH = 'api/docs' as const;

/**
 * The docs gate: an explicit opt-in flag AND a non-production environment.
 * Read at call time so tests can flip the flag per case.
 */
export function isApiDocsEnabled(): boolean {
  return process.env.API_DOCS_ENABLED === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * Builds the OpenAPI document from the app's routes and mounts the Swagger
 * UI at /api/docs. Returns false (and mounts nothing) when the gate is off.
 */
export function setupSwagger(app: INestApplication): boolean {
  if (!isApiDocsEnabled()) {
    return false;
  }
  const config = new DocumentBuilder()
    .setTitle('zs API')
    .setDescription('zs sales + inventory API — every route is served under both /api/... and /api/v1/...')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(API_DOCS_PATH, app, document);
  return true;
}
