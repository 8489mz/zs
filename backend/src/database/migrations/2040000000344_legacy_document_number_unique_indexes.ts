import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000344: unique indexes on the legacy
 * document-number columns (INV-LEGACY-DOC-NUMBER-UNIQUE-BACKSTOP).
 *
 * Migration 0297 (INV-DOCUMENT-NUMBER-UNIQUE-BACKSTOP) indexed
 * only the van tables and explicitly deferred these five legacy
 * nullable doc_no columns pending "a writer audit plus a live
 * duplicate count first". The slice-4 writer audit (live code,
 * phase1-final-inspection-log.md) proves four of the five
 * writers id-derived, so these four columns get the backstop
 * in this migration:
 * - purchases.doc_no: purchases-write-create renames the NULL
 *   insert via generatePurchaseDocNo (ZP-<row id> /
 *   ZP-YYMMDD-<row id>); GRN bills insert 'TMP' then rename
 *   to the same shape in the same transaction.
 * - cashier_shifts.doc_no: the shift open inserts NULL then
 *   renames via buildCashDrawerShiftDocNo (SHIFT-YYMMDD-<row
 *   id>) in the same transaction; the demo seed inserts a
 *   shift with no doc_no at all (NULL, permitted).
 * - stock_transfers.doc_no: all four insert sites rename in
 *   the same transaction via generateTransferDocNo
 *   (ZTR-<row id> / ZTR-YYMMDD-<row id>).
 * - return_documents.doc_no: insertReturnDocument inserts
 *   'TMP' then renames via generateReturnDocNo
 *   (ZR/ZPR-YYMMDD-<row id>) in the same transaction.
 * The row id is table-globally unique, so (tenant_id, doc_no)
 * is unique by construction for all four — the index is a
 * backstop against paths that slip past the generators (a
 * manual insert, a restore, legacy copied values), not the
 * numbering mechanism itself.
 *
 * EXCLUDED, recorded (not silently dropped):
 * - sales.doc_no: the subscription writer numbers invoices
 *   from a per-subscription counter (SUB-INV-YYMMDD-<count>),
 *   so two subscriptions billing the same day collide with
 *   no concurrency needed. Indexing sales would break
 *   subscription billing; the generator fix is its own
 *   package, then sales follows.
 * - The old returns table: migration 4000 drops it in up
 *   (recreated only in down) and no production code reads
 *   or writes it. return_documents is the live returns
 *   table and is indexed instead.
 *
 * SAFE WITH THE TMP-THEN-RENAME FLOW: three of the four
 * tables insert a 'TMP' placeholder first and rename it in
 * the SAME transaction. Two concurrent transactions that
 * share the placeholder for the same tenant do NOT fail:
 * Postgres speculative insertion makes the second insert
 * wait, and once the first transaction renames its row
 * (same transaction, before commit) the conflict is gone
 * and the second insert proceeds (the 0297 safety, same
 * shape). The spec pins the observable half of this
 * (identical placeholders in two sequential transactions
 * both succeed after rename); the concurrent half is
 * Postgres semantics, not application code.
 *
 * NULLS: all four columns are TEXT NULL and legacy rows can
 * hold NULL. Postgres unique indexes permit multiple NULLs,
 * so the pre-check below excludes NULL rows: a GROUP BY
 * would otherwise group NULLs together and refuse on rows
 * the index itself would accept. The spec pins NULL rows do
 * not block up().
 *
 * FAILS LOUDLY ON PURPOSE: the live duplicate count cannot
 * be taken from the audit VM (the live-DB tunnel is closed),
 * so this migration's own pre-check enforces the count at
 * deploy. If production already holds two rows with the
 * same (tenant_id, doc_no) for a non-NULL number, the
 * explicit duplicate pre-check below raises before any
 * index is created. Resolve duplicates first — never
 * silently renumber rows. A post-check asserts all four
 * indexes exist after creation.
 *
 * Performance (PERF-9 / PERF-10): numbered migration,
 * CREATE UNIQUE INDEX IF NOT EXISTS (up is idempotent: up →
 * up → down verified in the spec), only on the four legacy
 * tables whose numbers are id-derived — no speculative
 * index, no hot-path table touched.
 */

const INDEXES: Array<{ table: string; column: string; name: string }> = [
  { table: 'purchases', column: 'doc_no', name: 'uq_purchases_tenant_doc_no' },
  { table: 'cashier_shifts', column: 'doc_no', name: 'uq_cashier_shifts_tenant_doc_no' },
  { table: 'stock_transfers', column: 'doc_no', name: 'uq_stock_transfers_tenant_doc_no' },
  { table: 'return_documents', column: 'doc_no', name: 'uq_return_documents_tenant_doc_no' },
];

export async function up(db: Kysely<any>): Promise<void> {
  // Pre-check: fail loudly (named error, duplicate count included)
  // instead of letting CREATE UNIQUE INDEX abort with a bare 23505.
  // NULL doc_no rows are excluded: the unique index permits
  // multiple NULLs, so they are not duplicates the index would
  // reject.
  for (const { table, column } of INDEXES) {
    const dupes = await sql<{ n: string }>`
      SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM ${sql.table(table)}
        WHERE ${sql.ref(column)} IS NOT NULL
        GROUP BY tenant_id, ${sql.ref(column)}
        HAVING COUNT(*) > 1
      ) AS d
    `.execute(db);
    const count = Number(dupes.rows[0]?.n ?? 0);
    if (count > 0) {
      throw new Error(
        `legacy document-number unique backstop refused: ${table} already holds ${count} duplicate (tenant_id, ${column}) group(s); resolve duplicates first, never silently renumber rows`,
      );
    }
  }

  for (const { table, column, name } of INDEXES) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(name)} ON ${sql.table(table)} (tenant_id, ${sql.ref(column)})`.execute(
      db,
    );
  }

  // Post-check: all four indexes must exist after creation.
  const found = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes
    WHERE indexname IN ('uq_purchases_tenant_doc_no', 'uq_cashier_shifts_tenant_doc_no', 'uq_stock_transfers_tenant_doc_no', 'uq_return_documents_tenant_doc_no')
  `.execute(db);
  if (Number(found.rows[0]?.n ?? 0) !== INDEXES.length) {
    throw new Error('legacy document-number unique backstop incomplete: not all four indexes exist after creation');
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const { name } of INDEXES) {
    await sql`DROP INDEX IF EXISTS ${sql.ref(name)}`.execute(db);
  }
}

export const migration = { up, down };
