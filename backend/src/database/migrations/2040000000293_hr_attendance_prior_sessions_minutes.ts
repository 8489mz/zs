import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0293 — Split-shift accumulation (D2).
 *
 * A second session in one day used to overwrite the first: the day row
 * kept only the latest check-in/check-out and the earlier session
 * survived only as a text note, so hourly pay lost it. The day row now
 * carries the completed minutes of earlier sessions
 * (prior_sessions_minutes), accumulated by upsertAttendanceRecord when a
 * new session starts; summarizeHourlyAttendance adds them to the day's
 * pay. Pre-0293 rows keep 0 (no earlier session was ever stored as
 * minutes); no backfill is possible from the note text, no existing
 * column touched.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS prior_sessions_minutes INTEGER NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS prior_sessions_minutes`.execute(db);
}

export const migration: Migration = { up, down };
