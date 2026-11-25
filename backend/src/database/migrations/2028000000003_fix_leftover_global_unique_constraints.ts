import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. journal_entries: drop global entry_no unique, create tenant-scoped
    await sql`ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_entry_no_key`
      .execute(db)
      .catch(() => undefined);
    await sql`DROP INDEX IF EXISTS journal_entries_entry_no_key`.execute(db).catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_tenant_entry_no_uidx ON journal_entries (tenant_id, entry_no)`
      .execute(db)
      .catch(() => undefined);

    // 2. users: drop global username unique (tenant-scoped already exists)
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS users_username_key`.execute(db).catch(() => undefined);

    // 3. hr_departments: drop global code unique, create tenant-scoped
    await sql`DROP INDEX IF EXISTS idx_hr_departments_code_unique`.execute(db).catch(() => undefined);
    await sql`ALTER TABLE hr_departments DROP CONSTRAINT IF EXISTS hr_departments_code_key`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_departments_tenant_code_unique ON hr_departments(tenant_id, code) WHERE code <> ''`
      .execute(db)
      .catch(() => undefined);

    // 4. hr_job_titles: drop global code unique, create tenant-scoped
    await sql`DROP INDEX IF EXISTS idx_hr_job_titles_code_unique`.execute(db).catch(() => undefined);
    await sql`ALTER TABLE hr_job_titles DROP CONSTRAINT IF EXISTS hr_job_titles_code_key`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_job_titles_tenant_code_unique ON hr_job_titles(tenant_id, code) WHERE code <> ''`
      .execute(db)
      .catch(() => undefined);

    // 5. hr_positions: drop global code unique, create tenant-scoped
    await sql`DROP INDEX IF EXISTS idx_hr_positions_code_unique`.execute(db).catch(() => undefined);
    await sql`ALTER TABLE hr_positions DROP CONSTRAINT IF EXISTS hr_positions_code_key`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_positions_tenant_code_unique ON hr_positions(tenant_id, code) WHERE code <> ''`
      .execute(db)
      .catch(() => undefined);

    // 6. hr_payroll_runs: drop global period_month unique, create tenant-scoped
    await sql`DROP INDEX IF EXISTS idx_hr_payroll_runs_active_period_month_unique`.execute(db).catch(() => undefined);
    await sql`ALTER TABLE hr_payroll_runs DROP CONSTRAINT IF EXISTS hr_payroll_runs_period_month_key`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_payroll_runs_tenant_period_month_unique ON hr_payroll_runs(tenant_id, period_month) WHERE status <> 'cancelled'`
      .execute(db)
      .catch(() => undefined);

    // 7. hr_attendance_records: drop global employee_date unique, create tenant-scoped
    await sql`ALTER TABLE hr_attendance_records DROP CONSTRAINT IF EXISTS hr_attendance_records_employee_work_date_unique`
      .execute(db)
      .catch(() => undefined);
    await sql`DROP INDEX IF EXISTS hr_attendance_records_employee_work_date_unique`.execute(db).catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS hr_attendance_records_tenant_employee_work_date_unique ON hr_attendance_records(tenant_id, employee_id, work_date)`
      .execute(db)
      .catch(() => undefined);

    // 8. hr_payroll_run_items: drop global run_employee unique, create tenant-scoped
    await sql`ALTER TABLE hr_payroll_run_items DROP CONSTRAINT IF EXISTS hr_payroll_run_items_run_employee_unique`
      .execute(db)
      .catch(() => undefined);
    await sql`DROP INDEX IF EXISTS hr_payroll_run_items_run_employee_unique`.execute(db).catch(() => undefined);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_run_items_tenant_run_employee_unique ON hr_payroll_run_items(tenant_id, run_id, employee_id)`
      .execute(db)
      .catch(() => undefined);
  },
  async down(db: Kysely<unknown>): Promise<void> {
    // Reverse operations are optional since these constraints were fundamentally wrong in a multi-tenant DB.
  },
};
