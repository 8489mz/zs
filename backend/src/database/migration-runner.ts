import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from './database.types';
import { FileMigrationProvider } from './migration-provider';
import { validateEnv } from '../config/env.schema';
import { resolvePgSslConfig } from './ssl.util';
import { isDesktopRuntimeMode } from '../config/app-mode';

export type MigrationCommand = 'up' | 'down' | 'list';

function getMigrationsPath(): string {
  const builtPath = join(__dirname, 'migrations');
  if (existsSync(builtPath)) return builtPath;
  const srcPath = join(__dirname, '..', '..', 'src', 'database', 'migrations');
  if (existsSync(srcPath)) return srcPath;
  const projectSrcPath = join(process.cwd(), 'src', 'database', 'migrations');
  if (existsSync(projectSrcPath)) return projectSrcPath;
  const projectDistPath = join(process.cwd(), 'dist', 'database', 'migrations');
  if (existsSync(projectDistPath)) return projectDistPath;
  return builtPath;
}

type ResolvedDbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  schema: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  sslCaCert: string;
  sslMode: 'existing' | 'disable' | 'require' | 'no-verify';
};

function readSslCaCertFromEnv(): string {
  const base64Cert = process.env.DATABASE_SSL_CA_CERT_B64?.trim();
  if (base64Cert) {
    return Buffer.from(base64Cert, 'base64').toString('utf8');
  }
  return process.env.DATABASE_SSL_CA_CERT ?? '';
}

function normalizeSslMode(value: unknown): 'disable' | 'require' | 'no-verify' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'disable' || normalized === 'require' || normalized === 'no-verify') return normalized;
  throw new Error(`Unsupported database SSL mode: ${String(value)}`);
}

function hasExplicitEnv(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, key);
}

export function resolveMigrationSslModeFromEnv(): 'existing' | 'disable' | 'require' | 'no-verify' {
  const explicitMode = normalizeSslMode(process.env.DATABASE_SSL_MODE ?? process.env.PGSSLMODE);
  if (explicitMode) return explicitMode;

  const explicitRejectUnauthorizedFalse =
    hasExplicitEnv('DATABASE_SSL_REJECT_UNAUTHORIZED')
    && String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() === 'false';
  const explicitSslTrue =
    String(process.env.DATABASE_SSL ?? process.env.DB_SSL ?? '').trim().toLowerCase() === 'true';
  const explicitSslFalse =
    hasExplicitEnv('DATABASE_SSL')
    && String(process.env.DATABASE_SSL || '').trim().toLowerCase() === 'false';

  if (explicitSslTrue && explicitRejectUnauthorizedFalse) return 'no-verify';
  if (explicitSslTrue) return 'require';
  if (explicitSslFalse) return 'disable';
  return 'existing';
}

export function resolveDatabaseConfigFromEnv(): ResolvedDbConfig {
  const sslMode = resolveMigrationSslModeFromEnv();
  const validationEnv = { ...process.env } as Record<string, unknown>;
  if (sslMode === 'require' || sslMode === 'no-verify') {
    validationEnv.DATABASE_SSL = 'true';
  }
  if (sslMode === 'disable') {
    validationEnv.DATABASE_SSL = 'false';
  }
  // The migration runner may intentionally use no-verify for hosted poolers with
  // self-signed chains; keep app-runtime validation strict while overriding only
  // the migration pg connection config below.
  if (sslMode === 'no-verify') {
    validationEnv.DATABASE_SSL_REJECT_UNAUTHORIZED = 'true';
  }

  const parsed = validateEnv(validationEnv);
  
  function isLocalDatabaseHost(host: string): boolean {
    return ['postgres', 'localhost', '127.0.0.1', '::1'].includes(host.trim().toLowerCase());
  }

  const isPortableOrSelfContained = isDesktopRuntimeMode(parsed.APP_MODE);
  const forceDisableSsl = isPortableOrSelfContained || isLocalDatabaseHost(parsed.DATABASE_HOST);

  const ssl = forceDisableSsl
    ? false
    : sslMode === 'require' || sslMode === 'no-verify'
      ? true
      : sslMode === 'disable'
        ? false
        : parsed.DATABASE_SSL;

  const sslRejectUnauthorized = forceDisableSsl
    ? false
    : sslMode === 'no-verify'
      ? false
      : sslMode === 'require'
        ? true
        : parsed.DATABASE_SSL_REJECT_UNAUTHORIZED;

  return {
    host: parsed.DATABASE_HOST,
    port: parsed.DATABASE_PORT,
    user: parsed.DATABASE_USER,
    password: parsed.DATABASE_PASSWORD,
    name: parsed.DATABASE_NAME,
    schema: parsed.DATABASE_SCHEMA,
    ssl,
    sslRejectUnauthorized,
    sslCaCert: readSslCaCertFromEnv(),
    sslMode,
  };
}

