import { Kysely, sql } from 'kysely';

const ddlStatements = [
  `CREATE TABLE IF NOT EXISTS offline_releases (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    patch_url TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    promoted_by VARCHAR(100),
    promoted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS offline_releases_version_idx ON offline_releases (version)`,
  `CREATE INDEX IF NOT EXISTS offline_releases_active_idx ON offline_releases (is_active) WHERE is_active = TRUE`,
];

const dropStatements = [`DROP TABLE IF EXISTS offline_releases`];

export const migration = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    for (let i = 0; i < ddlStatements.length; i += 1) {
      const statement = ddlStatements[i];
      try {
        await sql.raw(statement).execute(db);
      } catch (error) {
        console.error('FAILED DDL INDEX:', i);
        console.error('FAILED DDL STATEMENT:\n', statement);
        throw error;
      }
    }
  },
  down: async (db: Kysely<unknown>): Promise<void> => {
    for (let i = 0; i < dropStatements.length; i += 1) {
      const statement = dropStatements[i];
      try {
        await sql.raw(statement).execute(db);
      } catch (error) {
        console.error('FAILED DROP INDEX:', i);
        console.error('FAILED DROP STATEMENT:\n', statement);
        throw error;
      }
    }
  },
};
