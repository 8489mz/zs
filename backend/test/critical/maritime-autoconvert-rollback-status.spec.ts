/*
New file: backend/test/critical/maritime-autoconvert-rollback-status.spec.ts
Pins INV-MARITIME-AUTOCONVERT-ROLLBACK-STATUS.

THE GAP: autoConvertQuotationToJob flipped the quotation to
'converted_to_job', and when the job creation failed its catch block
unconditionally restored status 'approved' -- even when the quote had
been 'sent', 'draft' or 'rejected'. A failed conversion rewrote the
quote's history and silently approved work nobody approved.

THE RULE: the catch block restores exactly the status captured before
the flip. The flip itself stays the single atomic predicate UPDATE it
always was, so a concurrent conversion still loses the race and
reports already-converted without restoring anything it did not flip.

WHAT THIS PINS, driving the REAL autoConvertQuotationToJob on PGlite
(the job creation is forced to fail before any write by an air quote
carrying an invalid MAWB number, which createJob rejects at its first
validation):
- a failed conversion of a 'sent' quote leaves it 'sent';
- a failed conversion of a 'rejected' quote leaves it 'rejected'
  (never 'approved');
- the original failure still propagates to the caller;
- no job row is created by the failed conversions;
- an already-converted quote still reports already-converted, and a
  missing quote still reports not-found.

NOT COVERED HERE: the success path (createJob writes a job) is
unchanged code -- the fix only touches the failure catch -- and is
left to the live-Postgres rehearsal R3.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  try {
    await pg.exec(`
      CREATE TABLE maritime_quotations (id bigint PRIMARY KEY, tenant_id text, status text, rfq_id bigint, bid_id bigint, inquiry_id bigint, customer_id bigint, customer_name text, transport_mode text, air_cargo_type text, gross_weight_kg numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric, total_cbm numeric, package_count int, flight_number text, flight_date date, mawb_number text, hawb_number text, payment_term text, quotation_number text, updated_at timestamptz);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text);
      INSERT INTO maritime_quotations (id, tenant_id, status, rfq_id, bid_id, inquiry_id, customer_id, customer_name, transport_mode, mawb_number, quotation_number) VALUES
        (1,'t1','sent',NULL,NULL,NULL,NULL,'Customer','air','BAD','Q-1'),
        (2,'t1','rejected',NULL,NULL,NULL,NULL,'Customer','air','BAD','Q-2'),
        (3,'t1','converted_to_job',NULL,NULL,NULL,NULL,'Customer','air','BAD','Q-3');
    `);

    const statusOf = async (id: number): Promise<string> => {
      const row = await db.selectFrom('maritime_quotations' as any).select('status').where('id', '=', id).executeTakeFirstOrThrow();
      return String((row as any).status);
    };
    const jobCount = async (): Promise<number> => {
      const rows = await db.selectFrom('maritime_jobs' as any).selectAll().execute();
      return rows.length;
    };

    // 1. Failed conversion of a 'sent' quote restores 'sent', error propagates.
    await assert.rejects(service.autoConvertQuotationToJob(auth, '1'));
    assert.equal(await statusOf(1), 'sent');
    assert.equal(await jobCount(), 0);

    // 2. Failed conversion of a 'rejected' quote restores 'rejected', never 'approved'.
    await assert.rejects(service.autoConvertQuotationToJob(auth, '2'));
    assert.equal(await statusOf(2), 'rejected');
    assert.equal(await jobCount(), 0);

    // 3. Already-converted quote still reports already-converted.
    await assert.rejects(service.autoConvertQuotationToJob(auth, '3'), /بالفعل/);
    assert.equal(await statusOf(3), 'converted_to_job');

    // 4. Missing quote still reports not-found.
    await assert.rejects(service.autoConvertQuotationToJob(auth, '999'), /not found/i);

    console.log('maritime autoconvert rollback status checks passed');
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
