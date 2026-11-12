/*
 * R5-D (INV-REST-FLOOR-STATE-TRUTH): floor design mode is manager-only,
 * a held draft is renamed by table_number only, and reservation days are
 * tenant-local.
 *
 * - saveTableLayouts: at base any authenticated user can overwrite the
 *   shared floor layout (class-level @AllowAuthenticated(), no gate).
 *   After the fix a non-manager caller gets 403 MANAGER_PERMISSION_REQUIRED
 *   (same assertManagerCaller shape as the FNB comp/tip endpoints) while a
 *   manager save still lands.
 * - renameHeldDraftTable: at base there is no rename at all — whole-table
 *   transfer only renamed in-memory state (PosWorkspace onTransferTable).
 *   After the fix the endpoint updates ONLY held_sales.table_number:
 *   every other column is byte-identical, and a target table that already
 *   holds a draft is refused with 409 HELD_DRAFT_TABLE_OCCUPIED.
 * - listReservations: at base the day window is UTC midnight
 *   (dateT00:00:00.000Z .. dateT23:59:59.999Z) while reservation_time is
 *   stored from client wall time. A 01:00 Cairo reservation on 2026-11-09
 *   is 2026-11-08T23:00Z, so it falls outside the UTC window for its own
 *   day. After the fix the window is the tenant-local day, so the
 *   reservation is listed under 2026-11-09.
 *
 * RED PROOF: on the unfixed tree the cashier save succeeds (no 403),
 * renameHeldDraftTable does not exist (TypeError), and the 01:00 Cairo
 * reservation is missing from the 2026-11-09 list.
 *
 * INV-REST-FLOOR-SAVE-MANAGER-FORWARD (2026-11-12): the R5-D gate above
 * was wired wrong at the controller — saveTableLayouts passed the bare
 * requireTenantScope() result ({ tenantId, accountId } only) to the
 * service, so assertManagerCaller saw role undefined / permissions [] and
 * refused EVERY save with 403, manager included. The service-level checks
 * (1)/(2) pass on both trees because they hand the service a full scope;
 * only the controller-level checks (7)/(8) below catch the wiring, by
 * calling the controller with a real req.authContext the way the POS does.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  RestaurantAdvancedFnbService,
  type TenantScope,
} from '../../src/modules/sales/services/restaurant-advanced-fnb.service';
import { TableReservationsService } from '../../src/modules/sales/services/table-reservations.service';
import { RestaurantAdvancedFnbController } from '../../src/modules/sales/controllers/restaurant-advanced-fnb.controller';

const TENANT = 't1';
const ACCOUNT = 't1:main';

const DDL = `
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE restaurant_table_layouts (id bigserial PRIMARY KEY, tenant_id text,
    branch_id bigint, table_number text, zone_code text, shape text,
    x_pos numeric, y_pos numeric, width numeric, height numeric, seats int,
    rotation numeric, is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text,
    table_number text, order_type text, customer_id bigint, payment_type text,
    payment_channel text, paid_amount numeric, cash_amount numeric, card_amount numeric,
    discount numeric, delivery_fee numeric, note text, search text, price_type text,
    branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint,
    collection_status text, created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW());
  CREATE TABLE restaurant_table_reservations (id bigserial PRIMARY KEY, tenant_id text,
    branch_id bigint, table_number text, guest_name text, guest_phone text,
    guest_count int, reservation_time timestamptz, status text,
    special_requests text, reservation_type text, created_by bigint,
    created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  return { pg, db };
}

async function resetDb(pg: PGlite): Promise<void> {
  await pg.exec(
    `TRUNCATE settings, restaurant_table_layouts, held_sales, restaurant_table_reservations RESTART IDENTITY`,
  );
}

const managerScope: TenantScope = { tenantId: TENANT, accountId: ACCOUNT, role: 'admin', permissions: [], userId: 1 };
const cashierScope: TenantScope = { tenantId: TENANT, accountId: ACCOUNT, role: 'cashier', permissions: ['sales'], userId: 2 };

async function expectAppError(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, code, `expected AppError ${code}, got ${error?.code}: ${error?.message}`);
    assert.equal(error?.statusCode, statusCode, `expected status ${statusCode}, got ${error?.statusCode}`);
    return;
  }
  assert.fail(`expected AppError ${code} but the call succeeded`);
}

async function seedHeldDraft(
  db: Kysely<Database>,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await (db as any)
    .insertInto('held_sales')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      table_number: '5',
      order_type: 'dine_in',
      customer_id: null,
      payment_type: 'cash',
      payment_channel: 'cash',
      paid_amount: 100,
      cash_amount: 100,
      card_amount: 0,
      discount: 5,
      delivery_fee: 0,
      note: 'keep-me',
      search: '',
      price_type: 'retail',
      branch_id: null,
      location_id: null,
      created_by: 1,
      delivery_rep_id: null,
      collection_status: null,
      ...overrides,
    })
    .returning('id')
    .execute();
  return Number(row.id);
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    const service = new RestaurantAdvancedFnbService(db as any);
    const reservations = new TableReservationsService(db as any);

    // (1) A cashier caller cannot save the floor layout.
    {
      await resetDb(pg);
      await expectAppError(
        service.saveTableLayouts(cashierScope, [
          { table_number: '1', shape: 'square', x_pos: 10, y_pos: 10 },
        ]),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      const rows: any = await pg.query(`SELECT COUNT(*)::int AS n FROM restaurant_table_layouts`);
      assert.equal(Number(rows.rows[0].n), 0, 'the refused save must write nothing');
      console.log('  (1) cashier saveTableLayouts refused with 403 passed');
    }

    // (2) A manager save still lands.
    {
      await resetDb(pg);
      const saved: any = await service.saveTableLayouts(managerScope, [
        { table_number: '1', shape: 'square', x_pos: 10, y_pos: 10, width: 100, height: 78 },
      ]);
      assert.equal(saved.length, 1);
      assert.equal(String(saved[0].table_number), '1');
      console.log('  (2) manager saveTableLayouts still lands passed');
    }

    // (3) Rename updates ONLY table_number; every other field is untouched.
    {
      await resetDb(pg);
      const id = await seedHeldDraft(db);
      const renamed: any = await (service as any).renameHeldDraftTable(managerScope, id, '9');
      assert.equal(String(renamed.table_number), '9');
      const rows: any = await pg.query(
        `SELECT table_number, order_type, paid_amount, discount, note, payment_type, price_type
         FROM held_sales WHERE id = $1`,
        [id],
      );
      const row = rows.rows[0];
      assert.equal(row.table_number, '9');
      assert.equal(row.order_type, 'dine_in');
      assert.equal(Number(row.paid_amount), 100);
      assert.equal(Number(row.discount), 5);
      assert.equal(row.note, 'keep-me');
      assert.equal(row.payment_type, 'cash');
      assert.equal(row.price_type, 'retail');
      console.log('  (3) rename changes table_number only passed');
    }

    // (4) Renaming onto a table that already holds a draft is refused.
    {
      await resetDb(pg);
      const id = await seedHeldDraft(db, { table_number: '5' });
      await seedHeldDraft(db, { table_number: '9' });
      await expectAppError(
        (service as any).renameHeldDraftTable(managerScope, id, '9'),
        'HELD_DRAFT_TABLE_OCCUPIED',
        409,
      );
      const rows: any = await pg.query(`SELECT table_number FROM held_sales WHERE id = $1`, [id]);
      assert.equal(rows.rows[0].table_number, '5', 'the refused rename must leave the draft on its table');
      console.log('  (4) rename onto an occupied table refused passed');
    }

    // (5) Renaming a missing draft is a 404, not a silent no-op.
    {
      await resetDb(pg);
      await expectAppError(
        (service as any).renameHeldDraftTable(managerScope, 9999, '9'),
        'HELD_DRAFT_NOT_FOUND',
        404,
      );
      console.log('  (5) rename of a missing draft is 404 passed');
    }

    // (6) A 01:00 Cairo reservation lists under its own tenant-local day.
    {
      await resetDb(pg);
      await (db as any).insertInto('settings').values({
        tenant_id: TENANT, key: 'timezone', value: '"Africa/Cairo"',
      }).execute();
      await (db as any).insertInto('restaurant_table_reservations').values({
        tenant_id: TENANT,
        branch_id: null,
        table_number: '5',
        guest_name: 'ضيف الفجر',
        guest_phone: null,
        guest_count: 2,
        // 01:00 Cairo (UTC+2) on 2026-11-09 = 2026-11-08T23:00:00Z.
        reservation_time: new Date('2026-11-08T23:00:00.000Z'),
        status: 'confirmed',
        special_requests: null,
        reservation_type: 'reservation',
        created_by: 1,
      }).execute();
      const listed: any[] = await reservations.listReservations(TENANT, undefined, '2026-11-09');
      assert.equal(listed.length, 1, 'the 01:00 Cairo reservation must list under 2026-11-09');
      assert.equal(String(listed[0].table_number), '5');
      // And it must NOT leak into the previous day.
      const prevDay: any[] = await reservations.listReservations(TENANT, undefined, '2026-11-08');
      assert.equal(prevDay.length, 0, 'the reservation must not leak into 2026-11-08');
      console.log('  (6) tenant-local reservation day window passed');
    }

    // (7) Through the CONTROLLER, a manager save lands: the controller
    // must forward role/permissions from req.authContext to the service
    // gate (requireTenantScope alone carries neither).
    {
      await resetDb(pg);
      const controller = new RestaurantAdvancedFnbController(service);
      const managerReq: any = {
        authContext: {
          userId: 1, sessionId: 's1', username: 'admin',
          role: 'admin', permissions: [], tenantId: TENANT, accountId: ACCOUNT,
        },
      };
      const saved: any = await controller.saveTableLayouts(managerReq, {
        layouts: [{ table_number: '1', shape: 'square', x_pos: 10, y_pos: 10, width: 100, height: 78 }],
      });
      assert.equal(saved.length, 1);
      assert.equal(String(saved[0].table_number), '1');
      console.log('  (7) controller manager saveTableLayouts lands passed');
    }

    // (8) Through the CONTROLLER, a cashier save is still refused 403
    // and writes nothing.
    {
      await resetDb(pg);
      const controller = new RestaurantAdvancedFnbController(service);
      const cashierReq: any = {
        authContext: {
          userId: 2, sessionId: 's2', username: 'cashier',
          role: 'cashier', permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
        },
      };
      await expectAppError(
        controller.saveTableLayouts(cashierReq, {
          layouts: [{ table_number: '1', shape: 'square', x_pos: 10, y_pos: 10 }],
        }),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      const rows: any = await pg.query(`SELECT COUNT(*)::int AS n FROM restaurant_table_layouts`);
      assert.equal(Number(rows.rows[0].n), 0, 'the refused controller save must write nothing');
      console.log('  (8) controller cashier saveTableLayouts refused with 403 passed');
    }

    console.log('restaurant-floor-state.spec: all checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
