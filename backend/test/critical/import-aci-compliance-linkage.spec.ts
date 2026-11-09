/*
 * I5-P12+D13: ACI records link to their container/shipment
 * (INV-IMPORT-COMPLIANCE-HS-ACI-DATES).
 *
 * WHAT WAS WRONG (live trial phase 2, problem 13): the ACI registration
 * dialog (ACID 19 digits, issue date, CargoX B/L, importer tax number,
 * exporter ID) had no container/shipment linkage field at all, although
 * the backend stores shipment_id + project_id on import_aci_compliance
 * and reads the record back by them (getAciCompliance matches id,
 * shipment_id or project_id). And the service trusted a linked id
 * blindly: upsertAciCompliance passed dto.shipmentId / dto.projectId
 * straight into the row, so a foreign UUID either failed opaquely on
 * the FK or linked another tenant's shipment.
 *
 * WHAT THIS PINS, driving the real upsertAciCompliance on PGlite:
 * - A save linked to the tenant's own shipment stores shipment_id and
 *   fills project_id from that shipment when the caller sends only the
 *   container. THIS case fails on base (no linkage is ever stored —
 *   the dialog never sent one, and the service never derived it).
 * - A save with an explicit projectId stores both ids as given.
 * - A save linked to another tenant's shipment fails closed with a
 *   named error and inserts nothing.
 * - A malformed (non-UUID) shipment id fails closed, never reaching
 *   the database as a cast error.
 * - A save with no linkage still succeeds (an ACID is issued before
 *   the container exists in the system) with null ids.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const SHIP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_SHIP_ID = '33333333-3333-4333-8333-333333333333';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_projects (
      id text PRIMARY KEY,
      tenant_id text
    );
    CREATE TABLE import_shipments (
      id text PRIMARY KEY,
      tenant_id text,
      project_id text
    );
    CREATE TABLE import_aci_compliance (
      id text PRIMARY KEY DEFAULT ('aci-' || md5(random()::text)),
      tenant_id text,
      project_id text,
      shipment_id text,
      acid_number text NOT NULL,
      acid_issue_date text,
      acid_expiry_date text,
      cargox_document_id text,
      importer_tax_number text,
      exporter_id text,
      status text DEFAULT 'pending',
      compliance_checklist jsonb DEFAULT '{}'::jsonb,
      notes text,
      created_at timestamptz DEFAULT NOW()
    );
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

async function aciCount(db: Kysely<Database>): Promise<number> {
  const rows: any[] = await (db as any).selectFrom('import_aci_compliance').select('id').execute();
  return rows.length;
}

async function seedShipment(db: Kysely<Database>, tenantId: string, shipId: string, projectId: string | null): Promise<void> {
  if (projectId) {
    await (db as any).insertInto('import_projects').values({ id: projectId, tenant_id: tenantId }).execute();
  }
  await (db as any)
    .insertInto('import_shipments')
    .values({ id: shipId, tenant_id: tenantId, project_id: projectId })
    .execute();
}

async function main(): Promise<void> {
  // Case 1: linked to the tenant's own shipment — shipment_id stored
  // and project_id filled from the shipment.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 't1', SHIP_ID, PROJECT_ID);
      const row: any = await service.upsertAciCompliance('t1', {
        acidNumber: '2609140019284719283',
        acidIssueDate: '2026-11-09',
        shipmentId: SHIP_ID,
        status: 'issued',
      });
      assert.equal(row.shipment_id, SHIP_ID, 'Shipment link stored');
      assert.equal(row.project_id, PROJECT_ID, 'Project filled from the linked shipment');
      assert.equal(row.acid_number, '2609140019284719283');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: explicit projectId + shipmentId both stored as given.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 't1', SHIP_ID, PROJECT_ID);
      const row: any = await service.upsertAciCompliance('t1', {
        acidNumber: '2609140019284719284',
        shipmentId: SHIP_ID,
        projectId: PROJECT_ID,
        status: 'issued',
      });
      assert.equal(row.shipment_id, SHIP_ID);
      assert.equal(row.project_id, PROJECT_ID);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: another tenant's shipment fails closed, inserts nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 't2', FOREIGN_SHIP_ID, null);
      await assert.rejects(
        () =>
          service.upsertAciCompliance('t1', {
            acidNumber: '2609140019284719285',
            shipmentId: FOREIGN_SHIP_ID,
            status: 'issued',
          }),
        /غير موجودة/,
        'Foreign shipment link is rejected with a named error',
      );
      assert.equal(await aciCount(db), 0, 'Nothing inserted on rejection');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: malformed shipment id fails closed, never a cast error.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        () =>
          service.upsertAciCompliance('t1', {
            acidNumber: '2609140019284719286',
            shipmentId: 'not-a-uuid',
            status: 'issued',
          }),
        /غير صالح/,
        'Malformed shipment id is rejected with a named error',
      );
      assert.equal(await aciCount(db), 0, 'Nothing inserted on rejection');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: no linkage still succeeds — an ACID is issued before the
  // container exists in the system.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const row: any = await service.upsertAciCompliance('t1', {
        acidNumber: '2609140019284719287',
        acidIssueDate: '2026-11-09',
        status: 'issued',
      });
      assert.equal(row.shipment_id, null, 'Unlinked save stores a null shipment');
      assert.equal(row.project_id, null, 'Unlinked save stores a null project');
      assert.equal(await aciCount(db), 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: another tenant's project fails closed, inserts nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 't2', FOREIGN_SHIP_ID, PROJECT_ID);
      await assert.rejects(
        () =>
          service.upsertAciCompliance('t1', {
            acidNumber: '2609140019284719288',
            projectId: PROJECT_ID,
            status: 'issued',
          }),
        /غير موجود/,
        'Foreign project link is rejected with a named error',
      );
      assert.equal(await aciCount(db), 0, 'Nothing inserted on rejection');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import ACI compliance linkage tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
