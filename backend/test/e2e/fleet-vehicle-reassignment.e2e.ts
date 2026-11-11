import 'dotenv/config';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import type { Database } from '../../src/database/database.types';
import type { AuditService } from '../../src/core/audit/audit.service';
import type { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

// Regression coverage for fleet vehicle handover safety. Before this fix, reassignVehicleRep did not
// exist: createFleetVehicle/updateFleetVehicle/assignVehicleRep each wrote directly to
// fleet_vehicles/delivery_representatives with no checks at all, which let:
//   - the same rep be "assigned" to two vehicles at once (the fleet list would show them driving
//     both, while their own van_location_id only ever points at whichever vehicle was assigned last);
//   - a vehicle be handed to a new rep while its outgoing rep still had an open, unsettled trip,
//     so both reps' van_location_id pointed at the same physical stock location simultaneously and
//     a second trip could open against stock the first trip's settlement hadn't accounted for yet;
//   - the outgoing rep's own van_location_id to keep pointing at a vehicle they no longer drive.
// This drives the real VanSalesService against a live database and cleans up in a `finally` block
// scoped to one disposable tenant id (same reasoning as van-sales-field-flow.e2e.ts: the service
// opens its own top-level transactions per call, so the whole flow cannot be one rolled-back
// transaction the way a single-call e2e test can).

const TENANT = '__fleet_reassign_verify_tmp__';
const ACCOUNT = 'e2e-fleet-reassign';

async function cleanup(db: Kysely<Database>): Promise<void> {
  const dbAny = db as any;
  await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${TENANT})`.execute(db);
  const tables = [
    'journal_entries',
    'accounting_posting_failures',
    'van_sales_trips',
    'stock_movements',
    'product_location_stock',
    'products',
    'fleet_vehicles',
    'delivery_representatives',
    'stock_locations',
    'accounting_settings',
    'accounting_accounts',
    'users',
    'branches',
  ];
  for (const table of tables) {
    await dbAny.deleteFrom(table).where('tenant_id', '=', TENANT).execute();
  }
}

async function main(): Promise<void> {
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    application_name: 'backend-e2e-fleet-reassign',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const dbAny = db as any;

  await cleanup(db); // in case a previous failed run left rows behind

  try {
    const branch = await dbAny
      .insertInto('branches')
      .values({ name: `Fleet Test Branch ${Date.now()}`, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const warehouse = await dbAny
      .insertInto('stock_locations')
      .values({ name: 'Main Warehouse', branch_id: branch.id, location_type: 'internal_warehouse', is_active: true, tenant_id: TENANT, account_id: ACCOUNT })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const product = await dbAny
      .insertInto('products')
      .values({ name: 'Fleet Test Product', cost_price: 5, retail_price: 10, stock_qty: 50, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    await dbAny
      .insertInto('product_location_stock')
      .values({ product_id: product.id, location_id: warehouse.id, branch_id: branch.id, qty: 50, tenant_id: TENANT, account_id: ACCOUNT })
      .execute();

    const repA = await dbAny
      .insertInto('delivery_representatives')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep A', is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const repB = await dbAny
      .insertInto('delivery_representatives')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep B', is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const foundation = new AccountingTenantFoundationService();
    const accountingPosting = new AccountingPostingService(foundation);
    const vanSales = new VanSalesService(db, {} as AuditService, {} as DeliveryRepsService, accountingPosting);

    // --- 1. Assign Rep A to Vehicle 1 -------------------------------------------------------
    const created = await vanSales.createFleetVehicle(TENANT, ACCOUNT, {
      plateNumber: 'ABC-1',
      assignedRepId: Number(repA.id),
    });
    const vehicle1 = created.find((v: any) => v.plateNumber === 'ABC-1')!;
    assert.equal(vehicle1.assignedRepId, Number(repA.id));
    assert.equal(vehicle1.status, 'assigned');

    let repARow = await dbAny.selectFrom('delivery_representatives').select(['van_location_id']).where('id', '=', repA.id).executeTakeFirstOrThrow();
    assert.equal(Number(repARow.van_location_id), Number(vehicle1.vanLocationId), "Rep A's own pointer follows the vehicle they were assigned");

    // --- 2. Register Vehicle 2, try to assign Rep A to it too -> must be rejected ----------
    const vehicles2 = await vanSales.createFleetVehicle(TENANT, ACCOUNT, { plateNumber: 'ABC-2' });
    const vehicle2 = vehicles2.find((v: any) => v.plateNumber === 'ABC-2')!;

    await assert.rejects(
      () => vanSales.assignVehicleRep(TENANT, vehicle2.id, Number(repA.id)),
      (err: any) => err.code === 'REP_ALREADY_ASSIGNED_TO_VEHICLE',
      'a rep already driving one vehicle must not be assignable to a second one',
    );

    // --- 3. Rep A opens a trip on Vehicle 1 and leaves it open ------------------------------
    const trip = await vanSales.openTripAndLoad(Number(repA.id), TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      items: [{ productId: Number(product.id), qty: 5 }],
    });
    assert.equal(trip.ok, true);

    // --- 4. Reassigning Vehicle 1 to Rep B while that trip is open must be rejected ---------
    await assert.rejects(
      () => vanSales.assignVehicleRep(TENANT, vehicle1.id, Number(repB.id)),
      (err: any) => err.code === 'VEHICLE_HAS_OPEN_TRIP',
      'a vehicle with an open, unsettled trip must not change hands until it is settled',
    );

    // --- 5. Settle Rep A's trip, then the handover must succeed -----------------------------
    await vanSales.settleTrip(Number(repA.id), TENANT, ACCOUNT, {
      tripId: trip.tripId,
      countedCash: 0,
      countedStock: [{ productId: Number(product.id), countedQty: 5 }],
      unloadRemainingToWarehouse: true,
    });

    const afterHandover = await vanSales.assignVehicleRep(TENANT, vehicle1.id, Number(repB.id));
    const vehicle1AfterHandover = afterHandover.find((v: any) => v.id === vehicle1.id)!;
    assert.equal(vehicle1AfterHandover.assignedRepId, Number(repB.id));

    repARow = await dbAny.selectFrom('delivery_representatives').select(['van_location_id']).where('id', '=', repA.id).executeTakeFirstOrThrow();
    assert.equal(repARow.van_location_id, null, "the OUTGOING rep's pointer must be cleared on handover — this was the exact bug that let two reps share one van's stock");

    const repBRow = await dbAny.selectFrom('delivery_representatives').select(['van_location_id']).where('id', '=', repB.id).executeTakeFirstOrThrow();
    assert.equal(Number(repBRow.van_location_id), Number(vehicle1.vanLocationId), "the INCOMING rep now points at the same vehicle location Rep A used to");

    // --- 6. Reassigning to the exact same rep already assigned is a harmless no-op ---------
    const noop = await vanSales.assignVehicleRep(TENANT, vehicle1.id, Number(repB.id));
    assert.equal(noop.find((v: any) => v.id === vehicle1.id)!.assignedRepId, Number(repB.id));

    // --- 7. Vehicle status is validated ------------------------------------------------------
    await assert.rejects(
      () => vanSales.updateFleetVehicle(TENANT, ACCOUNT, vehicle2.id, { status: 'not_a_real_status' }),
      (err: any) => err.code === 'INVALID_VEHICLE_STATUS',
      'an unrecognized status string must be rejected, not silently stored',
    );

    process.stdout.write('fleet-vehicle-reassignment.e2e: all checks passed\n');
  } finally {
    await cleanup(db);
    await pool.end();
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`fleet-vehicle-reassignment.e2e failed:\n${details}\n`);
  process.exit(1);
});
