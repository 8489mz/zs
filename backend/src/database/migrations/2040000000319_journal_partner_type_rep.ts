import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0319 — allow 'rep' as a journal line partner (INV-REP-CUSTODY-LEDGER, M12/C8).
 *
 * GROUNDING: the custody reclassification (postDeliveryCustodyReclassification)
 * posts the courier custody debit on 1130 with partner_type 'none', so every
 * rep's custody mixes into one aggregate 'none' balance and no per-rep GL
 * balance exists to reconcile against. The DB gate is the enumerated CHECK
 * on journal_entry_lines (foundation migration, extended to 'employee' by
 * 0110 in the same DROP + ADD shape used here): it allows only
 * ('none','customer','supplier','employee') — no FK constrains partner
 * values, and partner identity is validated in code (insertPostedJournal).
 * syncPostedPartnerLedger throws for a non-customer/supplier partner on a
 * control account, but it runs only for its 12 listed source types, and
 * the custody / settle / return source types are not among them, so no
 * sync exemption is needed for the new value.
 *
 * WHAT THIS DOES: extends the CHECK to include 'rep'. The partner id of a
 * 'rep' leg is a delivery_representatives.id (validated tenant-scoped in
 * insertPostedJournal, same pattern as customer/supplier/employee).
 * Prospective only: no existing row carries 'rep' yet, so no backfill —
 * pre-M12 custody stays on its 'none' legs and the settle/return legs
 * mirror the reclassification partner (deliveryCustodyPartner), so a
 * transitional order clears exactly where its debit sits.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE journal_entry_lines
      DROP CONSTRAINT IF EXISTS journal_entry_lines_partner_type_chk;
  `.execute(db);

  await sql`
    ALTER TABLE journal_entry_lines
      ADD CONSTRAINT journal_entry_lines_partner_type_chk
      CHECK (partner_type IN ('none', 'customer', 'supplier', 'employee', 'rep'));
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  // Collapse any rep partners back to 'none' so the narrower constraint can be restored (0110 precedent).
  await sql`
    UPDATE journal_entry_lines
    SET partner_type = 'none', partner_id = NULL
    WHERE partner_type = 'rep';
  `.execute(db);

  await sql`
    ALTER TABLE journal_entry_lines
      DROP CONSTRAINT IF EXISTS journal_entry_lines_partner_type_chk;
  `.execute(db);

  await sql`
    ALTER TABLE journal_entry_lines
      ADD CONSTRAINT journal_entry_lines_partner_type_chk
      CHECK (partner_type IN ('none', 'customer', 'supplier', 'employee'));
  `.execute(db);
}

export const migration: Migration = { up, down };
