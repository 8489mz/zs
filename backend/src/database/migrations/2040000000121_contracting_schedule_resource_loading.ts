import { sql, type Kysely } from 'kysely';

// Closes the "resource-loaded schedule" gap found in the September 2026 Tier-1
// benchmark (Primavera P6 / MS Project style manpower & equipment histograms):
// schedule tasks previously only carried a free-text `assigned_team` label with
// no actual headcount/equipment count to aggregate into a loading report.
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE contracting_schedule_tasks
      ADD COLUMN IF NOT EXISTS planned_manpower_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS planned_equipment_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS resource_trade TEXT NULL;
    `.execute(db);

    await sql`
      ALTER TABLE contracting_schedule_tasks
      ADD CONSTRAINT chk_contracting_schedule_tasks_resource_counts
      CHECK (planned_manpower_count >= 0 AND planned_equipment_count >= 0);
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_contracting_schedule_tasks_dates
      ON contracting_schedule_tasks (tenant_id, project_id, start_date, end_date);
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_contracting_schedule_tasks_dates;`.execute(db);
    await sql`ALTER TABLE contracting_schedule_tasks DROP CONSTRAINT IF EXISTS chk_contracting_schedule_tasks_resource_counts;`.execute(
      db,
    );
    await sql`
      ALTER TABLE contracting_schedule_tasks
      DROP COLUMN IF EXISTS planned_manpower_count,
      DROP COLUMN IF EXISTS planned_equipment_count,
      DROP COLUMN IF EXISTS resource_trade;
    `.execute(db);
  },
};
