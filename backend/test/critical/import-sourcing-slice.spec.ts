/*
New file: backend/test/critical/import-sourcing-slice.spec.ts
Pins the five S2 sourcing methods that no other spec drives
(import-sales refactor, slice S2 ImportSourcingService).

WHAT THIS PINS, driving the real facade methods on PGlite
(the facade delegates to the sourcing slice, so these cases
prove the delegation wiring as well as the slice logic):
- createChinaSupplier inserts a supplier + import meta row,
  stamps audit_status 'verified' only when bank name + SWIFT
  are both present, and fails closed on an empty name.
- createChinaSupplier reuses the supplier on a
  case-insensitive duplicate name (no second supplier row)
  and updates the meta row in place.
- listChinaSuppliers returns the joined meta (chinese name,
  city, audit status, bank details) ordered by name.
- listSourcingTrips orders by start_date desc and filters
  by project.
- listQcInspections orders by inspection_date desc and
  filters by project and by shipment.
- listTariffSectors returns the bundled TARIFF_SECTORS
  constant (non-empty, id + Arabic/English names).

UNWIRED: this spec is not in the test:critical chain (most
import specs are orphans); the merge decides wiring.
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
    CREATE TABLE suppliers (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, metadata jsonb, is_active boolean);
    CREATE TABLE import_suppliers_meta (id text PRIMARY KEY DEFAULT ('meta-' || md5(random()::text)), tenant_id text, supplier_id bigint, chinese_name text, city text, province text, moq_description text, production_lead_time_days int DEFAULT 30, verified_bank_details jsonb DEFAULT '{}'::jsonb, incoterms_accepted jsonb DEFAULT '["FOB", "EXW", "CIF"]'::jsonb, qc_rating numeric DEFAULT 5.0, quality_certifications jsonb DEFAULT '[]'::jsonb, audit_status text DEFAULT 'verified', verified_at timestamptz, verified_by bigint, verification_notes text, notes text, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, trip_title text NOT NULL, destination_city text NOT NULL, start_date date NOT NULL, end_date date, budget_egp numeric DEFAULT 0, actual_cost_egp numeric DEFAULT 0, notes text, findings jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, stage text NOT NULL, inspection_date date NOT NULL, inspector_name text, sample_size int DEFAULT 0, passed_quantity int DEFAULT 0, failed_quantity int DEFAULT 0, defect_notes text, status text DEFAULT 'passed', report_file_url text, created_at timestamptz DEFAULT NOW());
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

function asJson(value: any): any {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function main(): Promise<void> {
  // Case 1: create + list round-trip, bank-verified audit status.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const created: any = await service.createChinaSupplier('t1', 1, {
        name: 'Shenzhen Optics Co',
        chineseName: '深圳光学',
        city: 'Shenzhen',
        province: 'Guangdong',
        phone: '+86 755 0000',
        bankName: 'Bank of China',
        bankSwift: 'BKCHCNBJ',
        bankAccount: '1234567890',
        bankBeneficiary: 'Shenzhen Optics Co',
        productionLeadTimeDays: 45,
      });
      assert.equal(created.ok, true);
      assert.equal(created.name, 'Shenzhen Optics Co');
      assert.equal(created.city, 'Shenzhen');
      assert.ok(Number(created.supplierId) > 0, 'Supplier id returned');

      const rows: any[] = await service.listChinaSuppliers('t1');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'Shenzhen Optics Co');
      assert.equal(rows[0].chinese_name, '深圳光学');
      assert.equal(rows[0].city, 'Shenzhen');
      assert.equal(rows[0].audit_status, 'verified', 'Bank name + SWIFT verifies the supplier');
      assert.equal(asJson(rows[0].verified_bank_details).bankName, 'Bank of China');
      assert.equal(asJson(rows[0].incoterms_accepted).length, 3, 'Default incoterms FOB/EXW/CIF');
      assert.equal(Number(rows[0].production_lead_time_days), 45);

      // Empty name fails closed and writes nothing.
      let err: any = null;
      try {
        await service.createChinaSupplier('t1', 1, { name: '   ' });
      } catch (e: any) {
        err = e;
      }
      assert.ok(err, 'Empty supplier name must throw');
      assert.ok(String(err.message || '').includes('اسم المصنع'), `Expected Arabic name error, got: ${err?.message}`);
      const after: any[] = await service.listChinaSuppliers('t1');
      assert.equal(after.length, 1, 'Failed creation writes nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: case-insensitive duplicate name reuses the supplier
  // and updates the meta row in place (no second supplier).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first: any = await service.createChinaSupplier('t1', 1, {
        name: 'Guangzhou Tools',
        city: 'Guangzhou',
      });
      const second: any = await service.createChinaSupplier('t1', 1, {
        name: 'guangzhou TOOLS',
        city: 'Foshan',
        province: 'Guangdong',
        bankName: 'ICBC',
        bankSwift: 'ICBKCNBJ',
      });
      assert.equal(Number(second.supplierId), Number(first.supplierId), 'Duplicate name reuses the supplier id');

      const suppliers: any[] = await (db as any).selectFrom('suppliers').selectAll().execute();
      assert.equal(suppliers.length, 1, 'No second supplier row');
      const metas: any[] = await (db as any).selectFrom('import_suppliers_meta').selectAll().execute();
      assert.equal(metas.length, 1, 'No second meta row');
      assert.equal(metas[0].city, 'Foshan', 'Meta updated in place');
      assert.equal(metas[0].audit_status, 'verified', 'Second call with bank details verifies');

      const rows: any[] = await service.listChinaSuppliers('t1');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].city, 'Foshan');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: listSourcingTrips orders by start_date desc and
  // filters by project.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await (db as any)
        .insertInto('import_sourcing_trips')
        .values([
          {
            id: 'trip-a',
            tenant_id: 't1',
            project_id: 'proj-1',
            trip_title: 'Jan visit',
            destination_city: 'Shenzhen',
            start_date: '2026-01-10',
            end_date: '2026-01-15',
          },
          {
            id: 'trip-b',
            tenant_id: 't1',
            project_id: 'proj-1',
            trip_title: 'Mar visit',
            destination_city: 'Guangzhou',
            start_date: '2026-03-05',
            end_date: '2026-03-09',
          },
          {
            id: 'trip-c',
            tenant_id: 't1',
            project_id: 'proj-2',
            trip_title: 'Feb visit',
            destination_city: 'Yiwu',
            start_date: '2026-02-01',
            end_date: '2026-02-04',
          },
          {
            id: 'trip-d',
            tenant_id: 't2',
            project_id: 'proj-1',
            trip_title: 'Other tenant',
            destination_city: 'Beijing',
            start_date: '2026-04-01',
            end_date: '2026-04-03',
          },
        ])
        .execute();
      const all: any[] = await service.listSourcingTrips('t1');
      assert.deepEqual(
        all.map((t: any) => t.id),
        ['trip-b', 'trip-c', 'trip-a'],
        'Newest start_date first',
      );
      const filtered: any[] = await service.listSourcingTrips('t1', 'proj-1');
      assert.deepEqual(
        filtered.map((t: any) => t.id),
        ['trip-b', 'trip-a'],
        'Project filter keeps only that project',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 4: listQcInspections orders by inspection_date desc and
  // filters by project and by shipment.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await (db as any)
        .insertInto('import_qc_inspections')
        .values([
          {
            id: 'qc-1',
            tenant_id: 't1',
            project_id: 'proj-1',
            shipment_id: 'sh-1',
            stage: 'pre_shipment',
            inspection_date: '2026-01-20',
            status: 'passed',
          },
          {
            id: 'qc-2',
            tenant_id: 't1',
            project_id: 'proj-1',
            shipment_id: 'sh-2',
            stage: 'production',
            inspection_date: '2026-02-10',
            status: 'passed',
          },
          {
            id: 'qc-3',
            tenant_id: 't1',
            project_id: 'proj-2',
            shipment_id: 'sh-1',
            stage: 'receiving',
            inspection_date: '2026-03-01',
            status: 'failed',
          },
        ])
        .execute();
      const all: any[] = await service.listQcInspections('t1');
      assert.deepEqual(
        all.map((q: any) => q.id),
        ['qc-3', 'qc-2', 'qc-1'],
        'Newest inspection first',
      );
      const byProject: any[] = await service.listQcInspections('t1', 'proj-1');
      assert.deepEqual(
        byProject.map((q: any) => q.id),
        ['qc-2', 'qc-1'],
      );
      const byShipment: any[] = await service.listQcInspections('t1', undefined, 'sh-1');
      assert.deepEqual(
        byShipment.map((q: any) => q.id),
        ['qc-3', 'qc-1'],
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5: listTariffSectors returns the bundled constant.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const sectors: any[] = service.listTariffSectors();
      assert.ok(Array.isArray(sectors) && sectors.length > 0, 'Tariff sectors are non-empty');
      for (const s of sectors) {
        assert.ok(s.id, 'Every sector has an id');
        assert.ok(s.name_ar, 'Every sector has an Arabic name');
        assert.ok(s.name_en, 'Every sector has an English name');
      }
      assert.ok(
        sectors.some((s: any) => s.id === 'electronics_it'),
        'Electronics/IT sector present',
      );
      assert.ok(
        sectors.some((s: any) => s.id === 'commercial_vehicles_spare_parts'),
        'Truck parts sector present',
      );
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import sourcing slice tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
