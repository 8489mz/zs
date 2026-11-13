/*
 * New file: backend/test/critical/driver-requisition-dto-whitelist.spec.ts
 *
 * WHAT THIS PINS (INV-DRIVER-REQUISITION-DTO-WHITELIST): a driver could
 * send `allowMultiplePending: true` on POST /api/driver-portal/van-sales/
 * requisitions and bypass the single-pending-requisition rule, because
 * the route took an inline @Body() type (no DTO class), so the global
 * validation pipe (whitelist + forbidNonWhitelisted) never stripped or
 * rejected the flag, and submitLoadRequisition forwarded the raw body
 * verbatim into VanRequisitionsService, which honours the flag.
 *
 * THE FIX (two layers, both pinned here):
 * (1) the driver route now takes SubmitLoadRequisitionDto, which has
 *     NO allowMultiplePending property — the real global
 *     requestValidationPipe rejects a driver-sent flag with
 *     VALIDATION_ERROR (400) before the controller ever runs;
 * (2) the driver controller explicitly passes allowMultiplePending:
 *     false into the shared funnel, so even a body that survived the
 *     boundary can never bypass the pending check. The admin funnel
 *     (createLoadRequisitionByAdmin) is untouched and still sets the
 *     flag from dispatchImmediately — the legitimate supplementary-load
 *     path is preserved.
 *
 * WHAT IS DRIVEN (real PGlite, real code — no mocks except the two
 * seams the production code itself owns: a stubbed verifyDriverToken
 * for the controller call and a stubbed approveAndDispatchRequisition
 * for the admin funnel):
 * (a) a driver WITH a pending requisition who sends
 *     allowMultiplePending: true is REFUSED at the DTO boundary (400
 *     VALIDATION_ERROR), and at the service level with the
 *     controller-forced false (PENDING_REQUISITION_EXISTS);
 * (b) the driver controller passes allowMultiplePending: false to the
 *     service even when the body it receives carries no flag;
 * (c) a driver WITHOUT a pending requisition can submit normally;
 * (d) the admin route with dispatchImmediately still allows multiple
 *     pending (the supplementary-load flow is preserved);
 * (e) the DTO rejects other unknown fields (dispatchImmediately) and
 *     the REAL driver frontend payload passes the pipe — per item the
 *     frontend always sends unitName / isWeight / packingText plus the
 *     carton breakdown (cartons / pieces / cartonMultiplier /
 *     packagingUnitName) when defined, so the DTO must whitelist
 *     those display fields while still rejecting allowMultiplePending.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app —
 * the pipe instance driven here IS the global one registered in
 * main.ts); a live Postgres run (PGlite only); the frontend screens
 * (untouched — the driver frontend sends the per-item display fields
 * listed under (e), which is exactly what this spec drives).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesController } from '../../src/modules/delivery-reps/van-sales.controller';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanRequisitionsService } from '../../src/modules/delivery-reps/services/van-requisitions.service';
import { SubmitLoadRequisitionDto } from '../../src/modules/delivery-reps/dto/submit-load-requisition.dto';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { AppError } from '../../src/common/errors/app-error';

const TENANT = 't1';
const ACCOUNT = 'a1';
const REP_ID = 4;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, rep_id bigint, source_warehouse_id bigint, status text, requested_items text, approved_items text, notes text, rejection_reason text, trip_id bigint, reviewed_by bigint, reviewed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedWarehouse(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('stock_locations').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1,
    name: 'Warehouse', code: 'WH', is_active: true, location_type: 'branch_stock',
  }).execute();
}

async function seedPendingRequisition(db: Kysely<Database>, repId: number): Promise<number> {
  const [inserted] = await (db as any).insertInto('van_load_requisitions').values({
    tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'REQ-260101-0001', rep_id: repId,
    source_warehouse_id: 1, status: 'pending', requested_items: '[]', approved_items: '[]',
    notes: null, rejection_reason: null, trip_id: null, reviewed_by: null,
  }).returning(['id']).execute();
  return Number(inserted.id);
}

async function countPending(db: Kysely<Database>, repId: number): Promise<number> {
  const rows = await (db as any)
    .selectFrom('van_load_requisitions')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('rep_id', '=', repId)
    .where('status', '=', 'pending')
    .execute();
  return rows.length;
}

function buildReqService(db: Kysely<Database>): any {
  const service = Object.create(VanRequisitionsService.prototype);
  service.db = db;
  return service;
}

function isValidationError(err: unknown): boolean {
  return (
    err instanceof BadRequestException &&
    (err.getResponse() as { code?: string }).code === 'VALIDATION_ERROR'
  );
}

function isPendingExists(err: unknown): boolean {
  return err instanceof AppError && (err as AppError).code === 'PENDING_REQUISITION_EXISTS';
}

async function main(): Promise<void> {
  // (a1) DTO boundary: a driver body carrying allowMultiplePending is
  // refused by the real global pipe with VALIDATION_ERROR.
  {
    await assert.rejects(
      () =>
        requestValidationPipe.transform(
          {
            sourceWarehouseId: 1,
            items: [{ productId: 10, qty: 2 }],
            allowMultiplePending: true,
          },
          { type: 'body', metatype: SubmitLoadRequisitionDto },
        ),
      isValidationError,
      'the pipe must refuse allowMultiplePending from the driver route',
    );
    console.log('  (a1) pipe rejects driver allowMultiplePending with VALIDATION_ERROR passed');
  }

  // (a2) Service level with the controller-forced false: a driver WITH
  // a pending requisition is refused PENDING_REQUISITION_EXISTS even
  // though the raw body tried to set the flag.
  {
    const { db } = await makeDb();
    try {
      await seedWarehouse(db);
      await seedPendingRequisition(db, REP_ID);
      const service = buildReqService(db);
      await assert.rejects(
        () =>
          service.submitLoadRequisition(REP_ID, TENANT, ACCOUNT, {
            sourceWarehouseId: 1,
            items: [{ productId: 10, qty: 2 }],
            allowMultiplePending: false,
          }),
        isPendingExists,
        'the forced false must keep the pending check active',
      );
      assert.equal(await countPending(db, REP_ID), 1, 'no second pending requisition was created');
    } finally {
      await db.destroy();
    }
    console.log('  (a2) service refuses second pending with controller-forced false passed');
  }

  // (b) The driver controller itself passes allowMultiplePending:
  // false into the shared funnel.
  {
    let captured: any = null;
    const controller = Object.create(VanSalesController.prototype);
    controller.deliveryRepsService = {
      verifyDriverToken: async () => ({ repId: REP_ID, tenantId: TENANT, accountId: ACCOUNT }),
      // verifyDriver (INV-DRIVER-PIN-FIRST-LOGIN-CHANGE) re-derives the
      // default-PIN flag from the live hash on every driver endpoint —
      // the stub must answer it or the controller call never runs.
      assertDriverPinChanged: async () => undefined,
    };
    controller.vanSalesService = {
      submitLoadRequisition: async (_repId: number, _tenantId: string, _accountId: string, payload: any) => {
        captured = payload;
        return { ok: true, docNo: 'REQ-X', requisitionId: 1 };
      },
    };
    const res = await controller.submitLoadRequisition('Bearer driver-token', {
      sourceWarehouseId: 1,
      items: [{ productId: 10, qty: 2 }],
      notes: 'morning load',
    });
    assert.equal(res.ok, true, 'the controller forwards the submission');
    assert.equal(captured.allowMultiplePending, false, 'the controller forces allowMultiplePending false');
    assert.equal(captured.sourceWarehouseId, 1, 'the warehouse survives');
    assert.equal(captured.notes, 'morning load', 'the notes survive');
    assert.deepEqual(captured.items, [{ productId: 10, qty: 2 }], 'the items survive');
    console.log('  (b) driver controller forces allowMultiplePending false passed');
  }

  // (c) A driver WITHOUT a pending requisition can submit normally.
  {
    const { db } = await makeDb();
    try {
      await seedWarehouse(db);
      const service = buildReqService(db);
      const res = await service.submitLoadRequisition(REP_ID, TENANT, ACCOUNT, {
        sourceWarehouseId: 1,
        items: [{ productId: 10, qty: 2 }],
        notes: 'morning load',
        allowMultiplePending: false,
      });
      assert.equal(res.ok, true, 'the submission succeeds');
      assert.ok(Number(res.requisitionId) > 0, 'the requisition has an id');
      assert.match(res.docNo, /^REQ-\d{6}-\d{4}$/, 'the doc number follows the daily format');
      assert.equal(await countPending(db, REP_ID), 1, 'exactly one pending requisition exists');
      const row = await (db as any)
        .selectFrom('van_load_requisitions')
        .selectAll()
        .where('id', '=', Number(res.requisitionId))
        .executeTakeFirst();
      assert.equal(row.status, 'pending', 'the created requisition is pending');
      assert.equal(Number(row.source_warehouse_id), 1, 'the warehouse is recorded');
    } finally {
      await db.destroy();
    }
    console.log('  (c) driver without pending submits normally passed');
  }

  // (d) The admin route with dispatchImmediately still allows multiple
  // pending — the legitimate supplementary-load flow is preserved.
  {
    const { db } = await makeDb();
    try {
      await seedWarehouse(db);
      await seedPendingRequisition(db, REP_ID);
      const reqService = buildReqService(db);
      const vanService = Object.create(VanSalesService.prototype);
      vanService.vanRequisitionsService = reqService;
      vanService.approveAndDispatchRequisition = async () => ({
        ok: true, tripId: 50, isSupplementary: true,
      });
      const res = await vanService.createLoadRequisitionByAdmin(TENANT, ACCOUNT, 1, {
        repId: REP_ID,
        sourceWarehouseId: 1,
        items: [{ productId: 15, qty: 12 }],
        dispatchImmediately: true,
      });
      assert.equal(res.ok, true, 'the admin submission succeeds');
      assert.equal(res.dispatched, true, 'the admin requisition dispatches immediately');
      assert.equal(res.isSupplementary, true, 'the dispatch is flagged supplementary');
      assert.equal(await countPending(db, REP_ID), 2, 'the second pending requisition exists');
    } finally {
      await db.destroy();
    }
    console.log('  (d) admin dispatchImmediately still allows multiple pending passed');
  }

  // (e) The DTO rejects other unknown fields too, and a clean driver
  // payload passes the pipe with no allowMultiplePending key on it.
  {
    await assert.rejects(
      () =>
        requestValidationPipe.transform(
          {
            sourceWarehouseId: 1,
            items: [{ productId: 10, qty: 2 }],
            dispatchImmediately: true,
          },
          { type: 'body', metatype: SubmitLoadRequisitionDto },
        ),
      isValidationError,
      'dispatchImmediately is not a driver field either',
    );
    const transformed = (await requestValidationPipe.transform(
      {
        sourceWarehouseId: 1,
        items: [{ productId: 10, qty: 2, sourceWarehouseId: 1, sourceWarehouseName: 'WH' }],
        notes: 'morning load',
      },
      { type: 'body', metatype: SubmitLoadRequisitionDto },
    )) as SubmitLoadRequisitionDto;
    assert.equal(transformed.sourceWarehouseId, 1, 'the warehouse survives the pipe');
    assert.equal(transformed.notes, 'morning load', 'the notes survive the pipe');
    assert.equal(transformed.items.length, 1, 'one item survives the pipe');
    assert.equal(transformed.items[0].productId, 10, 'the item product survives the pipe');
    assert.equal(transformed.items[0].qty, 2, 'the item qty survives the pipe');
    assert.equal(transformed.items[0].sourceWarehouseId, 1, 'the item warehouse survives the pipe');
    assert.equal(transformed.items[0].sourceWarehouseName, 'WH', 'the item warehouse name survives the pipe');
    assert.equal(
      'allowMultiplePending' in (transformed as unknown as Record<string, unknown>),
      false,
      'no allowMultiplePending key reaches the service from a clean driver payload',
    );
    // (e2) The REAL driver frontend payload — DriverNewLoadRequisitionView
    // handleSubmit sends per item, ALWAYS: unitName, isWeight,
    // packingText, plus the carton breakdown (cartons / pieces /
    // cartonMultiplier / packagingUnitName) when defined. The pipe
    // must ACCEPT it (this is the exact payload the live trial sent
    // and got rejected with VALIDATION_ERROR on every submit).
    const realFrontend = (await requestValidationPipe.transform(
      {
        sourceWarehouseId: 1,
        items: [
          { productId: 5, qty: 1, unitName: 'قطعة', isWeight: false, packingText: '1 قطعة' },
          {
            productId: 7, qty: 24, cartons: 2, pieces: 0, cartonMultiplier: 12,
            packagingUnitName: 'كرتونة', unitName: 'قطعة', isWeight: false,
            packingText: '2 كرتونة',
          },
          { productId: 8, qty: 2.5, unitName: 'كجم', isWeight: true, packingText: '2.5 كجم' },
        ],
        notes: 'morning load',
      },
      { type: 'body', metatype: SubmitLoadRequisitionDto },
    )) as SubmitLoadRequisitionDto;
    // The new display fields are read through a Record cast on
    // purpose: before the DTO fix they do not exist on the type at
    // all, so a direct access would fail compilation instead of
    // proving the runtime rejection (VALIDATION_ERROR) at the pipe.
    const rf0 = realFrontend.items[0] as unknown as Record<string, unknown>;
    const rf1 = realFrontend.items[1] as unknown as Record<string, unknown>;
    const rf2 = realFrontend.items[2] as unknown as Record<string, unknown>;
    assert.equal(realFrontend.items.length, 3, 'all three real frontend items survive the pipe');
    assert.equal(rf0.unitName, 'قطعة', 'the piece item unit survives the pipe');
    assert.equal(rf0.isWeight, false, 'the piece item weight flag survives the pipe');
    assert.equal(rf0.packingText, '1 قطعة', 'the piece item packing text survives the pipe');
    assert.equal(rf1.cartons, 2, 'the carton count survives the pipe');
    assert.equal(rf1.pieces, 0, 'the piece remainder survives the pipe');
    assert.equal(rf1.cartonMultiplier, 12, 'the carton multiplier survives the pipe');
    assert.equal(rf1.packagingUnitName, 'كرتونة', 'the packaging unit name survives the pipe');
    assert.equal(rf1.packingText, '2 كرتونة', 'the carton packing text survives the pipe');
    assert.equal(rf2.isWeight, true, 'the weight item flag survives the pipe');
    assert.equal(rf2.packingText, '2.5 كجم', 'the weight item packing text survives the pipe');
    assert.equal(
      'allowMultiplePending' in (realFrontend as unknown as Record<string, unknown>),
      false,
      'no allowMultiplePending key reaches the service from the real frontend payload either',
    );
    console.log('  (e) DTO rejects unknown fields, clean payload passes without the flag passed');
    console.log('  (e2) real driver frontend payload passes the pipe passed');
  }

  // Source pins: the controller forces the flag false and takes the
  // DTO; the DTO itself never mentions the flag.
  {
    const here = __dirname;
    const controllerSource = readFileSync(
      resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'),
      'utf8',
    );
    assert.ok(
      controllerSource.includes('allowMultiplePending: false'),
      'the driver controller forces allowMultiplePending false',
    );
    assert.ok(
      controllerSource.includes('SubmitLoadRequisitionDto'),
      'the driver route takes the DTO class',
    );
    const dtoSource = readFileSync(
      resolve(here, '../../src/modules/delivery-reps/dto/submit-load-requisition.dto.ts'),
      'utf8',
    );
    assert.equal(
      /^\s*allowMultiplePending\s*[?:!]/.test(dtoSource),
      false,
      'the DTO declares no allowMultiplePending property to whitelist (the name appears only in the header comment)',
    );
    assert.ok(
      dtoSource.includes('INV-DRIVER-REQUISITION-DTO-WHITELIST'),
      'the DTO names the invariant',
    );
    console.log('  source pins passed');
  }

  console.log('Driver requisition DTO whitelist tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
