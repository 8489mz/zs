import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // Drop the global unique index on employee_no
    await sql`DROP INDEX IF EXISTS idx_hr_employees_employee_no_unique`.execute(db);

    // Create a tenant-scoped unique index on employee_no
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_employees_employee_no_tenant_unique ON hr_employees(tenant_id, employee_no) WHERE employee_no <> ''`.execute(
      db,
    );
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_hr_employees_employee_no_tenant_unique`.execute(db);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_employees_employee_no_unique ON hr_employees(employee_no) WHERE employee_no <> ''`.execute(
      db,
    );
  },
};
