import { Kysely, sql } from 'kysely';

const ddlStatements = [`ALTER TABLE products ADD COLUMN IF NOT EXISTS bin_location VARCHAR(255)`];

const dropStatements = [`ALTER TABLE products DROP COLUMN IF EXISTS bin_location`];

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
