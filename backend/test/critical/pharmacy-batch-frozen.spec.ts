/*
New file: backend/test/critical/pharmacy-batch-frozen.spec.ts
Pins the batch identity freeze (INV-PHARMACY-BATCH-FROZEN).

THE GAP: upsertBatch already froze batch quantities, costs and
links (a 409 when they change outside a purchase/GRN document),
but expiry_date and status were written with no validation at
all. An expired batch could be re-admitted to saleable stock by
moving its expiry forward or flipping its status back to
'active', and a malformed expiry string compared
lexicographically greater than today, so the FEFO sale gate
treated it as valid. Batch identity -- what the batch IS and
when it expires -- was freely editable metadata.

THE RULE: expiry must be a real calendar date (YYYY-MM-DD) or a
real month (YYYY-MM, the form the acceptance suite already
uses) at creation; a batch created already expired cannot be
created 'active'. After creation the expiry is frozen outright:
any change is rejected. Status comes from a closed list
(active/expired/depleted), and 'expired' is terminal: an
expired batch, or a batch whose expiry has passed, can never
be flipped back to 'active' through this endpoint. Updates
that touch nothing but notes, or that repeat the stored
expiry/status, are not blocked.

WHAT THIS PINS, driving the REAL upsertBatch on PGlite:
- malformed expiries ('garbage', month 13, day 40, a slashed
  date, an empty string) are rejected with
  PHARMACY_BATCH_EXPIRY_INVALID and no row is created.
- the YYYY-MM form and a future YYYY-MM-DD are accepted.
- a past expiry created 'active' is rejected; the same past
  expiry created 'expired' is accepted.
- moving an expiry forward on an existing batch is rejected
  with PHARMACY_BATCH_EXPIRY_FROZEN and the row is unchanged;
  repeating the stored expiry, or omitting it, still allows a
  notes update.
- flipping 'expired' back to 'active' is rejected with
  PHARMACY_BATCH_REACTIVATION_FORBIDDEN; flipping
  'active' to 'expired' succeeds; an unknown status is
  rejected with PHARMACY_BATCH_STATUS_INVALID.
- a batch whose expiry passed cannot be flipped INTO 'active'
  from another status, but a notes-only update on it is still
  allowed (no over-blocking by the passage of time).
- a row carrying a legacy status outside the list keeps its
  status through a notes-only update.
- the pre-existing financial freeze is untouched: changing
  quantity through upsertBatch still fails with
  PHARMACY_BATCH_FINANCIAL_EDIT_FORBIDDEN.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function batchCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM pharmacy_batches`.execute(db);
  return Number(row.rows[0].n);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const service = new PharmacyService(
    db as never,
    new AuditService(db as never),
    {} as never,
    foundation,
    new AccountingPostingService(foundation),
  );

  try {
    await pg.exec(`
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    `);

    // Case 1: malformed expiries are rejected at creation.
    for (const bad of ['garbage', '2027-13-01', '2027-02-30', '05/01/2027', '', '2027-1-5']) {
      await assert.rejects(
        service.upsertBatch(AUTH, { batchNumber: 'BAD', expiryDate: bad } as never),
        /PHARMACY_BATCH_EXPIRY_INVALID/,
      );
    }
    assert.equal(await batchCount(db), 0);

    // Case 2: the YYYY-MM form and a future date are accepted.
    const monthBatch = await service.upsertBatch(AUTH, { batchNumber: 'MONTH', expiryDate: '2030-12' } as never) as any;
    assert.equal(monthBatch.batch_number, 'MONTH');
    assert.equal(monthBatch.expiry_date, '2030-12');
    const dateBatch = await service.upsertBatch(AUTH, { batchNumber: 'DATE', expiryDate: '2030-12-15' } as never) as any;
    assert.equal(dateBatch.expiry_date, '2030-12-15');

    // Case 3: a past expiry cannot be created 'active', but can be 'expired'.
    await assert.rejects(
      service.upsertBatch(AUTH, { batchNumber: 'PAST-ACTIVE', expiryDate: '2020-01-01' } as never),
      /PHARMACY_BATCH_EXPIRY_INVALID/,
    );
    await assert.rejects(
      service.upsertBatch(AUTH, { batchNumber: 'PAST-ACTIVE-MONTH', expiryDate: '2020-01', status: 'active' } as never),
      /PHARMACY_BATCH_EXPIRY_INVALID/,
    );
    const pastExpired = await service.upsertBatch(AUTH, { batchNumber: 'PAST-EXPIRED', expiryDate: '2020-01-01', status: 'expired' } as never) as any;
    assert.equal(pastExpired.status, 'expired');

    // Case 4: expiry is frozen after creation.
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', expiryDate: '2031-01-01' } as never),
      /PHARMACY_BATCH_EXPIRY_FROZEN/,
    );
    const unchanged = await sql<{ expiry_date: string }>`SELECT expiry_date FROM pharmacy_batches WHERE id = ${Number(dateBatch.id)}`.execute(db);
    assert.equal(unchanged.rows[0].expiry_date, '2030-12-15');
    const sameExpiry = await service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', expiryDate: '2030-12-15', notes: 'same date ok' } as never) as any;
    assert.equal(sameExpiry.notes, 'same date ok');
    const omittedExpiry = await service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', notes: 'no date ok' } as never) as any;
    assert.equal(omittedExpiry.notes, 'no date ok');
    assert.equal(omittedExpiry.expiry_date, '2030-12-15');

    // Case 5: status list and the terminal 'expired' state.
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(pastExpired.id), batchNumber: 'PAST-EXPIRED', status: 'active' } as never),
      /PHARMACY_BATCH_REACTIVATION_FORBIDDEN/,
    );
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', status: 'bogus' } as never),
      /PHARMACY_BATCH_STATUS_INVALID/,
    );
    const toExpired = await service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', status: 'expired' } as never) as any;
    assert.equal(toExpired.status, 'expired');
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(dateBatch.id), batchNumber: 'DATE', status: 'active' } as never),
      /PHARMACY_BATCH_REACTIVATION_FORBIDDEN/,
    );

    // Case 6: expiry passed while 'active' -- flipping INTO 'active'
    // from another status is rejected, but a notes-only update (or
    // repeating the stored status) is not blocked by time passing.
    const staleActive = await service.upsertBatch(AUTH, { batchNumber: 'STALE', expiryDate: '2030-06-01' } as never) as any;
    await sql`UPDATE pharmacy_batches SET expiry_date = '2020-06-01', status = 'depleted' WHERE id = ${Number(staleActive.id)}`.execute(db);
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(staleActive.id), batchNumber: 'STALE', status: 'active' } as never),
      /PHARMACY_BATCH_REACTIVATION_FORBIDDEN/,
    );
    const notesOnly = await service.upsertBatch(AUTH, { id: Number(staleActive.id), batchNumber: 'STALE', notes: 'still editable' } as never) as any;
    assert.equal(notesOnly.notes, 'still editable');

    // Case 7: a legacy status outside the list survives a notes-only update.
    const legacy = await service.upsertBatch(AUTH, { batchNumber: 'LEGACY', expiryDate: '2030-06-01' } as never) as any;
    await sql`UPDATE pharmacy_batches SET status = 'quarantined' WHERE id = ${Number(legacy.id)}`.execute(db);
    const legacyKept = await service.upsertBatch(AUTH, { id: Number(legacy.id), batchNumber: 'LEGACY', notes: 'kept' } as never) as any;
    assert.equal(legacyKept.status, 'quarantined');

    // Case 8: the pre-existing financial freeze is untouched.
    await assert.rejects(
      service.upsertBatch(AUTH, { id: Number(monthBatch.id), batchNumber: 'MONTH', quantity: 5 } as never),
      /PHARMACY_BATCH_FINANCIAL_EDIT_FORBIDDEN/,
    );

    console.log('pharmacy batch frozen checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
