import 'dotenv/config';
import { Client } from 'pg';
import { resolvePgSslConfig, toBoolean } from './ssl.util';

type PgLikeError = {
  code?: string;
  message?: string;
  name?: string;
  errors?: unknown[];
};

function collectNestedErrors(error: unknown): PgLikeError[] {
  const root = error as PgLikeError;
  const nested = Array.isArray(root?.errors) ? root.errors : [];
  return [root, ...(nested.filter(Boolean) as PgLikeError[])];
}

function classifyRootCause(error: unknown): 'network reachability' | 'auth/credentials' | 'SSL/TLS wiring' | 'unknown' {
  const items = collectNestedErrors(error);
  const codes = new Set(items.map((item) => String(item.code || '').toUpperCase()).filter(Boolean));
  const messages = items.map((item) => String(item.message || '').toLowerCase()).join(' | ');

  if (codes.has('ENETUNREACH') || codes.has('ETIMEDOUT') || codes.has('EHOSTUNREACH') || codes.has('ECONNREFUSED')) {
    return 'network reachability';
  }

  if (
    codes.has('28P01') ||
    messages.includes('password authentication failed') ||
    messages.includes('no pg_hba.conf entry')
  ) {
    return 'auth/credentials';
  }

  if (
    codes.has('SELF_SIGNED_CERT_IN_CHAIN') ||
    codes.has('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
    messages.includes('certificate') ||
    messages.includes('tls') ||
    messages.includes('ssl')
  ) {
    return 'SSL/TLS wiring';
  }

  return 'unknown';
}

async function main(): Promise<void> {
  const base64Cert = process.env.DATABASE_SSL_CA_CERT_B64?.trim();
  const caCert = base64Cert
    ? Buffer.from(base64Cert, 'base64').toString('utf8')
    : (process.env.DATABASE_SSL_CA_CERT ?? '');

  const ssl = resolvePgSslConfig({
    enabled: toBoolean(process.env.DATABASE_SSL, true),
    rejectUnauthorized: toBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    caCert,
  });

  const connectTimeoutMs = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? '10000');
  const connectionString = process.env.DATABASE_URL?.trim() || undefined;

  const client = new Client({
    connectionString,
    host: connectionString ? undefined : process.env.DATABASE_HOST,
    port: connectionString ? undefined : Number(process.env.DATABASE_PORT ?? '5432'),
    user: connectionString ? undefined : process.env.DATABASE_USER,
    password: connectionString ? undefined : process.env.DATABASE_PASSWORD,
    database: connectionString ? undefined : process.env.DATABASE_NAME,
    ssl,
    connectionTimeoutMillis: connectTimeoutMs,
  });

  await client.connect();
  await client.query('select 1');
  await client.end();

  process.stdout.write(
    `[db-check] PASS: hosted DB connection established (connectTimeoutMs=${connectTimeoutMs}, via=${connectionString ? 'DATABASE_URL' : 'split-vars'}).\n`,
  );
}

main().catch(async (error: unknown) => {
  const rootCause = classifyRootCause(error);
  const nested = collectNestedErrors(error)
    .map(
      (item, idx) =>
        `#${idx + 1} name=${item.name || 'Error'} code=${item.code || 'n/a'} message=${item.message || String(item)}`,
    )
    .join(' || ');

  process.stderr.write(`[db-check] ROOT_CAUSE: ${rootCause}\n`);
  process.stderr.write(`[db-check] FAIL: ${String(error)}\n`);
  process.stderr.write(`[db-check] DETAILS: ${nested}\n`);
  process.exit(1);
});
