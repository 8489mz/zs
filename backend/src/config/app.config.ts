import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.schema';

export default registerAs('app', () => {
  const env = validateEnv(process.env as Record<string, unknown>);
  return {
    mode: env.APP_MODE,
    host: env.APP_HOST,
    port: env.APP_PORT,
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
  };
});
