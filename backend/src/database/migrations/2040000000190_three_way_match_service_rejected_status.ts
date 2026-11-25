import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    await sql`ALTER TABLE purchase_three_way_matches DROP CONSTRAINT IF EXISTS chk_three_way_match_status`.execute(db);
    await sql`
      ALTER TABLE purchase_three_way_matches
      ADD CONSTRAINT chk_three_way_match_status CHECK (
        match_status IN (
          'matched', 'quantity_mismatch', 'price_mismatch', 'tolerance_exceeded',
          'unmatched_grn', 'service_approved', 'service_rejected', 'override_approved'
        )
      )
    `.execute(db);
  },

  down: async (db: Kysely<unknown>): Promise<void> => {
    await sql`ALTER TABLE purchase_three_way_matches DROP CONSTRAINT IF EXISTS chk_three_way_match_status`.execute(db);
    await sql`UPDATE purchase_three_way_matches SET match_status = 'unmatched_grn' WHERE match_status = 'service_rejected'`.execute(
      db,
    );
    await sql`UPDATE purchases SET three_way_match_status = 'unmatched_grn' WHERE three_way_match_status = 'service_rejected'`.execute(
      db,
    );
    await sql`
      ALTER TABLE purchase_three_way_matches
      ADD CONSTRAINT chk_three_way_match_status CHECK (
        match_status IN (
          'matched', 'quantity_mismatch', 'price_mismatch', 'tolerance_exceeded',
          'unmatched_grn', 'service_approved', 'override_approved'
        )
      )
    `.execute(db);
  },
};
