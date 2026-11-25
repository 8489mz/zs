import { sql, type Kysely } from 'kysely';

const TABLES = ['expenses', 'return_documents', 'return_items', 'treasury_transactions', 'services'] as const;

function demoTenantId(): string {
  return String(process.env.TENANT_ID || 'default').trim() || 'default';
}

function demoAccountId(): string {
  return String(process.env.ACCOUNT_ID || demoTenantId()).trim() || demoTenantId();
}

async function tableExists(db: Kysely<unknown>, table: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${table}
    ) as exists
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    const tenantId = demoTenantId();
    const accountId = demoAccountId();

    for (const table of TABLES) {
      if (!(await tableExists(db, table))) continue;
      await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`UPDATE ${sql.table(table)} SET tenant_id = ${tenantId} WHERE tenant_id = ''`.execute(db);
      await sql`UPDATE ${sql.table(table)} SET account_id = ${accountId} WHERE account_id = ''`.execute(db);
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      if (!(await tableExists(db, table))) continue;
      await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }
  },
};
