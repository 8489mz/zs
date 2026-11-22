/*
 * Clock P9 — stamp unification (RC-9 + RC-11).
 *
 * THE DEFECTS (single-server-clock audit):
 * (a) Naive TIMESTAMP instant columns: van_sales_trips (opened_at /
 * closed_at / created_at / updated_at) and van_field_visits (visited_at
 * / created_at) store DB NOW() instants in TIMESTAMP WITHOUT TIME ZONE,
 * so their meaning depends on the database `timezone` setting — and
 * node-postgres reads them back as host-local Dates, shifting every
 * instant by the host offset. sales.settled_at is the same root cause.
 * (b) CURRENT_DATE defaults on business DATE columns: the default
 * fires in the DATABASE server's local date, not the tenant day.
 * (c) Same-row split: shift close stamped closed_at with DB now()
 * while the review stamps in the same row's JSON close note used app
 * new Date(). Three contracting DATE fallbacks (`|| new Date()` into
 * a DATE column) and the broker-expense payment_date (no writer at
 * all — the DB default filled it) are the same hole in miniature.
 * (d) saas-admin recordPayment stamped a caller-supplied `date`
 * verbatim into paid_at, unvalidated and unparse-checked.
 *
 * THE FIX (migration 0328 + five one-line seams):
 * - 7 instant columns convert to TIMESTAMPTZ, reinterpreting each
 *   stored wall time in the database's own timezone setting
 *   (`USING col AT TIME ZONE current_setting('TIMEZONE')`), so the
 *   stored INSTANT is preserved.
 * - 22 CURRENT_DATE defaults are dropped; every one of those dates
 *   is already supplied by the app (tenant-day fallback or required
 *   DTO field), except import_broker_expenses.payment_date, whose
 *   insert now supplies the tenant day.
 * - Shift close/review capture ONE server instant per operation and
 *   stamp the column and the JSON note with it.
 * - recordPayment bounds the supplied date to [today-7d, today] in
 *   the tenant day via the P6 helper.
 *
 * WHAT THIS PINS, driving the REAL code:
 * - §0 the P6 window edges at the saas-admin window ([today-7, today]).
 * - §A the REAL migration 0328 on PGlite under a non-UTC session zone
 *   (Africa/Cairo): naive types before, timestamptz after, seeded
 *   instants preserved to the millisecond, row counts unchanged,
 *   up() idempotent, down() reverses with instants intact.
 * - §B the REAL migration 0328 on PGlite: all 22 CURRENT_DATE
 *   defaults gone; an insert that omits the date now fails (NOT NULL,
 *   no default to hide behind) while an insert with the tenant day
 *   succeeds.
 * - §C source pins for the five seams (the services are too heavy to
 *   drive end-to-end here; the migration's §B failure proves the app
 *   must supply these dates, and the pins prove it does).
 *
 * TRIAGED, NOT FIXED (evidence in the package report):
 * - van_sales_trips.settled_at does not exist — the audit's RC-9 list
 *   is wrong on that column.
 * - RC-11's other sites are already compliant server-now instants
 *   with NO business-day derivation at the site: saas-admin trial /
 *   subscription / suspend / expire / session-TTL stamps, the 9
 *   storefront-payment paid_at stamps on gateway confirmation, and
 *   the 13 ar-collections stamps (TIMESTAMPTZ columns; the client
 *   dates there were already P6-bounded). Instants stay server-now
 *   by the rule itself, so there is nothing to change.
 *
 * HONEST LIMITS:
 * - PGlite cannot prove the live-Postgres behaviour: the conversion
 *   assumes the deployed database `timezone` setting is the setting
 *   under which NOW() stamped the rows (open audit check #1). A
 *   live-Postgres rehearsal on the real host is recorded as a
 *   re-review follow-up.
 * - The drawer/fuel/broker/saas seams are pinned by source, not by
 *   driving the services (their constructors / fixtures are too
 *   heavy for a proportionate spec); the related existing specs
 *   staying green is the behavioural cover for those files.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  checkClientBusinessDay,
  CLIENT_BUSINESS_DATE_PAST_DAYS,
  addDaysToDayKey,
} from '../../src/common/utils/client-date-bounds.util';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { migration as p9Migration } from '../../src/database/migrations/2040000000328_van_timestamps_timestamptz';

const KW_TZ = 'Asia/Kuwait';
const CAIRO_TZ = 'Africa/Cairo';

/** The 7 instant columns migration 0328 converts. */
const TIMESTAMPTZ_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'van_sales_trips', column: 'opened_at' },
  { table: 'van_sales_trips', column: 'closed_at' },
  { table: 'van_sales_trips', column: 'created_at' },
  { table: 'van_sales_trips', column: 'updated_at' },
  { table: 'van_field_visits', column: 'visited_at' },
  { table: 'van_field_visits', column: 'created_at' },
  { table: 'sales', column: 'settled_at' },
];

