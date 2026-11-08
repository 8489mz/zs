import { sql, type Kysely } from 'kysely';

/**
 * Marketplace webhook signature capture (INV-MARKETPLACE-OUTBOX-RELAY).
 *
 * Receipt stores the raw payload but never its signature material, so a
 * stored event could never be verified after the fact -- the relay
 * would have to trust the payload bytes it re-serialised, which are
 * not the bytes the gateway signed. These two nullable columns close
 * that gap: `signature` holds the `x-zs-webhook-signature` header value
 * as received, `raw_body` holds the exact request bytes (UTF-8 text).
 * The relay verifies HMAC-SHA256 over `raw_body` against the tenant's
 * per-marketplace `webhookSecret` (minimum 32 characters, configured
 * in the marketplace config JSON) before any handler runs.
 *
 * Numbered 0298, not 0297: batch U6 package R6 owns 0297
 * (unique document-number indexes, verified in the shared
 * batch-u567-state.md) and lands on the same base; sharing the number
 * would collide. Kysely sorts migrations alphabetically, so 0298 runs
 * after 0297 regardless of landing order.
 *
 * Follows the 0275 information_schema guard pattern: re-running is a
 * no-op. Rollback deliberately NEVER drops the columns: dropping them
 * would destroy the only signature evidence for already-stored events.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'marketplace_webhook_events'
      AND column_name IN ('signature', 'raw_body')
  `.execute(db);
  const existing = new Set(rows.map((row) => row.column_name));
  if (!existing.has('signature')) {
    await sql`ALTER TABLE "marketplace_webhook_events" ADD COLUMN "signature" TEXT NULL`.execute(db);
  }
  if (!existing.has('raw_body')) {
    await sql`ALTER TABLE "marketplace_webhook_events" ADD COLUMN "raw_body" TEXT NULL`.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy webhook signature evidence on rollback: the columns
  // and their values are kept, and stored events stay verifiable.
}

export const migration = { up, down };
