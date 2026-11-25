// Enable Node.js 22+ built-in V8 compile cache for accelerated startup
try {
  if (typeof enableCompileCache === 'function') {
    enableCompileCache();
  }
} catch {
  // Gracefully ignored on platforms without compile cache
}

import * as Sentry from '@sentry/node';
import { json, urlencoded, type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import { enableCompileCache } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { ResponseMetadataInterceptor } from './common/interceptors/response-metadata.interceptor';
import { requestValidationPipe } from './common/pipes/request-validation.pipe';
import { buildCorsOriginCallback } from './common/utils/cors-options.util';
import { LoggerService } from './core/logging/logger.service';
import { isDesktopRuntimeMode } from './config/app-mode';
import { JSON_BODY_LIMIT } from './config/http-limits';

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return [
      `Failed to bootstrap application: ${error.message}`,
      `stack: ${error.stack ?? 'N/A'}`,
      `cause: ${String(error.cause ?? 'N/A')}`,
    ].join('\n');
  }

  return `Failed to bootstrap application: ${typeof error === 'string' ? error : JSON.stringify(error)}`;
}

import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap(): Promise<void> {
  if (process.env.ERROR_TRACKING_ENABLED === 'true' && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      beforeSend(event) {
        if (event.request?.headers) {
          const headers = event.request.headers;
          const sensitiveHeaders = ['authorization', 'cookie', 'session-id', 'csrf-token'];
          for (const key of Object.keys(headers)) {
            if (sensitiveHeaders.some((h) => key.toLowerCase().includes(h))) {
              headers[key] = '[REDACTED]';
            }
          }
        }

        if (event.request?.cookies) {
          event.request.cookies = { redacted: '[REDACTED]' };
        }

        if (event.request?.data) {
          try {
            const data = typeof event.request.data === 'string' ? JSON.parse(event.request.data) : event.request.data;
            if (data && typeof data === 'object') {
              const sensitiveKeys = ['password', 'token', 'secret', 'connection', 'smtp', 'db'];

              const deepRedact = (obj: any, sensitiveKeys: string[]): any => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map((item) => deepRedact(item, sensitiveKeys));
                const result = { ...obj };
                for (const key of Object.keys(result)) {
                  if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
                    result[key] = '[REDACTED]';
                  } else if (typeof result[key] === 'object') {
                    result[key] = deepRedact(result[key], sensitiveKeys);
                  }
                }
                return result;
              };

              const redactedData = deepRedact(data, sensitiveKeys);
              event.request.data = typeof event.request.data === 'string' ? JSON.stringify(redactedData) : redactedData;
            }
          } catch (e) {
            // ignore JSON parse errors
          }
        }
        return event;
      },
    });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  const configService = app.get(ConfigService);

  // Express computes weak ETags for JSON responses and responds 304 to If-None-Match.
  // Authenticated master data must never enter a shared proxy cache.
  app.set('etag', 'weak');
  const revalidatedMasters = new Set([
    '/api/categories',
    '/api/units',
    '/api/payment-methods',
    '/api/settings',
    '/api/settings/locations',
    '/api/branches',
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && revalidatedMasters.has(req.path)) {
      res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
      res.vary('Cookie');
      res.vary('Authorization');
      res.vary('X-Session-ID');
    }
    next();
  });

  app.use(
    json({
      limit: JSON_BODY_LIMIT,
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '256kb' }));
  // compression@1.8.1 negotiates Brotli/gzip/deflate on Node 22; its default
  // Brotli quality is 4. Fail startup if the dependency is unavailable rather than
  // silently serving every large JSON payload uncompressed.
  app.use(compression({ threshold: 1024 }));

  app.useGlobalPipes(requestValidationPipe);
  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  // PERF-1 (ARCHITECTURE_INVARIANTS.md §2.6): no global ClassSerializerInterceptor. Every response
  // here is a plain Kysely row/object (no @Exclude/@Expose on any response class), so it only deep-
  // copied each payload through class-transformer — measured ~100ms of blocked event loop per
  // 5,000-row response, on top of JSON.stringify. Hide fields by not selecting them instead.
  app.useGlobalInterceptors(new RequestContextInterceptor(), new ResponseMetadataInterceptor());

  app.enableShutdownHooks();

  const host = configService.getOrThrow<string>('app.host');
  const port = configService.getOrThrow<number>('app.port');

  const corsOrigins = configService
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // CORS policy lives in cors-options.util.ts (buildCorsOriginCallback):
  // public marketing paths allow the marketing origin + CORS_ORIGINS,
  // every other path (including GET /api/updates/*) allows CORS_ORIGINS
  // only. No origin is ever reflected back.
  app.enableCors(buildCorsOriginCallback(corsOrigins));

  const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  if (isDesktopRuntimeMode(configService.get<string>('app.mode')) || isDev) {
    if (process.env.SKIP_MIGRATIONS === 'true') {
      logger.log('Skipping migrations (SKIP_MIGRATIONS=true).');
    } else {
      logger.log('Running database migrations to ensure schema compatibility...');
      try {
        const { runMigrationCommand } = await import('./database/migration-runner');
        await runMigrationCommand('up');
        logger.log('Database migrations completed successfully.');

        try {
          const { PlanFeatureService } = await import('./core/auth/services/plan-feature.service');
          const planFeatureService = app.get(PlanFeatureService);
          await planFeatureService.refreshCache();
          logger.log('Plan features cache refreshed successfully.');
        } catch (e: any) {
          logger.warn(`Could not refresh plan features cache after migrations: ${e.message}`);
        }
      } catch (error) {
        logger.error('Failed to run database migrations during bootstrap', error);
        process.exit(1);
      }
    }
  }

  await app.listen(port, host);
  logger.log(`API bootstrap complete on ${host}:${port}`);
  console.log(`API bootstrap complete on ${host}:${port}`);

  if (typeof process.send === 'function') {
    process.send('ready');
  }
}

bootstrap().catch((error: unknown) => {
  const details = formatErrorDetails(error);
  // Hostinger's runtime log viewer reliably captures stderr, while the app logger may
  // not be fully initialized when bootstrap/config validation fails.
  console.error(details);
  const logger = new LoggerService();
  logger.error(details);
  process.exit(1);
});
