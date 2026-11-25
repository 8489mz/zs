import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE purchase_attachments ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(db);
    await sql`ALTER TABLE purchase_attachments ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS purchase_attachments_tenant_idx ON purchase_attachments(tenant_id)`.execute(
      db,
    );
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS purchase_attachments_tenant_idx`.execute(db);
    await sql`ALTER TABLE purchase_attachments DROP COLUMN IF EXISTS tenant_id`.execute(db);
    await sql`ALTER TABLE purchase_attachments DROP COLUMN IF EXISTS account_id`.execute(db);
  },
};
