import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.schema';

function readSslCaCert(): string {
  const base64Cert = process.env.DATABASE_SSL_CA_CERT_B64?.trim();
  if (base64Cert) {
    return Buffer.from(base64Cert, 'base64').toString('utf8');
  }

  return process.env.DATABASE_SSL_CA_CERT ?? '';
}

export default registerAs('database', () => {
  const env = validateEnv(process.env as Record<string, unknown>);
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    name: env.DATABASE_NAME,
    schema: env.DATABASE_SCHEMA,
    ssl: env.DATABASE_SSL,
    sslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    sslCaCert: readSslCaCert(),
    logging: env.DATABASE_LOGGING,
    poolMax: env.DATABASE_POOL_MAX,
    poolIdleTimeoutMs: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
    poolConnectionTimeoutMs: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
  };
});
