import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0306 — server-side uniqueness for the three import write paths
 * (IMPORT Batch I6-E; one root cause: no server-side uniqueness, so
 * a retry after a network drop or two concurrent submits could
 * double-record).
 *
 * (a) GRN: a partial unique index on import_qc_inspections
 * (tenant_id, shipment_id) WHERE stage = 'receiving' AND
 * shipment_id IS NOT NULL. The pre-check in createQcInspection
 * (IMPORT_GRN_ALREADY_RECORDED) is a read-then-write, so two
 * concurrent submits could both pass it and both insert; the
 * index is the second line of defence and the service maps its
 * 23505 to the same named error. Scoped to the receiving stage
 * so China pre-shipment QC (other stages) is unaffected, and to
 * non-NULL shipments so QC rows without a shipment are
 * unaffected. If legacy duplicate receiving rows exist, CREATE
 * UNIQUE INDEX fails loudly naming the index — the duplicates
 * must be deduped first, never silently dropped.
 *
 * (b) Container deposits: import_container_deposits gains
 * idempotency_key VARCHAR(128) NOT NULL + a unique index on
 * (tenant_id, idempotency_key). The natural key
 * (tenant_id, shipment_id, container_no) is already unique
 * (migration 0238), so a same-container retry already failed —
 * but with a raw 23505 and no record to return. The service
 * now stores an effective key (client-supplied idempotencyKey
 * when sent, else server-derived
 * 'deposit:<shipmentId>:<containerNo>') and replays the
 * existing row on a duplicate instead of double-recording.
 * Legacy rows are backfilled with 'legacy:<serial_id>' — a
 * stable unique value that marks them pre-idempotency; a retry
 * of a legacy deposit was never possible (the 0238 unique
 * constraint already blocks a second row for the same
 * container) so no legacy replay identity is lost.
 *
 * (c) Floating-goods preorders: import_container_preorders
 * gains the same idempotency_key column + unique index. Unlike
 * deposits there is NO natural unique constraint here —
 * preorder_no is a fresh randomUUID per row — so a retry after
 * a network drop inserted a second reservation, consumed B/L
 * capacity twice and posted a second advance JE. The effective
 * key is the client-supplied idempotencyKey when sent, else
 * server-derived from the reservation identity
 * 'preorder:<shipmentId>:<customerId>:<productId>:<qty>:
 * <unitPrice>:<deposit>'. Legacy rows are backfilled with
 * 'legacy:<serial_id>' for the same reason as deposits.
 * Known limit, recorded in the service: two intentionally
 * identical reservations with no client key are
 * indistinguishable from a retry and the second returns the
 * first; sending a client key (a future frontend change — this
 * package only declares the optional DTO field) removes the
 * ambiguity.
 *
 * Up is idempotent (IF NOT EXISTS / re-runnable backfill +
 * SET NOT NULL is a no-op once applied); down drops the index
 * and the two columns.
 */
export async function up(db: any): Promise<void> {
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_import_qc_inspections_receiving_per_shipment
      ON import_qc_inspections (tenant_id, shipment_id)
      WHERE stage = 'receiving' AND shipment_id IS NOT NULL
  `.execute(db);

  await sql`ALTER TABLE "import_container_deposits" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128)`.execute(db);
  await sql`UPDATE "import_container_deposits" SET "idempotency_key" = 'legacy:' || serial_id::text WHERE "idempotency_key" IS NULL`.execute(db);
  await sql`ALTER TABLE "import_container_deposits" ALTER COLUMN "idempotency_key" SET NOT NULL`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_import_container_deposits_tenant_idempotency
      ON import_container_deposits (tenant_id, idempotency_key)
  `.execute(db);

  await sql`ALTER TABLE "import_container_preorders" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128)`.execute(db);
  await sql`UPDATE "import_container_preorders" SET "idempotency_key" = 'legacy:' || serial_id::text WHERE "idempotency_key" IS NULL`.execute(db);
  await sql`ALTER TABLE "import_container_preorders" ALTER COLUMN "idempotency_key" SET NOT NULL`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_import_container_preorders_tenant_idempotency
      ON import_container_preorders (tenant_id, idempotency_key)
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_import_qc_inspections_receiving_per_shipment`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_import_container_deposits_tenant_idempotency`.execute(db);
  await sql`ALTER TABLE "import_container_deposits" DROP COLUMN IF EXISTS "idempotency_key"`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_import_container_preorders_tenant_idempotency`.execute(db);
  await sql`ALTER TABLE "import_container_preorders" DROP COLUMN IF EXISTS "idempotency_key"`.execute(db);
}

export const migration: Migration = { up, down };
