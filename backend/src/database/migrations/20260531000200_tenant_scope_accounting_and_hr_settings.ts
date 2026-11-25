import { sql, type Kysely } from 'kysely';

function defaultTenantId(): string {
  return String(process.env.TENANT_ID || 'default').trim() || 'default';
}

function defaultAccountId(): string {
  return String(process.env.ACCOUNT_ID || 'default').trim() || 'default';
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

async function columnExists(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${column}
    ) as exists
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
}

async function scopeTable(db: Kysely<unknown>, table: string): Promise<void> {
  const tenantId = defaultTenantId();
  const accountId = defaultAccountId();
  await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS tenant_id TEXT`.execute(db);
  await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS account_id TEXT`.execute(db);
  await sql`UPDATE ${sql.table(table)} SET tenant_id = ${tenantId} WHERE tenant_id IS NULL OR btrim(tenant_id) = ''`.execute(
    db,
  );
  await sql`UPDATE ${sql.table(table)} SET account_id = ${accountId} WHERE account_id IS NULL OR btrim(account_id) = ''`.execute(
    db,
  );
  await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN tenant_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN account_id SET NOT NULL`.execute(db);
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    if (await tableExists(db, 'accounting_accounts')) {
      await scopeTable(db, 'accounting_accounts');
      await sql`ALTER TABLE accounting_accounts DROP CONSTRAINT IF EXISTS accounting_accounts_code_key`.execute(db);
      await sql`DROP INDEX IF EXISTS idx_accounting_accounts_code`.execute(db);
      await sql`DROP INDEX IF EXISTS accounting_accounts_code_key`.execute(db);
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_accounting_accounts_tenant_id ON accounting_accounts (tenant_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_accounting_accounts_account_id ON accounting_accounts (account_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_accounting_accounts_tenant_parent_id ON accounting_accounts (tenant_id, parent_id)`.execute(
        db,
      );
    }

    if (await tableExists(db, 'accounting_settings')) {
      await scopeTable(db, 'accounting_settings');
      await sql`
        delete from accounting_settings s
        using accounting_settings newer
        where s.tenant_id = newer.tenant_id
          and s.id = newer.id
          and s.ctid < newer.ctid
      `.execute(db);
      await sql`ALTER TABLE accounting_settings DROP CONSTRAINT IF EXISTS accounting_settings_pkey`.execute(db);
      await sql`ALTER TABLE accounting_settings ADD CONSTRAINT accounting_settings_pkey PRIMARY KEY (tenant_id, id)`.execute(
        db,
      );
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_settings_tenant_singleton_uidx ON accounting_settings (tenant_id, id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_accounting_settings_account_id ON accounting_settings (account_id)`.execute(
        db,
      );
    }

    if (await tableExists(db, 'hr_hr_settings')) {
      await scopeTable(db, 'hr_hr_settings');
      await sql`ALTER TABLE hr_hr_settings DROP CONSTRAINT IF EXISTS hr_hr_settings_pkey`.execute(db);
      await sql`ALTER TABLE hr_hr_settings ADD CONSTRAINT hr_hr_settings_pkey PRIMARY KEY (tenant_id, key)`.execute(db);
      await sql`CREATE INDEX IF NOT EXISTS idx_hr_hr_settings_account_id ON hr_hr_settings (account_id)`.execute(db);
      await sql`CREATE INDEX IF NOT EXISTS idx_hr_hr_settings_tenant_key ON hr_hr_settings (tenant_id, key)`.execute(
        db,
      );
    }

    if ((await tableExists(db, 'accounting_settings')) && (await columnExists(db, 'accounting_settings', 'id'))) {
      await sql`CREATE INDEX IF NOT EXISTS idx_accounting_settings_tenant_lookup ON accounting_settings (tenant_id, account_id)`.execute(
        db,
      );
    }
  },

  async down(_db: Kysely<unknown>): Promise<void> {},
};
