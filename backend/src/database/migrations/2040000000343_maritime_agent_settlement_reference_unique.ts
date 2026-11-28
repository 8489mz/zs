import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000343: unique index on the maritime agent-settlement
 * reference number (INV-MARITIME-AGENT-SETTLEMENT-IDEMPOTENCY).
 *
 * createAgentSettlement (maritime-freight-agent-settlements.service.ts)
 * inserts a settlement row unconditionally: a caller-supplied
 * reference_number is stored verbatim, otherwise a TMP uuid is
 * renamed in the same transaction to the generated daily number
 * (APS/ADN/ACN-YYMMDD-XXXX by row id). Nothing stopped a lost
 * response + retry from booking the same settlement twice — the
 * R2 review recorded it as a GAP, record-only
 * (idempotency-coverage-r2.spec.ts), and this migration is the
 * storage-layer half of the follow-up package (the other half is
 * the IdempotencyInterceptor on POST agent-settlements).
 *
 * Scope (tenant_id, reference_number) follows the 0297 backstop
 * (INV-DOCUMENT-NUMBER-UNIQUE-BACKSTOP): references are
 * tenant-scoped, and the GRN precedent (uq_grn_tenant_doc,
 * migration 0106) is the same shape. account_id is NOT part of
 * the key: references are never scoped by account.
 *
 * SAFE WITH THE TMP-THEN-RENAME FLOW: the generated placeholder
 * is `AST-TMP-<randomUUID()>`, unique per insert by construction,
 * and the rename to the final daily number happens in the SAME
 * transaction before commit — the index only ever sees the final
 * value, and two concurrent inserts never share a placeholder.
 *
 * NULLS: reference_number is TEXT NULL (migration 0200) and the
 * service always writes a value, but legacy rows could hold NULL.
 * Postgres unique indexes permit multiple NULLs, so the
 * pre-check below excludes NULL rows: a GROUP BY would otherwise
 * group NULLs together and refuse on rows the index itself would
 * accept. The spec pins two NULL rows do not block up().
 *
 * FAILS LOUDLY ON PURPOSE: if production already holds two rows
 * with the same (tenant_id, reference_number) for a non-NULL
 * reference, the explicit duplicate pre-check below raises before
 * the index is created. Resolve duplicates first — never silently
 * renumber rows. A post-check asserts the index exists after
 * creation.
 *
 * Performance (PERF-9 / PERF-10): numbered migration,
 * CREATE UNIQUE INDEX IF NOT EXISTS (up is idempotent: up → up →
 * down verified in the spec), only on the one settlements table
 * whose references the service writes — no speculative index, no
 * hot-path table touched.
 */

export async function up(db: Kysely<any>): Promise<void> {
  // Pre-check: fail loudly (named error, duplicate count included)
  // instead of letting CREATE UNIQUE INDEX abort with a bare 23505.
  // NULL references are excluded: the unique index permits multiple
  // NULLs, so they are not duplicates the index would reject.
  const dupes = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM ${sql.table('maritime_agent_settlements')}
      WHERE reference_number IS NOT NULL
      GROUP BY tenant_id, reference_number
      HAVING COUNT(*) > 1
    ) AS d
  `.execute(db);
  const count = Number(dupes.rows[0]?.n ?? 0);
  if (count > 0) {
    throw new Error(
      `maritime agent-settlement reference backstop refused: maritime_agent_settlements already holds ${count} duplicate (tenant_id, reference_number) group(s); resolve duplicates first, never silently renumber rows`,
    );
  }

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref('uq_maritime_agent_settlements_tenant_reference')} ON ${sql.table('maritime_agent_settlements')} (tenant_id, reference_number)`.execute(
    db,
  );

  // Post-check: the index must exist after creation.
  const found = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes
    WHERE indexname = 'uq_maritime_agent_settlements_tenant_reference'
  `.execute(db);
  if (Number(found.rows[0]?.n ?? 0) !== 1) {
    throw new Error(
      'maritime agent-settlement reference backstop incomplete: the unique index does not exist after creation',
    );
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS ${sql.ref('uq_maritime_agent_settlements_tenant_reference')}`.execute(db);
}

export const migration = { up, down };