/** The 22 CURRENT_DATE defaults migration 0328 drops. */
const DATE_DEFAULT_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'customer_installments', column: 'start_date' },
  { table: 'hr_end_of_service_settlements', column: 'settlement_date' },
  { table: 'contracting_site_daily_logs', column: 'log_date' },
  { table: 'contracting_material_requisitions', column: 'issue_date' },
  { table: 'contracting_supplier_returns', column: 'return_date' },
  { table: 'contracting_labor_attendance', column: 'work_date' },
  { table: 'contracting_petty_cash', column: 'issue_date' },
  { table: 'contracting_site_mobilization_expenses', column: 'expense_date' },
  { table: 'contracting_equipment_transfers', column: 'transfer_date' },
  { table: 'contracting_subcontractor_payments', column: 'payment_date' },
  { table: 'contracting_indirect_expenses', column: 'expense_date' },
  { table: 'contracting_equipment_fuel_logs', column: 'log_date' },
  { table: 'contracting_rfis', column: 'date_requested' },
  { table: 'contracting_labor_attendance_records', column: 'attendance_date' },
  { table: 'contracting_supplier_price_memory', column: 'last_purchase_date' },
  { table: 'contracting_submittals', column: 'submission_date' },
  { table: 'contracting_subcontractor_backcharges', column: 'occurrence_date' },
  { table: 'contracting_inspection_requests', column: 'scheduled_date' },
  { table: 'contracting_project_handovers', column: 'handover_date' },
  { table: 'maritime_carrier_invoices', column: 'invoice_date' },
  { table: 'import_broker_expenses', column: 'expense_date' },
  { table: 'import_broker_expenses', column: 'payment_date' },
];

const readSource = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), 'utf8');

async function columnType(
  db: Kysely<Database>,
  table: string,
  column: string,
): Promise<string | null> {
  const row = await sql<{ data_type: string }>`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `.execute(db);
  return row.rows[0]?.data_type ?? null;
}

async function columnDefault(
  db: Kysely<Database>,
  table: string,
  column: string,
): Promise<string | null> {
  const row = await sql<{ column_default: string | null }>`
    SELECT column_default FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `.execute(db);
  return row.rows[0]?.column_default ?? null;
}

