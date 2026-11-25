import { Kysely, sql } from 'kysely';

async function dropConstraintIfExists(db: Kysely<unknown>, table: string, constraint: string): Promise<void> {
  await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.ref(constraint)}`
    .execute(db)
    .catch(() => undefined);
}

async function tableExists(db: Kysely<unknown>, table: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${table}
    ) AS exists
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
}

async function dropSingleColumnUniqueConstraints(db: Kysely<unknown>, table: string, column: string): Promise<void> {
  const result = await sql<{ conname: string }>`
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = ${table}
      AND c.contype IN ('u', 'p')
      AND a.attname = ${column}
      AND array_length(c.conkey, 1) = 1
  `.execute(db);

  for (const row of result.rows) {
    await dropConstraintIfExists(db, table, row.conname);
  }
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    if (await tableExists(db, 'settings')) {
      if (!(await columnExists(db, 'settings', 'tenant_id')))
        await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'`
          .execute(db)
          .catch(() => undefined);
      if (!(await columnExists(db, 'settings', 'account_id')))
        await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'default'`
          .execute(db)
          .catch(() => undefined);
      await dropSingleColumnUniqueConstraints(db, 'settings', 'key');
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS settings_tenant_key_uidx ON settings (tenant_id, key)`
        .execute(db)
        .catch(() => undefined);
    }

    if (await tableExists(db, 'branches')) {
      await dropSingleColumnUniqueConstraints(db, 'branches', 'name');
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_name_uidx ON branches (tenant_id, lower(name)) WHERE is_active = true`
        .execute(db)
        .catch(() => undefined);
    }

    if (await tableExists(db, 'product_categories')) {
      await dropSingleColumnUniqueConstraints(db, 'product_categories', 'name');
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS product_categories_tenant_name_uidx ON product_categories (tenant_id, lower(name)) WHERE is_active = true`
        .execute(db)
        .catch(() => undefined);
    }

    if (await tableExists(db, 'products')) {
      await dropSingleColumnUniqueConstraints(db, 'products', 'barcode');
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_uidx ON products (tenant_id, lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> '' AND is_active = true`
        .execute(db)
        .catch(() => undefined);
    }

    if (await tableExists(db, 'product_units')) {
      if (!(await columnExists(db, 'product_units', 'tenant_id')))
        await sql`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'`
          .execute(db)
          .catch(() => undefined);
      if (!(await columnExists(db, 'product_units', 'account_id')))
        await sql`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'default'`
          .execute(db)
          .catch(() => undefined);
      await dropSingleColumnUniqueConstraints(db, 'product_units', 'barcode');
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS product_units_tenant_barcode_uidx ON product_units (tenant_id, lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> ''`
        .execute(db)
        .catch(() => undefined);
    }
  },

  async down(_db: Kysely<unknown>): Promise<void> {},
};
