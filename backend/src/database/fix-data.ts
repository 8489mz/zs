import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zsystems',
});

async function run() {
  await pool.query(`UPDATE hr_employees SET tenant_id = 'default', account_id = 'default' WHERE tenant_id = ''`);
  await pool.query(`UPDATE hr_departments SET tenant_id = 'default', account_id = 'default' WHERE tenant_id = ''`);
  await pool.query(`UPDATE hr_job_titles SET tenant_id = 'default', account_id = 'default' WHERE tenant_id = ''`);
  await pool.query(`UPDATE hr_positions SET tenant_id = 'default', account_id = 'default' WHERE tenant_id = ''`);
  console.log('Fixed orphaned data.');
  pool.end();
}

run().catch(console.error);
