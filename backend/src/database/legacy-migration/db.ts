import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../database.types';

export function openLegacyDb(): DatabaseSync {
  const configured = process.env.OLD_DB_FILE?.trim();
  const fallback = join(process.cwd(), '..', 'data', 'zstore.db');
  const filePath = configured ? resolve(process.cwd(), configured) : fallback;
  if (!existsSync(filePath)) {
    throw new Error(`Legacy database file not found: ${filePath}`);
  }
  return new DatabaseSync(filePath, { readOnly: true });
}

export function openNewDb(): Kysely<Database> {
  const rawPort = process.env.DATABASE_PORT ?? process.env.DB_PORT ?? process.env.PGPORT;
  if (!rawPort) {
    throw new Error('Missing database port env. Expected one of: DATABASE_PORT, DB_PORT, PGPORT');
  }

  const dbPort = Number(rawPort);
  if (!Number.isInteger(dbPort) || dbPort <= 0) {
    throw new Error(`Invalid database port value: ${rawPort}`);
  }

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: process.env.DATABASE_HOST ?? process.env.DB_HOST,
        port: dbPort,
        user: process.env.DATABASE_USER ?? process.env.DB_USER,
        password: process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD,
        database: process.env.DATABASE_NAME ?? process.env.DB_NAME,
        ssl:
          (process.env.DATABASE_SSL ?? process.env.DB_SSL ?? 'false') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
  });
}

export async function syncIdSequence(db: Kysely<Database>, tableName: string): Promise<void> {
  await sql`
    SELECT setval(
      pg_get_serial_sequence(${tableName}, 'id'),
      COALESCE((SELECT MAX(id) FROM ${sql.id(tableName)}), 0),
      true
    )
  `.execute(db);
}