async function main(): Promise<void> {
  // ── §0. The saas-admin window: [today-7d, today] in the tenant day ─────
  // Frozen 2026-04-08T21:30:00Z = 23:30 Cairo (Apr 08) / 00:30 Kuwait (Apr 09).
  const frozenNow = new Date('2026-04-08T21:30:00Z');
  const todayKuwait = todayTenantDate(KW_TZ, frozenNow);
  assert.equal(todayKuwait, '2026-04-09', 'frozen instant is Apr 09 in Kuwait');
  const window = { minDayOffset: -CLIENT_BUSINESS_DATE_PAST_DAYS, maxDayOffset: 0 };
  assert.equal(CLIENT_BUSINESS_DATE_PAST_DAYS, 7, 'P6 past window is 7 days');
  assert.ok(checkClientBusinessDay(todayKuwait, KW_TZ, window, frozenNow).ok, 'today passes');
  assert.ok(
    checkClientBusinessDay(addDaysToDayKey(todayKuwait, -7)!, KW_TZ, window, frozenNow).ok,
    'exactly today-7 passes',
  );
  assert.equal(
    checkClientBusinessDay(addDaysToDayKey(todayKuwait, -8)!, KW_TZ, window, frozenNow).ok,
    false,
    'today-8 is too old',
  );
  assert.equal(
    checkClientBusinessDay(addDaysToDayKey(todayKuwait, 1)!, KW_TZ, window, frozenNow).ok,
    false,
    'tomorrow is too far in the future for a payment date',
  );
  assert.equal(
    checkClientBusinessDay('not-a-date', KW_TZ, window, frozenNow).ok,
    false,
    'garbage rejects',
  );

  // ── §A. Migration 0328: naive TIMESTAMP → timestamptz, instants kept ───
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      // Non-UTC session zone: the conversion must reinterpret wall times
      // in THIS zone, or the seeded instants shift by 2 hours.
      await sql`SET TIME ZONE 'Africa/Cairo'`.execute(db);
      const tz = await sql<{ tz: string }>`SELECT current_setting('TIMEZONE') AS tz`.execute(db);
      assert.equal(tz.rows[0]?.tz, CAIRO_TZ, 'session zone is Cairo for the test');

      // Old-schema tables, exactly as migrations 0045 / 0158 / 2030000000001 built them.
      await sql`
        CREATE TABLE van_sales_trips (
          id SERIAL PRIMARY KEY,
          tenant_id VARCHAR(50) NOT NULL,
          opened_at TIMESTAMP DEFAULT now(),
          closed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT now(),
          updated_at TIMESTAMP DEFAULT now()
        )
      `.execute(db);
      await sql`
        CREATE TABLE van_field_visits (
          id SERIAL PRIMARY KEY,
          visited_at TIMESTAMP DEFAULT now(),
          created_at TIMESTAMP DEFAULT now()
        )
      `.execute(db);
      await sql`
        CREATE TABLE sales (
          id SERIAL PRIMARY KEY,
          settled_at TIMESTAMP
        )
      `.execute(db);

      // Seed with KNOWN instants (UTC): 2026-04-08T21:30:00Z is 23:30 wall time in Cairo.
      const openedAt = '2026-04-08T21:30:00Z';
      const closedAt = '2026-04-08T22:00:00Z';
      const settledAt = '2026-04-08T20:15:00Z';
      await sql`
        INSERT INTO van_sales_trips (tenant_id, opened_at, closed_at)
        VALUES ('t1', ${openedAt}::timestamptz, ${closedAt}::timestamptz)
      `.execute(db);
      // A row relying on DEFAULT now() for opened_at/created_at/updated_at.
      await sql`INSERT INTO van_sales_trips (tenant_id) VALUES ('t1')`.execute(db);
      // A row with an explicitly NULL closed_at.
      await sql`
        INSERT INTO van_sales_trips (tenant_id, opened_at, closed_at)
        VALUES ('t1', ${openedAt}::timestamptz, NULL)
      `.execute(db);
      await sql`
        INSERT INTO van_field_visits (visited_at) VALUES (${openedAt}::timestamptz)
      `.execute(db);
      await sql`INSERT INTO sales (settled_at) VALUES (${settledAt}::timestamptz)`.execute(db);

      for (const { table, column } of TIMESTAMPTZ_COLUMNS) {
        assert.equal(
          await columnType(db, table, column),
          'timestamp without time zone',
          `${table}.${column} starts naive`,
        );
      }

      await p9Migration.up(db as never);

      for (const { table, column } of TIMESTAMPTZ_COLUMNS) {
        assert.equal(
          await columnType(db, table, column),
          'timestamp with time zone',
          `${table}.${column} is timestamptz after up()`,
        );
      }

      // Instants preserved to the millisecond (the wall time 23:30 Cairo
      // re-reads as the same 21:30Z instant — not shifted by 2 hours).
      const trip = await sql<{ opened_at: Date; closed_at: Date | null }>`
        SELECT opened_at, closed_at FROM van_sales_trips WHERE id = 1
      `.execute(db);
      assert.equal(
        new Date(trip.rows[0]!.opened_at).getTime(),
        Date.parse(openedAt),
        'opened_at instant preserved',
      );
      assert.equal(
        new Date(trip.rows[0]!.closed_at!).getTime(),
        Date.parse(closedAt),
        'closed_at instant preserved',
      );
      const nullClose = await sql<{ closed_at: Date | null }>`
        SELECT closed_at FROM van_sales_trips WHERE id = 3
      `.execute(db);
      assert.equal(nullClose.rows[0]!.closed_at, null, 'NULL closed_at stays NULL');
      const visit = await sql<{ visited_at: Date }>`
        SELECT visited_at FROM van_field_visits WHERE id = 1
      `.execute(db);
      assert.equal(
        new Date(visit.rows[0]!.visited_at).getTime(),
        Date.parse(openedAt),
        'visited_at instant preserved',
      );
      const sale = await sql<{ settled_at: Date }>`
        SELECT settled_at FROM sales WHERE id = 1
      `.execute(db);
      assert.equal(
        new Date(sale.rows[0]!.settled_at).getTime(),
        Date.parse(settledAt),
        'settled_at instant preserved',
      );
      // The DEFAULT-now() row still has a recent instant (conversion did
      // not blank or shift it).
      const defaulted = await sql<{ opened_at: Date }>`
        SELECT opened_at FROM van_sales_trips WHERE id = 2
      `.execute(db);
      const defaultMs = new Date(defaulted.rows[0]!.opened_at).getTime();
      assert.ok(
        Math.abs(Date.now() - defaultMs) < 60_000,
        'DEFAULT now() row keeps a recent instant after conversion',
      );

      const counts = await sql<{ n: string }>`
        SELECT (SELECT COUNT(*) FROM van_sales_trips)
          + (SELECT COUNT(*) FROM van_field_visits)
          + (SELECT COUNT(*) FROM sales) AS n
      `.execute(db);
      assert.equal(Number(counts.rows[0]!.n), 5, 'no row lost or gained by the migration');

      // up() is idempotent: a second run is a no-op, not an error.
      await p9Migration.up(db as never);
      assert.equal(
        await columnType(db, 'van_sales_trips', 'opened_at'),
        'timestamp with time zone',
        'second up() keeps timestamptz',
      );

      // down() reverses the type change with the wall time intact.
      // (A naive column has no instant: compare wall-clock text, not
      // a Date — node-postgres parses naive timestamps in the HOST
      // zone, so a getTime() comparison would be zone-dependent.)
      await p9Migration.down?.(db as never);
      assert.equal(
        await columnType(db, 'van_sales_trips', 'opened_at'),
        'timestamp without time zone',
        'down() restores naive TIMESTAMP',
      );
      const back = await sql<{ wall: string }>`
        SELECT opened_at::text AS wall FROM van_sales_trips WHERE id = 1
      `.execute(db);
      assert.ok(
        String(back.rows[0]!.wall).startsWith('2026-04-08 23:30:00'),
        `down() round-trips the wall time, got ${back.rows[0]!.wall}`,
      );
    } finally {
      await db.destroy();
    }
  }

  // ── §B. Migration 0328: the 22 CURRENT_DATE defaults are gone ───────────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      // One table per entry — group columns so a table with two dated
      // columns (import_broker_expenses) is created exactly once.
      const tables = new Map<string, string[]>();
      for (const { table, column } of DATE_DEFAULT_COLUMNS) {
        const cols = tables.get(table) ?? [];
        cols.push(column);
        tables.set(table, cols);
      }
      for (const [table, columns] of tables) {
        let builder = db.schema
          .createTable(table)
          .addColumn('id', 'serial', (col) => col.primaryKey());
        for (const column of columns) {
          builder = builder.addColumn(column, 'date', (col) =>
            col.notNull().defaultTo(sql`CURRENT_DATE`),
          );
        }
        await builder.execute();
      }
      for (const { table, column } of DATE_DEFAULT_COLUMNS) {
        assert.equal(
          await columnDefault(db, table, column),
          'CURRENT_DATE',
          `${table}.${column} starts with a CURRENT_DATE default`,
        );
      }

      await p9Migration.up(db as never);

      for (const { table, column } of DATE_DEFAULT_COLUMNS) {
        assert.equal(
          await columnDefault(db, table, column),
          null,
          `${table}.${column} has no default after up()`,
        );
      }

      // An insert that omits the date now FAILS (NOT NULL, no default to
      // hide behind) — this is what forces every writer to supply the
      // tenant day, and proves the defaults are really gone.
      await assert.rejects(
        sql`INSERT INTO customer_installments (id) VALUES (1)`.execute(db),
        'installment insert without start_date must fail',
      );
      await assert.rejects(
        sql`INSERT INTO import_broker_expenses (id) VALUES (1)`.execute(db),
        'broker-expense insert without dates must fail',
      );
      await assert.rejects(
        sql`INSERT INTO contracting_equipment_fuel_logs (id) VALUES (1)`.execute(db),
        'fuel-log insert without log_date must fail',
      );

      // An insert WITH the tenant day succeeds and reads back exactly.
      await sql`INSERT INTO customer_installments (id, start_date) VALUES (2, '2026-04-08')`.execute(
        db,
      );
      const row = await sql<{ start_date: string }>`
        SELECT start_date::text AS start_date FROM customer_installments WHERE id = 2
      `.execute(db);
      assert.equal(row.rows[0]!.start_date, '2026-04-08', 'tenant day stores verbatim');
    } finally {
      await db.destroy();
    }
  }

  // ── §C. Source pins for the five one-line seams ─────────────────────────
  {
    const drawer = readSource('../../src/modules/cash-drawer/cash-drawer-write.service.ts');
    assert.ok(drawer.includes('const closeNow = new Date();'), 'close captures one instant');
    assert.ok(
      drawer.includes('closed_at = ${closeNow}'),
      'close stamps closed_at with the captured instant',
    );
    assert.ok(!drawer.includes('closed_at = now()'), 'no DB now() left on the close stamp');
    assert.ok(drawer.includes('const reviewNow = new Date();'), 'review captures one instant');
    assert.ok(
      drawer.includes('rejectedAt: reviewNow.toISOString()'),
      'rejection stamp uses the review instant',
    );
    assert.ok(
      drawer.includes('reviewedAt: reviewNow.toISOString()'),
      'review stamp uses the review instant',
    );
    assert.ok(
      drawer.includes('updated_at = ${reviewNow}'),
      'review stamps updated_at with the review instant',
    );
    assert.ok(
      drawer.includes('closed_at = coalesce(closed_at, ${reviewNow})'),
      'review stamps closed_at with the review instant',
    );
    assert.ok(!drawer.includes('updated_at = now()'), 'no DB now() left on the review stamps');

    const contracting = readSource('../../src/modules/contracting/services/contracting-quality.service.ts');
    // Fuel-log methods moved into the documents slice at the C14 merge
    // (merge fallback); their pin reads the documents slice,
    // assertion text unchanged.
    const contractingFuelLogs = readSource('../../src/modules/contracting/services/contracting-documents.service.ts');
    assert.ok(
      contractingFuelLogs.includes(
        'log_date: dto.logDate || (await resolveBusinessDateKey(this.db, tenantId, new Date()))',
      ),
      'fuel-log fallback is the tenant day, not a host-local Date',
    );
    assert.ok(
      !contractingFuelLogs.includes('log_date: dto.logDate || new Date()'),
      'fuel-log host-local fallback is gone',
    );
    assert.ok(
      contracting.includes(
        'submission_date: dto.submissionDate || todayTenantDate(businessTz, new Date())',
      ),
      'submittal fallback is the tenant day',
    );
    assert.ok(
      !contracting.includes('submission_date: dto.submissionDate || new Date()'),
      'submittal host-local fallback is gone',
    );
    assert.ok(
      contracting.includes(
        'occurrence_date: dto.occurrenceDate || todayTenantDate(businessTz, new Date())',
      ),
      'backcharge fallback is the tenant day',
    );
    assert.ok(
      !contracting.includes('occurrence_date: dto.occurrenceDate || new Date()'),
      'backcharge host-local fallback is gone',
    );

    // liquidateBrokerExpenses lives in the treasury slice since the
    // import-sales split (slice S9); the pin follows the method, the
    // assertion text is unchanged.
    const treasury = readSource('../../src/modules/import-sales/services/import-treasury.service.ts');
    assert.ok(
      treasury.includes(
        'payment_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),',
      ),
      'broker-expense insert supplies payment_date as the tenant day',
    );

    const saas = readSource('../../src/modules/saas-admin/saas-admin/saas-admin-subscriptions.ts');
    assert.ok(
      saas.includes('checkClientBusinessDay(body.date, tenantTz,'),
      'recordPayment bounds the supplied date through the P6 helper',
    );
    assert.ok(
      saas.includes('minDayOffset: -CLIENT_BUSINESS_DATE_PAST_DAYS'),
      'recordPayment uses the P6 past window',
    );
    assert.ok(
      !saas.includes('paid_at: body.date ? new Date(body.date) : now'),
      'recordPayment no longer stamps the client date verbatim',
    );

    // Van trip/visit stamps stay DB-stamped (NOW()): the migration's
    // type change is the fix, and no app code may start supplying
    // these columns as JS Dates. File #43 split: the open stamp lives
    // in the S3 trip-open-load slice; the visit stamps live in S3/S4/S5,
    // so the negatives must hold in every slice that writes one.
    const tripOpenLoad = readSource(
      '../../src/modules/delivery-reps/services/van-trip-lifecycle/trip-open-load.service.ts',
    );
    assert.ok(tripOpenLoad.includes('opened_at: sql`NOW()`'), 'trip open stays DB-stamped');
    assert.ok(!tripOpenLoad.includes('opened_at: new Date()'), 'trip open is never app-stamped');
    assert.ok(!tripOpenLoad.includes('visited_at: new Date()'), 'visit is never app-stamped');
    const submitSettlement = readSource(
      '../../src/modules/delivery-reps/services/van-trip-lifecycle/submit-settlement.service.ts',
    );
    assert.ok(!submitSettlement.includes('visited_at: new Date()'), 'submit visit is never app-stamped');
    const settleTrip = readSource(
      '../../src/modules/delivery-reps/services/van-trip-lifecycle/settle-trip.service.ts',
    );
    assert.ok(!settleTrip.includes('visited_at: new Date()'), 'settle visit is never app-stamped');
    // File #52 split: the field-visit insert now lives in the S1 slice.
    const fieldSales = readSource(
      '../../src/modules/delivery-reps/services/van-field-sales/execute-field-sale-internal.ts',
    );
    assert.ok(fieldSales.includes('visited_at: sql`NOW()`'), 'field-visit stamp stays DB-stamped');
  }

  console.log('clock-p9-stamp-unification.spec: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
