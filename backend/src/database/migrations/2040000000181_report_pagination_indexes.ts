import { sql, type Kysely } from 'kysely';

// Supports the tenant-scoped newest-first stock movement and journal entry lists.
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id_desc ON stock_movements (tenant_id, id DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_id_desc ON journal_entries (tenant_id, id DESC)`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_journal_entries_tenant_id_desc`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_stock_movements_tenant_id_desc`.execute(db);
  },
};
