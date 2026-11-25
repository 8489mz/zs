import { sql, type Kysely } from 'kysely';

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

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    if (await tableExists(db, 'supplier_payment_schedules')) {
      await sql`ALTER TABLE supplier_payment_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedules ADD COLUMN IF NOT EXISTS account_id TEXT`.execute(db);

      // Strict backfill from tenant-scoped parent entities only (no fallback tenant guessing).
      if (await columnExists(db, 'suppliers', 'tenant_id')) {
        await sql`
          UPDATE supplier_payment_schedules s
          SET tenant_id = sp.tenant_id
          FROM suppliers sp
          WHERE sp.id = s.supplier_id
            AND sp.tenant_id IS NOT NULL
            AND sp.tenant_id <> ''
        `.execute(db);
      }

      if (await columnExists(db, 'purchases', 'tenant_id')) {
        await sql`
          UPDATE supplier_payment_schedules s
          SET tenant_id = p.tenant_id
          FROM purchases p
          WHERE p.id = s.purchase_id
            AND p.tenant_id IS NOT NULL
            AND p.tenant_id <> ''
            AND COALESCE(s.tenant_id, '') = ''
        `.execute(db);
      }

      if (await columnExists(db, 'suppliers', 'account_id')) {
        await sql`
          UPDATE supplier_payment_schedules s
          SET account_id = sp.account_id
          FROM suppliers sp
          WHERE sp.id = s.supplier_id
            AND sp.account_id IS NOT NULL
            AND sp.account_id <> ''
        `.execute(db);
      }

      if (await columnExists(db, 'purchases', 'account_id')) {
        await sql`
          UPDATE supplier_payment_schedules s
          SET account_id = p.account_id
          FROM purchases p
          WHERE p.id = s.purchase_id
            AND p.account_id IS NOT NULL
            AND p.account_id <> ''
            AND COALESCE(s.account_id, '') = ''
        `.execute(db);
      }

      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedules_tenant_idx ON supplier_payment_schedules (tenant_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedules_tenant_supplier_idx ON supplier_payment_schedules (tenant_id, supplier_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedules_tenant_purchase_idx ON supplier_payment_schedules (tenant_id, purchase_id)`.execute(
        db,
      );
    }

    if (await tableExists(db, 'supplier_payment_schedule_logs')) {
      await sql`ALTER TABLE supplier_payment_schedule_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedule_logs ADD COLUMN IF NOT EXISTS account_id TEXT`.execute(db);

      if (await columnExists(db, 'supplier_payment_schedules', 'tenant_id')) {
        await sql`
          UPDATE supplier_payment_schedule_logs l
          SET tenant_id = s.tenant_id
          FROM supplier_payment_schedules s
          WHERE s.id = l.schedule_id
            AND s.tenant_id IS NOT NULL
            AND s.tenant_id <> ''
        `.execute(db);
      }

      if (await columnExists(db, 'suppliers', 'tenant_id')) {
        await sql`
          UPDATE supplier_payment_schedule_logs l
          SET tenant_id = sp.tenant_id
          FROM suppliers sp
          WHERE sp.id = l.supplier_id
            AND sp.tenant_id IS NOT NULL
            AND sp.tenant_id <> ''
            AND COALESCE(l.tenant_id, '') = ''
        `.execute(db);
      }

      if (await columnExists(db, 'supplier_payment_schedules', 'account_id')) {
        await sql`
          UPDATE supplier_payment_schedule_logs l
          SET account_id = s.account_id
          FROM supplier_payment_schedules s
          WHERE s.id = l.schedule_id
            AND s.account_id IS NOT NULL
            AND s.account_id <> ''
        `.execute(db);
      }

      if (await columnExists(db, 'suppliers', 'account_id')) {
        await sql`
          UPDATE supplier_payment_schedule_logs l
          SET account_id = sp.account_id
          FROM suppliers sp
          WHERE sp.id = l.supplier_id
            AND sp.account_id IS NOT NULL
            AND sp.account_id <> ''
            AND COALESCE(l.account_id, '') = ''
        `.execute(db);
      }

      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedule_logs_tenant_idx ON supplier_payment_schedule_logs (tenant_id)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS supplier_payment_schedule_logs_tenant_schedule_idx ON supplier_payment_schedule_logs (tenant_id, schedule_id)`.execute(
        db,
      );
    }

    // NOTE:
    // We intentionally do not force tenant_id/account_id to NOT NULL here.
    // If any legacy orphan rows cannot be backfilled from reliable relational sources,
    // forcing NOT NULL would require guessing tenant ownership, which is unsafe.
  },

  async down(db: Kysely<unknown>): Promise<void> {
    if (await tableExists(db, 'supplier_payment_schedule_logs')) {
      await sql`DROP INDEX IF EXISTS supplier_payment_schedule_logs_tenant_schedule_idx`.execute(db);
      await sql`DROP INDEX IF EXISTS supplier_payment_schedule_logs_tenant_idx`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedule_logs DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedule_logs DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }

    if (await tableExists(db, 'supplier_payment_schedules')) {
      await sql`DROP INDEX IF EXISTS supplier_payment_schedules_tenant_purchase_idx`.execute(db);
      await sql`DROP INDEX IF EXISTS supplier_payment_schedules_tenant_supplier_idx`.execute(db);
      await sql`DROP INDEX IF EXISTS supplier_payment_schedules_tenant_idx`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedules DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE supplier_payment_schedules DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }
  },
};
