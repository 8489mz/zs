import { sql, type Kysely } from 'kysely';

function demoTenantId(): string {
  return String(process.env.TENANT_ID || 'default').trim() || 'default';
}

function demoAccountId(): string {
  return String(process.env.ACCOUNT_ID || process.env.TENANT_ID || 'default').trim() || 'default';
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
    if (!(await tableExists(db, 'sessions'))) return;

    const tenantId = demoTenantId();
    const accountId = demoAccountId();

    await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(db);
    await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(db);
    await sql`UPDATE sessions SET tenant_id = ${tenantId} WHERE tenant_id = ''`.execute(db);
    await sql`UPDATE sessions SET account_id = ${accountId} WHERE account_id = ''`.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user_id ON sessions (tenant_id, user_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_tenant_expires_at ON sessions (tenant_id, expires_at)`.execute(
      db,
    );
  },

  async down(db: Kysely<unknown>): Promise<void> {
    if (!(await tableExists(db, 'sessions'))) return;
    await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS account_id`.execute(db);
    await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS tenant_id`.execute(db);
  },
};
