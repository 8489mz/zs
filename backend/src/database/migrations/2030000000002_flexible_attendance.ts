import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

const upStatements = [
  // Drop the existing type constraints
  `ALTER TABLE hr_attendance_exceptions DROP CONSTRAINT IF EXISTS hr_attendance_exceptions_type_valid`,
  `ALTER TABLE hr_employees DROP CONSTRAINT IF EXISTS hr_employees_attendance_policy_valid`,

  // Add attendance_policy column
  `ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS attendance_policy VARCHAR(24) NOT NULL DEFAULT 'strict'`,

  // Re-add constraints with new values
  `ALTER TABLE hr_employees
    ADD CONSTRAINT hr_employees_attendance_policy_valid
    CHECK (attendance_policy IN ('strict','flexible'))`,

  `ALTER TABLE hr_attendance_exceptions
    ADD CONSTRAINT hr_attendance_exceptions_type_valid
    CHECK (exception_type IN (
      'early_check_in',
      'late_check_in',
      'early_check_out',
      'late_check_out',
      'missing_check_in',
      'missing_check_out',
      'short_hours',
      'extra_hours',
      'unscheduled_time'
    ))`,
];

const downStatements = [
  `ALTER TABLE hr_attendance_exceptions DROP CONSTRAINT IF EXISTS hr_attendance_exceptions_type_valid`,
  `ALTER TABLE hr_employees DROP CONSTRAINT IF EXISTS hr_employees_attendance_policy_valid`,
  `ALTER TABLE hr_employees DROP COLUMN IF EXISTS attendance_policy`,
  `ALTER TABLE hr_attendance_exceptions
    ADD CONSTRAINT hr_attendance_exceptions_type_valid
    CHECK (exception_type IN (
      'early_check_in',
      'late_check_in',
      'early_check_out',
      'late_check_out',
      'missing_check_in',
      'missing_check_out'
    ))`,
];

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
