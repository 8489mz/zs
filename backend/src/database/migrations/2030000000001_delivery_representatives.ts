import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS delivery_representatives (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `.execute(db);

    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_rep_id integer`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_status varchar(30)`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS collection_status varchar(30)`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_at timestamp`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_by integer`.execute(db);

    await sql`ALTER TABLE held_sales ADD COLUMN IF NOT EXISTS delivery_rep_id integer`.execute(db);
    await sql`ALTER TABLE held_sales ADD COLUMN IF NOT EXISTS collection_status varchar(30)`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('sales')
      .dropColumn('delivery_rep_id')
      .dropColumn('delivery_status')
      .dropColumn('collection_status')
      .dropColumn('settled_at')
      .dropColumn('settled_by')
      .execute();

    await db.schema.alterTable('held_sales').dropColumn('delivery_rep_id').dropColumn('collection_status').execute();

    await db.schema.dropTable('delivery_representatives').execute();
  },
};
