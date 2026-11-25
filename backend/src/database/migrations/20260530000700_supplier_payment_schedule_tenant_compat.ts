import { sql, type Kysely } from 'kysely';

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

    if (await tableExists(db, 'supplier_payment_schedules')) {
      await sql`ALTER TABLE supplier_payment_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`ALTER TABLE supplier_payment_schedules ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );

      await sql`
        UPDATE supplier_payment_schedules s
        SET tenant_id = COALESCE(NULLIF(sp.tenant_id, ''), ${tenantId})
        FROM suppliers sp
        WHERE sp.id = s.supplier_id
          AND COALESCE(s.tenant_id, '') = ''
      `.execute(db);
      await sql`UPDATE supplier_payment_schedules SET tenant_id = ${tenantId} WHERE COALESCE(tenant_id, '') = ''`.execute(
        db,
      );

      await sql`
        UPDATE supplier_payment_schedules s
        SET account_id = COALESCE(NULLIF(sp.account_id, ''), ${accountId})
        FROM suppliers sp
        WHERE sp.id = s.supplier_id
          AND COALESCE(s.account_id, '') = ''
      `.execute(db);
      await sql`UPDATE supplier_payment_schedules SET account_id = ${accountId} WHERE COALESCE(account_id, '') = ''`.execute(
        db,
      );

      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedules_tenant_idx ON supplier_payment_schedules (tenant_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedules_tenant_supplier_idx ON supplier_payment_schedules (tenant_id, supplier_id)`.execute(
        db,
      );
    }

    if (await tableExists(db, 'supplier_payment_schedule_logs')) {
      await sql`ALTER TABLE supplier_payment_schedule_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`ALTER TABLE supplier_payment_schedule_logs ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );

      await sql`
        UPDATE supplier_payment_schedule_logs l
        SET tenant_id = COALESCE(
          NULLIF((SELECT s.tenant_id FROM supplier_payment_schedules s WHERE s.id = l.schedule_id LIMIT 1), ''),
          NULLIF((SELECT sp.tenant_id FROM suppliers sp WHERE sp.id = l.supplier_id LIMIT 1), ''),
          ${tenantId}
        )
        WHERE COALESCE(l.tenant_id, '') = ''
      `.execute(db);
      await sql`UPDATE supplier_payment_schedule_logs SET tenant_id = ${tenantId} WHERE COALESCE(tenant_id, '') = ''`.execute(
        db,
      );

      await sql`
        UPDATE supplier_payment_schedule_logs l
        SET account_id = COALESCE(
          NULLIF((SELECT s.account_id FROM supplier_payment_schedules s WHERE s.id = l.schedule_id LIMIT 1), ''),
          NULLIF((SELECT sp.account_id FROM suppliers sp WHERE sp.id = l.supplier_id LIMIT 1), ''),
          ${accountId}
        )
        WHERE COALESCE(l.account_id, '') = ''
      `.execute(db);
      await sql`UPDATE supplier_payment_schedule_logs SET account_id = ${accountId} WHERE COALESCE(account_id, '') = ''`.execute(
        db,
      );

      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedule_logs_tenant_idx ON supplier_payment_schedule_logs (tenant_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedule_logs_tenant_schedule_idx ON supplier_payment_schedule_logs (tenant_id, schedule_id)`.execute(
        db,
      );
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    if (await tableExists(db, 'supplier_payment_schedule_logs')) {
      await sql`DROP INDEX IF EXISTS supplier_payment_schedule_logs_tenant_schedule_idx`.execute(db);
      await sql`DROP INDEX IF EXISTS supplier_payment_schedule_logs_tenant_idx`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedule_logs DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedule_logs DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }

    if (await tableExists(db, 'supplier_payment_schedules')) {
      await sql`DROP INDEX IF EXISTS supplier_payment_schedules_tenant_supplier_idx`.execute(db);
      await sql`DROP INDEX IF EXISTS supplier_payment_schedules_tenant_idx`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedules DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedules DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }
  },
};
