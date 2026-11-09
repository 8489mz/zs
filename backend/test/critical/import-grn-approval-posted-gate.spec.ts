/*
New file: backend/test/critical/import-grn-approval-posted-gate.spec.ts
Pins the GRN approval fail-closed rules (INV-IMPORT-GRN-APPROVAL-POSTED-GATE).

WHAT WAS WRONG (live trial phase 2, problem D10): receipt #1 was already
posted ("سند الاستلام #1 — الحالة: مرحّل", 10/10/0/0 accepted) yet the
GRN approval action ("محضر فحص واستلام (GRN)") was still offered, and
two approval attempts both failed with the generic
"البيانات المدخلة غير صحيحة." — no confirmation screen, no second
posting. Two root causes, both in the GRN approval flow:

(a) The GRN button was unconditional, and the backend endpoint it
posts to (POST /api/import-sales/qc-inspections, createQcInspection)
had no posted-receipt check and no duplicate check at all: it blindly
inserted a QC row on every call, so a second approval would have
recorded a second GRN.
(b) The dialog posted fields the DTO never declares
(warehouseLocationId, overallStatus, notes, items) and omitted the
DTO's two required fields (stage, inspectionDate). The global
validation pipe (whitelist + forbidNonWhitelisted + stopAtFirstError)
rejected every submit with code VALIDATION_ERROR and a specific
field message — but the frontend http layer maps that code to the
generic 'البيانات المدخلة غير صحيحة.', discarding the specific
message. The frontend payload mapping + error rescue are pinned by
frontend/src/features/import-sales/api/receiving-inspection-contract.spec.tsx.

WHAT THIS PINS, driving the real createQcInspection on PGlite:
- Unposted receipt (no receipt row, or a frozen/non-posted receipt):
  a receiving-stage inspection records exactly once.
- A second receiving-stage inspection for the same shipment is
  refused with IMPORT_GRN_ALREADY_RECORDED and no second row.
- A posted receipt refuses the receiving inspection with
  IMPORT_GRN_RECEIPT_ALREADY_POSTED and no row at all.
- The gates are scoped to the GRN stage ('receiving'): other QC
  stages (e.g. pre-shipment checks in China) are unaffected even
  when a receipt is posted.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, stage text, inspection_date date, inspector_name text, sample_size int, passed_quantity int, failed_quantity int, defect_notes text, status text, report_file_url text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function main(): Promise<void> {
  // Case 1: unposted shipment — the GRN approval records exactly once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const row = await service.createQcInspection('t1', {
        shipmentId: 'sh-1',
        stage: 'receiving',
        inspectionDate: '2026-11-09',
        inspectorName: 'Storekeeper',
        sampleSize: 10,
        passedQuantity: 10,
        failedQuantity: 0,
        status: 'passed',
      });
      assert.equal(row.stage, 'receiving', 'The recorded row must carry the GRN stage');
      assert.equal(Number(row.passed_quantity), 10, 'Accepted quantity must be recorded');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a second GRN approval for the same shipment fails closed — no second row.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.createQcInspection('t1', {
        shipmentId: 'sh-1',
        stage: 'receiving',
        inspectionDate: '2026-11-09',
        sampleSize: 10,
        passedQuantity: 10,
        failedQuantity: 0,
      });
      await assert.rejects(
        async () =>
          service.createQcInspection('t1', {
            shipmentId: 'sh-1',
            stage: 'receiving',
            inspectionDate: '2026-11-09',
            sampleSize: 10,
            passedQuantity: 10,
            failedQuantity: 0,
          }),
        /IMPORT_GRN_ALREADY_RECORDED/,
        'A second GRN approval for the same shipment must fail closed',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'The refused second approval must not insert a row');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: posted receipt — the GRN approval is refused, no row at all.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db
        .insertInto('import_inventory_receipts' as never)
        .values({ tenant_id: 't1', shipment_id: 'sh-2', state: 'posted' } as never)
        .execute();
      await assert.rejects(
        async () =>
          service.createQcInspection('t1', {
            shipmentId: 'sh-2',
            stage: 'receiving',
            inspectionDate: '2026-11-09',
            sampleSize: 10,
            passedQuantity: 10,
            failedQuantity: 0,
          }),
        /IMPORT_GRN_RECEIPT_ALREADY_POSTED/,
        'A GRN approval for an already-posted receipt must fail closed',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 0, 'The refused approval must not insert a row');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: the gates are scoped to the GRN stage — a pre-shipment QC
  // check for a posted-receipt shipment is still recorded (China QC
  // is not a receipt approval).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db
        .insertInto('import_inventory_receipts' as never)
        .values({ tenant_id: 't1', shipment_id: 'sh-3', state: 'posted' } as never)
        .execute();
      const row = await service.createQcInspection('t1', {
        shipmentId: 'sh-3',
        stage: 'pre_shipment',
        inspectionDate: '2026-11-09',
        sampleSize: 5,
        passedQuantity: 5,
        failedQuantity: 0,
      });
      assert.equal(row.stage, 'pre_shipment', 'A non-GRN QC stage must not be blocked by the posted receipt');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one QC row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: frozen (non-posted) receipt — the GRN approval still works.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db
        .insertInto('import_inventory_receipts' as never)
        .values({ tenant_id: 't1', shipment_id: 'sh-4', state: 'legacy_review_required', review_reason: 'old receipt' } as never)
        .execute();
      const row = await service.createQcInspection('t1', {
        shipmentId: 'sh-4',
        stage: 'receiving',
        inspectionDate: '2026-11-09',
        sampleSize: 10,
        passedQuantity: 9,
        failedQuantity: 1,
      });
      assert.equal(row.stage, 'receiving', 'A GRN approval for an unposted receipt must record');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import GRN approval posted-gate tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
