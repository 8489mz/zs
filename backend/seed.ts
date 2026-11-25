import { type Generated, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/zsystems' });

// Minimal local shape for the tables this seed script touches. The
// generated Database type does not cover them: saas_tenants is not in
// it, and the hr_employees / hr_compensation_packages shapes it has
// no longer match what this script inserts (old schema), so the
// script carries its own shape instead of Kysely<Database>.
interface SeedDatabase {
  saas_tenants: { id: number };
  hr_employees: {
    id: Generated<number>;
    tenant_id: number;
    name: string;
    employee_no: string;
    status: string;
    hired_at: string;
    work_days: number;
    daily_hours: number;
  };
  hr_compensation_packages: {
    id: Generated<number>;
    tenant_id: number;
    employee_id: number;
    type: string;
    hourly_rate: number;
    base_salary: number;
    housing_allowance: number;
    transportation_allowance: number;
    effective_date: string;
  };
}

const db = new Kysely<SeedDatabase>({ dialect: new PostgresDialect({ pool }) });

async function seed() {
  try {
    const tenantRes = await db.selectFrom('saas_tenants').select('id').executeTakeFirst();
    const tenantId = tenantRes?.id || 1;

    let emp = await db.selectFrom('hr_employees').where('employee_no', '=', 'H-1').select('id').executeTakeFirst();
    if (!emp) {
      const res = await db.insertInto('hr_employees').values({
        tenant_id: tenantId,
        name: 'موظف تجريبي (أجر بالساعة)',
        employee_no: 'H-1',
        status: 'active',
        hired_at: '2026-06-01',
        work_days: 5,
        daily_hours: 8
      }).returning('id').executeTakeFirst();
      emp = res;
    }

    await db.deleteFrom('hr_compensation_packages').where('employee_id', '=', emp!.id).execute();
    await db.insertInto('hr_compensation_packages').values({
      tenant_id: tenantId,
      employee_id: emp!.id,
      type: 'hourly',
      hourly_rate: 30,
      base_salary: 0,
      housing_allowance: 0,
      transportation_allowance: 0,
      effective_date: '2026-06-01'
    }).execute();

    console.log('Employee H-1 created successfully.');
  } catch (e) {
    console.error('Error seeding employee:', e);
  } finally {
    await pool.end();
  }
}
seed();
