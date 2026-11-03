import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000290: explicit payee per import cost component
 * (INV-IMPORT-SUPPLIER-ATTRIBUTION).
 *
 * Until this migration every cost component of a posted import
 * receipt (goods, freight, customs, transport, demurrage) was
 * credited to one payable line attributed to the goods supplier,
 * so the supplier subledger overstated the goods supplier and the
 * carrier / customs / transporter payees had no subledger record
 * at all. The columns below record, per shipment, the explicit
 * supplier each component is owed to, plus the recorded reason
 * when a component is genuinely unallocable and must post to the
 * tenant-designated clearing account instead. The late-expense
 * event records the same attribution for post-receipt expenses.
 *
 * The migration is additive only: every column is nullable and no
 * existing row is touched — shipments posted before it keep their
 * single-payee journals (prospective only, never rewritten), and
 * the new fail-closed payee checks apply to postings after it.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_shipments
    ADD COLUMN IF NOT EXISTS freight_supplier_id BIGINT,
    ADD COLUMN IF NOT EXISTS customs_supplier_id BIGINT,
    ADD COLUMN IF NOT EXISTS transport_supplier_id BIGINT,
    ADD COLUMN IF NOT EXISTS demurrage_supplier_id BIGINT,
    ADD COLUMN IF NOT EXISTS unallocable_cost_reason TEXT`.execute(db);
  await sql`ALTER TABLE import_late_expense_events
    ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
    ADD COLUMN IF NOT EXISTS unallocable_reason TEXT`.execute(db);
  await sql`ALTER TABLE accounting_settings
    ADD COLUMN IF NOT EXISTS clearing_account_id BIGINT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_shipments
    DROP COLUMN IF EXISTS freight_supplier_id,
    DROP COLUMN IF EXISTS customs_supplier_id,
    DROP COLUMN IF EXISTS transport_supplier_id,
    DROP COLUMN IF EXISTS demurrage_supplier_id,
    DROP COLUMN IF EXISTS unallocable_cost_reason`.execute(db);
  await sql`ALTER TABLE import_late_expense_events
    DROP COLUMN IF EXISTS supplier_id,
    DROP COLUMN IF EXISTS unallocable_reason`.execute(db);
  await sql`ALTER TABLE accounting_settings
    DROP COLUMN IF EXISTS clearing_account_id`.execute(db);
}

export const migration = { up, down };
