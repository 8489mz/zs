import type { Migration } from 'kysely';

/*
 * INV-VAN-OFFLINE-TIMESTAMPS: receipt instants for the van's offline
 * legs. A sale made offline keeps its original instant as created_at
 * (set by the service, never the column default) and carries the
 * server receipt instant as received_at. The same pair belongs on
 * the collection and the field-return rows.
 *
 * CORRECTION to the brief (verified at the P1 base): the brief named
 * return_documents for the return leg, but return_documents is the
 * SHOP returns module (returns.service.ts) — the van field return
 * never touches it; it lives only in van_field_returns. The column
 * goes on van_field_returns instead. sales.received_at already
 * exists (migration 0325) and is not re-added here.
 *
 * Prospective only (migration 0325's doctrine): no backfill — a
 * receipt instant the server never recorded must stay NULL on
 * historical rows, never be invented.
 */
export const migration: Migration = {
  async up(db) {
    await db.schema.alterTable('customer_payments').addColumn('received_at', 'timestamptz').execute();
    await db.schema.alterTable('van_field_returns').addColumn('received_at', 'timestamptz').execute();
    await db.schema.alterTable('sales').addColumn('gps_missing_reason', 'text').execute();
  },
  async down(db) {
    await db.schema.alterTable('sales').dropColumn('gps_missing_reason').execute();
    await db.schema.alterTable('van_field_returns').dropColumn('received_at').execute();
    await db.schema.alterTable('customer_payments').dropColumn('received_at').execute();
  },
};
