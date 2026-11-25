import { sql, type Kysely } from 'kysely';

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

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS tenant_id TEXT`.execute(db);
    await sql`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS account_id TEXT`.execute(db);
    await sql`ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS tenant_id TEXT`.execute(db);

    // Backfill only from source tables that already carry an unambiguous tenant/account scope.
    if (await tableExists(db, 'sales')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = s.tenant_id,
            account_id = s.account_id,
            updated_at = NOW()
        FROM sales s
        WHERE je.source_type IN ('sale', 'sale_reversal', 'sale_cancel')
          AND je.source_id = s.id
          AND je.tenant_id IS NULL
          AND COALESCE(s.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'purchases')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = p.tenant_id,
            account_id = p.account_id,
            updated_at = NOW()
        FROM purchases p
        WHERE je.source_type IN ('purchase', 'purchase_reversal', 'purchase_cancel')
          AND je.source_id = p.id
          AND je.tenant_id IS NULL
          AND COALESCE(p.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'return_documents')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = rd.tenant_id,
            account_id = rd.account_id,
            updated_at = NOW()
        FROM return_documents rd
        WHERE je.source_type IN ('sales_return', 'return')
          AND je.source_id = rd.id
          AND je.tenant_id IS NULL
          AND COALESCE(rd.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'supplier_payments')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = sp.tenant_id,
            account_id = sp.account_id,
            updated_at = NOW()
        FROM supplier_payments sp
        WHERE je.source_type IN ('supplier_payment', 'supplier_payment_reversal')
          AND je.source_id = sp.id
          AND je.tenant_id IS NULL
          AND COALESCE(sp.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'supplier_payment_schedule_logs')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = spl.tenant_id,
            account_id = spl.account_id,
            updated_at = NOW()
        FROM supplier_payment_schedule_logs spl
        WHERE je.source_type = 'supplier_payment_schedule_settlement'
          AND je.source_id = spl.id
          AND je.tenant_id IS NULL
          AND COALESCE(spl.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'customer_payments')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = cp.tenant_id,
            account_id = cp.account_id,
            updated_at = NOW()
        FROM customer_payments cp
        WHERE je.source_type IN ('customer_payment', 'customer_payment_reversal')
          AND je.source_id = cp.id
          AND je.tenant_id IS NULL
          AND COALESCE(cp.tenant_id, '') <> ''
      `.execute(db);
    }

    if (await tableExists(db, 'expenses')) {
      await sql`
        UPDATE journal_entries je
        SET tenant_id = e.tenant_id,
            account_id = e.account_id,
            updated_at = NOW()
        FROM expenses e
        WHERE je.source_type IN ('expense', 'treasury_expense', 'expense_reversal')
          AND je.source_id = e.id
          AND je.tenant_id IS NULL
          AND COALESCE(e.tenant_id, '') <> ''
      `.execute(db);
    }

    await sql`
      UPDATE journal_entry_lines line
      SET tenant_id = je.tenant_id
      FROM journal_entries je
      WHERE line.journal_entry_id = je.id
        AND line.tenant_id IS NULL
        AND je.tenant_id IS NOT NULL
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_id ON journal_entries (tenant_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_source ON journal_entries (tenant_id, source_type, source_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_tenant_entry ON journal_entry_lines (tenant_id, journal_entry_id)`.execute(
      db,
    );
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_opening_balance_once_per_tenant
      ON journal_entries (tenant_id)
      WHERE source_type = 'opening_balance'
        AND status = 'posted'
        AND tenant_id IS NOT NULL
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_journal_entries_opening_balance_once_per_tenant`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_entry_lines_tenant_entry`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_entries_tenant_source`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_entries_tenant_id`.execute(db);
    await sql`ALTER TABLE journal_entry_lines DROP COLUMN IF EXISTS tenant_id`.execute(db);
    await sql`ALTER TABLE journal_entries DROP COLUMN IF EXISTS account_id`.execute(db);
    await sql`ALTER TABLE journal_entries DROP COLUMN IF EXISTS tenant_id`.execute(db);
  },
};
