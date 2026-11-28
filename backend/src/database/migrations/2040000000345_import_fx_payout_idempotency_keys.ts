import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000345: service-level idempotency keys for the two
 * import-sales money writes the R2 review left without a key path
 * (INV-IMPORT-FX-PAYOUT-IDEMPOTENCY).
 *
 * recordFxAcquisition (import-treasury.service.ts) inserts into
 * import_fx_acquisitions unconditionally: a lost response + retry
 * books a second acquisition with a second journal and a second
 * pair of treasury legs. recordPartnerPayout
 * (import-projects-partners.service.ts) has no key path either: its
 * retry fails at the already-consumed maker-checker approval instead
 * of returning the original success. The class-wide
 * IdempotencyInterceptor on ImportSalesController (R2) already
 * protects an HTTP retry that carries a key header; this migration
 * is the storage-layer half of the service-level key path (the
 * other half is the optional DTO idempotencyKey + the in-transaction
 * pre-check + replay in the two services).
 *
 * No natural key exists for either write (two identical FX buys on
 * the same day are legitimate distinct operations; a payout is
 * identified by its caller-supplied key, not by its approval —
 * the approval is a single-use authorization, not the retry
 * identity). The key is therefore client-supplied and OPTIONAL:
 * no key means pass-through, exactly as before. The partial unique
 * indexes below serialise concurrent retries; the service replays
 * the original row on a duplicate key instead of failing.
 *
 * NULLS: the new columns are TEXT NULL and every existing row
 * holds NULL. Postgres unique indexes permit multiple NULLs, so
 * the pre-check below excludes NULL keys: a GROUP BY would
 * otherwise group NULLs together and refuse on rows the index
 * itself would accept. The spec pins two NULL rows do not block
 * up().
 *
 * FAILS LOUDLY ON PURPOSE: if production already holds two rows
 * with the same (tenant_id, idempotency_key) for a non-NULL key,
 * the explicit duplicate pre-check below raises before the index
 * is created. Resolve duplicates first — never silently renumber
 * rows. A post-check asserts both indexes exist after creation.
 *
 * Performance (PERF-9 / PERF-10): numbered migration,
 * CREATE UNIQUE INDEX IF NOT EXISTS (up is idempotent: up → up →
 * down verified in the spec), only on the two tables whose rows
 * the two services write — no speculative index, no hot-path
 * table touched.
 */

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE ${sql.table('import_fx_acquisitions')} ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(
    db,
  );
  await sql`ALTER TABLE ${sql.table('import_partner_project_payouts')} ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(
    db,
  );

  // Pre-check: fail loudly (named error, duplicate count included)
  // instead of letting CREATE UNIQUE INDEX abort with a bare 23505.
  // NULL keys are excluded: the unique indexes permit multiple
  // NULLs, so they are not duplicates the indexes would reject.
  for (const table of ['import_fx_acquisitions', 'import_partner_project_payouts']) {
    const dupes = await sql<{ n: string }>`
      SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM ${sql.table(table)}
        WHERE idempotency_key IS NOT NULL
        GROUP BY tenant_id, idempotency_key
        HAVING COUNT(*) > 1
      ) AS d
    `.execute(db);
    const count = Number(dupes.rows[0]?.n ?? 0);
    if (count > 0) {
      throw new Error(
        `import-sales idempotency backstop refused: ${table} already holds ${count} duplicate (tenant_id, idempotency_key) group(s); resolve duplicates first, never silently renumber rows`,
      );
    }
  }

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref('uq_fx_acquisitions_tenant_key')} ON ${sql.table('import_fx_acquisitions')} (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref('uq_partner_payouts_tenant_key')} ON ${sql.table('import_partner_project_payouts')} (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.execute(
    db,
  );

  // Post-check: both indexes must exist after creation.
  for (const indexName of ['uq_fx_acquisitions_tenant_key', 'uq_partner_payouts_tenant_key']) {
    const found = await sql<{ n: string }>`
      SELECT COUNT(*) AS n FROM pg_indexes
      WHERE indexname = ${indexName}
    `.execute(db);
    if (Number(found.rows[0]?.n ?? 0) !== 1) {
      throw new Error(
        `import-sales idempotency backstop incomplete: the unique index ${indexName} does not exist after creation`,
      );
    }
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS ${sql.ref('uq_fx_acquisitions_tenant_key')}`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.ref('uq_partner_payouts_tenant_key')}`.execute(db);
  await sql`ALTER TABLE ${sql.table('import_fx_acquisitions')} DROP COLUMN IF EXISTS idempotency_key`.execute(db);
  await sql`ALTER TABLE ${sql.table('import_partner_project_payouts')} DROP COLUMN IF EXISTS idempotency_key`.execute(
    db,
  );
}

export const migration = { up, down };
