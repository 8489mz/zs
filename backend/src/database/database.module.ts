import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KYSELY_DB } from './database.constants';
import { Database } from './database.types';
import { TransactionHelper } from './helpers/transaction.helper';
import { resolvePgSslConfig } from './ssl.util';

@Global()
@Module({
  providers: [
    {
      provide: KYSELY_DB,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const ssl = configService.get<boolean>('database.ssl', false);
        const sslRejectUnauthorized = configService.get<boolean>('database.sslRejectUnauthorized', true);
        const sslCaCert = configService.get<string>('database.sslCaCert', '');

        const positiveBounded = (value: unknown, fallback: number, max: number): number => {
          const parsed = Number(value);
          return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
        };
        const pool = new Pool({
          host: configService.getOrThrow<string>('database.host'),
          port: configService.getOrThrow<number>('database.port'),
          user: configService.getOrThrow<string>('database.user'),
          password: configService.getOrThrow<string>('database.password'),
          database: configService.getOrThrow<string>('database.name'),
          ssl: resolvePgSslConfig({
            enabled: ssl,
            rejectUnauthorized: sslRejectUnauthorized,
            caCert: sslCaCert,
          }),
          application_name: 'backend-new',
          max: positiveBounded(process.env.DATABASE_POOL_MAX || configService.get<number>('database.poolMax', 25), 25, 40),
          idleTimeoutMillis: positiveBounded(process.env.DATABASE_POOL_IDLE_MS || configService.get<number>('database.poolIdleTimeoutMs', 30000), 30000, 120000),
          connectionTimeoutMillis: positiveBounded(process.env.DATABASE_POOL_TIMEOUT_MS || configService.get<number>('database.poolConnectionTimeoutMs', 10000), 10000, 30000),
          statement_timeout: positiveBounded(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 15000, 15000, 30000),
          options: '-c idle_in_transaction_session_timeout=60000',
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        });
        // pg emits idle-client errors on the pool. Without a listener Node treats them as an
        // unhandled EventEmitter error and terminates the process during a database failover.
        pool.on('error', (error: Error) => Logger.error('Idle PostgreSQL connection failed', error.stack, 'DatabasePool'));

        return new Kysely<Database>({
          dialect: new PostgresDialect({ pool }),
          log(event) {
            if (event.level === 'error') {
              console.error('Kysely query error', event.error);
            }
          },
        });
      },
    },
    TransactionHelper,
  ],
  exports: [KYSELY_DB, TransactionHelper],
})
export class DatabaseModule {}
