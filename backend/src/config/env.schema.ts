import { z } from 'zod';
import { normalizeAppMode } from './app-mode';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['LOCAL_PILOT', 'SELF_CONTAINED', 'CLOUD_SAAS']).default('CLOUD_SAAS'),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  APP_HOST: z.string().min(1).default('0.0.0.0'),
  APP_PUBLIC_URL: z.string().trim().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_SCHEMA: z.string().min(1).default('public'),
  DATABASE_SSL: booleanString,
  DATABASE_SSL_REJECT_UNAUTHORIZED: booleanString,
  DATABASE_LOGGING: booleanString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(10000),
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  ENABLE_BOOTSTRAP_ADMIN: booleanString,
  LICENSE_MODE: z.enum(['desktop', 'server']).default('desktop'),
  ACTIVATION_ENFORCED: booleanString,
  ACTIVATION_PUBLIC_KEY: z.string().default(''),
  ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION: booleanString,
  DEFAULT_ADMIN_USERNAME: z.string().trim().default(''),
  DEFAULT_ADMIN_PASSWORD: z.string().default(''),
  SESSION_COOKIE_NAME: z.string().trim().min(1).default('session_id'),
  SESSION_CSRF_COOKIE_NAME: z.string().trim().min(1).default('csrf_token'),
  SESSION_COOKIE_SECURE: booleanString,
  SESSION_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  SESSION_CSRF_SECRET: z.string().min(16),
  ALLOW_SESSION_ID_HEADER: booleanString,
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10000).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(3).max(10000).default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(30).max(86400).default(600),
  AUTH_BURST_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(5000).default(60),
  AUTH_BURST_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(100000).default(600),
  GLOBAL_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  BUSINESS_TIMEZONE: z.string().default('UTC'),
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM_EMAIL: z.string().trim().default(''),
  MAIL_FROM_NAME: z.string().trim().default('Z Systems'),
  TENANT_ID: z.string().trim().default('default'),
  ACCOUNT_ID: z.string().trim().default('default'),
  PORTABLE_MODE: booleanString.optional(),
  IS_ELECTRON: booleanString.optional(),
  SAAS_DEFAULT_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),
  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().trim().default('production'),
  SENTRY_RELEASE: z.string().trim().default(''),
  SENTRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  ERROR_TRACKING_ENABLED: booleanString,
  SUPPORT_BUNDLE_LOG_TAIL_LINES: z.coerce.number().int().min(100).max(10000).default(2000),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
});

export type AppEnv = z.infer<typeof envSchema>;

function isLocalDatabaseHost(host: string): boolean {
  return ['postgres', 'localhost', '127.0.0.1', '::1'].includes(host.trim().toLowerCase());
}

function hasUnsafeCorsOrigin(corsOrigins: string): boolean {
  return corsOrigins
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean)
    .some((origin) => origin === '*' || origin.includes('localhost') || origin.includes('127.0.0.1'));
}

function isPlaceholderTenant(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || ['default', 'replace-me', 'replace-me-tenant-id'].includes(normalized);
}

