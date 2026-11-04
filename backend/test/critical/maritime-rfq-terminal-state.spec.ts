/*
New file: backend/test/critical/maritime-rfq-terminal-state.spec.ts
Pins INV-MARITIME-RFQ-TERMINAL-STATE.

THE GAP: awardBid locked the RFQ row but never read its status, so a
closed or cancelled RFQ could gain (or change) a winner, silently
un-awarding the previous winner -- and staff submitBid accepted new
bids on terminal RFQs while the public magic-link path already
rejected them. A dead RFQ could be resurrected by a stray click, with
no audit trail.

THE RULE: awardBid rejects a closed or cancelled RFQ (the row is
already locked, so the status read is the decision-time status), and
staff submitBid carries the public path's guard verbatim (no new bids
on awarded / closed / cancelled RFQs). Re-award within an open or
already-awarded RFQ stays allowed -- no un-award endpoint exists, and
a carrier backing out must not strand the RFQ; that choice is
flagged in the invariant for reversal.

WHAT THIS PINS, driving the REAL awardBid / submitBid on PGlite:
- awarding on a 'closed' RFQ is rejected and the previous winner
  stays awarded;
- awarding on a 'cancelled' RFQ is rejected;
- awarding on a 'sent' RFQ succeeds and marks the RFQ 'awarded';
- re-awarding an 'awarded' RFQ succeeds and moves the winner;
- staff bids on 'closed' and 'awarded' RFQs are rejected with the
  public path's message and write no bid row;
- a staff bid on a 'sent' RFQ succeeds and moves the RFQ to
  'bids_received'.
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
      CREATE TABLE maritime_rfqs (id bigint PRIMARY KEY, tenant_id text, status text, updated_at timestamptz);
      CREATE TABLE maritime_rfq_bids (id bigserial PRIMARY KEY, tenant_id text, rfq_id bigint, shipping_line_id text, shipping_line_name text, ocean_freight numeric, currency text, thc_origin numeric, thc_destination numeric, baf_charges numeric, other_charges numeric, total_freight_cost numeric, transit_time_days int, free_days int, validity_date date, submission_channel text, raw_bid_data text, notes text, is_awarded boolean, awarded_at timestamptz);
      INSERT INTO maritime_rfqs (id, tenant_id, status) VALUES
        (1,'t1','closed'),(2,'t1','cancelled'),(3,'t1','sent'),(4,'t1','awarded'),(5,'t1','closed'),(6,'t1','awarded'),(7,'t1','sent');
      INSERT INTO maritime_rfq_bids (id, tenant_id, rfq_id, shipping_line_name, ocean_freight, currency, total_freight_cost, is_awarded) VALUES
        (1,'t1',1,'Line',100,'USD',100,true),
        (2,'t1',1,'Line',90,'USD',90,false),
        (3,'t1',2,'Line',100,'USD',100,false),
        (4,'t1',3,'Line',100,'USD',100,false),
        (5,'t1',4,'Line',100,'USD',100,true),
        (6,'t1',4,'Line',90,'USD',90,false);
      SELECT setval('maritime_rfq_bids_id_seq', 6, true);
    `);

    const bidOf = async (id: number): Promise<any> => {
      const row = await db.selectFrom('maritime_rfq_bids' as any).selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return row as any;
    };
    const rfqStatus = async (id: number): Promise<string> => {
      const row = await db.selectFrom('maritime_rfqs' as any).select('status').where('id', '=', id).executeTakeFirstOrThrow();
      return String((row as any).status);
    };
    const bidCount = async (): Promise<number> => {
      const rows = await db.selectFrom('maritime_rfq_bids' as any).selectAll().execute();
      return rows.length;
    };
    const bidDto = (rfqId: string) => ({
      rfqId,
      shippingLineName: 'Line',
      oceanFreight: 100,
      currency: 'USD',
    });

    // 1. Award on a closed RFQ: rejected, previous winner untouched.
    await assert.rejects(service.awardBid(auth, '2'), /مغلق أو ملغى/);
    assert.equal((await bidOf(1)).is_awarded, true);
    assert.equal((await bidOf(2)).is_awarded, false);
    assert.equal(await rfqStatus(1), 'closed');

    // 2. Award on a cancelled RFQ: rejected.
    await assert.rejects(service.awardBid(auth, '3'), /مغلق أو ملغى/);
    assert.equal(await rfqStatus(2), 'cancelled');

    // 3. Award on a sent RFQ: succeeds, RFQ becomes awarded.
    const awarded = await service.awardBid(auth, '4');
    assert.equal(awarded.is_awarded, true);
    assert.equal(await rfqStatus(3), 'awarded');

    // 4. Re-award on an awarded RFQ: succeeds, winner moves.
    const reAwarded = await service.awardBid(auth, '6');
    assert.equal(reAwarded.is_awarded, true);
    assert.equal((await bidOf(5)).is_awarded, false);
    assert.equal((await bidOf(6)).is_awarded, true);
    assert.equal(await rfqStatus(4), 'awarded');

    // 5. Staff bid on a closed RFQ: rejected, no bid row written.
    const beforeClosed = await bidCount();
    await assert.rejects(service.submitBid(auth, bidDto('5')), /مغلق أو تم ترسيته/);
    assert.equal(await bidCount(), beforeClosed);

    // 6. Staff bid on an awarded RFQ: rejected (public-path parity).
    const beforeAwarded = await bidCount();
    await assert.rejects(service.submitBid(auth, bidDto('6')), /مغلق أو تم ترسيته/);
    assert.equal(await bidCount(), beforeAwarded);

    // 7. Staff bid on a sent RFQ: succeeds, RFQ becomes bids_received.
    const bid = await service.submitBid(auth, bidDto('7'));
    assert.equal(Number(bid.total_freight_cost), 100);
    assert.equal(await rfqStatus(7), 'bids_received');

    console.log('maritime rfq terminal state checks passed');
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