export function getSanitizedDatabaseTargetFromResolved(config: Pick<ResolvedDbConfig, 'host' | 'port' | 'user' | 'name'>): string {
  return `postgres://${config.user}@${config.host}:${String(config.port)}/${config.name}`;
}

export function formatErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details: string[] = [];
  details.push(`message: ${error.message}`);
  if (error.stack) details.push(`stack: ${error.stack}`);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) details.push(`cause: ${formatErrorDetails(cause)}`);
  return details.join('\n');
}

export function getSanitizedDatabaseTarget(): string {
  const config = resolveDatabaseConfigFromEnv();
  return getSanitizedDatabaseTargetFromResolved(config);
}

export function createDb(): Kysely<Database> {
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    application_name: 'backend-migrations',
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

async function reconcileRenamedMigrations(db: Kysely<Database>): Promise<void> {
  const schema = process.env.DATABASE_SCHEMA ?? 'public';
  try {
    const tableCheck = await sql<{ found: number }>`
      SELECT 1 AS found FROM information_schema.tables 
      WHERE table_schema = ${schema} AND table_name = 'kysely_migration'
    `.execute(db);

    if (tableCheck.rows.length === 0) {
      return;
    }

    // Check if 2040000000134_online_order_number_unique is already recorded
    const orderUniqueCheck = await sql<{ found: number }>`
      SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
      WHERE name = '2040000000134_online_order_number_unique'
    `.execute(db);

    // If online_order_number_unique is NOT recorded, but performance_hot_path_indexes was recorded
    // (either under legacy 2040000000134 or premature 2040000000136), delete it from kysely_migration
    // so Kysely can run 134, 135, 136, 137 in strict alphabetical order.
    // Migration 136 is fully idempotent (CREATE INDEX IF NOT EXISTS) and safe to re-run.
    if (orderUniqueCheck.rows.length === 0) {
      await sql`
        DELETE FROM ${sql.id(schema, 'kysely_migration')}
        WHERE name IN (
          '2040000000134_performance_hot_path_indexes',
          '2040000000136_performance_hot_path_indexes'
        )
      `.execute(db);
    } else {
      // If 134 is already recorded, just make sure any legacy 134_performance record is purged
      await sql`
        DELETE FROM ${sql.id(schema, 'kysely_migration')}
        WHERE name = '2040000000134_performance_hot_path_indexes'
      `.execute(db);
    }

    // Reconcile 194 / 195 race condition if 195 was recorded prematurely before 194 was exported
    const hrCheck = await sql<{ found: number }>`
      SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
      WHERE name = '2040000000194_hr_payroll_and_loan_hardening'
    `.execute(db);

    const vanCheck = await sql<{ found: number }>`
      SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
      WHERE name = '2040000000195_van_sales_hardening'
    `.execute(db);

    if (hrCheck.rows.length === 0 && vanCheck.rows.length > 0) {
      await sql`
        DELETE FROM ${sql.id(schema, 'kysely_migration')}
        WHERE name = '2040000000195_van_sales_hardening'
      `.execute(db);
    }

    // Reconcile ghost migration 2040000000200_logistics_couriers_and_cod_settlements
    // DATA-PRESERVING VERSION-AWARE STRATEGY (CORE-002):
    // Never drop tables or columns with CASCADE. Snapshot counts and sums before and after.
    const courierMigrationCheck = await sql<{ found: number }>`
      SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
      WHERE name = '2040000000200_logistics_couriers_and_cod_settlements'
    `.execute(db);

    if (courierMigrationCheck.rows.length > 0) {
      const checkTableExists = async (table: string): Promise<boolean> => {
        const res = await sql<{ found: number }>`
          SELECT 1 as found FROM information_schema.tables
          WHERE table_schema = ${schema} AND table_name = ${table}
        `.execute(db);
        return res.rows.length > 0;
      };

      const checkColumnExists = async (table: string, column: string): Promise<boolean> => {
        const res = await sql<{ found: number }>`
          SELECT 1 as found FROM information_schema.columns
          WHERE table_schema = ${schema} AND table_name = ${table} AND column_name = ${column}
        `.execute(db);
        return res.rows.length > 0;
      };

      const takeSnapshot = async () => {
        let couriersCount = 0;
        let batchesCount = 0;
        let batchesTotalAmount = 0;
        let linesCount = 0;
        let linesCollectedAmount = 0;
        let shipmentsWithCourierCount = 0;

        if (await checkTableExists('shipping_couriers')) {
          const res = await sql<{ cnt: string | number }>`SELECT count(*) as cnt FROM ${sql.id(schema, 'shipping_couriers')}`.execute(db);
          couriersCount = Number(res.rows[0]?.cnt || 0);
        }

        if (await checkTableExists('courier_settlement_batches')) {
          const res = await sql<{ cnt: string | number; total: string | number }>`
            SELECT count(*) as cnt, COALESCE(sum(total_amount), 0) as total FROM ${sql.id(schema, 'courier_settlement_batches')}
          `.execute(db);
          batchesCount = Number(res.rows[0]?.cnt || 0);
          batchesTotalAmount = Number(res.rows[0]?.total || 0);
        }

        if (await checkTableExists('courier_settlement_lines')) {
          const res = await sql<{ cnt: string | number; total: string | number }>`
            SELECT count(*) as cnt, COALESCE(sum(collected_amount), 0) as total FROM ${sql.id(schema, 'courier_settlement_lines')}
          `.execute(db);
          linesCount = Number(res.rows[0]?.cnt || 0);
          linesCollectedAmount = Number(res.rows[0]?.total || 0);
        }

        if ((await checkTableExists('shipments')) && (await checkColumnExists('shipments', 'courier_id'))) {
          const res = await sql<{ cnt: string | number }>`
            SELECT count(*) as cnt FROM ${sql.id(schema, 'shipments')} WHERE courier_id IS NOT NULL
          `.execute(db);
          shipmentsWithCourierCount = Number(res.rows[0]?.cnt || 0);
        }

        return {
          couriersCount,
          batchesCount,
          batchesTotalAmount,
          linesCount,
          linesCollectedAmount,
          shipmentsWithCourierCount,
        };
      };

      const preSnapshot = await takeSnapshot();

      // Safe non-destructive reconciliation:
      // In Kysely, rename the migration row to archived legacy prefix so it avoids conflict with maritime 200
      // while STRICTLY preserving all courier and settlement tables, columns, and data rows intact.
      await sql`
        UPDATE ${sql.id(schema, 'kysely_migration')}
        SET name = '2040000000199_legacy_reconciled_couriers_and_cod_settlements'
        WHERE name = '2040000000200_logistics_couriers_and_cod_settlements'
      `.execute(db);

      const postSnapshot = await takeSnapshot();

      if (
        preSnapshot.couriersCount !== postSnapshot.couriersCount ||
        preSnapshot.batchesCount !== postSnapshot.batchesCount ||
        preSnapshot.batchesTotalAmount !== postSnapshot.batchesTotalAmount ||
        preSnapshot.linesCount !== postSnapshot.linesCount ||
        preSnapshot.linesCollectedAmount !== postSnapshot.linesCollectedAmount ||
        preSnapshot.shipmentsWithCourierCount !== postSnapshot.shipmentsWithCourierCount
      ) {
        throw new Error(
          `Migration reconciliation integrity check failed: Courier/settlement data loss detected! ` +
          `Pre: ${JSON.stringify(preSnapshot)}, Post: ${JSON.stringify(postSnapshot)}`
        );
      }
    }

    // Reconcile shifted / resequenced migrations (commit d44a2a648 shifted 236..239 to 237..240; commit 7ce255c0 shifted 252 to 254)
    const shiftedImportMigrations: [string, string][] = [
      ['2040000000087_contracting_wir_and_handover_workflows', '2040000000092_contracting_wir_and_handover_registers'],
      ['2040000000230_international_import_operations_core', '2040000000232_international_import_operations_core'],
      ['2040000000231_international_import_operations_core', '2040000000232_international_import_operations_core'],
      ['2040000000236_international_trade_procurement_and_sourcing', '2040000000237_international_trade_procurement_and_sourcing'],
      ['2040000000237_customs_broker_advances_and_container_deposits', '2040000000238_customs_broker_advances_and_container_deposits'],
      ['2040000000238_container_preorders_and_inventory_traceability', '2040000000239_container_preorders_and_inventory_traceability'],
      ['2040000000239_import_governance_approvals_and_reconciliation', '2040000000240_import_governance_approvals_and_reconciliation'],
      ['2040000000246_tracked_stock_transfer_details', '2040000000248_tracked_stock_transfer_details'],
      ['2040000000247_purchase_and_damage_tracked_provenance', '2040000000249_purchase_and_damage_tracked_provenance'],
      ['2040000000248_stock_count_tracked_provenance', '2040000000250_stock_count_tracked_provenance'],
      ['2040000000249_payment_channels_cash_drawer_separation', '2040000000251_payment_channels_cash_drawer_separation'],
      ['2040000000252_hr_asset_recovery_money_type', '2040000000254_hr_asset_recovery_money_type'],
      ['2040000000319_import_sale_allocations_allocation_type', '2040000000320_import_sale_allocations_allocation_type'],
    ];

    for (const [oldName, newName] of shiftedImportMigrations) {
      const oldCheck = await sql<{ found: number }>`
        SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
        WHERE name = ${oldName}
      `.execute(db);

      if (oldCheck.rows.length > 0) {
        const newCheck = await sql<{ found: number }>`
          SELECT 1 AS found FROM ${sql.id(schema, 'kysely_migration')}
          WHERE name = ${newName}
        `.execute(db);

        if (newCheck.rows.length > 0) {
          // New numbered row already exists; delete the obsolete ghost row so Kysely doesn't treat it as missing
          await sql`
            DELETE FROM ${sql.id(schema, 'kysely_migration')}
            WHERE name = ${oldName}
          `.execute(db);
        } else {
          // Only old row exists; rename it to new prefix so Kysely recognizes it without rerunning
          await sql`
            UPDATE ${sql.id(schema, 'kysely_migration')}
            SET name = ${newName}
            WHERE name = ${oldName}
          `.execute(db);
        }
      }
    }
    // Purge obsolete prototype migrations from earlier feature branches that were superseded or merged under official migrations
    const obsoleteBranchMigrations = [
      '2040000000233_users_default_branch_tenant_fk',
      '2040000000194_multi_grn_bill_accrual',
      '2040000000195_sale_pharmacy_batch_allocations',
      '2040000000196_pos_atomic_exchange',
    ];

    for (const obsolete of obsoleteBranchMigrations) {
      await sql`
        DELETE FROM ${sql.id(schema, 'kysely_migration')}
        WHERE name = ${obsolete}
      `.execute(db);
    }
  } catch (err: any) {
    if (err.message && err.message.includes('Migration reconciliation integrity check failed')) {
      throw err;
    }
    // Fail closed on unexpected migration runner errors
    throw err;
  }
}

export async function runMigrationCommand(command: MigrationCommand): Promise<void> {
  const db = createDb();
  await reconcileRenamedMigrations(db);
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider(getMigrationsPath()),
    migrationTableSchema: process.env.DATABASE_SCHEMA ?? 'public',
    allowUnorderedMigrations: true,
  });

  if (command === 'list') {
    const migrations = await migrator.getMigrations();
    migrations.forEach((migration) => {
      process.stdout.write(`${migration.name}: ${migration.executedAt ? 'applied' : 'pending'}\n`);
    });
    await db.destroy();
    return;
  }

  const result = command === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();

  for (const migration of result.results ?? []) {
    process.stdout.write(`${migration.status}: ${migration.migrationName}\n`);
  }

  if (result.error) {
    await db.destroy();
    throw result.error;
  }

  await db.destroy();
}
