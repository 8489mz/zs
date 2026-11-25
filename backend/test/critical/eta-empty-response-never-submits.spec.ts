/*
New file: backend/test/critical/eta-empty-response-never-submits.spec.ts
Pins the ETA empty-response rule (INV-ETA-EMPTY-RESPONSE-NEVER-SUBMITS).

THE GAP: when ETA answered a submission with empty accepted and
rejected arrays, submitInvoices marked EVERY provided invoice
'submitted' — with a submission id invented locally
(`SUB-${Date.now()}`) when ETA returned none. Invoices ETA never
confirmed left the pending queue forever, with no ETA uuid and
no way to verify them. The status-check endpoint that could have
resolved the ambiguity was never reached, because the invoices
no longer looked pending.

THE RULE: only documents ETA names as accepted become
'submitted', only named rejections become 'failed'. A response
with neither array changes no status: every invoice stays
pending/failed for retry or verification via
checkSubmissionStatus. The submission id comes from ETA or is
null — never invented.

WHAT THIS PINS, driving the REAL submitInvoices on PGlite with
stubbed auth, serializer, settings, and fetch:
- accepted + unmentioned: the named invoice submits with its
  uuid; the unmentioned one stays pending.
- empty arrays + submission id: both stay pending, no
  submission id stamped, acceptedCount 0.
- wholly empty response: both stay pending, submissionId null.
- named rejection: failed, no submission stamp on the other.
- non-OK answer: still throws, nothing marked.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { EtaSubmissionService } from '../../src/modules/tax-integration/services/eta-submission/eta-submission.service';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const svc = new EtaSubmissionService(
    db as never,
    { getAccessToken: async () => 'token-1' } as never,
    { serializeSaleToEtaFormat: async () => ({}) } as never,
    {
      getSettings: async () => ({ client_id: 'cid', client_secret: 'sec', is_active: true, environment: 'sandbox' }),
    } as never,
  );

  let payload: unknown = null;
  let ok = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok,
    statusText: ok ? 'OK' : 'Bad Gateway',
    json: async () => payload,
  })) as unknown as typeof fetch;

  try {
    await pg.exec(`
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text,
        eta_status text, eta_uuid text, eta_submission_id text);
      INSERT INTO sales VALUES
        (7,'t1','INV-7','pending',NULL,NULL),
        (8,'t1','INV-8','pending',NULL,NULL);
    `);
    const statusOf = async (id: number) => {
      const rows = await pg.query<{ eta_status: string; eta_uuid: string | null; eta_submission_id: string | null }>(
        `SELECT eta_status, eta_uuid, eta_submission_id FROM sales WHERE id = $1`,
        [id],
      );
      return rows.rows[0];
    };

    // 1. Named acceptance only: INV-7 submits, INV-8 stays pending.
    payload = {
      submissionId: 'SUB-1',
      acceptedDocuments: [{ internalId: 'INV-7', uuid: 'uuid-1' }],
      rejectedDocuments: [],
    };
    const r1 = await svc.submitInvoices('t1', ['7', '8']);
    assert.equal(r1.acceptedCount, 1);
    assert.equal(r1.submissionId, 'SUB-1');
    assert.equal((await statusOf(7)).eta_status, 'submitted');
    assert.equal((await statusOf(7)).eta_uuid, 'uuid-1');
    assert.equal((await statusOf(8)).eta_status, 'pending');

    // Reset INV-7 to pending for the empty-response drives.
    await pg.exec(`UPDATE sales SET eta_status='pending', eta_uuid=NULL, eta_submission_id=NULL WHERE id=7`);

    // 2. Empty arrays + submission id: nothing changes.
    payload = { submissionId: 'SUB-2', acceptedDocuments: [], rejectedDocuments: [] };
    const r2 = await svc.submitInvoices('t1', ['7', '8']);
    assert.equal(r2.acceptedCount, 0);
    assert.equal(r2.submissionId, 'SUB-2');
    assert.equal((r2 as any).unverifiedCount, 2);
    assert.equal((await statusOf(7)).eta_status, 'pending');
    assert.equal((await statusOf(7)).eta_submission_id, null);
    assert.equal((await statusOf(8)).eta_status, 'pending');

    // 3. Wholly empty response: nothing changes, no invented id.
    payload = {};
    const r3 = await svc.submitInvoices('t1', ['7', '8']);
    assert.equal(r3.submissionId, null);
    assert.equal((await statusOf(7)).eta_status, 'pending');
    assert.equal((await statusOf(8)).eta_status, 'pending');

    // 4. Named rejection: INV-8 fails, INV-7 untouched.
    payload = {
      submissionId: 'SUB-3',
      acceptedDocuments: [],
      rejectedDocuments: [{ internalId: 'INV-8', error: 'bad vat' }],
    };
    const r4 = await svc.submitInvoices('t1', ['7', '8']);
    assert.equal(r4.rejectedCount, 1);
    assert.equal((await statusOf(8)).eta_status, 'failed');
    assert.equal((await statusOf(7)).eta_status, 'pending');

    // 5. Non-OK answer: throws, nothing marked.
    ok = false;
    await pg.exec(`UPDATE sales SET eta_status='pending' WHERE id=8`);
    await assert.rejects(svc.submitInvoices('t1', ['7', '8']), /فشل تقديم الفواتير/);
    assert.equal((await statusOf(7)).eta_status, 'pending');
    assert.equal((await statusOf(8)).eta_status, 'pending');

    console.log('ETA empty response never submits tests passed.');
  } finally {
    globalThis.fetch = realFetch;
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
