/*
 * Portal rejected-quote guard (INV-MARITIME-PORTAL-REJECTED-QUOTE-GUARD).
 *
 * THE GAP: MaritimeCustomerPortalService.approveQuotation
 * returned early only for converted/approved quotes, then set
 * ANY other status -- including 'rejected' -- to 'approved'
 * and auto-converted it to a job. A staff rejection could be
 * undone from the customer portal, silently, with no staff
 * review.
 *
 * THE RULE: the portal cannot approve a staff-rejected quote.
 * There is no rejected_by column, so 'rejected' is the only
 * signal -- and it covers a customer who rejected via the
 * portal and changed their mind too: a rejected quote is a
 * closed financial commitment either way, and only staff
 * re-opening it (re-send / status change) can make it
 * approvable again. The guard throws before any status write
 * or auto-conversion attempt, so the quote stays rejected
 * byte for byte.
 *
 * WHAT THIS PINS, driving the REAL approveQuotation on PGlite
 * (real AuditService, stubbed freight service recording
 * conversion attempts):
 * - a rejected quote rejects with QUOTATION_REJECTED_CANNOT_APPROVE
 *   (403), keeps status 'rejected', keeps its approval columns
 *   empty, and triggers no conversion;
 * - a 'sent' quote and a 'draft' quote still approve and
 *   convert (existing behaviour, unchanged);
 * - already approved / converted quotes still take the early
 *   return with no conversion attempt;
 * - a missing quote, or one belonging to another customer,
 *   still throws NotFoundException;
 * - source pin: no rejected_by signal exists anywhere in the
 *   portal service, so the status check is the only guard
 *   available -- and it is present.
 *
 * HONEST LIMIT: autoConvertQuotationToJob itself still converts
 * any non-converted status when called directly (staff flows);
 * this package guards the portal approval path only, as
 * decided. Whether direct conversion of rejected quotes
 * should also refuse is a separate, undecided question.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeCustomerPortalService } from '../../src/modules/maritime-freight/maritime-customer-portal.service';
import { AuditService } from '../../src/core/audit/audit.service';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  let convertCalls = 0;
  const freightStub = {
    autoConvertQuotationToJob: async () => {
      convertCalls++;
      return { id: 77, job_number: 'JOB-77' };
    },
  };
  const service = new MaritimeCustomerPortalService(db, new AuditService(db as never), freightStub as never);
  const portalAuth = { customerId: 5, tenantId: 't1', accountId: 'a1', name: 'Acme', phone: '555' } as never;

  async function quoteRow(id: number): Promise<any> {
    return (db as any).selectFrom('maritime_quotations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  try {
    await pg.exec(`
      CREATE TABLE maritime_quotations (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, status text, converted_job_id bigint, customer_approved_at timestamptz, customer_approval_notes text, customer_approval_reference text, customer_approval_ip text, updated_at timestamptz);
      INSERT INTO maritime_quotations VALUES
        (1,'t1',5,'rejected',NULL,NULL,NULL,NULL,NULL,NULL),
        (2,'t1',5,'sent',NULL,NULL,NULL,NULL,NULL,NULL),
        (3,'t1',5,'draft',NULL,NULL,NULL,NULL,NULL,NULL),
        (4,'t1',5,'approved',NULL,NULL,NULL,NULL,NULL,NULL),
        (5,'t1',5,'converted_to_job',42,NULL,NULL,NULL,NULL,NULL),
        (6,'t1',9,'sent',NULL,NULL,NULL,NULL,NULL,NULL);
    `);

    // 1. Rejected: guard throws, nothing changes, no conversion.
    await assert.rejects(
      service.approveQuotation(portalAuth, '1', {}),
      (err: any) => err && err.code === 'QUOTATION_REJECTED_CANNOT_APPROVE' && err.statusCode === 403,
    );
    const rejected = await quoteRow(1);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.customer_approved_at, null);
    assert.equal(rejected.customer_approval_notes, null);
    assert.equal(convertCalls, 0);

    // 2. Sent: approves and converts.
    const sent: any = await service.approveQuotation(portalAuth, '2', { approvalNotes: 'ok' });
    assert.equal(sent.status, 'approved');
    assert.equal(sent.jobId, 77);
    assert.equal((await quoteRow(2)).status, 'approved');
    assert.equal(convertCalls, 1);

    // 3. Draft: still approvable (existing behaviour).
    const draft: any = await service.approveQuotation(portalAuth, '3', {});
    assert.equal(draft.status, 'approved');
    assert.equal(convertCalls, 2);

    // 4. Already approved / converted: early return, no conversion.
    const approved: any = await service.approveQuotation(portalAuth, '4', {});
    assert.equal(approved.status, 'approved');
    const converted: any = await service.approveQuotation(portalAuth, '5', {});
    assert.equal(converted.status, 'converted_to_job');
    assert.equal(converted.jobId, 42);
    assert.equal(convertCalls, 2);

    // 5. Missing / another customer's quote: not found.
    await assert.rejects(service.approveQuotation(portalAuth, '999', {}), /غير موجود/);
    await assert.rejects(service.approveQuotation(portalAuth, '6', {}), /غير موجود/);

    // 6. Source pin: no code reads a rejected_by field anywhere
    // in the portal service, so the status check is the only
    // guard available -- and it is present.
    const portalSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-customer-portal.service.ts'), 'utf8');
    assert.ok(!portalSource.includes('quote.rejected_by'), 'no code reads a rejected_by field');
    assert.ok(!portalSource.includes("'rejected_by'"), 'no query references a rejected_by column');
    const approveStart = portalSource.indexOf('async approveQuotation(');
    const rejectStart = portalSource.indexOf('async rejectQuotation(');
    const approveBody = portalSource.slice(approveStart, rejectStart);
    assert.ok(approveBody.includes("quote.status === 'rejected'"), 'the rejected guard must be in approveQuotation');
    assert.ok(approveBody.includes('QUOTATION_REJECTED_CANNOT_APPROVE'), 'the guard must carry its stable code');

    console.log('maritime portal rejected quote guard checks passed');
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
