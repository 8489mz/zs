import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'service_charge'
        ) THEN
          ALTER TABLE sales ADD COLUMN service_charge numeric(14, 2) DEFAULT 0;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'guest_count'
        ) THEN
          ALTER TABLE sales ADD COLUMN guest_count integer DEFAULT 1;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'guest_check_printed_at'
        ) THEN
          ALTER TABLE sales ADD COLUMN guest_check_printed_at timestamptz;
        END IF;
      END $$;
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`
      ALTER TABLE sales
      DROP COLUMN IF EXISTS service_charge,
      DROP COLUMN IF EXISTS guest_count,
      DROP COLUMN IF EXISTS guest_check_printed_at;
    `.execute(db);
  },
};
