import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

const upStatements = ['ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS national_id TEXT NULL'];

const downStatements = ['ALTER TABLE hr_employees DROP COLUMN IF EXISTS national_id'];

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    for (const statement of upStatements) {
      await sql.raw(statement).execute(db);
    }
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    for (const statement of downStatements) {
      await sql.raw(statement).execute(db);
    }
  },
};
