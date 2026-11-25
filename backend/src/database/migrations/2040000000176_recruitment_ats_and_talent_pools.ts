import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Job Openings
  await db.schema
    .createTable('recruitment_job_openings')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', (col) => col.primaryKey())
    .addColumn('tenant_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('job_code', 'varchar(64)', (col) => col.notNull())
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('department', 'varchar(128)', (col) => col.notNull())
    .addColumn('experience_years_min', 'numeric(4, 1)', (col) => col.defaultTo(0))
    .addColumn('headcount', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('hired_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('description', 'text')
    .addColumn('requirements', 'text')
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('published'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createIndex('idx_recruitment_jobs_tenant_code')
    .ifNotExists()
    .on('recruitment_job_openings')
    .columns(['tenant_id', 'job_code'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_recruitment_jobs_tenant_status')
    .ifNotExists()
    .on('recruitment_job_openings')
    .columns(['tenant_id', 'status'])
    .execute();

  // 2. Applicants & Talent Pools
  await db.schema
    .createTable('recruitment_applicants')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', (col) => col.primaryKey())
    .addColumn('tenant_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('job_id', 'varchar(128)', (col) => col.references('recruitment_job_openings.id').onDelete('set null'))
    .addColumn('applicant_number', 'varchar(64)', (col) => col.notNull())
    .addColumn('full_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .addColumn('phone', 'varchar(64)', (col) => col.notNull())
    .addColumn('expected_salary', 'numeric(12, 2)')
    .addColumn('experience_years', 'numeric(4, 1)', (col) => col.defaultTo(0))
    .addColumn('stage', 'varchar(32)', (col) => col.notNull().defaultTo('new'))
    .addColumn('rating', 'integer', (col) => col.defaultTo(3))
    .addColumn('talent_pool_tag', 'varchar(128)')
    .addColumn('cv_url', 'text')
    .addColumn('interview_notes', 'text')
    .addColumn('hired_employee_id', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createIndex('idx_recruitment_applicants_tenant_num')
    .ifNotExists()
    .on('recruitment_applicants')
    .columns(['tenant_id', 'applicant_number'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_recruitment_applicants_tenant_job')
    .ifNotExists()
    .on('recruitment_applicants')
    .columns(['tenant_id', 'job_id'])
    .execute();

  await db.schema
    .createIndex('idx_recruitment_applicants_tenant_stage')
    .ifNotExists()
    .on('recruitment_applicants')
    .columns(['tenant_id', 'stage'])
    .execute();

  await db.schema
    .createIndex('idx_recruitment_applicants_tenant_pool')
    .ifNotExists()
    .on('recruitment_applicants')
    .columns(['tenant_id', 'talent_pool_tag'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('recruitment_applicants').ifExists().execute();
  await db.schema.dropTable('recruitment_job_openings').ifExists().execute();
}
