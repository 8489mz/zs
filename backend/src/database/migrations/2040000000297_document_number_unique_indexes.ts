import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000297: unique indexes on the van document-number
 * columns (INV-DOCUMENT-NUMBER-UNIQUE-BACKSTOP).
 *
 * The daily sequence generator (generateDailySequenceNumber,
 * INV-SEQUENCE-NUMBER-FAIL-CLOSED) serializes numbering with a
 * transaction-held advisory lock per tenant + daily prefix, but the
 * database itself had no backstop: van_load_requisitions.doc_no and
 * van_field_returns.doc_no (migration 0155) and
 * van_stock_transfers.transfer_no (migration 0158) carried no unique
 * index, so a duplicate number produced by any path that slipped
 * past the generator — a second numbering transaction, a manual
 * insert, a restore — landed silently instead of failing loudly.
 * These three indexes make a duplicate number impossible at the
 * storage layer, mirroring the GRN precedent
 * (uq_grn_tenant_doc UNIQUE (tenant_id, doc_no), migration 0106)
 * and the import-projects backstop (migration 0279).
 *
 * Scope (tenant_id, doc_no) follows the generator: numbers are
 * tenant-scoped and reset daily (PREFIX-YYMMDD-XXXX, repo AGENTS.md
 * §10), so (tenant_id, doc_no) is exactly the generator's
 * uniqueness domain. account_id is NOT part of the key: the
 * generator never scopes by account, and the GRN precedent does not
 * either. The three tables are the complete set of generator-issued,
 * NOT NULL document-number columns without a unique backstop:
 * every other numbered column is either already unique
 * (goods_receipt_notes.doc_no, import_projects.project_no,
 * container preorders preorder_no), a user-supplied free value
 * (customs-broker receipt_no, van receipt_voucher_no), a number
 * embedded in free text (customer_payments.note COL), or a nullable
 * legacy column with mixed writers (sales.doc_no, purchases.doc_no,
 * returns/cashier-shifts/stock-transfers doc_no) — those need a
 * writer audit plus a live duplicate count first and are a
 * follow-up, not this package.
 *
 * SAFE WITH THE TMP-THEN-RENAME FLOW: every writer inserts a
 * `TMP-<PREFIX>-<Date.now()>` placeholder and renames it to the
 * generated number in the SAME transaction. Two concurrent
 * transactions that happen to share one millisecond placeholder for
 * the same tenant do NOT fail: Postgres speculative insertion makes
 * the second insert wait, and once the first transaction renames
 * its row (same transaction, before commit) the conflict is gone
 * and the second insert proceeds. The spec pins the observable
 * half of this (identical TMP values in two sequential transactions
 * both succeed after rename); the concurrent half is Postgres
 * semantics, not application code.
 *
 * FAILS LOUDLY ON PURPOSE: if production already holds two rows
 * with the same (tenant_id, doc_no) / (tenant_id, transfer_no),
 * the explicit duplicate pre-check below raises before any index
 * is created. Resolve duplicates first (pre-flight check in the
 * delivery report) — never silently renumber rows. A post-check
 * asserts all three indexes exist after creation.
 *
 * Performance (PERF-9 / PERF-10): numbered migration,
 * CREATE UNIQUE INDEX IF NOT EXISTS (up is idempotent: up → up →
 * down verified in the spec), only on the three van tables whose
 * numbers are issued by the generator — no speculative index, no
 * hot-path table touched.
 */

const INDEXES: Array<{ table: string; column: string; name: string }> = [
  { table: 'van_load_requisitions', column: 'doc_no', name: 'uq_van_load_requisitions_tenant_doc_no' },
  { table: 'van_field_returns', column: 'doc_no', name: 'uq_van_field_returns_tenant_doc_no' },
  { table: 'van_stock_transfers', column: 'transfer_no', name: 'uq_van_stock_transfers_tenant_transfer_no' },
];

export async function up(db: Kysely<any>): Promise<void> {
  // Pre-check: fail loudly (named error, duplicate count included)
  // instead of letting CREATE UNIQUE INDEX abort with a bare 23505.
  for (const { table, column } of INDEXES) {
    const dupes = await sql<{ n: string }>`
      SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM ${sql.table(table)}
        GROUP BY tenant_id, ${sql.ref(column)}
        HAVING COUNT(*) > 1
      ) AS d
    `.execute(db);
    const count = Number(dupes.rows[0]?.n ?? 0);
    if (count > 0) {
      throw new Error(
        `document-number unique backstop refused: ${table} already holds ${count} duplicate (tenant_id, ${column}) group(s); resolve duplicates first, never silently renumber rows`,
      );
    }
  }

  for (const { table, column, name } of INDEXES) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(name)} ON ${sql.table(table)} (tenant_id, ${sql.ref(column)})`.execute(db);
  }

  // Post-check: all three indexes must exist after creation.
  const found = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes
    WHERE indexname IN ('uq_van_load_requisitions_tenant_doc_no', 'uq_van_field_returns_tenant_doc_no', 'uq_van_stock_transfers_tenant_transfer_no')
  `.execute(db);
  if (Number(found.rows[0]?.n ?? 0) !== INDEXES.length) {
    throw new Error('document-number unique backstop incomplete: not all three indexes exist after creation');
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const { name } of INDEXES) {
    await sql`DROP INDEX IF EXISTS ${sql.ref(name)}`.execute(db);
  }
}

export const migration = { up, down };
