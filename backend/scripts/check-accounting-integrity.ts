import 'reflect-metadata';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../src/database/database.types';
import { inspectAccountingIntegrity } from '../src/modules/accounting/accounting-integrity';

async function main() {
  const connectionString = process.env.ACCOUNTING_AUDIT_DATABASE_URL;
  const tenantId = process.argv[2];
  if (!connectionString || !tenantId?.trim())
    throw new Error(
      'Set ACCOUNTING_AUDIT_DATABASE_URL and provide an explicit tenant ID; this command never loads dotenv.',
    );
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        application_name: 'accounting-integrity-readonly',
        max: 1,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      }),
    }),
  });
  try {
    const report = await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(trx);
        return inspectAccountingIntegrity(trx, tenantId);
      });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error.message || 'Accounting integrity check failed');
  process.exitCode = 1;
});
