/* Cashier fraud radar three-way equality (INV-AUDIT-RADAR-FORENSIC):
 * the header total, the per-cashier detail counts and the live strip must
 * all read the same aggregation over the same timeframe window. A sale
 * return used to count +1 in the header (event_count includes
 * POS_SALE_RETURN) and +0 in the detail (no returns column), and the
 * strip read audit_logs with no timeframe at all while relabelling
 * returns as cart_remove and never listing cancelled sales.
 *
 * Seed math (one fresh PGlite db per case, tenant t1, cashier 1 'muse'):
 * A: 2 cart voids + 1 draft cancel today -> header 3, detail sum 3, strip 3.
 * B: 1 sale return today -> header 1, saleReturnsCount 1, strip 1 as 'sale_return'.
 * C: 1 cancelled sale (total 150) -> header 1, cancelledSalesCount 1, strip 1 as 'sale_cancelled'.
 * D: 1 void today + 1 void yesterday -> today header 1 / strip 1, 7days header 2 / strip 2.
 * E: 1 void by unknown user 99 -> header 1, detail sum 1, profile row for 99.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { CashierFraudRadarService } from '../../src/modules/sales/services/cashier-fraud-radar.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: ['*'],
  tenantId: TENANT,
  accountId: 'a1',
};

const VOID = 'POS_CART_ITEM_REMOVED';
const DRAFT = 'POS_DRAFT_SALE_CANCELLED';
const RETURN = 'POS_SALE_RETURN';

async function setup() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });

  await sql`CREATE TABLE users (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cashier', is_active BOOLEAN NOT NULL DEFAULT true)`.execute(db);
  await sql`CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', action TEXT NOT NULL, event_code TEXT, details TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE sales (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', doc_no TEXT, status TEXT NOT NULL DEFAULT 'posted', total NUMERIC(14,2) NOT NULL DEFAULT 0, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);

  await db.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'muse', role: 'cashier', is_active: true }).execute();
  const service = new CashierFraudRadarService(db as any);
  return { db, service };
}

async function seedAudit(db: Kysely<any>, rows: Array<{ code: string; by: number; at?: Date }>) {
  for (const row of rows) {
    await db
      .insertInto('audit_logs')
      .values({
        tenant_id: TENANT,
        action: row.code === VOID ? 'حذف عنصر من السلة' : row.code === DRAFT ? 'إلغاء/حذف فاتورة' : 'مرتجع',
        event_code: row.code,
        details: '',
        created_by: row.by,
        ...(row.at ? { created_at: row.at } : {}),
      })
      .execute();
  }
}

function detailSum(summary: { cashiers: Array<{ totalSuspiciousEvents: number }> }): number {
  return summary.cashiers.reduce((sum, c) => sum + c.totalSuspiciousEvents, 0);
}

async function main() {
  // A: 2 cart voids + 1 draft cancel -> header 3, detail sum 3, strip 3.
  {
    const { db, service } = await setup();
    await seedAudit(db, [
      { code: VOID, by: 1 },
      { code: VOID, by: 1 },
      { code: DRAFT, by: 1 },
    ]);
    const summary = await service.getSummary('today', ACTOR);
    assert.equal(summary.totalSuspiciousEvents, 3, `header must be 3, got ${summary.totalSuspiciousEvents}`);
    assert.equal(detailSum(summary), 3, `detail sum must be 3, got ${detailSum(summary)}`);
    const profile = summary.cashiers.find((c) => c.cashierId === 1)!;
    assert.equal(profile.cartVoidsCount, 2, `cart voids must be 2, got ${profile.cartVoidsCount}`);
    assert.equal(profile.draftCancelsCount, 1, `draft cancels must be 1, got ${profile.draftCancelsCount}`);
    assert.equal(profile.totalSuspiciousEvents, 3, `profile total must be 3, got ${profile.totalSuspiciousEvents}`);
    const events = await service.getEvents(50, ACTOR, 'today');
    assert.equal(events.length, 3, `strip must list 3 events, got ${events.length}`);
    assert.deepEqual(
      events.map((e) => e.eventType).sort(),
      ['cart_remove', 'cart_remove', 'draft_cancel'],
      `strip event types must match the seeded kinds, got ${events.map((e) => e.eventType).join(',')}`,
    );
    await db.destroy();
  }

  // B: 1 sale return -> header 1, its own returns column 1, strip 1 as 'sale_return'.
  {
    const { db, service } = await setup();
    await seedAudit(db, [{ code: RETURN, by: 1 }]);
    const summary = await service.getSummary('today', ACTOR);
    assert.equal(summary.totalSuspiciousEvents, 1, `header must be 1, got ${summary.totalSuspiciousEvents}`);
    assert.equal(detailSum(summary), 1, `detail sum must be 1, got ${detailSum(summary)}`);
    const profile = summary.cashiers.find((c) => c.cashierId === 1)!;
    assert.equal(profile.saleReturnsCount, 1, `sale returns must be 1, got ${profile.saleReturnsCount}`);
    const events = await service.getEvents(50, ACTOR, 'today');
    assert.equal(events.length, 1, `strip must list 1 event, got ${events.length}`);
    assert.equal(events[0].eventType, 'sale_return', `return must stay 'sale_return', got ${events[0].eventType}`);
    await db.destroy();
  }

  // C: 1 cancelled sale -> header 1, cancelledSalesCount 1, strip 1 as 'sale_cancelled'.
  {
    const { db, service } = await setup();
    await db
      .insertInto('sales')
      .values({ tenant_id: TENANT, doc_no: 'S-9', status: 'cancelled', total: 150, created_by: 1 })
      .execute();
    const summary = await service.getSummary('today', ACTOR);
    assert.equal(summary.totalSuspiciousEvents, 1, `header must be 1, got ${summary.totalSuspiciousEvents}`);
    assert.equal(detailSum(summary), 1, `detail sum must be 1, got ${detailSum(summary)}`);
    const profile = summary.cashiers.find((c) => c.cashierId === 1)!;
    assert.equal(profile.cancelledSalesCount, 1, `cancelled sales must be 1, got ${profile.cancelledSalesCount}`);
    const events = await service.getEvents(50, ACTOR, 'today');
    assert.equal(events.length, 1, `strip must list 1 event, got ${events.length}`);
    assert.equal(events[0].eventType, 'sale_cancelled', `cancelled sale must be 'sale_cancelled', got ${events[0].eventType}`);
    assert.equal(events[0].amount, 150, `cancelled sale amount must be 150, got ${events[0].amount}`);
    await db.destroy();
  }

  // D: the strip reads the same timeframe as the summary — yesterday's void
  // counts for 7days but not for today.
  {
    const { db, service } = await setup();
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await seedAudit(db, [
      { code: VOID, by: 1 },
      { code: VOID, by: 1, at: yesterday },
    ]);
    const todaySummary = await service.getSummary('today', ACTOR);
    assert.equal(todaySummary.totalSuspiciousEvents, 1, `today header must be 1, got ${todaySummary.totalSuspiciousEvents}`);
    const todayEvents = await service.getEvents(50, ACTOR, 'today');
    assert.equal(todayEvents.length, 1, `today strip must list 1 event, got ${todayEvents.length}`);
    const weekSummary = await service.getSummary('7days', ACTOR);
    assert.equal(weekSummary.totalSuspiciousEvents, 2, `7days header must be 2, got ${weekSummary.totalSuspiciousEvents}`);
    const weekEvents = await service.getEvents(50, ACTOR, '7days');
    assert.equal(weekEvents.length, 2, `7days strip must list 2 events, got ${weekEvents.length}`);
    await db.destroy();
  }

  // E: an event by a user with no active cashier row still counts once in
  // the header AND in the detail — it must not inflate the header alone.
  {
    const { db, service } = await setup();
    await seedAudit(db, [{ code: VOID, by: 99 }]);
    const summary = await service.getSummary('today', ACTOR);
    assert.equal(summary.totalSuspiciousEvents, 1, `header must be 1, got ${summary.totalSuspiciousEvents}`);
    assert.equal(detailSum(summary), 1, `detail sum must be 1, got ${detailSum(summary)}`);
    const ghost = summary.cashiers.find((c) => c.cashierId === 99);
    assert.ok(ghost, 'an event by user 99 must produce a profile row for 99');
    assert.equal(ghost!.totalSuspiciousEvents, 1, `ghost profile total must be 1, got ${ghost!.totalSuspiciousEvents}`);
    await db.destroy();
  }

  console.log('cashier-fraud-radar: PASS (5 cases)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