function isPlaceholderAccount(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || ['default', 'replace-me', 'replace-me-account-id'].includes(normalized);
}

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const hasExplicitCsrfSecret =
    typeof config.SESSION_CSRF_SECRET === 'string' && config.SESSION_CSRF_SECRET.trim().length >= 16;
  const appMode = normalizeAppMode(config.APP_MODE);

  if (
    appMode === 'CLOUD_SAAS' &&
    [config.PORTABLE_MODE, config.IS_ELECTRON].some((value) => String(value) === 'true')
  ) {
    throw new Error('CLOUD_SAAS cannot enable PORTABLE_MODE or IS_ELECTRON');
  }

  const isPortable = config.PORTABLE_MODE === 'true' && appMode !== 'SELF_CONTAINED';

  const dbHost = (config.DATABASE_HOST ?? config.DB_HOST) || (isPortable ? 'localhost' : undefined);
  const isLocalHost = typeof dbHost === 'string' && isLocalDatabaseHost(dbHost);
  const forceDisableSsl = isPortable || appMode === 'SELF_CONTAINED' || isLocalHost;

  const raw = {
    ...config,
    APP_MODE: appMode,
    APP_PORT: (config.PORT ?? config.APP_PORT) ? Number(config.PORT ?? config.APP_PORT) : 3001,
    APP_HOST: config.HOST ?? config.APP_HOST ?? '0.0.0.0',
    APP_PUBLIC_URL: config.APP_PUBLIC_URL ?? '',
    DATABASE_HOST: dbHost,
    DATABASE_PORT:
      (config.DATABASE_PORT ?? config.DB_PORT ?? config.PGPORT)
        ? Number(config.DATABASE_PORT ?? config.DB_PORT ?? config.PGPORT)
        : isPortable
          ? 5432
          : 5432,
    DATABASE_NAME: config.DATABASE_NAME ?? config.DB_NAME ?? (isPortable ? 'pglite' : undefined),
    DATABASE_USER: config.DATABASE_USER ?? config.DB_USER ?? (isPortable ? 'pglite' : undefined),
    DATABASE_PASSWORD: config.DATABASE_PASSWORD ?? config.DB_PASSWORD ?? (isPortable ? 'pglite' : undefined),
    DATABASE_SSL: forceDisableSsl ? 'false' : (config.DATABASE_SSL ?? config.DB_SSL ?? 'false'),
    DATABASE_SSL_REJECT_UNAUTHORIZED: forceDisableSsl ? 'false' : (config.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'false'),
    DATABASE_POOL_MAX: config.DATABASE_POOL_MAX ?? 10,
    DATABASE_POOL_IDLE_TIMEOUT_MS: config.DATABASE_POOL_IDLE_TIMEOUT_MS ?? 10000,
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: config.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? 10000,
    ENABLE_BOOTSTRAP_ADMIN: config.ENABLE_BOOTSTRAP_ADMIN ?? 'false',
    LICENSE_MODE: config.LICENSE_MODE ?? 'desktop',
    ACTIVATION_ENFORCED: config.ACTIVATION_ENFORCED ?? 'false',
    ACTIVATION_PUBLIC_KEY: config.ACTIVATION_PUBLIC_KEY ?? '',
    ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION: config.ALLOW_BOOTSTRAP_ADMIN_IN_PRODUCTION ?? 'false',
    SESSION_COOKIE_NAME: config.SESSION_COOKIE_NAME ?? 'session_id',
    SESSION_CSRF_COOKIE_NAME: config.SESSION_CSRF_COOKIE_NAME ?? 'csrf_token',
    SESSION_COOKIE_SECURE:
      config.SESSION_COOKIE_SECURE ?? ((config.NODE_ENV as string | undefined) === 'production' ? 'true' : 'false'),
    SESSION_COOKIE_SAME_SITE:
      config.SESSION_COOKIE_SAME_SITE ?? ((config.NODE_ENV as string | undefined) === 'production' ? 'strict' : 'lax'),
    SESSION_CSRF_SECRET:
      config.SESSION_CSRF_SECRET ??
      `${String(config.DATABASE_PASSWORD ?? config.DB_PASSWORD ?? 'local-dev-csrf-secret')}:csrf:v1`,
    ALLOW_SESSION_ID_HEADER: config.ALLOW_SESSION_ID_HEADER ?? 'false',
    BUSINESS_TIMEZONE: config.BUSINESS_TIMEZONE ?? 'UTC',
    SMTP_HOST: config.SMTP_HOST ?? '',
    SMTP_PORT: config.SMTP_PORT ?? 587,
    SMTP_SECURE: config.SMTP_SECURE ?? 'false',
    SMTP_USER: config.SMTP_USER ?? '',
    SMTP_PASSWORD: config.SMTP_PASSWORD ?? '',
    MAIL_FROM_EMAIL: config.MAIL_FROM_EMAIL ?? '',
    MAIL_FROM_NAME: config.MAIL_FROM_NAME ?? 'Z Systems',
    TENANT_ID: config.TENANT_ID ?? 'default',
    ACCOUNT_ID: config.ACCOUNT_ID ?? 'default',
    SAAS_DEFAULT_GRACE_DAYS: config.SAAS_DEFAULT_GRACE_DAYS ?? 7,
    SENTRY_DSN: config.SENTRY_DSN ?? '',
    SENTRY_ENVIRONMENT: config.SENTRY_ENVIRONMENT ?? 'production',
    SENTRY_RELEASE: config.SENTRY_RELEASE ?? '',
    SENTRY_SAMPLE_RATE: config.SENTRY_SAMPLE_RATE ?? 0.1,
    ERROR_TRACKING_ENABLED: config.ERROR_TRACKING_ENABLED ?? 'false',
    SUPPORT_BUNDLE_LOG_TAIL_LINES: config.SUPPORT_BUNDLE_LOG_TAIL_LINES ?? 2000,
    TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN ?? '',
    TELEGRAM_CHAT_ID: config.TELEGRAM_CHAT_ID ?? '',
  };

  const parsed = envSchema.parse(raw);

  if (parsed.NODE_ENV === 'production' && !hasExplicitCsrfSecret) {
    throw new Error('SESSION_CSRF_SECRET must be explicitly configured in production');
  }

  const isSelfContained = parsed.APP_MODE === 'SELF_CONTAINED';
  if (parsed.NODE_ENV === 'production' && parsed.ALLOW_SESSION_ID_HEADER && !isPortable && !isSelfContained) {
    throw new Error('ALLOW_SESSION_ID_HEADER must remain disabled in production');
  }

  if (parsed.SESSION_COOKIE_SAME_SITE === 'none' && !parsed.SESSION_COOKIE_SECURE) {
    throw new Error('SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE is none');
  }

  if (
    (parsed.APP_MODE === 'LOCAL_PILOT' || parsed.APP_MODE === 'SELF_CONTAINED') &&
    !isLocalDatabaseHost(parsed.DATABASE_HOST)
  ) {
    throw new Error('DATABASE_HOST must be local-only when APP_MODE is LOCAL_PILOT or SELF_CONTAINED');
  }

  if (parsed.NODE_ENV === 'production' && parsed.APP_MODE === 'CLOUD_SAAS') {
    if (
      !isLocalDatabaseHost(parsed.DATABASE_HOST) &&
      (!parsed.DATABASE_SSL || !parsed.DATABASE_SSL_REJECT_UNAUTHORIZED)
    ) {
      throw new Error(
        'DATABASE_SSL and DATABASE_SSL_REJECT_UNAUTHORIZED must be true for CLOUD_SAAS production mode when using remote DB',
      );
    }

    if (hasUnsafeCorsOrigin(parsed.CORS_ORIGINS)) {
      throw new Error('CORS_ORIGINS cannot include localhost, 127.0.0.1, or "*" in CLOUD_SAAS production mode');
    }

    if (isPlaceholderTenant(parsed.TENANT_ID)) {
      throw new Error('TENANT_ID must be explicitly configured for CLOUD_SAAS production mode');
    }

    if (isPlaceholderAccount(parsed.ACCOUNT_ID)) {
      throw new Error('ACCOUNT_ID must be explicitly configured for CLOUD_SAAS production mode');
    }

    if (!parsed.SMTP_HOST || !parsed.MAIL_FROM_EMAIL) {
      throw new Error('SMTP_HOST and MAIL_FROM_EMAIL must be configured for CLOUD_SAAS production mode');
    }

    if (parsed.ERROR_TRACKING_ENABLED && !parsed.SENTRY_DSN) {
      throw new Error('SENTRY_DSN must be configured when ERROR_TRACKING_ENABLED=true');
    }
  }

  // SF-10: every store is its own subdomain of STOREFRONT_ROOT_DOMAIN and runs merchant-controlled
  // content (pixels, descriptions). A session cookie scoped to the root would be sent to all of them,
  // letting one store's page call the ERP API as whichever merchant or admin visits it.
  const storefrontRoot = normalizeCookieDomain(config.STOREFRONT_ROOT_DOMAIN);
  const cookieDomain = normalizeCookieDomain(config.SESSION_COOKIE_DOMAIN);
  if (
    storefrontRoot &&
    cookieDomain &&
    (cookieDomain === storefrontRoot || storefrontRoot.endsWith(`.${cookieDomain}`))
  ) {
    throw new Error(
      `SESSION_COOKIE_DOMAIN (${cookieDomain}) would share the ERP session with every store under ${storefrontRoot}; leave it empty (host-only cookie)`,
    );
  }

  return parsed;
}

function normalizeCookieDomain(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\.+|\.+$/g, '');
}
