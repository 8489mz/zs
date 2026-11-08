/*
 * R3b (U5): business-date UTC-slice fix, sales/purchases/ops slice.
 *
 * A `toISOString().slice(0, 10)` cut on a live instant yields the UTC
 * day, not the tenant's business day: at 00:30 in Cairo (22:30 UTC the
 * previous day) a sale, an expense, a due-date check or a rate-card
 * expiry all land on the wrong day. The fix routes instant cuts
 * through the canonical gateway resolveBusinessDateKey (tenant-local
 * day, never UTC, never host-local) and routes the sales/van offer
 * windows through the pinned shared clock todayLocalIsoDate.
 *
 * Part A pins the gateway itself on explicit instants (no clock
 * freeze needed): the same instant keys a different day in Cairo and
 * in New York, a YYYY-MM-DD string passes through untouched, and a
 * tenant with no setting falls back to Africa/Cairo.
 * Part B drives two real services end to end under a frozen clock
 * (00:30 Cairo, 15 Jan 2026 = 22:30 UTC, 14 Jan 2026): a supplier
 * installment due 14 Jan must read 'overdue', and a rate card valid
 * until 14 Jan must read 'expired'. Both pins FAIL on the old code:
 * the old UTC day is 14 Jan (so the installment stays 'pending'),
 * and the old raw `Date < string` expiry comparison is always false
 * (so the card could never flip to 'expired' at all).
 * Part C pins the pure helpers: normalizeDateOnly on a stored DATE
 * (a UTC-midnight Date object) is the stored day on every host, a
 * non-ISO text date keeps the day as written, isOfferActive agrees
 * with those days, calculateNextBillingDate keeps calendar-day
 * arithmetic on DATE inputs (LEAVE verdict, pinned not changed),
 * and detectDuplicateBills decides on instants (30-day window), not
 * on day keys (its formatDate is display-only, LEAVE verdict).
 * Part D proves, against PGlite, why the old extraction was broken:
 * a DATE column comes back as a Date object, and String() on it
 * yields 'Thu Jan 15', never '2026-01-15'.
 *
 * Host-independence: the normalizeDateOnly / isOfferActive pins are
 * written so they fail under the old code on a west-of-UTC host
 * (America/New_York) or an east-of-UTC host (Asia/Kathmandu);
 * run the spec under both to see them discriminate.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=2048 npx ts-node
 *   test/critical/business-date-sales-ops.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { resolveBusinessDateKey } from '../../src/modules/accounting/engines/accounting-date.engine';
import { invalidateTenantTimezoneCache } from '../../src/common/utils/tenant-timezone.util';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import {
  isOfferActive,
  normalizeDateOnly,
  todayLocalIsoDate,
} from '../../src/modules/sales/helpers/sales-write.helper';
import { calculateNextBillingDate } from '../../src/modules/sales/engines/subscription-billing.engine';
import { detectDuplicateBills } from '../../src/modules/purchases/engines/duplicate-bill-detector.engine';

const RealDate = Date;
const FROZEN_ISO = '2026-01-15T00:30:00+02:00'; // 22:30 UTC, 14 Jan 2026

function freezeAt(iso: string): void {
  const frozen = new RealDate(iso).getTime();
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      // Only the 0-arg (fresh instant) and 1-arg (copy/parse) shapes
      // occur while frozen: service code and the driver never build a
      // multi-arg calendar date inside the frozen window.
      if (args.length === 0) super(frozen);
      else super(args[0]);
    }
    static now(): number {
      return frozen;
    }
  }
  (globalThis as any).Date = FrozenDate;
}

function unfreeze(): void {
  (globalThis as any).Date = RealDate;
}

const authCairo = {
  tenantId: 't-cairo',
  accountId: 'a1',
  userId: 1,
  username: 'tester',
  role: 'admin',
  permissions: [],
} as never;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await db.schema
      .createTable('settings')
      .addColumn('tenant_id', 'text', (c) => c.notNull())
      .addColumn('key', 'text', (c) => c.notNull())
      .addColumn('value', 'text')
      .addPrimaryKeyConstraint('settings_pk', ['tenant_id', 'key'])
      .execute();
    // Cairo as a JSON-encoded value (the settings writer's shape),
    // New York as a raw string (the reader accepts both).
    await sql`INSERT INTO settings (tenant_id, key, value) VALUES
      ('t-cairo', 'timezone', '"Africa/Cairo"'),
      ('t-ny', 'timezone', 'America/New_York')`.execute(db);

    // ---- Part A: the gateway on explicit instants (real clock) ----
    const cairoInstant = new Date('2026-01-15T00:30:00+02:00');
    assert.equal(cairoInstant.toISOString().slice(0, 10), '2026-01-14');
    assert.equal(await resolveBusinessDateKey(db, 't-cairo', cairoInstant), '2026-01-15');
    console.log('✓ A1 Cairo 00:30 local keys 2026-01-15, not the UTC day 2026-01-14');

    const nyInstant = new Date('2026-01-14T23:30:00-05:00');
    assert.equal(nyInstant.toISOString().slice(0, 10), '2026-01-15');
    assert.equal(await resolveBusinessDateKey(db, 't-ny', nyInstant), '2026-01-14');
    console.log('✓ A2 New York 23:30 local keys 2026-01-14, not the UTC day 2026-01-15');

    assert.equal(await resolveBusinessDateKey(db, 't-cairo', '2026-01-15'), '2026-01-15');
    assert.equal(await resolveBusinessDateKey(db, 't-ny', '2026-01-15'), '2026-01-15');
    console.log('✓ A3 a YYYY-MM-DD string passes through untouched in every zone');

    assert.equal(await resolveBusinessDateKey(db, 't-cairo', 'not-a-date'), 'not-a-date');
    console.log('✓ A4 an unparseable value falls back to the old UTC slice');

    assert.equal(await resolveBusinessDateKey(db, 't-none', cairoInstant), '2026-01-15');
    console.log('✓ A5 a tenant with no setting falls back to Africa/Cairo');

    // ---- Part B1: supplier installment overdue, frozen Cairo clock ----
    await db.schema
      .createTable('supplier_payment_schedules')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('tenant_id', 'text', (c) => c.notNull())
      .addColumn('purchase_id', 'integer')
      .addColumn('supplier_id', 'integer', (c) => c.notNull())
      .addColumn('installment_no', 'integer', (c) => c.notNull())
      .addColumn('due_date', 'date', (c) => c.notNull())
      .addColumn('amount', 'numeric', (c) => c.notNull())
      .addColumn('paid_amount', 'numeric', (c) => c.notNull().defaultTo(0))
      .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
      .addColumn('note', 'text')
      .addColumn('paid_at', 'timestamptz')
      .execute();
    await db.schema
      .createTable('supplier_payment_schedule_logs')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('tenant_id', 'text', (c) => c.notNull())
      .addColumn('schedule_id', 'integer', (c) => c.notNull())
      .addColumn('supplier_id', 'integer', (c) => c.notNull())
      .addColumn('amount', 'numeric', (c) => c.notNull().defaultTo(0))
      .addColumn('note', 'text')
      .addColumn('created_by', 'integer')
      .addColumn('created_by_name', 'text')
      .addColumn('created_at', 'timestamptz')
      .execute();
    await sql`INSERT INTO supplier_payment_schedules
      (tenant_id, purchase_id, supplier_id, installment_no, due_date, amount, paid_amount, status, note)
      VALUES
      ('t-cairo', 1, 5, 1, '2026-01-14', 1000, 0, 'pending', ''),
      ('t-cairo', 1, 5, 2, '2026-01-16', 1000, 0, 'pending', '')`.execute(db);
    const schedulesService = new SupplierPaymentSchedulesService(
      db, {} as never, {} as never, {} as never, {} as never,
    );
    invalidateTenantTimezoneCache();
    freezeAt(FROZEN_ISO);
    try {
      const listed = (await schedulesService.listForPurchase(1, authCairo)) as {
        schedules: Array<{ dueDate: string; status: string }>;
      };
      assert.equal(listed.schedules.length, 2);
      assert.equal(listed.schedules[0].dueDate, '2026-01-14');
      assert.equal(listed.schedules[0].status, 'overdue');
      assert.equal(listed.schedules[1].status, 'pending');
    } finally {
      unfreeze();
    }
    console.log('✓ B1 installment due 2026-01-14 is overdue at 00:30 Cairo on 15 Jan (UTC day is still 14 Jan)');

    // ---- Part B2: rate card expired, frozen Cairo clock ----
    await db.schema
      .createTable('maritime_rate_cards')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('tenant_id', 'text', (c) => c.notNull())
      .addColumn('shipping_line_id', 'integer')
      .addColumn('carrier_name', 'text')
      .addColumn('transport_mode', 'text')
      .addColumn('rate_basis', 'text')
      .addColumn('min_charge', 'numeric')
      .addColumn('pol_code', 'text')
      .addColumn('pol_name', 'text')
      .addColumn('pod_code', 'text')
      .addColumn('pod_name', 'text')
      .addColumn('cargo_mode', 'text')
      .addColumn('container_type', 'text')
      .addColumn('ocean_freight', 'numeric')
      .addColumn('currency', 'text')
      .addColumn('thc_origin', 'numeric')
      .addColumn('thc_destination', 'numeric')
      .addColumn('baf_charges', 'numeric')
      .addColumn('other_charges', 'numeric')
      .addColumn('total_freight_cost', 'numeric')
      .addColumn('transit_time_days', 'integer')
      .addColumn('free_days', 'integer')
      .addColumn('valid_from', 'date')
      .addColumn('valid_until', 'date')
      .addColumn('source', 'text')
      .addColumn('source_bid_id', 'integer')
      .addColumn('status', 'text')
      .addColumn('notes', 'text')
      .addColumn('created_at', 'timestamptz')
      .addColumn('updated_at', 'timestamptz')
      .execute();
    await sql`INSERT INTO maritime_rate_cards
      (tenant_id, carrier_name, pol_code, pol_name, pod_code, pod_name, container_type,
       ocean_freight, currency, total_freight_cost, valid_from, valid_until, source, status)
      VALUES
      ('t-cairo', 'Carrier', 'CAI', 'Cairo', 'ALX', 'Alexandria', '20FT',
       100, 'USD', 100, '2026-01-01', '2026-01-14', 'manual', 'active'),
      ('t-cairo', 'Carrier', 'CAI', 'Cairo', 'ALX', 'Alexandria', '20FT',
       100, 'USD', 200, '2026-01-01', '2026-01-20', 'manual', 'active')`.execute(db);
    const maritimeService = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
    invalidateTenantTimezoneCache();
    freezeAt(FROZEN_ISO);
    try {
      const cards = (await maritimeService.listRateCards(authCairo)) as Array<{
        id: string;
        status: string;
        validUntil: string | Date;
      }>;
      assert.equal(cards.length, 2);
      const byId = new Map(cards.map((c) => [c.id, c]));
      assert.equal(byId.get('1')?.status, 'expired');
      assert.equal(byId.get('2')?.status, 'active');
    } finally {
      unfreeze();
    }
    console.log('✓ B2 rate card valid until 2026-01-14 reads expired at 00:30 Cairo on 15 Jan; the 20 Jan card stays active');

    // ---- Part C: pure helpers (no DB) ----
    assert.equal(normalizeDateOnly(new Date('2026-01-15T00:00:00.000Z')), '2026-01-15');
    assert.equal(normalizeDateOnly('15 Jan 2026'), '2026-01-15');
    assert.equal(normalizeDateOnly('2026-01-15'), '2026-01-15');
    assert.equal(normalizeDateOnly(''), '');
    console.log('✓ C1 normalizeDateOnly: stored DATE keeps its day on every host; text keeps the day as written');

    // Local noon, built from local calendar parts: no timezone ambiguity.
    const localNoon = new Date(2026, 0, 15, 12, 0, 0);
    assert.equal(todayLocalIsoDate(localNoon), '2026-01-15');
    assert.equal(isOfferActive({ start_date: new Date('2026-01-16T00:00:00.000Z') }, '2026-01-15', localNoon), false);
    assert.equal(isOfferActive({ end_date: new Date('2026-01-15T00:00:00.000Z') }, '2026-01-15', localNoon), true);
    assert.equal(isOfferActive({ end_date: '15 Jan 2026' }, '2026-01-15', localNoon), true);
    assert.equal(isOfferActive({ start_date: '2026-01-15', end_date: '2026-01-15' }, '2026-01-15', localNoon), true);
    console.log('✓ C2 isOfferActive agrees with the normalized days (tomorrow-start inactive, today-end active)');

    // LEAVE verdicts, pinned not changed: calendar-day arithmetic on
    // DATE inputs, and a timestamp-based duplicate decision.
    assert.equal(calculateNextBillingDate(new Date('2026-01-15T00:00:00.000Z'), 'monthly'), '2026-02-15');
    assert.equal(calculateNextBillingDate('2026-01-15', 'monthly'), '2026-02-15');
    console.log('✓ C3 calculateNextBillingDate keeps calendar-day arithmetic on DATE inputs');

    const recent = detectDuplicateBills(
      { supplierId: 7, supplierInvoiceNo: 'INV-100', total: 500, date: '2026-01-15' },
      [{ id: 1, docNo: 'P-1', supplierId: 7, supplierInvoiceNo: 'INV-999', total: 500, createdAt: '2026-01-10T12:00:00Z', status: 'posted' }],
    );
    assert.equal(recent.hasDuplicates, true);
    assert.equal(recent.matches[0]?.reason, 'identical_amount_recent');
    assert.equal(recent.matches[0]?.severity, 'warning');
    const stale = detectDuplicateBills(
      { supplierId: 7, supplierInvoiceNo: 'INV-100', total: 500, date: '2026-01-15' },
      [{ id: 1, docNo: 'P-1', supplierId: 7, supplierInvoiceNo: 'INV-999', total: 500, createdAt: '2025-12-01T12:00:00Z', status: 'posted' }],
    );
    assert.equal(stale.hasDuplicates, false);
    console.log('✓ C4 detectDuplicateBills decides on instants inside the 30-day window, not on day keys');

    // ---- Part D: PGlite DATE proof ----
    await db.schema
      .createTable('r3b_date_probe')
      .addColumn('id', 'serial', (c) => c.primaryKey())
      .addColumn('d', 'date', (c) => c.notNull())
      .execute();
    await sql`INSERT INTO r3b_date_probe (d) VALUES ('2026-01-15')`.execute(db);
    const probe = await sql<{ d: Date }>`SELECT d FROM r3b_date_probe`.execute(db);
    assert.equal(probe.rows.length, 1);
    const stored = probe.rows[0]?.d as unknown;
    assert.equal(stored instanceof Date, true);
    assert.notEqual(String(stored).slice(0, 10), '2026-01-15');
    assert.equal((stored as Date).toISOString().slice(0, 10), '2026-01-15');
    console.log('✓ D1 a stored DATE comes back as a Date object; String() on it is not a day key, the UTC slice is');

    console.log('business-date-sales-ops.spec: ok');
  } finally {
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
