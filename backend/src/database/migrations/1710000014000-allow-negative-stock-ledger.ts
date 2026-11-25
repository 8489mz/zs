import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

type ConstraintRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  constraint_def: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isNonNegativeColumnCheck(constraintDef: string, columnName: string): boolean {
  const normalized = constraintDef
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/\((0(?:\.0+)?)\)::numeric/g, '0')
    .replace(/\s+/g, ' ');
  return normalized.includes(columnName.toLowerCase()) && /(?:>=\s*0|0\s*<=)/.test(normalized);
}

async function dropNonNegativeColumnCheckConstraints(
  db: Kysely<Database>,
  tableName: 'products' | 'product_location_stock',
  columnName: 'stock_qty' | 'qty',
): Promise<void> {
  const result = await sql<ConstraintRow>`
    SELECT
      nsp.nspname AS schema_name,
      rel.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS constraint_def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute attr ON attr.attrelid = rel.oid AND attr.attnum = ANY(con.conkey)
    WHERE con.contype = 'c'
      AND rel.relname = ${tableName}
      AND attr.attname = ${columnName}
  `.execute(db);

  for (const row of result.rows) {
    if (!isNonNegativeColumnCheck(String(row.constraint_def || ''), columnName)) continue;
    const qualifiedTableName = `${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.table_name)}`;
    const constraintName = quoteIdentifier(row.constraint_name);
    await sql.raw(`ALTER TABLE ${qualifiedTableName} DROP CONSTRAINT ${constraintName}`).execute(db);
  }
}

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await dropNonNegativeColumnCheckConstraints(db, 'products', 'stock_qty');
    await dropNonNegativeColumnCheckConstraints(db, 'product_location_stock', 'qty');
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_stock_qty_non_negative CHECK (stock_qty >= 0)`.execute(
      db,
    );
    await sql`ALTER TABLE product_location_stock ADD CONSTRAINT chk_product_location_stock_qty_non_negative CHECK (qty >= 0)`.execute(
      db,
    );
  },
};
