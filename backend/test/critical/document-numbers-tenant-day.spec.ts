/*
 * Clock P3 — document numbers on the tenant day (INV-SINGLE-SERVER-CLOCK-TENANT-TZ;
 * the INV itself is carried by P1, this package threads the tenant timezone
 * through the document-number call sites).
 *
 * THE DEFECT: getDailyDocumentPrefix / formatDailyDocumentNumber take an
 * optional timeZone and fall back to host-local parts without one, so the
 * same code produced different doc-number days on cloud (UTC host) vs
 * Portable (Cairo host). 43 call sites in 25 files passed no timezone,
 * plus two inline bypasses (the POS sale number in generateSaleDocNo and
 * the shift number in buildCashDrawerShiftDocNo). The POS writer also
 * ignored the offline sale's own day: a sale made at 23:30, synced after
 * midnight, got today's doc-no day but yesterday's created_at.
 *
 * WHAT THIS PINS, driving the REAL POS writer on PGlite at one frozen
 * instant -- 2026-10-31T21:30:00Z, which is Oct 31 23:30 in Cairo
 * (UTC+2) and Nov 1 00:30 in Kuwait (UTC+3):
 * 1. Pure util: the same instant in different tenant zones -> different
 *    doc-number days (Cairo 261031, Kuwait 261101).
 * 2. generateSaleDocNo with the sale's business day: Cairo 261031,
 *    Kuwait 261101. On the old code both tenants got the host-local day
 *    of "now" (and the business date was ignored entirely), so the split
 *    assertion fails on the old code on every day of the year.
 * 3. generateSaleDocNo with no business date (online sale): the number's
 *    day is today's tenant day. The expected day is computed from the
 *    same tenant zone immediately before the call; the only straddle
 *    window is the single second the test itself crosses a Cairo
 *    midnight (the same shape the Cat 1-a specs use for "today").
 * 4. The sequential numbering scheme keeps returning Z-<saleId> with
 *    no date at all (no timezone resolution needed there).
 *
 * Deliberately NOT driven here: the other 42 call sites (one assertion
 * each would need the full DDL of 25 modules). They are mechanical
 * thread-throughs of the same getTenantTimezone call, proven by tsc +
 * the architecture guard + the two service-level specs updated in this
 * package (maritime-agent-settlement-record-integrity and
 * rep-shortage-cash-settle, whose expectations move from host-local to
 * the tenant day). Offline doc numbers (POS INV-<terminal>-YYMMDD and
 * van *-OFF-YYMMDD) are NOT re-stamped on sync by design: the offline
 * number is the customer's receipt identity, explicitly marked offline,
 * and the canonical server number is generated separately on sync with
 * the offline number preserved in the sale note.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { formatDailyDocumentNumber } from '../../src/common/utils/document-number.util';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';

const CAIRO = 't-cairo';
const KUWAIT = 't-kuwait';
const SEQUENTIAL = 't-seq';
// 2026-10-31T21:30:00Z = Oct 31 23:30 Cairo, Nov 1 00:30 Kuwait.
const FROZEN = new Date('2026-10-31T21:30:00.000Z');

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
    `);
    for (const [tenant, tz] of [
      [CAIRO, 'Africa/Cairo'],
      [KUWAIT, 'Asia/Kuwait'],
    ] as const) {
      await anyDb
        .insertInto('settings')
        .values({ tenant_id: tenant, key: 'timezone', value: JSON.stringify(tz) })
        .execute();
      await anyDb
        .insertInto('settings')
        .values({ tenant_id: tenant, key: 'invoiceNumberingScheme', value: JSON.stringify('daily') })
        .execute();
    }
    await anyDb
      .insertInto('settings')
      .values({ tenant_id: SEQUENTIAL, key: 'timezone', value: JSON.stringify('Africa/Cairo') })
      .execute();
    await anyDb
      .insertInto('settings')
      .values({ tenant_id: SEQUENTIAL, key: 'invoiceNumberingScheme', value: JSON.stringify('sequential') })
      .execute();

    // 1. Pure util: same instant, different tenant zones -> different days.
    assert.equal(formatDailyDocumentNumber('PO', 3, FROZEN, 4, 'Africa/Cairo'), 'PO-261031-0003');
    assert.equal(formatDailyDocumentNumber('PO', 3, FROZEN, 4, 'Asia/Kuwait'), 'PO-261101-0003');

    // 2. POS writer, real method, real transaction handle, real settings reads.
    const svc = Object.create(SalesWriteService.prototype) as SalesWriteService;
    const cairoNo = await db
      .transaction()
      .execute(async (trx) => (svc as any).generateSaleDocNo(trx, 7, CAIRO, FROZEN));
    assert.equal(cairoNo, 'Z-261031-0007');
    const kuwaitNo = await db
      .transaction()
      .execute(async (trx) => (svc as any).generateSaleDocNo(trx, 7, KUWAIT, FROZEN));
    assert.equal(kuwaitNo, 'Z-261101-0007');

    // 3. Online sale (no business date): today's tenant day.
    const expectedDay = todayTenantDate('Africa/Cairo', new Date());
    const onlineNo = await db.transaction().execute(async (trx) => (svc as any).generateSaleDocNo(trx, 9, CAIRO));
    assert.equal(onlineNo, `Z-${expectedDay.slice(2, 4)}${expectedDay.slice(5, 7)}${expectedDay.slice(8, 10)}-0009`);

    // 4. Sequential scheme: no date, no timezone resolution.
    const seqNo = await db.transaction().execute(async (trx) => (svc as any).generateSaleDocNo(trx, 11, SEQUENTIAL));
    assert.equal(seqNo, 'Z-11');
  } finally {
    await db.destroy();
  }
  console.log('document numbers tenant-day checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
