import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000286: broker-expense capitalisation links
 * (INV-IMPORT-BROKER-CAPITALISATION).
 *
 * A liquidated broker expense is capitalised exactly once, through
 * exactly one path:
 *  - folded into a shipment cost bucket BEFORE the receipt posts
 *    (import_broker_capitalizations, state 'folded', consumed by
 *    the receipt posting into 'consumed'), or
 *  - spread by late-expense-style revaluation AFTER the receipt
 *    posts (state 'revalued', linked to the late-expense event
 *    that carries the spread), or
 *  - posted as a period expense / VAT asset (no link row; the
 *    expense row's capitalization_state records the treatment).
 * The UNIQUE (tenant_id, broker_expense_id) constraint makes a
 * second capitalisation of the same expense impossible at the
 * database level, on top of the service guards. broker_expense_id
 * on import_late_expense_events and late_expense_event_id /
 * capitalization_state / created_by on import_broker_expenses
 * carry the bidirectional link and the maker-checker identity.
 * The migration is additive only and touches no existing row:
 * legacy broker expenses keep is_verified as recorded and a
 * NULL created_by (they predate the verification identity).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS import_broker_capitalizations (
    id bigserial PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    broker_expense_id TEXT NOT NULL,
    shipment_id TEXT NOT NULL,
    cost_bucket TEXT,
    amount_egp NUMERIC(19, 4) NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('folded', 'consumed', 'revalued')),
    late_expense_event_id BIGINT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, broker_expense_id)
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS import_broker_capitalizations_shipment_idx
    ON import_broker_capitalizations (tenant_id, shipment_id, state)`.execute(db);
  await sql`ALTER TABLE import_late_expense_events
    ADD COLUMN IF NOT EXISTS broker_expense_id TEXT`.execute(db);
  await sql`ALTER TABLE import_broker_expenses
    ADD COLUMN IF NOT EXISTS late_expense_event_id BIGINT,
    ADD COLUMN IF NOT EXISTS capitalization_state TEXT CHECK (capitalization_state IN ('folded', 'consumed', 'revalued', 'expensed', 'vat_asset')),
    ADD COLUMN IF NOT EXISTS created_by BIGINT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_broker_expenses
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS capitalization_state,
    DROP COLUMN IF EXISTS late_expense_event_id`.execute(db);
  await sql`ALTER TABLE import_late_expense_events
    DROP COLUMN IF EXISTS broker_expense_id`.execute(db);
  await sql`DROP TABLE IF EXISTS import_broker_capitalizations`.execute(db);
}

export const migration = { up, down };
