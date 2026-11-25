import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // =========================================================================
    // Fiscal years must not overlap within a tenant.
    // The application checked this with a SELECT followed by an INSERT, which is a TOCTOU race:
    // two concurrent creates both see "no overlap" and both commit. Overlapping fiscal years make
    // every period-based report ambiguous and let the same entry be closed twice.
    // Only the database can enforce this atomically.
    // =========================================================================
    await sql`CREATE EXTENSION IF NOT EXISTS btree_gist;`.execute(db);

    // Refuse to install the guard over data that already violates it, rather than silently skipping.
    const overlaps = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text AS cnt
      FROM accounting_fiscal_years a
      JOIN accounting_fiscal_years b
        ON a.tenant_id = b.tenant_id
       AND a.id < b.id
       AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');
    `.execute(db);

    const overlapCount = Number(overlaps.rows?.[0]?.cnt || 0);
    if (overlapCount > 0) {
      throw new Error(
        `Cannot add fiscal year overlap constraint: ${overlapCount} overlapping pair(s) already exist. Resolve them first.`,
      );
    }

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_fiscal_years_no_overlap') THEN
          ALTER TABLE accounting_fiscal_years
            ADD CONSTRAINT accounting_fiscal_years_no_overlap
            EXCLUDE USING gist (
              tenant_id WITH =,
              daterange(start_date, end_date, '[]') WITH &&
            );
        END IF;
      END $$;
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fiscal_year_date_order') THEN
          ALTER TABLE accounting_fiscal_years
            ADD CONSTRAINT chk_fiscal_year_date_order CHECK (start_date < end_date);
        END IF;
      END $$;
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE accounting_fiscal_years DROP CONSTRAINT IF EXISTS chk_fiscal_year_date_order;`.execute(db);
    await sql`ALTER TABLE accounting_fiscal_years DROP CONSTRAINT IF EXISTS accounting_fiscal_years_no_overlap;`.execute(
      db,
    );
  },
};
