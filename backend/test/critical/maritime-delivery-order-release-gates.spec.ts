/*
 * Delivery-order release gates (INV-MARITIME-DELIVERY-ORDER-RELEASE-GATES).
 *
 * THE GAP: releaseDeliveryOrder released the delivery order with
 * no check at all -- an unpaid job and a job with no cleared
 * customs declaration both released exactly like a clean one,
 * and nothing recorded either gap.
 *
 * THE RULE, two tiers (spirit of the law): PAYMENT is a strict
 * precondition -- when the job has been invoiced, the client
 * must have paid within the same 0.01 full-payment band settle
 * uses, or the release is rejected before any milestone is
 * written; an uninvoiced job has nothing due and releases
 * freely. DOCUMENTS only warn -- a sea job with no cleared
 * customs declaration, or a caller-flagged incomplete set on
 * any mode, still releases, but the warning and its reason are
 * recorded in the milestone notes and returned, so the gap is
 * visible instead of silently waived. A caller flag can never
 * mark documents complete: the customs check is derived from
 * the stored declarations. Air/road keep their existing
 * milestone checks.
 *
 * WHAT THIS PINS, driving the REAL releaseDeliveryOrder on
 * PGlite (WhatsApp stubbed, no phone seeded so the notify path
 * is skipped):
 * - unpaid + invoiced rejects with no milestone and no release;
 * - paid + no cleared declaration releases with the customs
 *   warning recorded in the milestone notes;
 * - paid + cleared declaration releases clean, no warning;
 * - paid + cleared + staff-flagged incomplete releases with the
 *   staff reason recorded;
 * - paid + no clearance + caller claiming complete still warns
 *   (the flag cannot bypass the stored-declaration check);
 * - an uninvoiced job releases (nothing due);
 * - the payment gate also rejects an unpaid AIR job, before
 *   any milestone-sequence check runs;
 * - the controller passes the optional body through to the
 *   service (source pin).
 *
 * HONEST LIMIT: the milestone WhatsApp notify path is not
 * driven (no phone seeded); the frontend release button sends
 * no body today, so staff flagging arrives only when the UI
 * passes documentsComplete/documentReason.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  async function milestoneCount(jobId: number): Promise<number> {
    const rows = await (db as any).selectFrom('maritime_job_milestones').select('id').where('job_id', '=', jobId).execute();
    return rows.length;
  }

  async function milestoneNotes(jobId: number): Promise<string | null> {
    const row = await (db as any).selectFrom('maritime_job_milestones').select('notes').where('job_id', '=', jobId).executeTakeFirst();
    return row ? String(row.notes) : null;
  }

  async function released(jobId: number): Promise<boolean> {
    const row = await (db as any).selectFrom('maritime_jobs').select('delivery_order_released').where('id', '=', jobId).executeTakeFirstOrThrow();
    return Boolean(row.delivery_order_released);
  }

  try {
    await pg.exec(`
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, transport_mode text, milestone_status text, status text, customer_id bigint, client_invoiced_total numeric, client_paid_total numeric, delivery_order_released boolean DEFAULT false, delivery_order_released_at timestamptz, updated_at timestamptz);
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, gated_out_at timestamptz, updated_at timestamptz);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, milestone_key text, milestone_title text, location text, notes text, recorded_by bigint, occurred_at timestamptz DEFAULT NOW());
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_customs_declarations (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, status text);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric, phone text);
      INSERT INTO maritime_jobs VALUES
        (1,'t1','JOB-1','sea',NULL,'active',NULL,1000,500,false,NULL,NULL),
        (2,'t1','JOB-2','sea',NULL,'active',NULL,1000,1000,false,NULL,NULL),
        (3,'t1','JOB-3','sea',NULL,'active',NULL,1000,1000,false,NULL,NULL),
        (4,'t1','JOB-4','sea',NULL,'active',NULL,1000,1000,false,NULL,NULL),
        (5,'t1','JOB-5','sea',NULL,'active',NULL,1000,1000,false,NULL,NULL),
        (6,'t1','JOB-6','sea',NULL,'active',NULL,0,0,false,NULL,NULL),
        (7,'t1','JOB-7','air',NULL,'active',NULL,1000,0,false,NULL,NULL);
      INSERT INTO maritime_customs_declarations (tenant_id, job_id, status) VALUES ('t1',3,'cleared'),('t1',4,'cleared');
    `);

    // 1. Unpaid + invoiced: strict rejection, nothing written.
    await assert.rejects(
      service.releaseDeliveryOrder(auth, '1'),
      /اكتمال السداد/,
    );
    assert.equal(await milestoneCount(1), 0);
    assert.equal(await released(1), false);

    // 2. Paid + no cleared declaration: releases WITH the warning recorded.
    const res2: any = await service.releaseDeliveryOrder(auth, '2');
    assert.equal(res2.paymentVerified, true);
    assert.equal(res2.documentsWarning, 'لا يوجد بيان جمركي مُخَلَّص (cleared) لهذه الشحنة');
    assert.equal(await released(2), true);
    assert.equal(await milestoneCount(2), 1);
    assert.match((await milestoneNotes(2)) || '', /تنبيه مستندات: لا يوجد بيان جمركي مُخَلَّص/);

    // 3. Paid + cleared declaration: clean release, no warning.
    const res3: any = await service.releaseDeliveryOrder(auth, '3');
    assert.equal(res3.paymentVerified, true);
    assert.equal(res3.documentsWarning, null);
    assert.equal(await released(3), true);
    assert.ok(!((await milestoneNotes(3)) || '').includes('تنبيه مستندات'));

    // 4. Paid + cleared + staff-flagged incomplete with a reason:
    // releases, staff reason recorded.
    const res4: any = await service.releaseDeliveryOrder(auth, '4', {
      documentsComplete: false,
      documentReason: 'بوليصة الشحن الأصلية غير مستلمة',
    });
    assert.equal(res4.documentsWarning, 'بوليصة الشحن الأصلية غير مستلمة');
    assert.equal(await released(4), true);
    assert.match((await milestoneNotes(4)) || '', /تنبيه مستندات: بوليصة الشحن الأصلية غير مستلمة/);

    // 5. Caller claiming complete cannot bypass the stored check.
    const res5: any = await service.releaseDeliveryOrder(auth, '5', { documentsComplete: true });
    assert.equal(res5.documentsWarning, 'لا يوجد بيان جمركي مُخَلَّص (cleared) لهذه الشحنة');
    assert.equal(await released(5), true);

    // 6. Uninvoiced job: nothing due, releases.
    const res6: any = await service.releaseDeliveryOrder(auth, '6');
    assert.equal(res6.paymentVerified, true);
    assert.equal(await released(6), true);

    // 7. Payment gate runs for air too, before sequence checks.
    await assert.rejects(
      service.releaseDeliveryOrder(auth, '7'),
      /اكتمال السداد/,
    );
    assert.equal(await milestoneCount(7), 0);

    // 8. Source pin: the controller passes the optional body through.
    const controller = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.controller.ts'), 'utf8');
    const releaseStart = controller.indexOf("jobs/:id/release-do");
    const releaseBody = controller.slice(releaseStart, controller.indexOf('@Get', releaseStart));
    assert.ok(releaseBody.includes('ReleaseDeliveryOrderDto'), 'controller types the body');
    assert.ok(releaseBody.includes('releaseDeliveryOrder(req.authContext!, id, body)'), 'controller forwards the body');

    console.log('maritime delivery order release gates checks passed');
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
