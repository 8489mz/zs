import { sql, type Kysely } from 'kysely';

// PERF-3 (ARCHITECTURE_INVARIANTS.md §2.6). Hot-path index audit, September 2026.
//
// The audit listed every table that has `tenant_id` but no index leading with it, then kept only the
// ones a hot, tenant-scoped read actually hits. Every other query here was already covered — this is
// deliberately a short list: each index is paid for on every INSERT/UPDATE of its table.
//
//   held_sales            POS "held invoices" list: WHERE tenant_id = ? ORDER BY created_at DESC
//   purchase_items        last-cost / margin-protection / landed-cost lookups by product
//   treasury_transactions reports summary + treasury report: WHERE tenant_id = ? AND created_at BETWEEN
//                         (the existing composite leads with branch/location, useless without them)
//   supplier_payments     supplier statement + payments list per tenant
//   stock_transfers       transfers list per tenant, newest first
//   tenant_subscriptions  subscription check at login / SaaS admin (no index at all before)
//
// It also drops five exact, NON-unique duplicates (same table, same columns, same predicate). They
// bought nothing for reads and doubled index maintenance on journal_entry_lines/journal_entries — rows
// written by every posted sale. Unique indexes and primary keys are never dropped here.
//
// Plain CREATE INDEX (not CONCURRENTLY): migrations run inside a transaction, and the same file runs
// on the desktop build's local Postgres. IF NOT EXISTS keeps it idempotent on both.
const CREATED_INDEXES: Array<{ name: string; ddl: string }> = [
  { name: 'idx_held_sales_tenant_created', ddl: 'held_sales (tenant_id, created_at DESC)' },
  { name: 'idx_purchase_items_tenant_product', ddl: 'purchase_items (tenant_id, product_id)' },
  { name: 'idx_treasury_tenant_created', ddl: 'treasury_transactions (tenant_id, created_at DESC)' },
  { name: 'idx_supplier_payments_tenant_supplier', ddl: 'supplier_payments (tenant_id, supplier_id)' },
  { name: 'idx_supplier_payments_tenant_date', ddl: 'supplier_payments (tenant_id, payment_date DESC)' },
  { name: 'idx_stock_transfers_tenant_created', ddl: 'stock_transfers (tenant_id, created_at DESC)' },
  { name: 'idx_tenant_subscriptions_tenant', ddl: 'tenant_subscriptions (tenant_id)' },
];

// [duplicate dropped, surviving twin, definition used by `down` to restore it]
const DUPLICATE_INDEXES: Array<{ drop: string; keep: string; ddl: string }> = [
  {
    drop: 'idx_journal_tenant_source',
    keep: 'idx_journal_entries_tenant_source',
    ddl: 'journal_entries (tenant_id, source_type, source_id)',
  },
  {
    drop: 'idx_journal_lines_tenant_entry',
    keep: 'idx_journal_entry_lines_tenant_entry',
    ddl: 'journal_entry_lines (tenant_id, journal_entry_id)',
  },
  {
    drop: 'idx_treasury_hr_reference',
    keep: 'idx_treasury_service_reference',
    ddl: 'treasury_transactions (reference_type, reference_id)',
  },
  {
    drop: 'idx_mfg_wo_cons_wo',
    keep: 'idx_mfg_wo_consumptions_wo_id',
    ddl: 'manufacturing_wo_consumptions (work_order_id)',
  },
  {
    drop: 'idx_contracting_tasks_proj_dates',
    keep: 'idx_contracting_schedule_tasks_dates',
    ddl: 'contracting_schedule_tasks (tenant_id, project_id, start_date, end_date)',
  },
];

async function indexExists(db: Kysely<unknown>, name: string): Promise<boolean> {
  const result = await sql<{ found: number }>`
    SELECT 1 AS found FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ${name}
  `.execute(db);
  return result.rows.length > 0;
}

async function tableExists(db: Kysely<unknown>, table: string): Promise<boolean> {
  const result = await sql<{ reg: string | null }>`SELECT to_regclass(${table})::text AS reg`.execute(db);
  return Boolean(result.rows[0]?.reg);
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    for (const index of CREATED_INDEXES) {
      const table = index.ddl.split(' ')[0];
      if (!(await tableExists(db, table))) continue;
      await sql.raw(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.ddl}`).execute(db);
    }

    // Only drop a duplicate when its twin is really there — never leave a query without its index.
    for (const dup of DUPLICATE_INDEXES) {
      if (!(await indexExists(db, dup.drop)) || !(await indexExists(db, dup.keep))) continue;
      await sql.raw(`DROP INDEX IF EXISTS ${dup.drop}`).execute(db);
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    for (const index of CREATED_INDEXES) {
      await sql.raw(`DROP INDEX IF EXISTS ${index.name}`).execute(db);
    }
    for (const dup of DUPLICATE_INDEXES) {
      const table = dup.ddl.split(' ')[0];
      if (!(await tableExists(db, table))) continue;
      await sql.raw(`CREATE INDEX IF NOT EXISTS ${dup.drop} ON ${dup.ddl}`).execute(db);
    }
  },
};
