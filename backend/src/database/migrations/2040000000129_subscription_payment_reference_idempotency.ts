import { sql, type Kysely } from 'kysely';

// Item 3 (SaaS platform review). `applySubscriptionPayment` grants a billing period and
// records a row in `tenant_subscription_payments`, keyed by the gateway's own
// transaction reference. Until now nothing checked whether that reference had already
// been applied, and `reference` was a plain varchar with no index:
//
//   - every gateway retries a webhook it did not get a 2xx for;
//   - XPay and Paymob sign a plain HMAC over the body with no nonce or timestamp, so a
//     captured valid (body, signature) pair stays valid forever;
//   - so each replay appended another `durationMonths` onto the tenant's ends_at.
//
// The service now checks for an existing payment with the same (tenant_id, reference)
// inside the same transaction that grants the period, under a lock on the tenant row.
// This index is what makes that check an index lookup rather than a scan.
//
// Deliberately NOT a UNIQUE index: existing deployments may already hold duplicate
// references created by the very bug this fixes, and dropping or merging real payment
// rows is not a decision a migration should take on its own. The duplicates are listed
// in the log below so an operator can reconcile them, and the code-level gate is what
// stops new ones. Promoting this to UNIQUE is tracked as an open item.
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    const exists = await sql<{ exists: boolean }>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'tenant_subscription_payments'
      ) as exists
    `.execute(db);

    if (!exists.rows[0]?.exists) return;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_tenant_subscription_payments_tenant_reference
      ON tenant_subscription_payments (tenant_id, reference)
    `.execute(db);

    const duplicates = await sql<{ tenant_id: string; reference: string; hits: string }>`
      SELECT tenant_id, reference, COUNT(*)::text AS hits
      FROM tenant_subscription_payments
      WHERE reference IS NOT NULL AND reference <> ''
      GROUP BY tenant_id, reference
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `.execute(db);

    if (duplicates.rows.length > 0) {
      const summary = duplicates.rows.map((row) => `${row.tenant_id}/${row.reference} x${row.hits}`).join(', ');
      // Loud on purpose: these are subscription periods that were granted more than once.
      console.warn(
        `[migration 129] tenant_subscription_payments holds duplicate gateway references that predate the idempotency gate and need manual reconciliation: ${summary}`,
      );
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_tenant_subscription_payments_tenant_reference`.execute(db);
  },
};
