/*
 * Maritime tracking honest labelling (INV-MARITIME-TRACKING-HONEST-LABELLING).
 *
 * THE GAP: syncCarrierTracking inserted 4 hardcoded events with
 * fixed offsets, made zero carrier fetches, and returned
 * status 'synced' with a CARRIER_API_HUB payload -- while the
 * frontend toast claimed a live synchronisation with the carrier's
 * servers, the hub header claimed a direct DCSA API integration,
 * and the customer portal called its milestone view live tracking.
 *
 * THE RULE: the events stay estimated and scheduled (no carrier
 * integration is built here), and every surface says so: the
 * stored payload is labelled ESTIMATED_SCHEDULE, the returned
 * status is 'estimated' with estimated: true, the toast and the
 * hub/portal copy say estimated/scheduled with no live carrier
 * connection, and the milestone WhatsApp copy no longer promises
 * moment-by-moment live tracking. The internal method/route name
 * syncCarrierTracking is kept for endpoint compatibility; only
 * user-facing copy and the returned status change.
 *
 * WHAT THIS PINS, driving the REAL syncCarrierTracking on PGlite
 * plus source pins over the frontend copy (frontend specs cannot
 * run on this VM -- frontend dependencies are not installed here --
 * so the copy is pinned by source read, and the browser behaviour
 * is an honest limit, not a proven run):
 * - the call stores 4 events, returns status 'estimated' with
 *   estimated: true, and every stored payload carries
 *   ESTIMATED_SCHEDULE;
 * - the service source keeps no 'synced' status or CARRIER_API_HUB
 *   payload in the tracking method, and no fetch call exists in
 *   the module;
 * - the hub file keeps no live-sync claim (no "live sync", no
 *   carrier-servers toast, no DCSA gateway badge) and carries the
 *   estimated wording; the portal tab and the client tracking-link
 *   label no longer say live/direct.
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

  try {
    await pg.exec(`
      CREATE TABLE maritime_carrier_api_events (id bigserial PRIMARY KEY, tenant_id text, carrier_code text, tracking_number text, event_type text, event_location text, event_time timestamptz, raw_payload jsonb, created_at timestamptz DEFAULT NOW());
    `);

    const res = await service.syncCarrierTracking(auth, 'mscu', 'MSCU9284710');
    assert.equal(res.status, 'estimated');
    assert.equal((res as any).estimated, true);
    assert.equal(res.eventsCount, 4);

    const events = await (db as any).selectFrom('maritime_carrier_api_events').selectAll().execute();
    assert.equal(events.length, 4);
    for (const evt of events) {
      const payload = typeof evt.raw_payload === 'string' ? JSON.parse(evt.raw_payload) : evt.raw_payload;
      assert.equal(payload.source, 'ESTIMATED_SCHEDULE');
      assert.equal(payload.estimated, true);
    }

    // Source pins: no live-sync claim survives in the tracking
    // method or the user-facing copy.
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const trackingStart = serviceSource.indexOf('async syncCarrierTracking(');
    const trackingEnd = serviceSource.indexOf('async recordCarrierApiEvent(');
    assert.ok(trackingStart > 0 && trackingEnd > trackingStart);
    const trackingBody = serviceSource.slice(trackingStart, trackingEnd);
    assert.ok(!trackingBody.includes("'synced'"));
    assert.ok(!trackingBody.includes('CARRIER_API_HUB'));
    assert.ok(trackingBody.includes("'estimated'"));
    assert.ok(trackingBody.includes('ESTIMATED_SCHEDULE'));
    const moduleSource = serviceSource;
    assert.ok(!moduleSource.includes('CARRIER_API_HUB'));
    // No fetch call exists in this service file: the events cannot
    // be live carrier data.
    assert.ok(!/[^a-zA-Z]fetch\s*\(/.test(moduleSource));

    const hub = readFileSync(resolve(__dirname, '../../../frontend/src/features/maritime-freight/components/CarrierTrackingHubTab.tsx'), 'utf8');
    assert.ok(!hub.includes('مزامنة لحظية') && !hub.includes('المزامنة اللحظية'));
    assert.ok(!hub.includes('خوادم الخط الملاحي'));
    assert.ok(!hub.includes('الاتصال بالسيرفر'));
    assert.ok(!hub.includes('DCSA API Gateway Active'));
    assert.ok(hub.includes('تقديرية'));
    assert.ok(hub.includes('لا يوجد اتصال مباشر'));

    const portal = readFileSync(resolve(__dirname, '../../../frontend/src/features/maritime-freight/pages/MaritimeCustomerPortalPage.tsx'), 'utf8');
    assert.ok(!portal.includes('التتبع اللحظي'));
    assert.ok(!portal.includes('الشحنات اللحظية'));
    assert.ok(portal.includes('التتبع التقديري'));

    const modal = readFileSync(resolve(__dirname, '../../../frontend/src/features/maritime-freight/components/JobDetailsModal.tsx'), 'utf8');
    assert.ok(!modal.includes('رابط التتبع المباشر'));

    console.log('maritime tracking honest labelling checks passed');
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
